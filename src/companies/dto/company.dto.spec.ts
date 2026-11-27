import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { VerificationStatus } from '@prisma/client';
import { UpdateCompanyVerificationDto } from './company.dto';

const errorsFor = async (body: object) =>
  validate(plainToInstance(UpdateCompanyVerificationDto, body));

describe('UpdateCompanyVerificationDto', () => {
  it('requires a reason when rejecting a company', async () => {
    const missing = await errorsFor({ verificationStatus: VerificationStatus.REJECTED });
    const blank = await errorsFor({ verificationStatus: VerificationStatus.REJECTED, reason: '   ' });
    expect(missing.map((error) => error.property)).toContain('reason');
    expect(blank.map((error) => error.property)).toContain('reason');
  });

  it('accepts a rejection with a reason', async () => {
    const errors = await errorsFor({
      verificationStatus: VerificationStatus.REJECTED,
      reason: 'The registration number does not match RDB records.',
    });
    expect(errors).toHaveLength(0);
  });

  it('approves without a reason', async () => {
    expect(await errorsFor({ verificationStatus: VerificationStatus.APPROVED })).toHaveLength(0);
  });
});
