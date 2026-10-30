import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../auth/roles.decorator';
import { JobsController } from './jobs.controller';
import { TechnicianJobsController } from './technician-jobs.controller';
import { JobsService } from './jobs.service';
import { AuthService } from '../auth/auth.service';

describe('job cooperation confirmation controllers', () => {
  const jobs = { confirmCooperation: jest.fn() };
  const customerController = new JobsController(
    jobs as unknown as JobsService,
    {} as AuthService,
  );
  const technicianController = new TechnicianJobsController(
    jobs as unknown as JobsService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('routes customer confirmation to the customer side', () => {
    const user = { id: 'customer-1', role: UserRole.CUSTOMER };
    const jobId = 'job-1';

    customerController.confirmCooperation(user, jobId);

    expect(jobs.confirmCooperation).toHaveBeenCalledWith(
      user.id,
      jobId,
      'customer',
    );
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        JobsController.prototype.confirmCooperation,
      ),
    ).toBe('mine/:jobId/confirm-cooperation');
    expect(
      Reflect.getMetadata(
        METHOD_METADATA,
        JobsController.prototype.confirmCooperation,
      ),
    ).toBe(RequestMethod.POST);
  });

  it('routes technician confirmation to the technician side', () => {
    const user = { id: 'technician-1', role: UserRole.TECHNICIAN };
    const jobId = 'job-1';

    technicianController.confirmCooperation(user, jobId);

    expect(jobs.confirmCooperation).toHaveBeenCalledWith(
      user.id,
      jobId,
      'technician',
    );
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        TechnicianJobsController.prototype.confirmCooperation,
      ),
    ).toBe('mine/:jobId/confirm-cooperation');
    expect(
      Reflect.getMetadata(
        METHOD_METADATA,
        TechnicianJobsController.prototype.confirmCooperation,
      ),
    ).toBe(RequestMethod.POST);
  });

  it('allows the customer job endpoint for both customer and technician accounts', () => {
    expect(Reflect.getMetadata(ROLES_KEY, JobsController)).toEqual([
      UserRole.CUSTOMER,
      UserRole.TECHNICIAN,
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, TechnicianJobsController)).toEqual([
      UserRole.TECHNICIAN,
    ]);
  });
});
