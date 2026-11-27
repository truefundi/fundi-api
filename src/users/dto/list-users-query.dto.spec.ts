import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListUsersQueryDto } from './list-users-query.dto';

// Mirrors how the global ValidationPipe converts and checks GET /users query strings.
describe('ListUsersQueryDto', () => {
  const validateQuery = (query: Record<string, unknown>) =>
    validate(plainToInstance(ListUsersQueryDto, query));

  // Returns the class-validator constraint names that failed for a query.
  const failedConstraints = async (query: Record<string, unknown>) =>
    (await validateQuery(query)).flatMap((error) => Object.keys(error.constraints ?? {}));

  it('accepts an empty query so paging defaults apply', async () => {
    expect(await validateQuery({})).toHaveLength(0);
  });

  it('converts query strings to integers and trims the search value', async () => {
    const dto = plainToInstance(ListUsersQueryDto, {
      page: '2',
      limit: '10',
      search: '  john  ',
    });

    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(10);
    expect(dto.search).toBe('john');
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts valid role, status, and search values', async () => {
    expect(
      await validateQuery({
        page: '1',
        limit: '20',
        role: 'TECHNICIAN',
        status: 'ACTIVE',
        search: 'john',
      }),
    ).toHaveLength(0);
  });

  it('rejects a non-numeric or out-of-range page', async () => {
    expect(await failedConstraints({ page: 'abc' })).toContain('isInt');
    expect(await failedConstraints({ page: '0' })).toContain('min');
  });

  it('rejects a non-numeric or out-of-range limit', async () => {
    expect(await failedConstraints({ limit: 'abc' })).toContain('isInt');
    expect(await failedConstraints({ limit: '101' })).toContain('max');
  });

  it('rejects an unknown role value', async () => {
    expect(await failedConstraints({ role: 'SUPERADMIN' })).toContain('isEnum');
  });

  it('rejects an unknown status value', async () => {
    expect(await failedConstraints({ status: 'PENDING' })).toContain('isEnum');
  });

  it('rejects an empty or whitespace-only search', async () => {
    expect(await failedConstraints({ search: '' })).toContain('isNotEmpty');
    expect(await failedConstraints({ search: '   ' })).toContain('isNotEmpty');
  });

  it('rejects a search longer than the allowed length', async () => {
    expect(await failedConstraints({ search: 'a'.repeat(201) })).toContain('maxLength');
  });
});
