import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { MatchingTechniciansByLocationDto } from './matching-technicians-by-location.dto';

const serviceCategoryId = 'c5a4f4d7-0b21-46d8-9a4b-98765d332100';

describe('MatchingTechniciansByLocationDto', () => {
  it('accepts text locations with null coordinates', () => {
    const dto = plainToInstance(MatchingTechniciansByLocationDto, {
      serviceCategoryId,
      locations: ['Kigali'],
      latitude: null,
      longitude: null,
    });

    expect(validateSync(dto)).toHaveLength(0);
    expect(dto).toMatchObject({
      locations: ['Kigali'],
      latitude: null,
      longitude: null,
    });
  });

  it('accepts coordinates with a null text-location list', () => {
    const dto = plainToInstance(MatchingTechniciansByLocationDto, {
      serviceCategoryId,
      locations: null,
      latitude: -1.9536,
      longitude: 30.0606,
    });

    expect(validateSync(dto)).toHaveLength(0);
    expect(dto.locations).toBeNull();
  });
});
