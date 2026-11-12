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

  describe('service category keywords validation', () => {
    it('accepts omitted and empty keywords', async () => {
      const omitted = plainToInstance(CreateCategoryDto, { name: 'Plumbing' });
      const empty = plainToInstance(UpdateCategoryDto, { keywords: '   ' });

      expect(await validate(omitted)).toHaveLength(0);
      expect(empty.keywords).toBe('');
      expect(await validate(empty)).toHaveLength(0);
    });

    it('trims keywords and rejects non-string or overlong values', async () => {
      const trimmed = plainToInstance(CreateCategoryDto, {
        name: 'Plumbing',
        keywords: '  leak repair, pipes  ',
      });
      const invalid = plainToInstance(UpdateCategoryDto, { keywords: null });
      const tooLong = plainToInstance(UpdateCategoryDto, {
        keywords: 'a'.repeat(501),
      });

      expect(trimmed.keywords).toBe('leak repair, pipes');
      expect(await validate(trimmed)).toHaveLength(0);
      expect(
        (await validate(invalid)).some(
          (error) => error.property === 'keywords',
        ),
      ).toBe(true);
      expect(
        (await validate(tooLong)).some(
          (error) => error.property === 'keywords',
        ),
      ).toBe(true);
    });
  });

  describe('service category fee validation', () => {
    it('rejects null for non-nullable booking fees', async () => {
      const create = plainToInstance(CreateCategoryDto, {
        name: 'Plumbing',
        bookingFee: null,
        emergencyVisitFee: null,
      });
      const update = plainToInstance(UpdateCategoryDto, {
        bookingFee: null,
        emergencyVisitFee: null,
      });

      const createErrors = await validate(create);
      const updateErrors = await validate(update);
      expect(createErrors.map((error) => error.property)).toEqual(
        expect.arrayContaining(['bookingFee', 'emergencyVisitFee']),
      );
      expect(updateErrors.map((error) => error.property)).toEqual(
        expect.arrayContaining(['bookingFee', 'emergencyVisitFee']),
      );
    });
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
