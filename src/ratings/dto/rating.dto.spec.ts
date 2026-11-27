import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateJobRatingDto, UpdateJobRatingDto } from './job-rating.dto';
import { CreateRatingItemDto, UpdateRatingItemDto } from './rating-item.dto';

describe('rating DTO validation', () => {
  const itemId = '00d85d71-96c8-4302-9989-194150e451d1';
  const anotherItemId = '84756e14-f08a-4a43-92b2-c80f2ef1c2a8';

  it('trims and validates rating items', async () => {
    const valid = plainToInstance(CreateRatingItemDto, {
      name: '  Time management ',
      description: '  Arrived at the agreed time. ',
      sortOrder: 2,
    });
    const invalid = plainToInstance(UpdateRatingItemDto, { name: null });

    expect(valid.name).toBe('Time management');
    expect(valid.description).toBe('Arrived at the agreed time.');
    expect(await validate(valid)).toHaveLength(0);
    expect(
      (await validate(invalid)).some((error) => error.property === 'name'),
    ).toBe(true);
  });

  it('requires unique rating item IDs and whole-number scores from 1 to 5', async () => {
    const valid = plainToInstance(CreateJobRatingDto, {
      responses: [
        { itemId, score: 1 },
        { itemId: anotherItemId, score: 5 },
      ],
    });
    const duplicate = plainToInstance(CreateJobRatingDto, {
      responses: [
        { itemId, score: 3 },
        { itemId, score: 4 },
      ],
    });
    const outOfRange = plainToInstance(CreateJobRatingDto, {
      responses: [{ itemId, score: 6 }],
    });

    expect(await validate(valid)).toHaveLength(0);
    expect(
      (await validate(duplicate)).some(
        (error) => error.property === 'responses',
      ),
    ).toBe(true);
    expect(
      (await validate(outOfRange)).some(
        (error) => error.property === 'responses',
      ),
    ).toBe(true);
  });

  it('allows admins to clear comments without requiring score replacement', async () => {
    const valid = plainToInstance(UpdateJobRatingDto, { comment: null });
    const invalid = plainToInstance(UpdateJobRatingDto, {
      responses: null,
    });

    expect(await validate(valid)).toHaveLength(0);
    expect(
      (await validate(invalid)).some((error) => error.property === 'responses'),
    ).toBe(true);
  });
});
