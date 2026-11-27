import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateStatusDto } from './update-status.dto';

// The body of PATCH /users/:id/status accepts only the existing ACTIVE/INACTIVE statuses.
describe('UpdateStatusDto', () => {
  const validateBody = (body: Record<string, unknown>) =>
    validate(plainToInstance(UpdateStatusDto, body));

  it('accepts ACTIVE and INACTIVE', async () => {
    expect(await validateBody({ status: 'ACTIVE' })).toHaveLength(0);
    expect(await validateBody({ status: 'INACTIVE' })).toHaveLength(0);
  });

  it('rejects an unknown status value', async () => {
    const errors = await validateBody({ status: 'PENDING' });

    expect(errors.flatMap((error) => Object.keys(error.constraints ?? {}))).toContain('isEnum');
  });

  it('rejects a missing status field', async () => {
    expect(await validateBody({})).not.toHaveLength(0);
  });
});
