import { BadRequestException } from '@nestjs/common';
import { PagedQueryDto } from './dto/paged-query.dto';
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
} from './dto/pagination.constants';

export function resolveAdminPaging(query: PagedQueryDto) {
  const page = query.page ?? DEFAULT_PAGE;
  const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
  const skip = (page - 1) * limit;
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_PAGE_LIMIT ||
    !Number.isSafeInteger(skip) ||
    skip > 2_147_483_647
  ) {
    throw new BadRequestException(
      `Use a positive page and a limit between 1 and ${MAX_PAGE_LIMIT}; the offset must fit a PostgreSQL integer.`,
    );
  }
  return { page, limit, skip };
}

export function paginationMeta(page: number, limit: number, total: number) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}
