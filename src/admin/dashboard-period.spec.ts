import { BadRequestException } from '@nestjs/common';
import { DashboardPeriod, DashboardQueryDto } from './dto/dashboard-query.dto';
import { resolveDashboardRange } from './dashboard-period';

describe('resolveDashboardRange', () => {
  it('resolves a Kigali calendar day to its UTC boundaries', () => {
    const range = resolveDashboardRange(
      {
        period: DashboardPeriod.TODAY,
        timezone: 'Africa/Kigali',
      } as DashboardQueryDto,
      new Date('2026-11-13T04:30:00.000Z'),
    );

    expect(range.from.toISOString()).toBe('2026-11-12T22:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-11-13T22:00:00.000Z');
  });

  it('accounts for daylight-saving transitions in the selected timezone', () => {
    const springForward = resolveDashboardRange(
      {
        period: DashboardPeriod.TODAY,
        timezone: 'America/New_York',
      } as DashboardQueryDto,
      new Date('2024-03-10T12:00:00.000Z'),
    );
    const fallBack = resolveDashboardRange(
      {
        period: DashboardPeriod.TODAY,
        timezone: 'America/New_York',
      } as DashboardQueryDto,
      new Date('2024-11-03T12:00:00.000Z'),
    );

    expect(springForward.to.getTime() - springForward.from.getTime()).toBe(
      23 * 60 * 60 * 1000,
    );
    expect(fallBack.to.getTime() - fallBack.from.getTime()).toBe(
      25 * 60 * 60 * 1000,
    );
  });

  it('resolves selected months and years using exclusive end boundaries', () => {
    const month = resolveDashboardRange({
      period: DashboardPeriod.SELECTED_MONTH,
      month: '2024-02',
      timezone: 'UTC',
    } as DashboardQueryDto);
    const year = resolveDashboardRange({
      period: DashboardPeriod.SELECTED_YEAR,
      year: 2025,
      timezone: 'UTC',
    } as DashboardQueryDto);

    expect(month.from.toISOString()).toBe('2024-02-01T00:00:00.000Z');
    expect(month.to.toISOString()).toBe('2024-03-01T00:00:00.000Z');
    expect(year.from.toISOString()).toBe('2025-01-01T00:00:00.000Z');
    expect(year.to.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('accepts a custom range and rejects invalid period parameters', () => {
    expect(
      resolveDashboardRange({
        period: DashboardPeriod.CUSTOM,
        from: '2025-01-01T00:00:00.000Z',
        to: '2025-01-02T00:00:00.000Z',
      } as DashboardQueryDto).to.toISOString(),
    ).toBe('2025-01-02T00:00:00.000Z');

    expect(() =>
      resolveDashboardRange({
        period: DashboardPeriod.SELECTED_MONTH,
        month: '2025-13',
      } as DashboardQueryDto),
    ).toThrow(BadRequestException);
    expect(() =>
      resolveDashboardRange({
        period: DashboardPeriod.SELECTED_MONTH,
        month: '0099-01',
      } as DashboardQueryDto),
    ).toThrow(BadRequestException);
    expect(() =>
      resolveDashboardRange({
        period: DashboardPeriod.CUSTOM,
        from: '2025-01-02T00:00:00.000Z',
        to: '2025-01-01T00:00:00.000Z',
      } as DashboardQueryDto),
    ).toThrow(BadRequestException);
    expect(() =>
      resolveDashboardRange({
        period: DashboardPeriod.TODAY,
        timezone: 'not-a-timezone',
      } as DashboardQueryDto),
    ).toThrow(BadRequestException);
  });
});
