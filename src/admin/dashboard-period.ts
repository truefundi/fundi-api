import { BadRequestException } from '@nestjs/common';
import { DashboardPeriod, DashboardQueryDto } from './dto/dashboard-query.dto';

export interface DashboardRange {
  from: Date;
  to: Date;
  timezone: string;
  period: DashboardPeriod;
}

function localParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function zonedMidnight(
  year: number,
  month: number,
  day: number,
  timezone: string,
) {
  const utcGuess = Date.UTC(year, month - 1, day);
  const local = localParts(new Date(utcGuess), timezone);
  const representedAsUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  const offset = representedAsUtc - utcGuess;
  return new Date(utcGuess - offset);
}

function shiftCalendarDate(
  year: number,
  month: number,
  day: number,
  deltaDays: number,
) {
  const shifted = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export function resolveDashboardRange(
  query: DashboardQueryDto,
  now = new Date(),
): DashboardRange {
  const timezone = query.timezone ?? 'UTC';
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format(now);
  } catch {
    throw new BadRequestException('timezone must be a valid IANA timezone.');
  }

  const period = query.period ?? DashboardPeriod.CURRENT_MONTH;
  const today = localParts(now, timezone);
  let from: Date;
  let to: Date;

  switch (period) {
    case DashboardPeriod.TODAY:
      from = zonedMidnight(today.year, today.month, today.day, timezone);
      to = zonedMidnight(
        ...(Object.values(
          shiftCalendarDate(today.year, today.month, today.day, 1),
        ) as [number, number, number]),
        timezone,
      );
      break;
    case DashboardPeriod.LAST_7_DAYS: {
      const start = shiftCalendarDate(today.year, today.month, today.day, -6);
      from = zonedMidnight(start.year, start.month, start.day, timezone);
      to = zonedMidnight(
        ...(Object.values(
          shiftCalendarDate(today.year, today.month, today.day, 1),
        ) as [number, number, number]),
        timezone,
      );
      break;
    }
    case DashboardPeriod.CURRENT_MONTH:
      from = zonedMidnight(today.year, today.month, 1, timezone);
      to = zonedMidnight(
        today.month === 12 ? today.year + 1 : today.year,
        today.month === 12 ? 1 : today.month + 1,
        1,
        timezone,
      );
      break;
    case DashboardPeriod.SELECTED_MONTH: {
      if (
        !query.month ||
        !/^\d{4}-(0[1-9]|1[0-2])$/.test(query.month) ||
        query.year !== undefined
      ) {
        throw new BadRequestException(
          'Provide month=YYYY-MM only when period=month.',
        );
      }
      const [year, month] = query.month.split('-').map(Number);
      if (year < 2000 || year > 9999) {
        throw new BadRequestException(
          'The selected month year must be between 2000 and 9999.',
        );
      }
      from = zonedMidnight(year, month, 1, timezone);
      to = zonedMidnight(
        month === 12 ? year + 1 : year,
        month === 12 ? 1 : month + 1,
        1,
        timezone,
      );
      break;
    }
    case DashboardPeriod.CURRENT_YEAR:
      from = zonedMidnight(today.year, 1, 1, timezone);
      to = zonedMidnight(today.year + 1, 1, 1, timezone);
      break;
    case DashboardPeriod.SELECTED_YEAR:
      if (
        query.year === undefined ||
        !Number.isInteger(query.year) ||
        query.year < 2000 ||
        query.year > 9999 ||
        query.month !== undefined
      ) {
        throw new BadRequestException(
          'Provide year=YYYY only when period=year.',
        );
      }
      from = zonedMidnight(query.year, 1, 1, timezone);
      to = zonedMidnight(query.year + 1, 1, 1, timezone);
      break;
    case DashboardPeriod.CUSTOM:
      if (!query.from || !query.to) {
        throw new BadRequestException(
          'Provide both from and to when period=custom.',
        );
      }
      from = new Date(query.from);
      to = new Date(query.to);
      if (
        !Number.isFinite(from.getTime()) ||
        !Number.isFinite(to.getTime()) ||
        from >= to
      ) {
        throw new BadRequestException(
          'The from date must be earlier than the exclusive to date.',
        );
      }
      break;
    default:
      throw new BadRequestException('Unsupported dashboard period.');
  }

  if (
    period !== DashboardPeriod.SELECTED_MONTH &&
    period !== DashboardPeriod.SELECTED_YEAR &&
    (query.month !== undefined || query.year !== undefined)
  ) {
    throw new BadRequestException(
      'month and year are only valid with their matching period.',
    );
  }
  if (period !== DashboardPeriod.CUSTOM && (query.from || query.to)) {
    throw new BadRequestException(
      'from and to are only valid when period=custom.',
    );
  }
  return { from, to, timezone, period };
}
