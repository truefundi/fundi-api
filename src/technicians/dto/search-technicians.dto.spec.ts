import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SearchTechniciansDto } from './search-technicians.dto';

// Verifies the admin search DTO accepts every inherited list filter alongside
// its own broad `query` sweep and national-ID normalisation.
describe('SearchTechniciansDto', () => {
  const validateQuery = (query: Record<string, unknown>) =>
    validate(plainToInstance(SearchTechniciansDto, query));

  const failedConstraints = async (query: Record<string, unknown>) =>
    (await validateQuery(query)).flatMap((error) =>
      Object.keys(error.constraints ?? {}),
    );

  it('accepts an empty query so paging defaults apply', async () => {
    expect(await validateQuery({})).toHaveLength(0);
  });

  it('converts inherited list filters together with query and nationalIdNumber', async () => {
    const dto = plainToInstance(SearchTechniciansDto, {
      page: '2',
      limit: '5',
      search: '  amina  ',
      verificationStatus: 'APPROVED',
      query: '  Kigali  ',
      nationalIdNumber: '  id123-456  ',
    });

    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(5);
    expect(dto.search).toBe('amina');
    expect(dto.verificationStatus).toBe('APPROVED');
    expect(dto.query).toBe('Kigali');
    expect(dto.nationalIdNumber).toBe('ID123456');
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects an empty or whitespace-only query', async () => {
    expect(await failedConstraints({ query: '' })).toContain('minLength');
    expect(await failedConstraints({ query: '   ' })).toContain('minLength');
  });

  it('rejects a malformed national ID number', async () => {
    expect(await failedConstraints({ nationalIdNumber: 'ID' })).toContain(
      'minLength',
    );
    expect(
      await failedConstraints({ nationalIdNumber: 'not valid!!' }),
    ).toContain('matches');
  });

  it('still rejects invalid inherited paging values', async () => {
    expect(await failedConstraints({ page: '0' })).toContain('min');
    expect(await failedConstraints({ limit: '101' })).toContain('max');
  });
});
