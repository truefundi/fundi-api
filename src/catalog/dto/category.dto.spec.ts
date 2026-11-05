import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCategoryDto, UpdateCategoryDto } from './category.dto';

describe('service category icon validation', () => {
  it.each([
    [CreateCategoryDto, { name: 'Plumbing', icon: null }],
    [UpdateCategoryDto, { icon: null }],
  ])('allows a null icon in %p', async (Dto, value) => {
    const dto = plainToInstance(Dto, value);

    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts a simple icon identifier and trims whitespace', async () => {
    const dto = plainToInstance(CreateCategoryDto, {
      name: 'Plumbing',
      icon: ' wrench ',
    });

    expect(dto.icon).toBe('wrench');
    expect(await validate(dto)).toHaveLength(0);
  });

  it.each(['https://example.com/icon.png', 'two words', ''])(
    'rejects a non-identifier icon value: %s',
    async (icon) => {
      const dto = plainToInstance(CreateCategoryDto, {
        name: 'Plumbing',
        icon,
      });

      expect(
        (await validate(dto)).some((error) => error.property === 'icon'),
      ).toBe(true);
    },
  );
});
