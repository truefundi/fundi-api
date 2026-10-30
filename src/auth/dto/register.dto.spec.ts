import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PhoneDto } from './phone.dto';
import { RegisterDto } from './register.dto';

describe('Rwandan phone and registration validation', () => {
  it.each([
    ['0788123456', '+250788123456'],
    ['0798123456', '+250798123456'],
    ['0728123456', '+250728123456'],
    ['0738123456', '+250738123456'],
    ['+250788123456', '+250788123456'],
    ['(+250) 788-123456', '+250788123456'],
  ])('normalizes %s to %s', (phoneNumber, normalizedPhoneNumber) => {
    const dto = plainToInstance(PhoneDto, { phoneNumber });

    expect(dto.phoneNumber).toBe(normalizedPhoneNumber);
    expect(validateSync(dto)).toHaveLength(0);
  });

  it.each(['078812345', '0708123456', '+250708123456', '+12025550123'])(
    'rejects unsupported phone number %s',
    (phoneNumber) => {
      const dto = plainToInstance(PhoneDto, { phoneNumber });

      expect(validateSync(dto).some((error) => error.property === 'phoneNumber')).toBe(
        true,
      );
    },
  );

  it('accepts and normalizes a standard email address during registration', () => {
    const dto = plainToInstance(RegisterDto, {
      fullName: 'Amina Example',
      phoneNumber: '0788123456',
      email: '  Amina.Example@Example.com  ',
    });

    expect(dto.email).toBe('amina.example@example.com');
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejects a malformed email address during registration', () => {
    const dto = plainToInstance(RegisterDto, {
      fullName: 'Amina Example',
      phoneNumber: '0788123456',
      email: 'amina.example@',
    });

    expect(validateSync(dto).some((error) => error.property === 'email')).toBe(true);
  });
});
