import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PinLoginDto } from './pin-login.dto';
import { PinRegisterDto } from './pin-register.dto';

describe('phone/PIN auth DTOs', () => {
  it.each(['1234', '123456'])('accepts a %s digit PIN', async (pin) => {
    const login = plainToInstance(PinLoginDto, {
      phoneNumber: '+250788123456',
      pin,
    });
    const register = plainToInstance(PinRegisterDto, {
      phoneNumber: '+250788123456',
      fullName: '  Amina Example ',
      pin,
    });

    expect(await validate(login)).toHaveLength(0);
    expect(await validate(register)).toHaveLength(0);
    expect(register.fullName).toBe('Amina Example');
  });

  it.each(['123', '1234567', '12ab'])('rejects invalid PIN %s', async (pin) => {
    const dto = plainToInstance(PinLoginDto, {
      phoneNumber: '+250788123456',
      pin,
    });

    expect(
      (await validate(dto)).some((error) => error.property === 'pin'),
    ).toBe(true);
  });

  it('requires a full name during PIN registration', async () => {
    const dto = plainToInstance(PinRegisterDto, {
      phoneNumber: '+250788123456',
      pin: '1234',
    });

    expect(
      (await validate(dto)).some((error) => error.property === 'fullName'),
    ).toBe(true);
  });
});
