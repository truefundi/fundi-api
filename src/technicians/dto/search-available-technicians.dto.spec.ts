import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SearchAvailableTechniciansDto } from './search-available-technicians.dto';

// Mirrors how the global ValidationPipe converts and checks discovery query
// strings: paging is inherited, and only discovery-safe filters exist here.
describe('SearchAvailableTechniciansDto', () => {
  const validateQuery = (query: Record<string, unknown>) =>
    validate(plainToInstance(SearchAvailableTechniciansDto, query));

  const failedConstraints = async (query: Record<string, unknown>) =>
    (await validateQuery(query)).flatMap((error) =>
      Object.keys(error.constraints ?? {}),
    );

  it('accepts an empty query so paging defaults apply', async () => {
    expect(await validateQuery({})).toHaveLength(0);
  });

  it('converts paging and experience filters and trims text filters', async () => {
    const dto = plainToInstance(SearchAvailableTechniciansDto, {
      page: '3',
      limit: '10',
      query: '  solar  ',
      location: '  kigali  ',
      category: '  Plumbing  ',
      minYearsOfExperience: '2',
    });

    expect(dto.page).toBe(3);
    expect(dto.limit).toBe(10);
    expect(dto.query).toBe('solar');
    expect(dto.location).toBe('kigali');
    expect(dto.category).toBe('Plumbing');
    expect(dto.minYearsOfExperience).toBe(2);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects an invalid category UUID', async () => {
    expect(await failedConstraints({ categoryId: 'nope' })).toContain('isUuid');
  });

  it('rejects an empty text filter', async () => {
    expect(await failedConstraints({ query: '   ' })).toContain('isNotEmpty');
    expect(await failedConstraints({ location: '' })).toContain('isNotEmpty');
    expect(await failedConstraints({ category: '' })).toContain('isNotEmpty');
  });

  it('rejects a non-numeric or out-of-range experience filter', async () => {
    expect(
      await failedConstraints({ minYearsOfExperience: 'abc' }),
    ).toContain('isInt');
    expect(
      await failedConstraints({ minYearsOfExperience: '-1' }),
    ).toContain('min');
  });
});
