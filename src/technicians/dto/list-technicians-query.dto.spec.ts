import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListTechniciansQueryDto } from './list-technicians-query.dto';

// Mirrors how the global ValidationPipe converts and checks technician list
// query strings (inherited page/limit included).
describe('ListTechniciansQueryDto', () => {
  const validateQuery = (query: Record<string, unknown>) =>
    validate(plainToInstance(ListTechniciansQueryDto, query));

  // Returns the class-validator constraint names that failed for a query.
  const failedConstraints = async (query: Record<string, unknown>) =>
    (await validateQuery(query)).flatMap((error) =>
      Object.keys(error.constraints ?? {}),
    );

  it('accepts an empty query so paging defaults apply', async () => {
    expect(await validateQuery({})).toHaveLength(0);
  });

  it('converts query strings to integers and trims text filters', async () => {
    const dto = plainToInstance(ListTechniciansQueryDto, {
      page: '2',
      limit: '10',
      search: '  amina  ',
      location: '  kigali  ',
      category: '  Plumbing  ',
      minYearsOfExperience: '3',
    });

    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(10);
    expect(dto.search).toBe('amina');
    expect(dto.location).toBe('kigali');
    expect(dto.category).toBe('Plumbing');
    expect(dto.minYearsOfExperience).toBe(3);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts valid status enums and a category UUID', async () => {
    expect(
      await validateQuery({
        verificationStatus: 'APPROVED',
        availabilityStatus: 'ONLINE',
        status: 'ACTIVE',
        categoryId: 'e5a4f4d7-0b21-46d8-9a4b-98765d332100',
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

  it('rejects unknown enum values', async () => {
    expect(await failedConstraints({ verificationStatus: 'SUPERSEDED' })).toContain(
      'isEnum',
    );
    expect(await failedConstraints({ availabilityStatus: 'AWAY' })).toContain(
      'isEnum',
    );
    expect(await failedConstraints({ status: 'SUSPENDED' })).toContain('isEnum');
  });

  it('rejects an empty or whitespace-only text filter', async () => {
    expect(await failedConstraints({ search: '' })).toContain('isNotEmpty');
    expect(await failedConstraints({ search: '   ' })).toContain('isNotEmpty');
    expect(await failedConstraints({ location: '   ' })).toContain('isNotEmpty');
    expect(await failedConstraints({ category: '' })).toContain('isNotEmpty');
  });

  it('rejects a search longer than the allowed length', async () => {
    expect(await failedConstraints({ search: 'a'.repeat(201) })).toContain(
      'maxLength',
    );
  });

  it('rejects a non-UUID categoryId', async () => {
    expect(await failedConstraints({ categoryId: 'not-a-uuid' })).toContain(
      'isUuid',
    );
  });

  it('rejects a non-numeric, negative, or excessive experience filter', async () => {
    expect(
      await failedConstraints({ minYearsOfExperience: 'abc' }),
    ).toContain('isInt');
    expect(
      await failedConstraints({ minYearsOfExperience: '-1' }),
    ).toContain('min');
    expect(
      await failedConstraints({ minYearsOfExperience: '61' }),
    ).toContain('max');
  });
});
