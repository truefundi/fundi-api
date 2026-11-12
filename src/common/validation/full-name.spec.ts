import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterDto } from '../../auth/dto/register.dto';
import { CreateUserDto } from '../../users/dto/create-user.dto';
import { UpdateAccountDto } from '../../users/dto/update-account.dto';
import { CreateTechnicianUserDto } from '../../technicians/dto/create-technician.dto';

describe('full name validation', () => {
  const validPhone = '+250788123456';

  it('accepts Unicode names with spaces, apostrophes, and hyphens', async () => {
    const dto = plainToInstance(RegisterDto, {
      fullName: '  Zoë   D’Amato-Smith ',
      phoneNumber: validPhone,
    });
    const errors = await validate(dto);

    expect(dto.fullName).toBe('Zoë D’Amato-Smith');
    expect(errors).toHaveLength(0);
  });

  it.each(['Amina2 Example', 'Prince_Example', 'Jean! Example', 'Name@Home'])(
    'rejects names containing unsupported characters: %s',
    async (fullName) => {
      const dto = plainToInstance(RegisterDto, {
        fullName,
        phoneNumber: validPhone,
      });

      expect(
        (await validate(dto)).some((error) => error.property === 'fullName'),
      ).toBe(true);
    },
  );

  it('rejects null instead of treating it as an omitted full name', async () => {
    const dto = plainToInstance(UpdateAccountDto, { fullName: null });

    expect(
      (await validate(dto)).some((error) => error.property === 'fullName'),
    ).toBe(true);
  });

  it.each([
    [CreateUserDto, { fullName: 'Amina2 Example', phoneNumber: validPhone }],
    [UpdateAccountDto, { fullName: 'Amina2 Example' }],
    [
      CreateTechnicianUserDto,
      { fullName: 'Amina2 Example', phoneNumber: validPhone },
    ],
  ])('applies name validation to %p', async (Dto, value) => {
    const dto = plainToInstance(Dto, value);

    expect(
      (await validate(dto)).some((error) => error.property === 'fullName'),
    ).toBe(true);
  });
});
