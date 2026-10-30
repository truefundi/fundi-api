import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import {
  ConversationMessageType,
  ConversationSender,
  ConversationStatus,
  JobDispatchStatus,
  Job,
  JobMediaType,
  JobOfferStatus,
  JobPriority,
  JobProgressStatus,
  JobCooperationStatus,
  JobStatus,
  BookingPaymentStatus,
  CancellationRequestStatus,
  CancellationRequester,
  Prisma,
  PriceOfferStatus,
  TechnicianAvailability,
  UserRole,
  UserStatus,
  VerificationStatus,
} from '@prisma/client';
import type { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { StorageService } from '../storage/storage.service';
import { EventsGateway } from '../websockets/events.gateway';
import { canRespondToOffer, isOfferExpired } from '../conversations/negotiation.util';
import {
  JOB_MATCH_RADIUS_METERS,
  JOB_MINIMUM_MATCH_SCORE,
  JOB_OFFER_RESPONSE_SECONDS,
} from './job.constants';
import { AdminCreateJobDto } from './dto/admin-create-job.dto';
import { CreateJobDto } from './dto/create-job.dto';
import {
  DropJobDto,
  JobProgressDto,
  RejectJobOfferDto,
} from './dto/job-action.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { AdminUpdateJobDto } from './dto/admin-update-job.dto';
import { MatchingTechniciansDto, ProposeTechnicianDto } from './dto/matching-technicians.dto';
import { MatchingTechniciansByLocationDto } from './dto/matching-technicians-by-location.dto';
import { CancelJobDto, ReviewCancellationDto } from './dto/cancel-job.dto';
import { GeocodingService } from './geocoding.service';
import { calculateJobMatchScore } from './job-matching.util';
import {
  JobUpload,
  safeJobFileName,
  validateJobUploads,
  ValidatedJobUpload,
} from './job-media.util';

const JOB_INCLUDE = {
  customer: {
    select: { id: true, fullName: true, phoneNumber: true, email: true },
  },
  technician: {
    include: {
      user: { select: { id: true, fullName: true } },
      categories: {
        include: {
          category: { select: { id: true, name: true, slug: true } },
        },
      },
    },
  },
  serviceCategory: { select: { id: true, name: true, slug: true } },
  media: { orderBy: { createdAt: 'asc' as const } },
  assignmentHistory: {
    include: {
      technician: {
        select: {
          id: true,
          user: { select: { fullName: true } },
        },
      },
    },
    orderBy: { acceptedAt: 'asc' as const },
  },
  bookingPayment: {
    select: {
      id: true,
      externalPaymentId: true,
      amount: true,
      status: true,
      paidAt: true,
      validUntil: true,
      remainingValiditySeconds: true,
      serviceCategory: { select: { id: true, name: true, slug: true } },
    },
  },
  dispute: {
    include: { resolvedBy: { select: { fullName: true } } },
  },
} satisfies Prisma.JobInclude;

type JobWithDetails = Prisma.JobGetPayload<{ include: typeof JOB_INCLUDE }>;
type MatchCandidate = {
  technicianId: string;
  matchScore: number;
  distanceMeters: number;
  rejectionCount: number;
  cancellationCount: number;
};

// The slice of a conversation a customer-facing action needs: the running messages
// (each carrying the offer it answered, when there was one) so the outstanding
// offer can be resolved. Job state itself is read from the job row.
const CUSTOMER_JOB_CONVERSATION_INCLUDE = {
  messages: {
    orderBy: { createdAt: 'asc' as const },
    include: { offer: true },
  },
} satisfies Prisma.ConversationInclude;

type CustomerConversation = Prisma.ConversationGetPayload<{
  include: typeof CUSTOMER_JOB_CONVERSATION_INCLUDE;
}>;
type CustomerMessage = CustomerConversation['messages'][number];
type CustomerOffer = NonNullable<CustomerMessage['offer']>;

interface MediaInput {
  upload: JobUpload;
  validated: ValidatedJobUpload;
}

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  static adjustMatchScore(
    score: number,
    rejectionCount: number,
    cancellationCount: number,
  ): number {
    const penalty = Math.min(40, (rejectionCount + cancellationCount) * 5);
    return Math.max(0, score - penalty);
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly events: EventsGateway,
    @InjectQueue('job-dispatch') private readonly dispatchQueue: Queue,
    private readonly geocoding: GeocodingService,
  ) {}

  async confirmCooperation(
    userId: string,
    jobId: string,
    side: 'customer' | 'technician',
  ) {
    const profile =
      side === 'technician' ? await this.getTechnicianProfile(userId) : null;
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "jobs" WHERE "id" = ${jobId} FOR UPDATE`;
      const job = await tx.job.findFirst({
        where:
          side === 'customer'
            ? { id: jobId, customerId: userId }
            : { id: jobId, technicianId: profile!.id },
      });
      if (!job) throw new NotFoundException('Job not found.');
      if (job.cooperationStatus === JobCooperationStatus.CONFIRMED) return;
      if (
        (job.status !== JobStatus.ASSIGNED &&
          job.status !== JobStatus.PAUSED) ||
        !job.technicianId
      ) {
        throw new ConflictException(
          'Cooperation can only be confirmed for an assigned job.',
        );
      }
      if (
        (side === 'customer' && job.customerConfirmedAt) ||
        (side === 'technician' && job.technicianConfirmedAt)
      ) {
        return;
      }

      const payment = await tx.bookingPayment.findFirst({
        where: { jobId, status: BookingPaymentStatus.PAUSED },
        select: { id: true },
      });
      if (!payment) {
        throw new ConflictException(
          'The assigned job does not have a paused booking payment.',
        );
      }

      const now = new Date();
      const customerConfirmedAt =
        side === 'customer'
          ? (job.customerConfirmedAt ?? now)
          : job.customerConfirmedAt;
      const technicianConfirmedAt =
        side === 'technician'
          ? (job.technicianConfirmedAt ?? now)
          : job.technicianConfirmedAt;
      const bothConfirmed = Boolean(
        customerConfirmedAt && technicianConfirmedAt,
      );

      if (bothConfirmed) {
        const expiredPayment = await tx.bookingPayment.updateMany({
          where: { id: payment.id, status: BookingPaymentStatus.PAUSED },
          data: {
            status: BookingPaymentStatus.EXPIRED,
            validUntil: now,
            remainingValiditySeconds: 0,
          },
        });
        if (!expiredPayment.count) {
          throw new ConflictException(
            'The booking payment changed before cooperation was confirmed.',
          );
        }
      }

      await tx.job.update({
        where: { id: jobId },
        data: {
          customerConfirmedAt,
          technicianConfirmedAt,
          ...(bothConfirmed && {
            cooperationStatus: JobCooperationStatus.CONFIRMED,
          }),
        },
      });
      await this.audit.log(
        {
          entityType: 'Job',
          entityId: jobId,
          action: bothConfirmed
            ? 'JOB_COOPERATION_CONFIRMED'
            : 'JOB_COOPERATION_CONFIRMATION_RECORDED',
          actorId: userId,
          fromStatus: job.cooperationStatus,
          toStatus: bothConfirmed
            ? JobCooperationStatus.CONFIRMED
            : JobCooperationStatus.PENDING,
          metadata: {
            confirmedBy: side,
            bookingPaymentExpired: bothConfirmed,
          },
        },
        tx,
      );
    });
    return side === 'customer'
      ? this.getCustomerJob(userId, jobId)
      : this.getTechnicianJob(userId, jobId);
  }

  async create(
    customerId: string,
    dto: CreateJobDto,
    photos: JobUpload[],
    video?: JobUpload,
    actorId = customerId,
  ) {
    const selection = await this.resolveServiceSelection(
      dto.serviceCategoryId,
      dto.otherServiceName,
    );
    const media = this.prepareMedia(photos, video);
    const candidates = await this.findMatches({
      serviceCategoryId: selection.serviceCategoryId,
      otherServiceName: selection.otherServiceName,
      latitude: dto.latitude,
      longitude: dto.longitude,
    });
    const jobId = randomUUID();
    const storedKeys: string[] = [];
    try {
      await this.storeMedia(jobId, media, storedKeys);
      await this.prisma.$transaction(async (tx) => {
        if (!selection.serviceCategoryId) {
          throw new BadRequestException(
            'A priced service category is required for booking payments.',
          );
        }
        const now = new Date();
        const payment = await tx.bookingPayment.findFirst({
          where: {
            id: dto.paymentId,
            customerId,
            serviceCategoryId: selection.serviceCategoryId,
            jobId: null,
          },
          select: { id: true, status: true, validUntil: true },
        });
        if (
          payment &&
          (payment.status === BookingPaymentStatus.VALID ||
            payment.status === BookingPaymentStatus.RESUMED) &&
          payment.validUntil <= now
        ) {
          await tx.bookingPayment.update({
            where: { id: payment.id },
            data: { status: BookingPaymentStatus.EXPIRED },
          });
        }
        if (
          !payment ||
          (payment.status !== BookingPaymentStatus.VALID &&
            payment.status !== BookingPaymentStatus.RESUMED) ||
          payment.validUntil <= now
        ) {
          throw new ConflictException(
            'A valid, unused booking payment for this service category is required.',
          );
        }
        const phoneVerification =
          await tx.customerPhoneVerification.findFirst({
            where: {
              id: dto.phoneVerificationId,
              customerId,
              verifiedAt: { not: null },
              consumedAt: null,
              expiresAt: { gt: now },
            },
            select: { id: true },
          });
        if (!phoneVerification) {
          throw new ConflictException(
            'Verify your phone number for this job request before submitting it.',
          );
        }
        await tx.job.create({
          data: {
            id: jobId,
            customerId,
            ...selection,
            phoneVerificationId: dto.phoneVerificationId,
            description: dto.description.trim(),
            locationAddress: dto.locationAddress.trim(),
            latitude: dto.latitude,
            longitude: dto.longitude,
            offeredAmount: dto.offeredAmount,
            priority: dto.priority ?? JobPriority.NORMAL,
            dispatchStatus: JobDispatchStatus.PENDING,
            ...(media.length
              ? {
                  media: {
                    create: media.map((item, index) =>
                      this.mediaCreateData(storedKeys[index], item),
                    ),
                  },
                }
              : {}),
          },
        });
        await tx.$executeRaw`
          UPDATE "jobs"
          SET "location" = ST_SetSRID(
            ST_MakePoint(${dto.longitude}::double precision, ${dto.latitude}::double precision),
            4326
          )::geography
          WHERE "id" = ${jobId}`;
        const attached = await tx.bookingPayment.updateMany({
          where: { id: payment.id, customerId, jobId: null },
          data: { jobId },
        });
        if (!attached.count) {
          throw new ConflictException(
            'The booking payment has already been used.',
          );
        }
        const consumed = await tx.customerPhoneVerification.updateMany({
          where: {
            id: dto.phoneVerificationId,
            customerId,
            verifiedAt: { not: null },
            consumedAt: null,
            expiresAt: { gt: now },
          },
          data: { consumedAt: now },
        });
        if (!consumed.count) {
          throw new ConflictException(
            'Phone verification has already been used. Verify again.',
          );
        }
        await this.audit.log(
          {
            entityType: 'Job',
            entityId: jobId,
            action: 'JOB_CREATED',
            actorId,
            toStatus: JobStatus.OPEN,
            metadata: {
              priority: dto.priority ?? JobPriority.NORMAL,
              matchCount: candidates.length,
              paymentId: payment.id,
              phoneVerificationId: dto.phoneVerificationId,
            },
          },
          tx,
        );
      });
    } catch (error) {
      await this.deleteStoredFiles(storedKeys);
      throw error;
    }

    return this.getCustomerJob(customerId, jobId);
  }

  /**
   * Admin creates a request on a customer's behalf. The customer must be an
   * active account; the job then dispatches like any customer request.
   */
  async createForAdmin(dto: AdminCreateJobDto, adminId: string) {
    const { customerId, ...jobInput } = dto;
    const customer = await this.prisma.user.findUnique({
      where: { id: customerId },
      select: { id: true, role: true, status: true },
    });
    if (!customer || customer.role !== UserRole.CUSTOMER) {
      throw new NotFoundException('Customer not found.');
    }
    if (customer.status !== UserStatus.ACTIVE) {
      throw new ConflictException(
        'The customer account is not active, so a job cannot be created for it.',
      );
    }
    const job = await this.create(
      customer.id,
      jobInput,
      [],
      undefined,
      adminId,
    );
    return this.getForAdmin(job.id);
  }

  async listForCustomer(customerId: string) {
    const where: Prisma.JobWhereInput = {
      customerId,
      customerHiddenAt: null,
    };
    const jobs = await this.prisma.job.findMany({
      where,
      include: JOB_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
    return Promise.all(jobs.map((job) => this.toResponse(job, 'customer')));
  }

  async getCustomerJob(customerId: string, jobId: string) {
    const job = await this.findJob(jobId);
    if (job.customerId !== customerId || job.customerHiddenAt)
      throw new NotFoundException('Job not found.');
    return this.toResponse(job, 'customer');
  }

  async previewMatchingTechnicians(dto: MatchingTechniciansDto) {
    const selection = await this.resolveServiceSelection(
      dto.serviceCategoryId,
      dto.otherServiceName,
    );
    const candidates = await this.findMatches({
      ...selection,
      latitude: dto.latitude,
      longitude: dto.longitude,
    });
    return this.toMatchingTechnicianResponses(candidates);
  }

  async previewMatchingTechniciansByGeocodedLocation(
    dto: MatchingTechniciansByLocationDto,
  ) {
    if (!dto.locations?.length) {
      throw new BadRequestException(
        'Provide at least one location name to geocode.',
      );
    }
    const selection = await this.resolveServiceSelection(dto.serviceCategoryId);
    const locations = await this.geocoding.geocodeMany(dto.locations);
    const matchesByTechnician = new Map<
      string,
      {
        matchScore: number;
        distanceMeters: number;
        matchedLocations: string[];
      }
    >();
    for (const location of locations) {
      const candidates = await this.findMatches({
        ...selection,
        latitude: location.latitude,
        longitude: location.longitude,
      });
      for (const candidate of candidates) {
        const existing = matchesByTechnician.get(candidate.technicianId);
        if (existing) {
          existing.matchedLocations.push(location.query);
          if (candidate.matchScore > existing.matchScore) {
            existing.matchScore = candidate.matchScore;
            existing.distanceMeters = candidate.distanceMeters;
          }
        } else {
          matchesByTechnician.set(candidate.technicianId, {
            matchScore: candidate.matchScore,
            distanceMeters: candidate.distanceMeters,
            matchedLocations: [location.query],
          });
        }
      }
    }
    const candidates = [...matchesByTechnician.entries()]
      .map(([technicianId, result]) => ({
        technicianId,
        matchScore: result.matchScore,
        distanceMeters: result.distanceMeters,
      }))
      .sort(
        (a, b) =>
          b.matchScore - a.matchScore ||
          a.distanceMeters - b.distanceMeters ||
          a.technicianId.localeCompare(b.technicianId),
      );
    const results = await this.toMatchingTechnicianResponses(candidates);
    const locationsByTechnician = new Map(
      [...matchesByTechnician.entries()].map(([id, result]) => [
        id,
        result.matchedLocations,
      ]),
    );
    return results.map((result) => ({
      ...result,
      matchedLocations: locationsByTechnician.get(result.technicianId) ?? [],
    }));
  }

  async previewMatchingTechniciansByLocationName(
    dto: MatchingTechniciansByLocationDto,
  ) {
    const hasLatitude = typeof dto.latitude === 'number';
    const hasLongitude = typeof dto.longitude === 'number';
    if (hasLatitude !== hasLongitude) {
      throw new BadRequestException(
        'latitude and longitude must be provided together.',
      );
    }
    if (!dto.locations?.length && !hasLatitude) {
      throw new BadRequestException(
        'Provide one or more location names, a latitude/longitude pair, or both.',
      );
    }
    const category = await this.prisma.serviceCategory.findFirst({
      where: { id: dto.serviceCategoryId, isActive: true },
      select: { id: true },
    });
    if (!category) {
      throw new BadRequestException(
        'The selected service category is invalid or inactive.',
      );
    }
    const matchesByTechnician = new Map<
      string,
      {
        matchScore: number;
        distanceMeters: number | null;
        matchedLocations: string[];
      }
    >();
    if (dto.locations?.length) {
      const rows = await this.prisma.technicianProfile.findMany({
        where: {
          verificationStatus: VerificationStatus.APPROVED,
          availabilityStatus: TechnicianAvailability.ONLINE,
          user: {
            is: { status: UserStatus.ACTIVE, role: UserRole.TECHNICIAN },
          },
          categories: { some: { categoryId: category.id } },
          OR: dto.locations.flatMap((location) => [
            { baseAddress: { contains: location, mode: 'insensitive' } },
            {
              publicLocationLabel: {
                contains: location,
                mode: 'insensitive',
              },
            },
          ]),
        },
        select: {
          id: true,
          rejectionCount: true,
          cancellationCount: true,
          baseAddress: true,
          publicLocationLabel: true,
        },
      });
      for (const row of rows) {
        const matchedLocations = dto.locations.filter((location) => {
          const normalized = this.normalizeService(location);
          return (
            this.normalizeService(row.baseAddress).includes(normalized) ||
            this.normalizeService(row.publicLocationLabel ?? '').includes(
              normalized,
            )
          );
        });
        const matchScore = JobsService.adjustMatchScore(
          100,
          row.rejectionCount,
          row.cancellationCount,
        );
        if (matchScore < JOB_MINIMUM_MATCH_SCORE) continue;
        matchesByTechnician.set(row.id, {
          matchScore,
          distanceMeters: null,
          matchedLocations,
        });
      }
    }

    if (
      typeof dto.latitude === 'number' &&
      typeof dto.longitude === 'number'
    ) {
      const geographicMatches = await this.findMatches({
        serviceCategoryId: category.id,
        otherServiceName: null,
        latitude: dto.latitude,
        longitude: dto.longitude,
      });
      for (const candidate of geographicMatches) {
        const existing = matchesByTechnician.get(candidate.technicianId);
        if (
          !existing ||
          candidate.matchScore > existing.matchScore ||
          (candidate.matchScore === existing.matchScore &&
            (existing.distanceMeters === null ||
              candidate.distanceMeters < existing.distanceMeters))
        ) {
          matchesByTechnician.set(candidate.technicianId, {
            matchScore: candidate.matchScore,
            distanceMeters: candidate.distanceMeters,
            matchedLocations: existing?.matchedLocations ?? [],
          });
        } else {
          existing.distanceMeters = candidate.distanceMeters;
        }
      }
    }

    const candidates = [...matchesByTechnician.entries()]
      .map(([technicianId, result]) => ({
        technicianId,
        matchScore: result.matchScore,
        distanceMeters: result.distanceMeters,
        matchedLocations: result.matchedLocations,
      }))
      .sort(
        (a, b) =>
          b.matchScore - a.matchScore ||
          (a.distanceMeters ?? Number.POSITIVE_INFINITY) -
            (b.distanceMeters ?? Number.POSITIVE_INFINITY) ||
          a.technicianId.localeCompare(b.technicianId),
      );
    const results = await this.toMatchingTechnicianResponses(candidates);
    const locationsByTechnician = new Map(
      candidates.map((candidate) => [
        candidate.technicianId,
        candidate.matchedLocations,
      ]),
    );
    return results.map((result) => ({
      ...result,
      matchedLocations: locationsByTechnician.get(result.technicianId) ?? [],
    }));
  }

  private async toMatchingTechnicianResponses(
    candidates: Array<{
      technicianId: string;
      matchScore: number;
      distanceMeters: number | null;
    }>,
  ) {
    const profiles = await this.prisma.technicianProfile.findMany({
      where: { id: { in: candidates.map((candidate) => candidate.technicianId) } },
      include: {
        user: { select: { fullName: true } },
        categories: {
          include: {
            category: { select: { id: true, name: true, slug: true } },
          },
        },
      },
    });
    const byId = new Map(profiles.map((profile) => [profile.id, profile]));
    return candidates.map((candidate) => {
      const profile = byId.get(candidate.technicianId);
      if (!profile) {
        throw new ConflictException(
          'A matching technician changed during the search. Please retry.',
        );
      }
      return {
        technicianId: profile.id,
        fullName: profile.user.fullName,
        matchAccuracy: candidate.matchScore,
        distanceMeters:
          candidate.distanceMeters === null
            ? null
            : Math.round(candidate.distanceMeters),
        gender: profile.gender,
        yearsOfExperience: profile.categories.length
          ? Math.max(...profile.categories.map((row) => row.yearsOfExperience))
          : 0,
        serviceExperiences: profile.categories.map((row) => ({
          categoryId: row.categoryId,
          category: row.category,
          customName: row.customName,
          yearsOfExperience: row.yearsOfExperience,
        })),
        publicLocationLabel: profile.publicLocationLabel,
      };
    });
  }

  async proposeTechnician(
    customerId: string,
    jobId: string,
    dto: ProposeTechnicianDto,
  ) {
    const job = await this.findJob(jobId);
    this.assertCustomerOwnsJob(job, customerId);
    if (job.customerHiddenAt) throw new NotFoundException('Job not found.');
    if (job.status !== JobStatus.OPEN || job.technicianId) {
      throw new ConflictException(
        'A technician can only be proposed for an open, unassigned job.',
      );
    }
    if (!job.serviceCategoryId) {
      throw new BadRequestException(
        'A priced service category is required before selecting a technician.',
      );
    }
    const candidates = await this.findMatches({
      serviceCategoryId: job.serviceCategoryId,
      otherServiceName: job.otherServiceName,
      latitude: job.latitude,
      longitude: job.longitude,
    });
    const candidate = candidates.find(
      (match) => match.technicianId === dto.technicianId,
    );
    if (!candidate) {
      throw new BadRequestException(
        'The selected technician is no longer an eligible match.',
      );
    }

    const now = new Date();
    const round = job.dispatchRound + 1;
    const expiresAt = new Date(
      now.getTime() + JOB_OFFER_RESPONSE_SECONDS * 1000,
    );
    const offer = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.bookingPayment.findFirst({
        where: {
          jobId,
          customerId,
          status: {
            in: [BookingPaymentStatus.VALID, BookingPaymentStatus.RESUMED],
          },
        },
      });
      if (!payment || payment.validUntil <= now) {
        if (payment && payment.validUntil <= now) {
          await tx.bookingPayment.update({
            where: { id: payment.id },
            data: { status: BookingPaymentStatus.EXPIRED },
          });
        }
        throw new ConflictException(
          'The booking payment has expired. Make another payment before selecting a technician.',
        );
      }
      const selectedTechnician = await tx.technicianProfile.findFirst({
        where: {
          id: dto.technicianId,
          verificationStatus: VerificationStatus.APPROVED,
          availabilityStatus: TechnicianAvailability.ONLINE,
          user: {
            is: { role: UserRole.TECHNICIAN, status: UserStatus.ACTIVE },
          },
        },
        select: { id: true, userId: true },
      });
      if (!selectedTechnician) {
        throw new ConflictException(
          'The selected technician is no longer available.',
        );
      }
      const changed = await tx.job.updateMany({
        where: {
          id: jobId,
          customerId,
          status: JobStatus.OPEN,
          technicianId: null,
          dispatchStatus: { not: JobDispatchStatus.OFFERED },
          dispatchRound: job.dispatchRound,
        },
        data: {
          dispatchRound: round,
          dispatchStatus: JobDispatchStatus.OFFERED,
        },
      });
      if (!changed.count) {
        throw new ConflictException(
          'This job already has an active technician request.',
        );
      }
      const created = await tx.jobOffer.create({
        data: {
          jobId,
          technicianId: selectedTechnician.id,
          round,
          matchScore: candidate.matchScore,
          distanceMeters: candidate.distanceMeters,
          status: JobOfferStatus.OFFERED,
          offeredAt: now,
          expiresAt,
        },
        include: {
          technician: { select: { userId: true } },
          job: {
            select: {
              priority: true,
              description: true,
              locationAddress: true,
              offeredAmount: true,
              currency: true,
              otherServiceName: true,
              serviceCategory: { select: { name: true } },
            },
          },
        },
      });
      await this.audit.log(
        {
          entityType: 'Job',
          entityId: jobId,
          action: 'TECHNICIAN_PROPOSED',
          actorId: customerId,
          metadata: {
            offerId: created.id,
            technicianId: selectedTechnician.id,
            matchScore: candidate.matchScore,
            round,
          },
        },
        tx,
      );
      return created;
    });

    try {
      await this.dispatchQueue.add(
        'expire-offer',
        { offerId: offer.id },
        {
          jobId: `job-offer-expiry-${offer.id}`,
          delay: JOB_OFFER_RESPONSE_SECONDS * 1000,
          attempts: 3,
          removeOnComplete: true,
        },
      );
    } catch (error) {
      await this.prisma.$transaction(async (tx) => {
        await tx.jobOffer.updateMany({
          where: { id: offer.id, status: JobOfferStatus.OFFERED },
          data: { status: JobOfferStatus.CANCELLED, respondedAt: new Date() },
        });
        await tx.job.updateMany({
          where: {
            id: jobId,
            status: JobStatus.OPEN,
            dispatchRound: round,
            dispatchStatus: JobDispatchStatus.OFFERED,
          },
          data: { dispatchStatus: JobDispatchStatus.PENDING },
        });
      });
      this.logger.error(
        `Could not schedule expiry for job offer ${offer.id}: ${this.errorMessage(error)}`,
      );
      throw new ServiceUnavailableException(
        'The request was saved but could not be scheduled. Please select a technician again shortly.',
      );
    }
    this.events.notifyTechnician(offer.technician.userId, 'job:offer', {
      offerId: offer.id,
      jobId: offer.jobId,
      matchScore: offer.matchScore,
      distanceMeters: Math.round(offer.distanceMeters),
      expiresAt: offer.expiresAt!.toISOString(),
      service: offer.job.serviceCategory?.name ?? offer.job.otherServiceName,
      description: offer.job.description,
      locationAddress: offer.job.locationAddress,
      offeredAmount: offer.job.offeredAmount,
      currency: offer.job.currency,
      priority: offer.job.priority,
    });
    return this.getCustomerJob(customerId, jobId);
  }

  async update(customerId: string, jobId: string, dto: UpdateJobDto) {
    const current = await this.findJob(jobId);
    this.assertCustomerOwnsJob(current, customerId);
    this.assertEditable(current);
    await this.applyOpenJobUpdate(current, dto, customerId);
    return this.getCustomerJob(customerId, jobId);
  }

  /**
   * Customer accepts the technician's outstanding price offer, which agrees the
   * price and closes the negotiation. The dispatch-time technician acceptance (the
   * job assignment itself) is a separate step; this closes the money conversation
   * the technician opened with their offer.
   */
  async acceptTechnicianOffer(customerId: string, jobId: string) {
    const job = await this.findJob(jobId);
    this.assertCustomerOwnsJob(job, customerId);

    const conversation = await this.prisma.conversation.findUnique({
      where: { jobId },
      include: CUSTOMER_JOB_CONVERSATION_INCLUDE,
    });
    if (!conversation) {
      throw new ConflictException('No negotiation is open for this job.');
    }
    if (conversation.status === ConversationStatus.PENDING) {
      throw new ConflictException(
        'The technician has not accepted the job request yet.',
      );
    }
    if (conversation.status !== ConversationStatus.NEGOTIATING) {
      throw new ConflictException('This negotiation is already closed.');
    }

    const offer = this.outstandingOffer(conversation);
    if (!offer) {
      throw new ConflictException(
        'There is no outstanding price offer to accept.',
      );
    }
    // The responder check comes first: a customer cannot accept an offer the
    // customer made themselves, and the refusal should not depend on the
    // offer's expiry.
    if (!canRespondToOffer(offer.senderRole, ConversationSender.CUSTOMER)) {
      throw new ForbiddenException('You cannot respond to your own offer.');
    }
    const now = new Date();
    if (isOfferExpired(offer.expiresAt)) {
      await this.prisma.$transaction(async (tx) => {
        const expired = await tx.priceOffer.updateMany({
          where: { id: offer.id, status: PriceOfferStatus.PENDING },
          data: { status: PriceOfferStatus.EXPIRED, respondedAt: now },
        });
        if (!expired.count) {
          return;
        }
        await tx.conversationMessage.create({
          data: {
            conversationId: conversation.id,
            senderRole: ConversationSender.SYSTEM,
            type: ConversationMessageType.SYSTEM,
            text: 'A price offer expired.',
          },
        });
        await tx.conversation.update({
          where: { id: conversation.id },
          data: { lastMessageAt: now },
        });
        await this.audit.log(
          {
            entityType: 'Conversation',
            entityId: conversation.id,
            action: 'PRICE_OFFER_EXPIRED',
            metadata: { offerId: offer.id },
          },
          tx,
        );
      });
      throw new ConflictException('This offer has expired.');
    }

    await this.prisma.$transaction(async (tx) => {
      const accepted = await tx.priceOffer.updateMany({
        where: { id: offer.id, status: PriceOfferStatus.PENDING },
        data: { status: PriceOfferStatus.ACCEPTED, respondedAt: now },
      });
      if (!accepted.count) {
        throw new ConflictException(
          'This offer is no longer awaiting a response.',
        );
      }
      await tx.conversation.update({
        where: { id: conversation.id },
        data: {
          status: ConversationStatus.AGREED,
          agreedAmount: offer.amount,
          lastMessageAt: now,
          closedAt: now,
        },
      });
      await tx.conversationMessage.create({
        data: {
          conversationId: conversation.id,
          senderRole: ConversationSender.SYSTEM,
          type: ConversationMessageType.SYSTEM,
          text: `Agreed at ${offer.amount} ${offer.currency}.`,
        },
      });
      await this.audit.log(
        {
          entityType: 'Conversation',
          entityId: conversation.id,
          action: 'CONVERSATION_AGREED',
          actorId: customerId,
          fromStatus: ConversationStatus.NEGOTIATING,
          toStatus: ConversationStatus.AGREED,
          metadata: { offerId: offer.id, amount: offer.amount },
        },
        tx,
      );
    });

    return this.getCustomerJob(customerId, jobId);
  }

  /**
   * Admin edit. An unassigned open job is updated and re-dispatched exactly like
   * the customer flow. Once a technician is assigned the job keeps its technician
   * and is not re-matched, but the admin can still correct every field (the
   * service and address are often what was wrong).
   */
  async adminUpdate(jobId: string, dto: UpdateJobDto, adminId: string) {
    const current = await this.findJob(jobId);
    if (current.status === JobStatus.OPEN && !current.technicianId) {
      await this.applyOpenJobUpdate(current, dto, adminId);
      return this.getForAdmin(jobId);
    }
    if (current.status !== JobStatus.ASSIGNED) {
      throw new ConflictException('Only open or assigned jobs can be edited.');
    }
    if (!Object.keys(dto).length) {
      throw new BadRequestException(
        'Provide at least one job field to update.',
      );
    }
    if (
      (dto.latitude === undefined) !== (dto.longitude === undefined) &&
      (dto.latitude !== undefined || dto.longitude !== undefined)
    ) {
      throw new BadRequestException(
        'latitude and longitude must be updated together.',
      );
    }
    const hasServiceChange =
      dto.serviceCategoryId !== undefined || dto.otherServiceName !== undefined;
    const selection = hasServiceChange
      ? await this.resolveServiceSelection(
          dto.serviceCategoryId,
          dto.otherServiceName,
        )
      : {};
    await this.prisma.$transaction(async (tx) => {
      await tx.job.update({
        where: { id: jobId },
        data: {
          ...selection,
          ...(dto.description !== undefined && {
            description: dto.description.trim(),
          }),
          ...(dto.locationAddress !== undefined && {
            locationAddress: dto.locationAddress.trim(),
          }),
          ...(dto.latitude !== undefined && { latitude: dto.latitude }),
          ...(dto.longitude !== undefined && { longitude: dto.longitude }),
          ...(dto.offeredAmount !== undefined && {
            offeredAmount: dto.offeredAmount,
          }),
          ...(dto.priority !== undefined && { priority: dto.priority }),
        },
      });
      if (dto.latitude !== undefined && dto.longitude !== undefined) {
        await tx.$executeRaw`
          UPDATE "jobs"
          SET "location" = ST_SetSRID(
            ST_MakePoint(${dto.longitude}::double precision, ${dto.latitude}::double precision),
            4326
          )::geography
          WHERE "id" = ${jobId}`;
      }
      await this.audit.log(
        {
          entityType: 'Job',
          entityId: jobId,
          action: 'JOB_UPDATED',
          actorId: adminId,
          metadata: { changedFields: Object.keys(dto) },
        },
        tx,
      );
    });
    return this.getForAdmin(jobId);
  }

  /** Shared by the customer and admin edit paths for an unassigned open job. */
  private async applyOpenJobUpdate(
    current: JobWithDetails,
    dto: UpdateJobDto,
    actorId: string,
  ) {
    const jobId = current.id;
    if (!Object.keys(dto).length) {
      throw new BadRequestException(
        'Provide at least one job field to update.',
      );
    }
    if (
      (dto.latitude === undefined) !== (dto.longitude === undefined) &&
      (dto.latitude !== undefined || dto.longitude !== undefined)
    ) {
      throw new BadRequestException(
        'latitude and longitude must be updated together.',
      );
    }

    const hasServiceChange =
      dto.serviceCategoryId !== undefined || dto.otherServiceName !== undefined;
    const selection = hasServiceChange
      ? await this.resolveServiceSelection(
          dto.serviceCategoryId,
          dto.otherServiceName,
        )
      : {
          serviceCategoryId: current.serviceCategoryId,
          otherServiceName: current.otherServiceName,
        };
    if (
      hasServiceChange &&
      selection.serviceCategoryId !== current.serviceCategoryId
    ) {
      throw new ConflictException(
        'The service category cannot be changed after the booking payment is attached. Cancel this job and create a new paid request instead.',
      );
    }
    const latitude = dto.latitude ?? current.latitude;
    const longitude = dto.longitude ?? current.longitude;
    const candidates = await this.findMatches({
      serviceCategoryId: selection.serviceCategoryId,
      otherServiceName: selection.otherServiceName,
      latitude,
      longitude,
    });

    await this.prisma.$transaction(async (tx) => {
      const updateResult = await tx.job.updateMany({
        where: {
          id: jobId,
          customerId: current.customerId,
          status: JobStatus.OPEN,
          technicianId: null,
          dispatchRound: current.dispatchRound,
        },
        data: {
          ...selection,
          ...(dto.description !== undefined && {
            description: dto.description.trim(),
          }),
          ...(dto.locationAddress !== undefined && {
            locationAddress: dto.locationAddress.trim(),
          }),
          ...(dto.latitude !== undefined && { latitude: dto.latitude }),
          ...(dto.longitude !== undefined && { longitude: dto.longitude }),
          ...(dto.offeredAmount !== undefined && {
            offeredAmount: dto.offeredAmount,
          }),
          ...(dto.priority !== undefined && { priority: dto.priority }),
          dispatchRound: { increment: 1 },
          dispatchStatus: JobDispatchStatus.PENDING,
        },
      });
      if (!updateResult.count) {
        throw new ConflictException('This job can no longer be edited.');
      }
      await tx.jobOffer.updateMany({
        where: {
          jobId,
          round: current.dispatchRound,
          status: { in: [JobOfferStatus.WAITING, JobOfferStatus.OFFERED] },
        },
        data: { status: JobOfferStatus.CANCELLED, respondedAt: new Date() },
      });
      if (dto.latitude !== undefined && dto.longitude !== undefined) {
        await tx.$executeRaw`
          UPDATE "jobs"
          SET "location" = ST_SetSRID(
            ST_MakePoint(${dto.longitude}::double precision, ${dto.latitude}::double precision),
            4326
          )::geography
          WHERE "id" = ${jobId}`;
      }
      await this.audit.log(
        {
          entityType: 'Job',
          entityId: jobId,
          action: 'JOB_UPDATED',
          actorId,
          metadata: {
            changedFields: Object.keys(dto),
            matchCount: candidates.length,
          },
        },
        tx,
      );
    });
  }

  async retryDispatch(customerId: string, jobId: string) {
    const job = await this.findJob(jobId);
    this.assertCustomerOwnsJob(job, customerId);
    this.assertEditable(job);
    await this.prisma.job.updateMany({
      where: {
        id:         jobId,
        customerId,
        serviceCategoryId: job.serviceCategoryId,
        status: JobStatus.OPEN,
        technicianId: null,
        dispatchStatus: JobDispatchStatus.EXHAUSTED,
      },
      data: { dispatchStatus: JobDispatchStatus.PENDING },
    });
    return this.getCustomerJob(customerId, jobId);
  }

  async cancelJob(
    actorId: string,
    jobId: string,
    side: 'customer' | 'technician',
    dto: CancelJobDto,
  ) {
    const job = await this.findJob(jobId);
    const profile =
      side === 'technician'
        ? await this.getTechnicianProfile(actorId)
        : null;
    if (
      (side === 'customer' && job.customerId !== actorId) ||
      (side === 'technician' && job.technicianId !== profile?.id)
    ) {
      throw new NotFoundException('Job not found.');
    }
    if (side === 'technician') {
      if (job.status !== JobStatus.ASSIGNED && job.status !== JobStatus.PAUSED) {
        throw new ConflictException(
          'Only an assigned job can be submitted for cancellation.',
        );
      }
      const pending = await this.prisma.jobCancellationRequest.findFirst({
        where: {
          jobId,
          requester: CancellationRequester.TECHNICIAN,
          status: CancellationRequestStatus.PENDING,
        },
        select: { id: true },
      });
      if (pending) {
        throw new ConflictException(
          'A cancellation request is already awaiting administrator review.',
        );
      }
    } else if (
      job.status !== JobStatus.ASSIGNED &&
      job.status !== JobStatus.PAUSED &&
      job.status !== JobStatus.OPEN
    ) {
      throw new ConflictException('This job can no longer be cancelled.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "jobs" WHERE "id" = ${jobId} FOR UPDATE`;
      const current = await tx.job.findUnique({ where: { id: jobId } });
      if (!current) throw new NotFoundException('Job not found.');
      if (
        (side === 'customer' && current.customerId !== actorId) ||
        (side === 'technician' && current.technicianId !== profile?.id)
      ) {
        throw new NotFoundException('Job not found.');
      }
      if (side === 'technician') {
        if (
          current.status !== JobStatus.ASSIGNED &&
          current.status !== JobStatus.PAUSED
        ) {
          throw new ConflictException(
            'Only an assigned job can be submitted for cancellation.',
          );
        }
        const pending = await tx.jobCancellationRequest.findFirst({
          where: {
            jobId,
            requester: CancellationRequester.TECHNICIAN,
            status: CancellationRequestStatus.PENDING,
          },
          select: { id: true },
        });
        if (pending) {
          throw new ConflictException(
            'A cancellation request is already awaiting administrator review.',
          );
        }
        await tx.jobCancellationRequest.create({
          data: {
            jobId,
            actorId,
            requester: CancellationRequester.TECHNICIAN,
            reason: dto.reason,
          },
        });
      } else if (
        current.status === JobStatus.ASSIGNED ||
        current.status === JobStatus.PAUSED
      ) {
        await this.releaseAssignment(tx, current, dto.reason, false);
        await tx.jobCancellationRequest.create({
          data: {
            jobId,
            actorId,
            requester: CancellationRequester.CUSTOMER,
            reason: dto.reason,
            status: CancellationRequestStatus.APPROVED,
            reviewedAt: new Date(),
            reviewNote: 'Customer cancellation is immediate.',
          },
        });
      } else {
        if (current.status !== JobStatus.OPEN || current.technicianId) {
          throw new ConflictException('This job can no longer be cancelled.');
        }
        await tx.job.update({
          where: { id: jobId },
          data: {
            status: JobStatus.CANCELLED,
            dispatchStatus: JobDispatchStatus.STOPPED,
          },
        });
        await tx.jobOffer.updateMany({
          where: {
            jobId,
            status: { in: [JobOfferStatus.WAITING, JobOfferStatus.OFFERED] },
          },
          data: { status: JobOfferStatus.CANCELLED, respondedAt: new Date() },
        });
      }
      await this.audit.log(
        {
          entityType: 'Job',
          entityId: jobId,
          action:
            side === 'technician'
              ? 'TECHNICIAN_CANCELLATION_REQUESTED'
              : 'CUSTOMER_CANCELLED',
          actorId,
          fromStatus: current.status,
          toStatus:
            side === 'technician'
              ? current.status
              : current.technicianId
                ? current.cooperationStatus === JobCooperationStatus.CONFIRMED
                  ? JobStatus.CANCELLED
                  : JobStatus.OPEN
                : JobStatus.CANCELLED,
          metadata: { reason: dto.reason },
        },
        tx,
      );
    });
    return side === 'customer'
      ? this.getCustomerJob(actorId, jobId)
      : { message: 'Cancellation request sent for administrator review.' };
  }

  async requestPause(
    userId: string,
    jobId: string,
    side: 'customer' | 'technician',
  ) {
    const profile =
      side === 'technician' ? await this.getTechnicianProfile(userId) : null;
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "jobs" WHERE "id" = ${jobId} FOR UPDATE`;
      const job = await tx.job.findFirst({
        where:
          side === 'customer'
            ? { id: jobId, customerId: userId }
            : { id: jobId, technicianId: profile!.id },
      });
      if (!job) throw new NotFoundException('Job not found.');
      if (job.status !== JobStatus.ASSIGNED) {
        throw new ConflictException('Only an active assigned job can be paused.');
      }
      const now = new Date();
      const customerPauseRequestedAt =
        side === 'customer' ? now : job.customerPauseRequestedAt;
      const technicianPauseRequestedAt =
        side === 'technician' ? now : job.technicianPauseRequestedAt;
      const bothRequested = Boolean(
        customerPauseRequestedAt && technicianPauseRequestedAt,
      );
      await tx.job.update({
        where: { id: jobId },
        data: {
          customerPauseRequestedAt,
          technicianPauseRequestedAt,
          ...(bothRequested && { status: JobStatus.PAUSED }),
        },
      });
      if (bothRequested && job.technicianId) {
        const otherActiveJobs = await tx.job.count({
          where: {
            technicianId: job.technicianId,
            status: JobStatus.ASSIGNED,
            id: { not: jobId },
          },
        });
        if (!otherActiveJobs) {
          await tx.technicianProfile.updateMany({
            where: {
              id: job.technicianId,
              verificationStatus: VerificationStatus.APPROVED,
              user: { is: { status: UserStatus.ACTIVE } },
            },
            data: { availabilityStatus: TechnicianAvailability.ONLINE },
          });
        }
      }
      await this.audit.log(
        {
          entityType: 'Job',
          entityId: jobId,
          action: bothRequested ? 'JOB_PAUSED' : 'JOB_PAUSE_REQUESTED',
          actorId: userId,
          fromStatus: job.status,
          toStatus: bothRequested ? JobStatus.PAUSED : job.status,
          metadata: { requestedBy: side },
        },
        tx,
      );
    });
    return side === 'customer'
      ? this.getCustomerJob(userId, jobId)
      : this.getTechnicianJob(userId, jobId);
  }

  async requestResume(
    userId: string,
    jobId: string,
    side: 'customer' | 'technician',
  ) {
    const profile =
      side === 'technician' ? await this.getTechnicianProfile(userId) : null;
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "jobs" WHERE "id" = ${jobId} FOR UPDATE`;
      const job = await tx.job.findFirst({
        where:
          side === 'customer'
            ? { id: jobId, customerId: userId }
            : { id: jobId, technicianId: profile!.id },
      });
      if (!job) throw new NotFoundException('Job not found.');
      if (job.status !== JobStatus.PAUSED || !job.technicianId) {
        throw new ConflictException('Only a mutually paused job can be resumed.');
      }
      const now = new Date();
      const customerResumeRequestedAt =
        side === 'customer' ? now : job.customerResumeRequestedAt;
      const technicianResumeRequestedAt =
        side === 'technician' ? now : job.technicianResumeRequestedAt;
      const bothRequested = Boolean(
        customerResumeRequestedAt && technicianResumeRequestedAt,
      );
      if (bothRequested) {
        const otherActiveJobs = await tx.job.count({
          where: {
            technicianId: job.technicianId,
            status: JobStatus.ASSIGNED,
            id: { not: jobId },
          },
        });
        if (otherActiveJobs) {
          throw new ConflictException(
            'The technician must complete or pause their other active job before resuming this one.',
          );
        }
      }
      await tx.job.update({
        where: { id: jobId },
        data: {
          customerResumeRequestedAt,
          technicianResumeRequestedAt,
          ...(bothRequested && {
            status: JobStatus.ASSIGNED,
            customerPauseRequestedAt: null,
            technicianPauseRequestedAt: null,
            customerResumeRequestedAt: null,
            technicianResumeRequestedAt: null,
          }),
        },
      });
      if (bothRequested) {
        await tx.technicianProfile.update({
          where: { id: job.technicianId },
          data: { availabilityStatus: TechnicianAvailability.OFFLINE },
        });
      }
      await this.audit.log(
        {
          entityType: 'Job',
          entityId: jobId,
          action: bothRequested ? 'JOB_RESUMED' : 'JOB_RESUME_REQUESTED',
          actorId: userId,
          fromStatus: job.status,
          toStatus: bothRequested ? JobStatus.ASSIGNED : job.status,
          metadata: { requestedBy: side },
        },
        tx,
      );
    });
    return side === 'customer'
      ? this.getCustomerJob(userId, jobId)
      : this.getTechnicianJob(userId, jobId);
  }

  async hideJobForUser(
    userId: string,
    jobId: string,
    side: 'customer' | 'technician',
  ) {
    const profile =
      side === 'technician' ? await this.getTechnicianProfile(userId) : null;
    const job = await this.prisma.job.findFirst({
      where:
        side === 'customer'
          ? { id: jobId, customerId: userId }
          : {
              id: jobId,
              OR: [
                { technicianId: profile!.id },
                { assignmentHistory: { some: { technicianId: profile!.id } } },
              ],
            },
      include: { assignmentHistory: { select: { technicianId: true } } },
    });
    if (!job) throw new NotFoundException('Job not found.');
    if (job.status !== JobStatus.COMPLETED && job.status !== JobStatus.CANCELLED) {
      throw new ConflictException(
        'Only completed or cancelled jobs can be hidden from your history.',
      );
    }
    await this.prisma.job.update({
      where: { id: jobId },
      data:
        side === 'customer'
          ? { customerHiddenAt: new Date() }
          : { technicianHiddenAt: new Date() },
    });
    await this.audit.log({
      entityType: 'Job',
      entityId: jobId,
      action: 'JOB_HIDDEN',
      actorId: userId,
      metadata: { hiddenBy: side },
    });
    return { message: 'Job hidden from your history.' };
  }

  async listCancellationRequests() {
    return this.prisma.jobCancellationRequest.findMany({
      include: {
        job: {
          select: {
            id: true,
            status: true,
            description: true,
            customer: { select: { id: true, fullName: true, phoneNumber: true } },
            technician: {
              select: {
                id: true,
                user: { select: { id: true, fullName: true } },
              },
            },
          },
        },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async reviewCancellation(
    requestId: string,
    dto: ReviewCancellationDto,
    adminId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id" FROM "job_cancellation_requests"
        WHERE "id" = ${requestId}
        FOR UPDATE`;
      const request = await tx.jobCancellationRequest.findUnique({
        where: { id: requestId },
      });
      if (!request) throw new NotFoundException('Cancellation request not found.');
      await tx.$queryRaw`
        SELECT "id" FROM "jobs" WHERE "id" = ${request.jobId} FOR UPDATE`;
      const currentJob = await tx.job.findUniqueOrThrow({
        where: { id: request.jobId },
      });
      if (
        request.status !== CancellationRequestStatus.PENDING ||
        request.requester !== CancellationRequester.TECHNICIAN
      ) {
        throw new ConflictException(
          'Only pending technician cancellation requests can be reviewed.',
        );
      }
      if (dto.decision === 'APPROVE') {
        if (
          !currentJob.technicianId ||
          (currentJob.status !== JobStatus.ASSIGNED &&
            currentJob.status !== JobStatus.PAUSED)
        ) {
          throw new ConflictException(
            'The job assignment changed before this request was reviewed.',
          );
        }
        await this.releaseAssignment(
          tx,
          currentJob,
          request.reason,
          true,
        );
      }
      const status =
        dto.decision === 'APPROVE'
          ? CancellationRequestStatus.APPROVED
          : CancellationRequestStatus.REJECTED;
      const updated = await tx.jobCancellationRequest.update({
        where: { id: requestId },
        data: {
          status,
          reviewedById: adminId,
          reviewedAt: new Date(),
          reviewNote: dto.reviewNote || null,
        },
      });
      await this.audit.log(
        {
          entityType: 'JobCancellationRequest',
          entityId: requestId,
          action: `CANCELLATION_${dto.decision}`,
          actorId: adminId,
          fromStatus: request.status,
          toStatus: status,
          metadata: { jobId: request.jobId, reviewNote: dto.reviewNote },
        },
        tx,
      );
      return updated;
    });
  }

  /**
   * Admin cancel: allowed while the job is open or assigned. The reason is kept
   * on the job for the record, pending offers are withdrawn, the assignment is
   * closed, and any open conversation is declined so the request cannot still be
   * accepted after cancellation.
   */
  async adminCancel(jobId: string, reason: string | undefined, adminId: string) {
    const job = await this.findJob(jobId);
    if (
      job.status !== JobStatus.OPEN &&
      job.status !== JobStatus.ASSIGNED
    ) {
      throw new ConflictException('This job can no longer be cancelled.');
    }
    const trimmedReason = reason?.trim() || null;
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const cancelled = await tx.job.updateMany({
        where: {
          id: jobId,
          status: { in: [JobStatus.OPEN, JobStatus.ASSIGNED] },
        },
        data: {
          status: JobStatus.CANCELLED,
          dispatchStatus: JobDispatchStatus.STOPPED,
          cancellationReason: trimmedReason,
        },
      });
      if (!cancelled.count) {
        throw new ConflictException('This job can no longer be cancelled.');
      }
      await tx.jobOffer.updateMany({
        where: {
          jobId,
          status: { in: [JobOfferStatus.WAITING, JobOfferStatus.OFFERED] },
        },
        data: { status: JobOfferStatus.CANCELLED, respondedAt: now },
      });
      await tx.jobOffer.updateMany({
        where: { jobId, status: JobOfferStatus.ACCEPTED },
        data: {
          status: JobOfferStatus.DROPPED,
          respondedAt: now,
          dropReason: 'CANCELLED_BY_ADMIN',
        },
      });
      await tx.jobAssignmentHistory.updateMany({
        where: { jobId, endedAt: null },
        data: {
          endedAt: now,
          endReason: 'CANCELLED',
          reason: trimmedReason,
        },
      });
      await tx.conversation.updateMany({
        where: {
          jobId,
          status: {
            in: [ConversationStatus.PENDING, ConversationStatus.NEGOTIATING],
          },
        },
        data: {
          status: ConversationStatus.DECLINED,
          declinedById: adminId,
          declineReason: 'Job cancelled by Fundi admin.',
          closedAt: now,
        },
      });
      await this.audit.log(
        {
          entityType: 'Job',
          entityId: jobId,
          action: 'JOB_CANCELLED',
          actorId: adminId,
          fromStatus: job.status,
          toStatus: JobStatus.CANCELLED,
          metadata: { reason: trimmedReason, by: 'ADMIN' },
        },
        tx,
      );
    });
    return this.getForAdmin(jobId);
  }

  /**
   * Admin reassignment: hand an open or assigned job to another technician. The
   * previous assignment is closed, pending offers are withdrawn, and the new
   * technician starts with fresh progress. The job's conversation, if open, stays
   * in place: access follows the currently assigned technician.
   */
  async adminReassign(jobId: string, technicianId: string, adminId: string) {
    const job = await this.findJob(jobId);
    if (
      job.status !== JobStatus.OPEN &&
      job.status !== JobStatus.ASSIGNED
    ) {
      throw new ConflictException('Only open or assigned jobs can be reassigned.');
    }
    const technician = await this.prisma.technicianProfile.findUnique({
      where: { id: technicianId },
      select: {
        id: true,
        verificationStatus: true,
        user: { select: { fullName: true, role: true, status: true } },
      },
    });
    if (!technician || technician.user.role !== UserRole.TECHNICIAN) {
      throw new NotFoundException('Technician not found.');
    }
    if (technician.verificationStatus !== VerificationStatus.APPROVED) {
      throw new ConflictException(
        'Only technicians with an approved verification can be assigned.',
      );
    }
    if (technician.user.status !== UserStatus.ACTIVE) {
      throw new ConflictException('The technician account is not active.');
    }
    if (job.technicianId === technician.id) {
      return this.getForAdmin(jobId);
    }

    const previousTechnicianId = job.technicianId;
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.job.updateMany({
        where: {
          id: jobId,
          status: { in: [JobStatus.OPEN, JobStatus.ASSIGNED] },
        },
        data: {
          technicianId: technician.id,
          status: JobStatus.ASSIGNED,
          dispatchStatus: JobDispatchStatus.STOPPED,
          assignedAt: now,
          technicianProgress: JobProgressStatus.PENDING,
          customerProgress: JobProgressStatus.PENDING,
          completedAt: null,
        },
      });
      if (!updated.count) {
        throw new ConflictException('This job can no longer be reassigned.');
      }
      await tx.jobOffer.updateMany({
        where: {
          jobId,
          status: { in: [JobOfferStatus.WAITING, JobOfferStatus.OFFERED] },
        },
        data: { status: JobOfferStatus.CANCELLED, respondedAt: now },
      });
      await tx.jobOffer.updateMany({
        where: { jobId, status: JobOfferStatus.ACCEPTED },
        data: {
          status: JobOfferStatus.DROPPED,
          respondedAt: now,
          dropReason: 'REASSIGNED_BY_ADMIN',
        },
      });
      await tx.jobOffer.upsert({
        where: {
          jobId_technicianId_round: {
            jobId,
            technicianId: technician.id,
            round: job.dispatchRound,
          },
        },
        create: {
          jobId,
          technicianId: technician.id,
          round: job.dispatchRound,
          matchScore: 0,
          distanceMeters: 0,
          status: JobOfferStatus.ACCEPTED,
          offeredAt: now,
          respondedAt: now,
        },
        update: {
          status: JobOfferStatus.ACCEPTED,
          offeredAt: now,
          expiresAt: null,
          respondedAt: now,
          rejectionReason: null,
          dropReason: null,
        },
      });
      await tx.jobAssignmentHistory.updateMany({
        where: { jobId, endedAt: null },
        data: { endedAt: now, endReason: 'REASSIGNED' },
      });
      await tx.jobAssignmentHistory.create({
        data: {
          jobId,
          technicianId: technician.id,
          technicianName: technician.user.fullName,
        },
      });
      await this.audit.log(
        {
          entityType: 'Job',
          entityId: jobId,
          action: 'JOB_REASSIGNED',
          actorId: adminId,
          metadata: {
            previousTechnicianId,
            technicianId: technician.id,
          },
        },
        tx,
      );
    });
    return this.getForAdmin(jobId);
  }

  /**
   * Admin delete for mistaken or duplicate requests. Jobs that are assigned or
   * completed must be cancelled instead so the record stays traceable.
   */
  async adminDelete(jobId: string, adminId: string) {
    const job = await this.findJob(jobId);
    if (
      job.status !== JobStatus.OPEN &&
      job.status !== JobStatus.CANCELLED
    ) {
      throw new ConflictException(
        'Only open or cancelled jobs can be deleted.',
      );
    }
    const objectKeys = job.media.map((item) => item.objectKey);
    await this.prisma.$transaction(async (tx) => {
      await this.audit.log(
        {
          entityType: 'Job',
          entityId: jobId,
          action: 'JOB_DELETED',
          actorId: adminId,
          fromStatus: job.status,
          metadata: {
            description: job.description,
            offeredAmount: job.offeredAmount,
          },
        },
        tx,
      );
      const deleted = await tx.job.deleteMany({
        where: {
          id: jobId,
          status: { in: [JobStatus.OPEN, JobStatus.CANCELLED] },
        },
      });
      if (!deleted.count) {
        throw new ConflictException('This job can no longer be deleted.');
      }
    });
    await this.deleteStoredFiles(objectKeys);
    return { message: 'Job deleted.' };
  }

  async listTechnicianOffers(technicianUserId: string) {
    const profile = await this.getTechnicianProfile(technicianUserId);
    const offers = await this.prisma.jobOffer.findMany({
      where: {
        technicianId: profile.id,
        OR: [
          {
            status: {
              in: [
                JobOfferStatus.REJECTED,
                JobOfferStatus.EXPIRED,
                JobOfferStatus.ACCEPTED,
                JobOfferStatus.DROPPED,
                JobOfferStatus.CANCELLED,
              ],
            },
          },
          {
            status: JobOfferStatus.OFFERED,
            expiresAt: { gt: new Date() },
          },
        ],
      },
      include: {
        job: {
          include: {
            serviceCategory: { select: { id: true, name: true, slug: true } },
            media: { orderBy: { createdAt: 'asc' } },
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
    return Promise.all(
      offers.map(async (offer) => ({
        id: offer.id,
        status: offer.status,
        round: offer.round,
        matchScore: offer.matchScore,
        distanceMeters: Math.round(offer.distanceMeters),
        offeredAt: offer.offeredAt,
        expiresAt: offer.expiresAt,
        respondedAt: offer.respondedAt,
        rejectionReason: offer.rejectionReason,
        dropReason: offer.dropReason,
        job: {
          id: offer.job.id,
          service: this.serviceName(offer.job),
          description: offer.job.description,
          locationAddress: offer.job.locationAddress,
          latitude: offer.job.latitude,
          longitude: offer.job.longitude,
          offeredAmount: offer.job.offeredAmount,
          currency: offer.job.currency,
          priority: offer.job.priority,
          status: offer.job.status,
          createdAt: offer.job.createdAt,
          media:
            offer.status === JobOfferStatus.OFFERED
              ? await this.mediaResponse(offer.job.id, offer.job.media)
              : [],
        },
      })),
    );
  }

  async listTechnicianJobs(technicianUserId: string) {
    const profile = await this.getTechnicianProfile(technicianUserId);
    const where: Prisma.JobWhereInput = {
      technicianHiddenAt: null,
      OR: [
        { technicianId: profile.id },
        { assignmentHistory: { some: { technicianId: profile.id } } },
      ],
    };
    const jobs = await this.prisma.job.findMany({
      where,
      include: JOB_INCLUDE,
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    });
    return Promise.all(jobs.map((job) => this.toResponse(job, 'technician')));
  }

  async acceptOffer(technicianUserId: string, offerId: string) {
    const profile = await this.getTechnicianProfile(technicianUserId);
    try {
      await this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`
            SELECT "id" FROM "technician_profiles"
            WHERE "id" = ${profile.id}
            FOR UPDATE`;
          const activeJobs = await tx.job.count({
            where: {
              technicianId: profile.id,
              status: JobStatus.ASSIGNED,
            },
          });
          if (activeJobs > 0) {
            throw new ConflictException(
              'Complete or mutually pause your current job before accepting another.',
            );
          }
          const offer = await tx.jobOffer.findFirst({
            where: {
              id: offerId,
              technicianId: profile.id,
              status: JobOfferStatus.OFFERED,
              expiresAt: { gt: new Date() },
              technician: {
                is: {
                  availabilityStatus: TechnicianAvailability.ONLINE,
                  verificationStatus: VerificationStatus.APPROVED,
                  user: {
                    is: {
                      status: UserStatus.ACTIVE,
                      role: UserRole.TECHNICIAN,
                    },
                  },
                },
              },
            },
            include: { job: true },
          });
          if (!offer) {
            throw new ConflictException(
              'This job offer is no longer available.',
            );
          }
          const payment = await tx.bookingPayment.findFirst({
            where: {
              jobId: offer.jobId,
              status: {
                in: [BookingPaymentStatus.VALID, BookingPaymentStatus.RESUMED],
              },
              validUntil: { gt: new Date() },
            },
            select: { id: true, validUntil: true },
          });
          if (!payment) {
            throw new ConflictException(
              'The booking payment is no longer valid for this job.',
            );
          }
          const claimed = await tx.job.updateMany({
            where: {
              id: offer.jobId,
              status: JobStatus.OPEN,
              technicianId: null,
              dispatchRound: offer.round,
            },
            data: {
              technicianId: profile.id,
              status: JobStatus.ASSIGNED,
              cooperationStatus: JobCooperationStatus.PENDING,
              dispatchStatus: JobDispatchStatus.STOPPED,
              technicianProgress: JobProgressStatus.STARTED,
              customerConfirmedAt: null,
              technicianConfirmedAt: null,
              assignedAt: new Date(),
              customerPauseRequestedAt: null,
              technicianPauseRequestedAt: null,
              customerResumeRequestedAt: null,
              technicianResumeRequestedAt: null,
            },
          });
          if (!claimed.count) {
            throw new ConflictException(
              'Another technician has already taken this job.',
            );
          }
          await tx.jobOffer.update({
            where: { id: offer.id },
            data: { status: JobOfferStatus.ACCEPTED, respondedAt: new Date() },
          });
          await tx.jobOffer.updateMany({
            where: {
              jobId: offer.jobId,
              round: offer.round,
              id: { not: offer.id },
              status: JobOfferStatus.WAITING,
            },
            data: { status: JobOfferStatus.CANCELLED, respondedAt: new Date() },
          });
          await tx.bookingPayment.update({
            where: { id: payment.id },
            data: {
              status: BookingPaymentStatus.PAUSED,
              remainingValiditySeconds: Math.max(
                0,
                Math.floor((payment.validUntil.getTime() - Date.now()) / 1000),
              ),
            },
          });
          await tx.technicianProfile.update({
            where: { id: profile.id },
            data: { availabilityStatus: TechnicianAvailability.OFFLINE },
          });
          const user = await tx.user.findUniqueOrThrow({
            where: { id: technicianUserId },
            select: { fullName: true },
          });
          await tx.jobAssignmentHistory.create({
            data: {
              jobId: offer.jobId,
              technicianId: profile.id,
              technicianName: user.fullName,
            },
          });
          await this.audit.log(
            {
              entityType: 'Job',
              entityId: offer.jobId,
              action: 'JOB_ACCEPTED',
              actorId: technicianUserId,
              fromStatus: JobStatus.OPEN,
              toStatus: JobStatus.ASSIGNED,
              metadata: { offerId: offer.id, matchScore: offer.matchScore },
            },
            tx,
          );
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      ) {
        throw new ConflictException(
          'Another technician has already taken this job.',
        );
      }
      throw error;
    }
    const job = await this.findJobByTechnician(technicianUserId, offerId);
    return this.toResponse(job, 'technician');
  }

  async rejectOffer(
    technicianUserId: string,
    offerId: string,
    dto: RejectJobOfferDto,
  ) {
    const profile = await this.getTechnicianProfile(technicianUserId);
    const offer = await this.prisma.jobOffer.findFirst({
      where: {
        id: offerId,
        technicianId: profile.id,
        status: JobOfferStatus.OFFERED,
        expiresAt: { gt: new Date() },
      },
      select: { id: true, jobId: true, round: true },
    });
    if (!offer)
      throw new ConflictException('This job offer is no longer available.');
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.jobOffer.updateMany({
        where: { id: offerId, status: JobOfferStatus.OFFERED },
        data: {
          status: JobOfferStatus.REJECTED,
          respondedAt: new Date(),
          rejectionReason: dto.reason?.trim() || null,
        },
      });
      if (!result.count)
        throw new ConflictException('This job offer is no longer available.');
      await tx.job.updateMany({
        where: {
          id: offer.jobId,
          status: JobStatus.OPEN,
          technicianId: null,
          dispatchRound: offer.round,
        },
        data: { dispatchStatus: JobDispatchStatus.PENDING },
      });
      await this.audit.log(
        {
          entityType: 'Job',
          entityId: offer.jobId,
          action: 'JOB_OFFER_REJECTED',
          actorId: technicianUserId,
          metadata: { offerId, reason: dto.reason?.trim() || null },
        },
        tx,
      );
      await tx.technicianProfile.update({
        where: { id: profile.id },
        data: { rejectionCount: { increment: 1 } },
      });
    });
    return { message: 'Job offer rejected.' };
  }

  async dropJob(technicianUserId: string, jobId: string, dto: DropJobDto) {
    return this.cancelJob(technicianUserId, jobId, 'technician', {
      reason: dto.reason,
    });
  }

  async updateProgress(
    userId: string,
    jobId: string,
    side: 'customer' | 'technician',
    dto: JobProgressDto,
  ) {
    const where: Prisma.JobWhereInput =
      side === 'customer'
        ? { id: jobId, customerId: userId, status: JobStatus.ASSIGNED }
        : {
            id: jobId,
            technician: { is: { userId } },
            status: JobStatus.ASSIGNED,
          };
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "jobs" WHERE "id" = ${jobId} FOR UPDATE`;
      const job = await tx.job.findFirst({ where });
      if (!job) throw new NotFoundException('Assigned job not found.');
      const current =
        side === 'customer' ? job.customerProgress : job.technicianProgress;
      this.assertProgressTransition(current, dto.status);
      const nextCustomer =
        side === 'customer' ? dto.status : job.customerProgress;
      const nextTechnician =
        side === 'technician' ? dto.status : job.technicianProgress;
      const status =
        nextCustomer === JobProgressStatus.FAILED ||
        nextTechnician === JobProgressStatus.FAILED
          ? JobStatus.FAILED
          : nextCustomer === JobProgressStatus.COMPLETED &&
              nextTechnician === JobProgressStatus.COMPLETED
            ? JobStatus.COMPLETED
            : JobStatus.ASSIGNED;
      await tx.job.update({
        where: { id: jobId },
        data: {
          ...(side === 'customer'
            ? { customerProgress: dto.status }
            : { technicianProgress: dto.status }),
          status,
          dispatchStatus:
            status === JobStatus.ASSIGNED
              ? job.dispatchStatus
              : JobDispatchStatus.STOPPED,
          completedAt:
            status === JobStatus.COMPLETED || status === JobStatus.FAILED
              ? new Date()
              : null,
        },
      });
      if (status === JobStatus.COMPLETED || status === JobStatus.FAILED) {
        const history = await tx.jobAssignmentHistory.findFirst({
          where: { jobId, endedAt: null },
          orderBy: { acceptedAt: 'desc' },
        });
        if (history) {
          await tx.jobAssignmentHistory.update({
            where: { id: history.id },
            data: {
              endedAt: new Date(),
              endReason: status,
            },
          });
        }
        if (status === JobStatus.COMPLETED) {
          await tx.bookingPayment.updateMany({
            where: {
              jobId,
              status: {
                in: [
                  BookingPaymentStatus.PAUSED,
                  BookingPaymentStatus.EXPIRED,
                ],
              },
            },
            data: {
              status: BookingPaymentStatus.COMPLETED,
              remainingValiditySeconds: null,
            },
          });
        }
      }
      await this.audit.log(
        {
          entityType: 'Job',
          entityId: jobId,
          action: `${side.toUpperCase()}_PROGRESS_UPDATED`,
          actorId: userId,
          metadata: {
            status: dto.status,
            customerProgress: nextCustomer,
            technicianProgress: nextTechnician,
          },
        },
        tx,
      );
    });
    const updated = await this.findJob(jobId);
    return this.toResponse(updated, side);
  }

  async getTechnicianJob(technicianUserId: string, jobId: string) {
    const profile = await this.getTechnicianProfile(technicianUserId);
    const job = await this.prisma.job.findFirst({
      where: {
        id: jobId,
        technicianHiddenAt: null,
        OR: [
          { technicianId: profile.id },
          { assignmentHistory: { some: { technicianId: profile.id } } },
        ],
      },
      include: JOB_INCLUDE,
    });
    if (!job) throw new NotFoundException('Job not found.');
    return this.toResponse(job, 'technician');
  }

  async listForAdmin() {
    const jobs = await this.prisma.job.findMany({
      include: {
        ...JOB_INCLUDE,
        offers: {
          include: {
            technician: {
              include: { user: { select: { id: true, fullName: true } } },
            },
          },
          orderBy: [{ round: 'asc' }, { matchScore: 'desc' }],
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
    return Promise.all(
      jobs.map(async (job) => ({
        ...(await this.toResponse(job, 'admin')),
        offers: job.offers.map((offer) => ({
          id: offer.id,
          technicianId: offer.technicianId,
          technicianName: offer.technician.user.fullName,
          round: offer.round,
          matchScore: offer.matchScore,
          distanceMeters: Math.round(offer.distanceMeters),
          status: offer.status,
          offeredAt: offer.offeredAt,
          expiresAt: offer.expiresAt,
          respondedAt: offer.respondedAt,
          rejectionReason: offer.rejectionReason,
          dropReason: offer.dropReason,
        })),
      })),
    );
  }

  // Counts the jobs the admin dashboard summarises. In-flight jobs are those
  // still OPEN or ASSIGNED; FAILED, CANCELLED, and COMPLETED are terminal.
  // A dispute counts as open until an admin records a resolution.
  async summaryForAdmin() {
    const [active, completed, openDisputes] = await Promise.all([
      this.prisma.job.count({
        where: {
          status: { in: [JobStatus.OPEN, JobStatus.ASSIGNED, JobStatus.PAUSED] },
        },
      }),
      this.prisma.job.count({ where: { status: JobStatus.COMPLETED } }),
      this.prisma.dispute.count({ where: { resolvedAt: null } }),
    ]);
    return { active, completed, openDisputes };
  }

  async getForAdmin(jobId: string) {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: {
        ...JOB_INCLUDE,
        offers: {
          include: {
            technician: {
              include: { user: { select: { id: true, fullName: true } } },
            },
          },
          orderBy: [{ round: 'asc' }, { matchScore: 'desc' }],
        },
      },
    });
    if (!job) throw new NotFoundException('Job not found.');
    return {
      ...(await this.toResponse(job, 'admin')),
      offers: job.offers.map((offer) => ({
        id: offer.id,
        technicianId: offer.technicianId,
        technicianName: offer.technician.user.fullName,
        round: offer.round,
        matchScore: offer.matchScore,
        distanceMeters: Math.round(offer.distanceMeters),
        status: offer.status,
        offeredAt: offer.offeredAt,
        expiresAt: offer.expiresAt,
        respondedAt: offer.respondedAt,
        rejectionReason: offer.rejectionReason,
        dropReason: offer.dropReason,
      })),
    };
  }

  async updateByAdmin(
    jobId: string,
    dto: AdminUpdateJobDto,
    adminId: string,
  ) {
    if (!Object.keys(dto).length) {
      throw new BadRequestException('Provide at least one job field to update.');
    }
    const current = await this.findJob(jobId);
    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.job.update({
        where: { id: jobId },
        data: {
          ...(dto.description !== undefined && {
            description: dto.description.trim(),
          }),
          ...(dto.locationAddress !== undefined && {
            locationAddress: dto.locationAddress.trim(),
          }),
          ...(dto.offeredAmount !== undefined && {
            offeredAmount: dto.offeredAmount,
          }),
        },
      });
      await this.audit.log(
        {
          entityType: 'Job',
          entityId: jobId,
          action: 'ADMIN_JOB_UPDATED',
          actorId: adminId,
          fromStatus: current.status,
          toStatus: saved.status,
          metadata: { changedFields: Object.keys(dto) },
        },
        tx,
      );
      return saved;
    });
    return this.getForAdmin(updated.id);
  }

  async permanentlyDelete(jobId: string, adminId: string) {
    const job = await this.findJob(jobId);
    if (
      job.status !== JobStatus.COMPLETED &&
      job.status !== JobStatus.CANCELLED
    ) {
      throw new ConflictException(
        'Only completed or cancelled jobs can be permanently deleted.',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.job.delete({ where: { id: jobId } });
      await this.audit.log(
        {
          entityType: 'Job',
          entityId: jobId,
          action: 'ADMIN_JOB_PERMANENTLY_DELETED',
          actorId: adminId,
          fromStatus: job.status,
          metadata: {
            paymentHistoryRetained: Boolean(job.bookingPayment),
            deletedMediaCount: job.media.length,
          },
        },
        tx,
      );
    });
    await this.deleteStoredFiles(job.media.map((media) => media.objectKey));
    return { message: 'Job permanently deleted; payment and audit history retained.' };
  }

  async addMedia(
    customerId: string,
    jobId: string,
    photos: JobUpload[],
    video?: JobUpload,
  ) {
    const job = await this.findJob(jobId);
    this.assertCustomerOwnsJob(job, customerId);
    this.assertEditable(job);
    const prepared = this.prepareMedia(photos, video);
    if (!prepared.length) {
      throw new BadRequestException(
        'Choose at least one photo or video to upload.',
      );
    }
    const photoCount = job.media.filter(
      (item) => item.type === JobMediaType.PHOTO,
    ).length;
    const videoCount = job.media.filter(
      (item) => item.type === JobMediaType.VIDEO,
    ).length;
    if (photoCount + photos.length > 5 || videoCount + (video ? 1 : 0) > 1) {
      throw new ConflictException(
        'A job can contain at most five photos and one video.',
      );
    }
    const keys: string[] = [];
    try {
      await this.storeMedia(jobId, prepared, keys);
      await this.prisma.$transaction(async (tx) => {
        await tx.jobMedia.createMany({
          data: prepared.map((item, index) => ({
            ...this.mediaCreateData(keys[index], item),
            jobId,
          })),
        });
        const edited = await tx.job.updateMany({
          where: {
            id: jobId,
            status: JobStatus.OPEN,
            technicianId: null,
            dispatchRound: job.dispatchRound,
          },
          data: {
            dispatchRound: { increment: 1 },
            dispatchStatus: JobDispatchStatus.PENDING,
          },
        });
        if (!edited.count) {
          throw new ConflictException('This job can no longer be changed.');
        }
        await tx.jobOffer.updateMany({
          where: {
            jobId,
            round: job.dispatchRound,
            status: { in: [JobOfferStatus.WAITING, JobOfferStatus.OFFERED] },
          },
          data: { status: JobOfferStatus.CANCELLED, respondedAt: new Date() },
        });
        await this.audit.log(
          {
            entityType: 'Job',
            entityId: jobId,
            action: 'JOB_MEDIA_ADDED',
            actorId: customerId,
          },
          tx,
        );
      });
    } catch (error) {
      await this.deleteStoredFiles(keys);
      throw error;
    }
    return this.getCustomerJob(customerId, jobId);
  }

  async deleteMedia(customerId: string, jobId: string, mediaId: string) {
    const job = await this.findJob(jobId);
    this.assertCustomerOwnsJob(job, customerId);
    this.assertEditable(job);
    const media = await this.prisma.jobMedia.findFirst({
      where: { id: mediaId, jobId },
    });
    if (!media) throw new NotFoundException('Job media not found.');
    await this.prisma.$transaction(async (tx) => {
      await tx.jobMedia.delete({ where: { id: mediaId } });
      const edited = await tx.job.updateMany({
        where: {
          id: jobId,
          status: JobStatus.OPEN,
          technicianId: null,
          dispatchRound: job.dispatchRound,
        },
        data: {
          dispatchRound: { increment: 1 },
          dispatchStatus: JobDispatchStatus.PENDING,
        },
      });
      if (!edited.count) {
        throw new ConflictException('This job can no longer be changed.');
      }
      await tx.jobOffer.updateMany({
        where: {
          jobId,
          round: job.dispatchRound,
          status: { in: [JobOfferStatus.WAITING, JobOfferStatus.OFFERED] },
        },
        data: { status: JobOfferStatus.CANCELLED, respondedAt: new Date() },
      });
      await this.audit.log(
        {
          entityType: 'Job',
          entityId: jobId,
          action: 'JOB_MEDIA_REMOVED',
          actorId: customerId,
        },
        tx,
      );
    });
    await this.deleteStoredFiles([media.objectKey]);
    return this.getCustomerJob(customerId, jobId);
  }

  async downloadMedia(
    userId: string,
    role: UserRole,
    jobId: string,
    mediaId: string,
  ) {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        customerId: true,
        technicianId: true,
        offers: {
          where: {
            technician: { userId },
            OR: [
              { status: JobOfferStatus.ACCEPTED },
              {
                status: JobOfferStatus.OFFERED,
                expiresAt: { gt: new Date() },
              },
            ],
          },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!job) throw new NotFoundException('Job not found.');
    if (
      role !== UserRole.ADMIN &&
      job.customerId !== userId &&
      !(await this.isAssignedTechnician(job.technicianId, userId)) &&
      job.offers.length === 0
    ) {
      throw new NotFoundException('Job media not found.');
    }
    const media = await this.prisma.jobMedia.findFirst({
      where: { id: mediaId, jobId },
    });
    if (!media) throw new NotFoundException('Job media not found.');
    return {
      buffer: await this.storage.get(media.objectKey),
      mimeType: media.mimeType,
      fileName: media.originalFileName,
    };
  }

  async expireOffer(offerId: string) {
    const offer = await this.prisma.jobOffer.findUnique({
      where: { id: offerId },
      select: {
        id: true,
        jobId: true,
        round: true,
        status: true,
        expiresAt: true,
      },
    });
    if (
      !offer ||
      offer.status !== JobOfferStatus.OFFERED ||
      !offer.expiresAt ||
      offer.expiresAt.getTime() > Date.now()
    ) {
      return;
    }
    await this.prisma.$transaction(async (tx) => {
      const expired = await tx.jobOffer.updateMany({
        where: {
          id: offer.id,
          status: JobOfferStatus.OFFERED,
          expiresAt: { lte: new Date() },
        },
        data: { status: JobOfferStatus.EXPIRED, respondedAt: new Date() },
      });
      if (!expired.count) return;
      await tx.job.updateMany({
        where: {
          id: offer.jobId,
          status: JobStatus.OPEN,
          technicianId: null,
          dispatchRound: offer.round,
        },
        data: { dispatchStatus: JobDispatchStatus.PENDING },
      });
      await this.audit.log(
        {
          entityType: 'Job',
          entityId: offer.jobId,
          action: 'JOB_OFFER_EXPIRED',
          metadata: { offerId: offer.id },
        },
        tx,
      );
    });
  }

  private async findMatches(input: {
    serviceCategoryId: string | null;
    otherServiceName: string | null;
    latitude: number;
    longitude: number;
  }): Promise<MatchCandidate[]> {
    const serviceName = this.normalizeService(input.otherServiceName ?? '');
    const technicians = await this.prisma.$queryRaw<
      Array<{
        technicianId: string;
        distanceMeters: number;
        rejectionCount: number;
        cancellationCount: number;
      }>
    >`
      SELECT DISTINCT ON (tp."id")
        tp."id" AS "technicianId",
        tp."rejectionCount",
        tp."cancellationCount",
        ST_Distance(
          tp."baseLocation",
          ST_SetSRID(
            ST_MakePoint(${input.longitude}::double precision, ${input.latitude}::double precision),
            4326
          )::geography
        )::double precision AS "distanceMeters"
      FROM "technician_profiles" tp
      JOIN "users" u ON u."id" = tp."userId"
      JOIN "technician_categories" tc ON tc."technicianId" = tp."id"
      LEFT JOIN "service_categories" sc ON sc."id" = tc."categoryId"
      WHERE tp."verificationStatus" = 'APPROVED'
        AND tp."availabilityStatus" = 'ONLINE'
        AND tp."baseLocation" IS NOT NULL
        AND u."status" = 'ACTIVE'
        AND u."role" = 'TECHNICIAN'
        AND (tc."categoryId" IS NULL OR sc."isActive" = TRUE)
        AND ST_DWithin(
          tp."baseLocation",
          ST_SetSRID(
            ST_MakePoint(${input.longitude}::double precision, ${input.latitude}::double precision),
            4326
          )::geography,
          ${JOB_MATCH_RADIUS_METERS}
        )
        AND (
          (
            CAST(${input.serviceCategoryId} AS text) IS NOT NULL
            AND tc."categoryId" = CAST(${input.serviceCategoryId} AS text)
          )
          OR
          (
            CAST(${input.serviceCategoryId} AS text) IS NULL
            AND (
              tc."customNameNormalized" = ${serviceName}
              OR LOWER(BTRIM(sc."name")) = ${serviceName}
            )
          )
        )
      ORDER BY tp."id", "distanceMeters" ASC`;
    const hasServiceSelection =
      Boolean(input.serviceCategoryId) ||
      Boolean(input.otherServiceName?.trim());
    const matches: MatchCandidate[] = [];
    for (const technician of technicians) {
      const distanceMeters = Number(technician.distanceMeters);
      const matchScore = calculateJobMatchScore(
        hasServiceSelection,
        distanceMeters,
      );
      if (matchScore === null) continue;
      const adjustedScore = JobsService.adjustMatchScore(
        matchScore,
        technician.rejectionCount,
        technician.cancellationCount,
      );
      if (adjustedScore < JOB_MINIMUM_MATCH_SCORE) continue;
      matches.push({
        technicianId: technician.technicianId,
        matchScore: adjustedScore,
        distanceMeters,
        rejectionCount: technician.rejectionCount,
        cancellationCount: technician.cancellationCount,
      });
    }
    return matches.sort(
      (a, b) =>
        b.matchScore - a.matchScore ||
        a.distanceMeters - b.distanceMeters ||
        a.technicianId.localeCompare(b.technicianId),
    );
  }

  private async resolveServiceSelection(
    categoryId?: string | null,
    customName?: string | null,
  ): Promise<{
    serviceCategoryId: string | null;
    otherServiceName: string | null;
  }> {
    const hasCategory = Boolean(categoryId);
    const hasCustomName = Boolean(customName?.trim());
    if (hasCategory === hasCustomName) {
      throw new BadRequestException(
        'Provide exactly one of serviceCategoryId or otherServiceName.',
      );
    }
    if (categoryId) {
      const category = await this.prisma.serviceCategory.findFirst({
        where: { id: categoryId, isActive: true },
        select: { id: true },
      });
      if (!category) {
        throw new BadRequestException(
          'The selected service category is invalid or inactive.',
        );
      }
      return { serviceCategoryId: category.id, otherServiceName: null };
    }
    return {
      serviceCategoryId: null,
      otherServiceName: customName!.trim(),
    };
  }

  private prepareMedia(photos: JobUpload[], video?: JobUpload): MediaInput[] {
    const validated = validateJobUploads(photos, video);
    const files = [...photos, ...(video ? [video] : [])];
    return files.map((upload, index) => ({
      upload,
      validated: validated[index],
    }));
  }

  private async storeMedia(
    jobId: string,
    media: MediaInput[],
    storedKeys: string[],
  ) {
    for (const item of media) {
      const objectKey = `jobs/${jobId}/${randomUUID()}.${item.validated.extension}`;
      await this.storage.put(
        objectKey,
        item.upload.buffer,
        item.validated.mimeType,
      );
      storedKeys.push(objectKey);
    }
  }

  private mediaCreateData(
    objectKey: string,
    item: MediaInput,
  ): Prisma.JobMediaCreateWithoutJobInput {
    return {
      type: item.validated.type,
      objectKey,
      mimeType: item.validated.mimeType,
      originalFileName: safeJobFileName(item.upload.originalname),
      sizeBytes: item.upload.buffer.length,
      durationSeconds: item.validated.durationSeconds,
    };
  }

  private async deleteStoredFiles(keys: string[]) {
    for (const key of keys) {
      try {
        await this.storage.delete(key);
      } catch (error) {
        this.logger.error(
          `Could not remove job media ${key}: ${this.errorMessage(error)}`,
        );
      }
    }
  }

  private async toResponse(
    job: JobWithDetails,
    viewer: 'customer' | 'technician' | 'admin',
  ) {
    const currentTechnician = job.technician
      ? {
          id: job.technician.id,
          fullName: job.technician.user.fullName,
          profile: {
            gender: job.technician.gender,
            yearsOfExperience: job.technician.categories.length
              ? Math.max(
                  ...job.technician.categories.map(
                    (category) => category.yearsOfExperience,
                  ),
                )
              : 0,
            serviceExperiences: job.technician.categories.map((category) => ({
              categoryId: category.categoryId,
              category: category.category,
              customName: category.customName,
              yearsOfExperience: category.yearsOfExperience,
            })),
            publicLocationLabel: job.technician.publicLocationLabel,
            profilePictureUrl: job.technician.profilePictureObjectKey
              ? await this.storage.getDownloadUrl(
                  job.technician.profilePictureObjectKey,
                )
              : null,
          },
        }
      : null;
    const response = {
      id: job.id,
      service: this.serviceName(job),
      serviceCategory: job.serviceCategory,
      otherServiceName: job.otherServiceName,
      description: job.description,
      location: {
        address: job.locationAddress,
        latitude: job.latitude,
        longitude: job.longitude,
      },
      offeredAmount: job.offeredAmount,
      currency: job.currency,
      priority: job.priority,
      status: job.status,
      cooperationStatus: job.cooperationStatus,
      cooperationConfirmations: {
        customerConfirmedAt: job.customerConfirmedAt,
        technicianConfirmedAt: job.technicianConfirmedAt,
      },
      dispatchStatus: job.dispatchStatus,
      customerProgress: job.customerProgress,
      technicianProgress: job.technicianProgress,
      pauseRequests: {
        customerRequested: Boolean(job.customerPauseRequestedAt),
        technicianRequested: Boolean(job.technicianPauseRequestedAt),
      },
      resumeRequests: {
        customerRequested: Boolean(job.customerResumeRequestedAt),
        technicianRequested: Boolean(job.technicianResumeRequestedAt),
      },
      bookingPayment: job.bookingPayment
        ? {
            id: job.bookingPayment.id,
            externalPaymentId: job.bookingPayment.externalPaymentId,
            serviceCategory: job.bookingPayment.serviceCategory,
            amount: job.bookingPayment.amount,
            currency: 'RWF',
            status: job.bookingPayment.status,
            paidAt: job.bookingPayment.paidAt,
            validUntil: job.bookingPayment.validUntil,
            remainingValiditySeconds:
              job.bookingPayment.remainingValiditySeconds,
          }
        : null,
      assignedAt: job.assignedAt,
      completedAt: job.completedAt,
      cancellationReason: job.cancellationReason,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      media: await this.mediaResponse(job.id, job.media),
      currentTechnician,
      dispute: job.dispute
        ? {
            reason: job.dispute.reason,
            openedBy: job.dispute.openedBy,
            openedAt: job.dispute.openedAt,
            ...(job.dispute.resolvedAt
              ? {
                  resolution: {
                    outcome: job.dispute.outcome,
                    amount: job.dispute.amount,
                    note: job.dispute.note,
                    resolvedAt: job.dispute.resolvedAt,
                    resolvedBy: job.dispute.resolvedBy?.fullName ?? null,
                  },
                }
              : {}),
          }
        : null,
      ...(viewer === 'admin' || viewer === 'customer'
        ? {
            customer: {
              id: job.customer.id,
              fullName: job.customer.fullName,
              ...(viewer === 'admin'
                ? {
                    phoneNumber: job.customer.phoneNumber,
                    email: job.customer.email,
                  }
                : {}),
            },
            assignmentHistory: job.assignmentHistory.map((entry) => ({
              technicianId: entry.technicianId,
              technicianName:
                entry.technician?.user.fullName ?? entry.technicianName,
              acceptedAt: entry.acceptedAt,
              endedAt: entry.endedAt,
              endReason: entry.endReason,
              reason: entry.reason,
            })),
          }
        : {}),
    };
    return response;
  }

  private async mediaResponse(
    jobId: string,
    media: Array<{
      id: string;
      type: JobMediaType;
      mimeType: string;
      originalFileName: string;
      sizeBytes: number;
      durationSeconds: number | null;
      createdAt: Date;
    }>,
  ) {
    return media.map((item) => ({
      id: item.id,
      type: item.type,
      mimeType: item.mimeType,
      fileName: item.originalFileName,
      sizeBytes: item.sizeBytes,
      durationSeconds: item.durationSeconds,
      createdAt: item.createdAt,
      downloadPath: `/api/v1/jobs/${jobId}/media/${item.id}`,
    }));
  }

  private serviceName(job: {
    otherServiceName: string | null;
    serviceCategory?: { name: string } | null;
  }) {
    return job.serviceCategory?.name ?? job.otherServiceName;
  }

  private async releaseAssignment(
    tx: Prisma.TransactionClient,
    job: Job,
    reason: string,
    countTechnicianCancellation: boolean,
  ) {
    if (!job.technicianId) {
      throw new ConflictException('This job does not have an assigned technician.');
    }
    const now = new Date();
    const offer = await tx.jobOffer.findFirst({
      where: {
        jobId: job.id,
        technicianId: job.technicianId,
        status: JobOfferStatus.ACCEPTED,
      },
      orderBy: { round: 'desc' },
      select: { id: true },
    });
    if (offer) {
      await tx.jobOffer.update({
        where: { id: offer.id },
        data: {
          status: JobOfferStatus.DROPPED,
          respondedAt: now,
          dropReason: reason,
        },
      });
    }
    const history = await tx.jobAssignmentHistory.findFirst({
      where: { jobId: job.id, technicianId: job.technicianId, endedAt: null },
      orderBy: { acceptedAt: 'desc' },
    });
    if (history) {
      await tx.jobAssignmentHistory.update({
        where: { id: history.id },
        data: { endedAt: now, endReason: 'CANCELLED', reason },
      });
    }
    const confirmedCooperation =
      job.cooperationStatus === JobCooperationStatus.CONFIRMED;
    await tx.job.update({
      where: { id: job.id },
      data: {
        technicianId: null,
        status: confirmedCooperation ? JobStatus.CANCELLED : JobStatus.OPEN,
        dispatchStatus: confirmedCooperation
          ? JobDispatchStatus.STOPPED
          : JobDispatchStatus.PENDING,
        ...(confirmedCooperation ? {} : { dispatchRound: { increment: 1 } }),
        technicianProgress: JobProgressStatus.PENDING,
        customerProgress: JobProgressStatus.PENDING,
        assignedAt: null,
        ...(confirmedCooperation
          ? {}
          : {
              cooperationStatus: JobCooperationStatus.PENDING,
              customerConfirmedAt: null,
              technicianConfirmedAt: null,
            }),
        customerPauseRequestedAt: null,
        technicianPauseRequestedAt: null,
        customerResumeRequestedAt: null,
        technicianResumeRequestedAt: null,
      },
    });
    const payment = await tx.bookingPayment.findFirst({
      where: { jobId: job.id, status: BookingPaymentStatus.PAUSED },
    });
    if (payment) {
      const remaining =
        payment.remainingValiditySeconds ??
        Math.floor((payment.validUntil.getTime() - now.getTime()) / 1000);
      if (remaining > 0) {
        await tx.bookingPayment.update({
          where: { id: payment.id },
          data: {
            status: BookingPaymentStatus.RESUMED,
            validUntil: new Date(now.getTime() + remaining * 1000),
            remainingValiditySeconds: null,
          },
        });
      } else {
        await tx.bookingPayment.update({
          where: { id: payment.id },
          data: {
            status: BookingPaymentStatus.EXPIRED,
            remainingValiditySeconds: 0,
          },
        });
      }
    }
    if (countTechnicianCancellation) {
      await tx.technicianProfile.update({
        where: { id: job.technicianId },
        data: { cancellationCount: { increment: 1 } },
      });
    }
    const activeJobs = await tx.job.count({
      where: {
        technicianId: job.technicianId,
        status: JobStatus.ASSIGNED,
      },
    });
    if (!activeJobs) {
      await tx.technicianProfile.updateMany({
        where: {
          id: job.technicianId,
          verificationStatus: VerificationStatus.APPROVED,
          user: { is: { status: UserStatus.ACTIVE } },
        },
        data: { availabilityStatus: TechnicianAvailability.ONLINE },
      });
    }
  }

  private async findJob(jobId: string): Promise<JobWithDetails> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: JOB_INCLUDE,
    });
    if (!job) throw new NotFoundException('Job not found.');
    return job;
  }

  private async getTechnicianProfile(userId: string) {
    const profile = await this.prisma.technicianProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!profile) throw new NotFoundException('Technician profile not found.');
    return profile;
  }

  private async findJobByTechnician(
    technicianUserId: string,
    offerId: string,
  ): Promise<JobWithDetails> {
    const profile = await this.getTechnicianProfile(technicianUserId);
    const offer = await this.prisma.jobOffer.findFirst({
      where: { id: offerId, technician: { userId: technicianUserId } },
      select: { jobId: true },
    });
    if (!offer) throw new NotFoundException('Job offer not found.');
    const job = await this.prisma.job.findFirst({
      where: { id: offer.jobId, technicianId: profile.id },
      include: JOB_INCLUDE,
    });
    if (!job) throw new NotFoundException('Assigned job not found.');
    return job;
  }

  private async isAssignedTechnician(
    profileId: string | null,
    userId: string,
  ): Promise<boolean> {
    if (!profileId) return false;
    const profile = await this.prisma.technicianProfile.findFirst({
      where: { id: profileId, userId },
      select: { id: true },
    });
    return Boolean(profile);
  }

  private assertCustomerOwnsJob(job: JobWithDetails, customerId: string) {
    if (job.customerId !== customerId)
      throw new NotFoundException('Job not found.');
  }

  private outstandingOffer(
    conversation: CustomerConversation,
  ): CustomerOffer | null {
    for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
      const offer = conversation.messages[index].offer;
      if (offer?.status === PriceOfferStatus.PENDING) return offer;
    }
    return null;
  }

  private assertEditable(job: JobWithDetails) {
    if (job.status !== JobStatus.OPEN || job.technicianId) {
      throw new ConflictException(
        'Only an unassigned open job can be changed or cancelled.',
      );
    }
  }

  private assertProgressTransition(
    current: JobProgressStatus,
    next: JobProgressStatus,
  ) {
    const allowed: Record<JobProgressStatus, JobProgressStatus[]> = {
      PENDING: [JobProgressStatus.STARTED, JobProgressStatus.FAILED],
      STARTED: [
        JobProgressStatus.IN_PROGRESS,
        JobProgressStatus.COMPLETED,
        JobProgressStatus.FAILED,
      ],
      IN_PROGRESS: [JobProgressStatus.COMPLETED, JobProgressStatus.FAILED],
      COMPLETED: [],
      FAILED: [],
    };
    if (!allowed[current].includes(next)) {
      throw new ConflictException(
        `Progress cannot change from ${current} to ${next}.`,
      );
    }
  }

  private normalizeService(value: string) {
    return value.normalize('NFKC').trim().toLowerCase();
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}
