import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCategoryDto, UpdateCategoryDto } from './category.dto';
import { CreateServiceDto, UpdateServiceDto } from './service.dto';

describe('catalog DTO validation', () => {
  const categoryId = '84cfa9af-05d4-40c1-ad36-123e412ec509';

  it('requires a category name and description', async () => {
    const valid = plainToInstance(CreateCategoryDto, {
      name: ' Home Services ',
      description: ' Repairs and maintenance for homes. ',
    });
    const missingDescription = plainToInstance(CreateCategoryDto, {
      name: 'Home Services',
    });

    expect(valid.name).toBe('Home Services');
    expect(valid.description).toBe('Repairs and maintenance for homes.');
    expect(await validate(valid)).toHaveLength(0);
    expect(
      (await validate(missingDescription)).map((error) => error.property),
    ).toContain('description');
  });

  it('rejects null values for non-nullable category and service fields', async () => {
    const categoryUpdate = plainToInstance(UpdateCategoryDto, {
      name: null,
      description: null,
      isActive: null,
    });
    const serviceUpdate = plainToInstance(UpdateServiceDto, {
      name: null,
      categoryId: null,
      description: null,
      isActive: null,
    });

    expect(
      (await validate(categoryUpdate)).map((error) => error.property),
    ).toEqual(expect.arrayContaining(['name', 'description', 'isActive']));
    expect(
      (await validate(serviceUpdate)).map((error) => error.property),
    ).toEqual(
      expect.arrayContaining(['name', 'categoryId', 'description', 'isActive']),
    );
  });

  it('allows nullable icons on services and rejects invalid icon identifiers', async () => {
    const nullIcon = plainToInstance(CreateServiceDto, {
      name: 'Plumbing',
      categoryId,
      icon: null,
    });
    const invalidIcon = plainToInstance(UpdateServiceDto, {
      icon: 'not an icon',
    });

    expect(await validate(nullIcon)).toHaveLength(0);
    expect(
      (await validate(invalidIcon)).some((error) => error.property === 'icon'),
    ).toBe(true);
  });

  it('requires services to reference a category ID', async () => {
    const missingCategory = plainToInstance(CreateServiceDto, {
      name: 'Plumbing',
    });
    const invalidCategory = plainToInstance(CreateServiceDto, {
      name: 'Plumbing',
      categoryId: 'not-a-uuid',
    });
    const valid = plainToInstance(CreateServiceDto, {
      name: 'Plumbing',
      categoryId,
    });

    expect(
      (await validate(missingCategory)).map((error) => error.property),
    ).toContain('categoryId');
    expect(
      (await validate(invalidCategory)).some(
        (error) => error.property === 'categoryId',
      ),
    ).toBe(true);
    expect(await validate(valid)).toHaveLength(0);
  });

  it('trims optional service keywords and rejects non-strings or overlong values', async () => {
    const trimmed = plainToInstance(CreateServiceDto, {
      name: 'Plumbing',
      categoryId,
      keywords: '  leak repair, pipes  ',
    });
    const invalid = plainToInstance(UpdateServiceDto, { keywords: null });
    const tooLong = plainToInstance(UpdateServiceDto, {
      keywords: 'a'.repeat(501),
    });

    expect(trimmed.keywords).toBe('leak repair, pipes');
    expect(await validate(trimmed)).toHaveLength(0);
    expect(
      (await validate(invalid)).some((error) => error.property === 'keywords'),
    ).toBe(true);
    expect(
      (await validate(tooLong)).some((error) => error.property === 'keywords'),
    ).toBe(true);
  });

  it('rejects null for non-nullable service booking fees', async () => {
    const create = plainToInstance(CreateServiceDto, {
      name: 'Plumbing',
      categoryId,
      bookingFee: null,
      emergencyVisitFee: null,
    });
    const update = plainToInstance(UpdateServiceDto, {
      bookingFee: null,
      emergencyVisitFee: null,
    });

    expect((await validate(create)).map((error) => error.property)).toEqual(
      expect.arrayContaining(['bookingFee', 'emergencyVisitFee']),
    );
    expect((await validate(update)).map((error) => error.property)).toEqual(
      expect.arrayContaining(['bookingFee', 'emergencyVisitFee']),
    );
  });
});
