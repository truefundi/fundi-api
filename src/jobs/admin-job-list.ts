import { JobStatus, Prisma } from '@prisma/client';
import {
  AdminJobGroup,
  ListAdminJobsQueryDto,
} from './dto/list-admin-jobs-query.dto';

// List rows intentionally omit offers, media, history, and signed image URLs.
export const ADMIN_JOB_LIST_SELECT = {
  id: true,
  reference: true,
  description: true,
  otherServiceName: true,
  locationAddress: true,
  latitude: true,
  longitude: true,
  offeredAmount: true,
  currency: true,
  priority: true,
  requestType: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
  customer: { select: { id: true, fullName: true, phoneNumber: true } },
  technician: { select: { id: true, user: { select: { fullName: true } } } },
  serviceCategory: { select: { id: true, name: true, slug: true } },
  bookingPayment: { select: { amount: true, status: true } },
  dispute: { select: { id: true, resolvedAt: true } },
} satisfies Prisma.JobSelect;

export function adminJobWhere(
  query: ListAdminJobsQueryDto,
): Prisma.JobWhereInput {
  const conditions: Prisma.JobWhereInput[] = [];
  if (query.status) conditions.push({ status: query.status });
  const groups: Record<
    Exclude<AdminJobGroup, AdminJobGroup.DISPUTED>,
    JobStatus[]
  > = {
    matching: [JobStatus.OPEN],
    in_progress: [JobStatus.ASSIGNED, JobStatus.PAUSED],
    completed: [JobStatus.COMPLETED],
    cancelled: [JobStatus.CANCELLED, JobStatus.FAILED],
  };
  if (query.group === AdminJobGroup.DISPUTED) {
    conditions.push({ dispute: { is: { resolvedAt: null } } });
  } else if (query.group) {
    conditions.push({ status: { in: groups[query.group] } });
  }
  if (query.search) {
    const contains = { contains: query.search, mode: 'insensitive' as const };
    conditions.push({
      OR: [
        { reference: contains },
        { description: contains },
        { locationAddress: contains },
        { otherServiceName: contains },
        { serviceCategory: { is: { name: contains } } },
        { customer: { fullName: contains } },
        { technician: { is: { user: { fullName: contains } } } },
      ],
    });
  }
  return {
    ...(conditions.length ? { AND: conditions } : {}),
    ...(query.priority ? { priority: query.priority } : {}),
    ...(query.requestType ? { requestType: query.requestType } : {}),
    ...(query.serviceCategoryId
      ? { serviceCategoryId: query.serviceCategoryId }
      : {}),
    ...(query.customerId ? { customerId: query.customerId } : {}),
    ...(query.technicianId ? { technicianId: query.technicianId } : {}),
  };
}

export function adminJobListResponse(
  job: Prisma.JobGetPayload<{ select: typeof ADMIN_JOB_LIST_SELECT }>,
) {
  const {
    technician,
    otherServiceName,
    locationAddress,
    latitude,
    longitude,
    ...row
  } = job;
  return {
    ...row,
    service: job.serviceCategory?.name ?? otherServiceName,
    location: { address: locationAddress, latitude, longitude },
    currentTechnician: technician
      ? { id: technician.id, fullName: technician.user.fullName }
      : null,
  };
}
