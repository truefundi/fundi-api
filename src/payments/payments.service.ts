import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BookingPaymentStatus,
  JobCooperationStatus,
  JobStatus,
  Prisma,
} from '@prisma/client';
import { createHmac, randomUUID } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { CreateMockPaymentDto } from './dto/create-mock-payment.dto';
import { ExtendPaymentDto } from './dto/extend-payment.dto';
import { RecordProcessedPaymentDto } from './dto/record-processed-payment.dto';
import { CreateCompletedPaymentDto } from './dto/create-completed-payment.dto';
import { UpdateCompletedPaymentDto } from './dto/update-completed-payment.dto';

const BOOKING_VALIDITY_SECONDS = 7 * 24 * 60 * 60;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async createMockPayment(customerId: string, dto: CreateMockPaymentDto) {
    const category = await this.prisma.serviceCategory.findFirst({
      where: { id: dto.serviceCategoryId, isActive: true },
      select: { id: true, name: true, bookingFee: true },
    });
    if (!category) throw new NotFoundException('Service category not found.');
    const bookingFee = category.bookingFee;
    if (bookingFee === null || bookingFee <= 0) {
      throw new BadRequestException(
        'This service category does not have a booking fee configured yet.',
      );
    }

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: customerId },
      select: { phoneNumber: true },
    });
    const key = this.config.get<string>('mockPayment.key');
    const secret = this.config.get<string>('mockPayment.secret');
    if (!key || !secret) {
      throw new ServiceUnavailableException(
        'Mock payment is not configured. Set MOCK_PAYMENT_KEY and MOCK_PAYMENT_SECRET.',
      );
    }

    const id = randomUUID();
    const externalPaymentId = `mock_${randomUUID()}`;
    const phoneNumber = dto.phoneNumber ?? user.phoneNumber;
    const paidAt = new Date();
    const validUntil = new Date(
      paidAt.getTime() + BOOKING_VALIDITY_SECONDS * 1000,
    );
    const signature = createHmac('sha256', secret)
      .update(
        [
          id,
          externalPaymentId,
          customerId,
          category.id,
          bookingFee,
          phoneNumber,
          paidAt.toISOString(),
        ].join(':'),
      )
      .digest('hex');
    const payment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.bookingPayment.create({
        data: {
          id,
          customerId,
          serviceCategoryId: category.id,
          externalPaymentId,
          paymentKeyId: key,
          signature,
          phoneNumber,
          amount: bookingFee,
          paidAt,
          validUntil,
          status: BookingPaymentStatus.VALID,
        },
      });
      await this.audit.log(
        {
          entityType: 'BookingPayment',
          entityId: created.id,
          action: 'MOCK_PAYMENT_SUCCEEDED',
          actorId: customerId,
          toStatus: BookingPaymentStatus.VALID,
          metadata: {
            externalPaymentId,
            serviceCategoryId: category.id,
            amount: bookingFee,
            phoneNumber,
            paidAt: paidAt.toISOString(),
          },
        },
        tx,
      );
      return created;
    });
    return {
      id: payment.id,
      externalPaymentId,
      status: 'SUCCESS',
      bookingStatus: payment.status,
      serviceCategory: category,
      phoneNumber,
      amount: payment.amount,
      currency: 'RWF',
      paidAt: payment.paidAt,
      validUntil: payment.validUntil,
    };
  }

  async recordFrontendProcessedPayment(
    customerId: string,
    dto: RecordProcessedPaymentDto,
  ) {
    const environment = this.config.get<string>(
      'environment',
      process.env.NODE_ENV || 'development',
    );
    if (environment === 'production') {
      throw new ServiceUnavailableException(
        'Frontend-reported payments are disabled in production. Confirm payments through the payment provider on the server.',
      );
    }
    const category = await this.prisma.serviceCategory.findFirst({
      where: { id: dto.serviceCategoryId, isActive: true },
      select: { id: true, name: true, bookingFee: true },
    });
    if (!category) throw new NotFoundException('Service category not found.');
    if (!category.bookingFee || category.bookingFee !== dto.amount) {
      throw new BadRequestException(
        'The submitted payment amount must match the service category booking fee.',
      );
    }
    const paidAt = this.parsePastDate(dto.paidAt);
    const key = this.config.get<string>('mockPayment.key');
    const secret = this.config.get<string>('mockPayment.secret');
    if (!key || !secret) {
      throw new ServiceUnavailableException(
        'Payment recording is not configured. Set MOCK_PAYMENT_KEY and MOCK_PAYMENT_SECRET.',
      );
    }
    const id = randomUUID();
    const validUntil = new Date(
      paidAt.getTime() + BOOKING_VALIDITY_SECONDS * 1000,
    );
    const bookingStatus =
      validUntil <= new Date()
        ? BookingPaymentStatus.EXPIRED
        : BookingPaymentStatus.VALID;
    const signature = this.signPayment(
      secret,
      id,
      dto.externalPaymentId,
      customerId,
      category.id,
      dto.amount,
      dto.phoneNumber,
      paidAt,
    );
    try {
      const payment = await this.prisma.$transaction(async (tx) => {
        const created = await tx.bookingPayment.create({
          data: {
            id,
            customerId,
            serviceCategoryId: category.id,
            externalPaymentId: dto.externalPaymentId,
            paymentKeyId: `frontend:${key}`,
            signature,
            phoneNumber: dto.phoneNumber,
            amount: dto.amount,
            paidAt,
            validUntil,
            status: bookingStatus,
          },
        });
        await this.audit.log(
          {
            entityType: 'BookingPayment',
            entityId: created.id,
            action: 'FRONTEND_PAYMENT_RECORDED_UNVERIFIED',
            actorId: customerId,
            toStatus: bookingStatus,
            metadata: {
              externalPaymentId: dto.externalPaymentId,
              serviceCategoryId: category.id,
              amount: dto.amount,
              phoneNumber: dto.phoneNumber,
              paidAt: paidAt.toISOString(),
              providerVerified: false,
            },
          },
          tx,
        );
        return created;
      });
      return {
        id: payment.id,
        externalPaymentId: payment.externalPaymentId,
        status: dto.status,
        bookingStatus: payment.status,
        serviceCategory: category,
        phoneNumber: payment.phoneNumber,
        amount: payment.amount,
        currency: 'RWF',
        paidAt: payment.paidAt,
        validUntil: payment.validUntil,
        providerVerified: false,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'A payment with this external payment ID has already been recorded.',
        );
      }
      throw error;
    }
  }

  async listMine(customerId: string) {
    const now = new Date();
    await this.prisma.bookingPayment.updateMany({
      where: {
        customerId,
        status: {
          in: [BookingPaymentStatus.VALID, BookingPaymentStatus.RESUMED],
        },
        validUntil: { lte: now },
      },
      data: { status: BookingPaymentStatus.EXPIRED },
    });
    const payments = await this.prisma.bookingPayment.findMany({
      where: { customerId },
      include: {
        serviceCategory: { select: { id: true, name: true, slug: true } },
        job: {
          include: {
            assignmentHistory: {
              select: {
                technicianId: true,
                technicianName: true,
                acceptedAt: true,
                endedAt: true,
                endReason: true,
                reason: true,
              },
              orderBy: { acceptedAt: 'asc' },
            },
            offers: {
              select: {
                technicianId: true,
                status: true,
                rejectionReason: true,
                dropReason: true,
                offeredAt: true,
                respondedAt: true,
                technician: { select: { user: { select: { fullName: true } } } },
              },
              orderBy: [{ round: 'asc' }, { createdAt: 'asc' }],
            },
          },
        },
      },
      orderBy: [{ paidAt: 'desc' }, { id: 'asc' }],
    });
    return payments.map(({ signature: _signature, paymentKeyId: _key, ...payment }) => ({
      ...payment,
      currency: 'RWF',
      service: payment.serviceCategory.name,
      job: payment.job
        ? {
            id: payment.job.id,
            status: payment.job.status,
            description: payment.job.description,
            createdAt: payment.job.createdAt,
            completedAt: payment.job.completedAt,
            technicians: this.uniqueTechnicians(
              payment.job.assignmentHistory.map((entry) => ({
                technicianId: entry.technicianId,
                fullName: entry.technicianName,
                acceptedAt: entry.acceptedAt,
                endedAt: entry.endedAt,
                endReason: entry.endReason,
                reason: entry.reason,
              })),
              payment.job.offers.map((offer) => ({
                technicianId: offer.technicianId,
                fullName: offer.technician.user.fullName,
                offerStatus: offer.status,
                offeredAt: offer.offeredAt,
                respondedAt: offer.respondedAt,
                rejectionReason: offer.rejectionReason,
                cancellationReason: offer.dropReason,
              })),
            ),
          }
        : null,
    }));
  }

  async listAll() {
    const now = new Date();
    await this.prisma.bookingPayment.updateMany({
      where: {
        status: {
          in: [BookingPaymentStatus.VALID, BookingPaymentStatus.RESUMED],
        },
        validUntil: { lte: now },
      },
      data: { status: BookingPaymentStatus.EXPIRED },
    });
    const rows = await this.prisma.bookingPayment.findMany({
      include: {
        customer: { select: { id: true, fullName: true, phoneNumber: true } },
        serviceCategory: { select: { id: true, name: true, slug: true } },
        job: {
          select: {
            id: true,
            status: true,
            description: true,
            createdAt: true,
            completedAt: true,
            assignmentHistory: {
              select: { technicianId: true, technicianName: true, acceptedAt: true, endedAt: true, endReason: true, reason: true },
              orderBy: { acceptedAt: 'asc' },
            },
          },
        },
      },
      orderBy: [{ paidAt: 'desc' }, { id: 'asc' }],
    });
    return rows.map(({ signature: _signature, paymentKeyId: _key, ...payment }) => ({
      ...payment,
      currency: 'RWF',
    }));
  }

  async listCompletedPayments() {
    const payments = await this.prisma.bookingPayment.findMany({
      where: {
        status: BookingPaymentStatus.COMPLETED,
        job: { is: { status: JobStatus.COMPLETED } },
      },
      include: {
        customer: { select: { id: true, fullName: true, phoneNumber: true } },
        serviceCategory: { select: { id: true, name: true, slug: true } },
        job: {
          select: {
            id: true,
            status: true,
            description: true,
            completedAt: true,
          },
        },
      },
      orderBy: [{ paidAt: 'desc' }, { id: 'asc' }],
    });
    return payments.map((payment) => this.toSafePayment(payment));
  }

  async getCompletedPayment(id: string) {
    const payment = await this.prisma.bookingPayment.findFirst({
      where: {
        id,
        status: BookingPaymentStatus.COMPLETED,
        job: { is: { status: JobStatus.COMPLETED } },
      },
      include: {
        customer: { select: { id: true, fullName: true, phoneNumber: true } },
        serviceCategory: { select: { id: true, name: true, slug: true } },
        job: {
          select: {
            id: true,
            status: true,
            description: true,
            completedAt: true,
          },
        },
      },
    });
    if (!payment) throw new NotFoundException('Completed payment not found.');
    return this.toSafePayment(payment);
  }

  async createCompletedPayment(
    dto: CreateCompletedPaymentDto,
    actorId: string,
  ) {
    const job = await this.prisma.job.findUnique({
      where: { id: dto.jobId },
      include: {
        serviceCategory: { select: { id: true, bookingFee: true } },
        bookingPayment: { select: { id: true } },
      },
    });
    if (!job || job.status !== JobStatus.COMPLETED) {
      throw new BadRequestException(
        'Payments can only be recorded for completed jobs.',
      );
    }
    if (!job.serviceCategory?.bookingFee || job.serviceCategory.bookingFee <= 0) {
      throw new BadRequestException(
        'The completed job category has no valid booking fee.',
      );
    }
    const category = job.serviceCategory;
    if (job.bookingPayment) {
      throw new ConflictException(
        'This completed job already has a booking payment.',
      );
    }
    const paidAt = this.parsePastDate(dto.paidAt);
    const secret = this.config.get<string>('jwt.tokenHashSecret');
    if (!secret) {
      throw new ServiceUnavailableException(
        'Administrator payment signing is not configured.',
      );
    }
    const id = randomUUID();
    const amount = job.serviceCategory.bookingFee;
    const signature = this.signPayment(
      secret,
      id,
      dto.externalPaymentId,
      job.customerId,
      category.id,
      amount,
      dto.phoneNumber,
      paidAt,
    );
    try {
      const payment = await this.prisma.$transaction(async (tx) => {
        const created = await tx.bookingPayment.create({
          data: {
            id,
            customerId: job.customerId,
            serviceCategoryId: category.id,
            jobId: job.id,
            externalPaymentId: dto.externalPaymentId,
            paymentKeyId: 'admin-reconciled',
            signature,
            phoneNumber: dto.phoneNumber,
            amount,
            paidAt,
            validUntil: new Date(
              paidAt.getTime() + BOOKING_VALIDITY_SECONDS * 1000,
            ),
            status: BookingPaymentStatus.COMPLETED,
          },
        });
        await this.audit.log(
          {
            entityType: 'BookingPayment',
            entityId: created.id,
            action: 'COMPLETED_JOB_PAYMENT_CREATED',
            actorId,
            toStatus: BookingPaymentStatus.COMPLETED,
            metadata: {
              jobId: job.id,
              externalPaymentId: dto.externalPaymentId,
              amount,
              phoneNumber: dto.phoneNumber,
              paidAt: paidAt.toISOString(),
            },
          },
          tx,
        );
        return created;
      });
      return this.toSafePayment(payment);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'A payment with this external payment ID or job already exists.',
        );
      }
      throw error;
    }
  }

  async updateCompletedPayment(
    id: string,
    dto: UpdateCompletedPaymentDto,
    actorId: string,
  ) {
    const payment = await this.prisma.bookingPayment.findFirst({
      where: {
        id,
        status: BookingPaymentStatus.COMPLETED,
        job: { is: { status: JobStatus.COMPLETED } },
      },
    });
    if (!payment) throw new NotFoundException('Completed payment not found.');
    const externalPaymentId =
      dto.externalPaymentId ?? payment.externalPaymentId;
    const phoneNumber = dto.phoneNumber ?? payment.phoneNumber;
    const paidAt = dto.paidAt ? this.parsePastDate(dto.paidAt) : payment.paidAt;
    const secret = this.config.get<string>('jwt.tokenHashSecret');
    if (!secret) {
      throw new ServiceUnavailableException(
        'Administrator payment signing is not configured.',
      );
    }
    const signature = this.signPayment(
      secret,
      payment.id,
      externalPaymentId,
      payment.customerId,
      payment.serviceCategoryId,
      payment.amount,
      phoneNumber,
      paidAt,
    );
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const saved = await tx.bookingPayment.update({
          where: { id },
          data: {
            externalPaymentId,
            phoneNumber,
            paidAt,
            validUntil: new Date(
              paidAt.getTime() + BOOKING_VALIDITY_SECONDS * 1000,
            ),
            signature,
          },
        });
        await this.audit.log(
          {
            entityType: 'BookingPayment',
            entityId: id,
            action: 'COMPLETED_JOB_PAYMENT_UPDATED',
            actorId,
            fromStatus: BookingPaymentStatus.COMPLETED,
            toStatus: BookingPaymentStatus.COMPLETED,
            metadata: {
              previous: {
                externalPaymentId: payment.externalPaymentId,
                phoneNumber: payment.phoneNumber,
                paidAt: payment.paidAt.toISOString(),
              },
              updated: {
                externalPaymentId,
                phoneNumber,
                paidAt: paidAt.toISOString(),
              },
            },
          },
          tx,
        );
        return saved;
      });
      return this.toSafePayment(updated);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'A payment with this external payment ID has already been recorded.',
        );
      }
      throw error;
    }
  }

  async deleteCompletedPayment(id: string, actorId: string) {
    const payment = await this.prisma.bookingPayment.findFirst({
      where: {
        id,
        status: BookingPaymentStatus.COMPLETED,
        job: { is: { status: JobStatus.COMPLETED } },
      },
      include: {
        job: { select: { id: true } },
      },
    });
    if (!payment) throw new NotFoundException('Completed payment not found.');
    await this.prisma.$transaction(async (tx) => {
      await this.audit.log(
        {
          entityType: 'BookingPayment',
          entityId: id,
          action: 'COMPLETED_JOB_PAYMENT_DELETED',
          actorId,
          fromStatus: BookingPaymentStatus.COMPLETED,
          metadata: {
            jobId: payment.job?.id ?? null,
            customerId: payment.customerId,
            serviceCategoryId: payment.serviceCategoryId,
            externalPaymentId: payment.externalPaymentId,
            phoneNumber: payment.phoneNumber,
            amount: payment.amount,
            paidAt: payment.paidAt.toISOString(),
          },
        },
        tx,
      );
      await tx.bookingPayment.delete({ where: { id } });
    });
    return { id, deleted: true };
  }

  private parsePastDate(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()) || date.getTime() > Date.now()) {
      throw new BadRequestException('paidAt must be a valid time in the past.');
    }
    return date;
  }

  private signPayment(
    secret: string,
    id: string,
    externalPaymentId: string,
    customerId: string,
    serviceCategoryId: string,
    amount: number,
    phoneNumber: string,
    paidAt: Date,
  ) {
    return createHmac('sha256', secret)
      .update(
        [
          id,
          externalPaymentId,
          customerId,
          serviceCategoryId,
          amount,
          phoneNumber,
          paidAt.toISOString(),
        ].join(':'),
      )
      .digest('hex');
  }

  private toSafePayment<T extends { signature: string; paymentKeyId: string }>(
    payment: T,
  ) {
    const { signature: _signature, paymentKeyId: _key, ...safe } = payment;
    return { ...safe, currency: 'RWF' };
  }

  async extend(id: string, dto: ExtendPaymentDto, actorId: string) {
    const paymentReference = await this.prisma.bookingPayment.findUnique({
      where: { id },
      select: { id: true, jobId: true },
    });
    if (!paymentReference) {
      throw new NotFoundException('Booking payment not found.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (paymentReference.jobId) {
        await tx.$queryRaw`
          SELECT "id" FROM "jobs"
          WHERE "id" = ${paymentReference.jobId}
          FOR UPDATE`;
      }
      const payment = await tx.bookingPayment.findUnique({
        where: { id },
        include: { job: { select: { cooperationStatus: true } } },
      });
      if (!payment) {
        throw new NotFoundException('Booking payment not found.');
      }
      if (
        payment.job?.cooperationStatus === JobCooperationStatus.CONFIRMED
      ) {
        throw new ConflictException(
          'A payment expires when both job participants confirm cooperation and can no longer be extended.',
        );
      }
      if (payment.status === BookingPaymentStatus.COMPLETED) {
        throw new ConflictException(
          'A completed booking payment can no longer be extended.',
        );
      }

      const now = new Date();
      const effectiveStatus =
        payment.status !== BookingPaymentStatus.PAUSED &&
        payment.validUntil <= now
          ? BookingPaymentStatus.EXPIRED
          : payment.status;
      const addedSeconds = dto.days * 24 * 60 * 60;
      let update: Prisma.BookingPaymentUpdateInput;
      if (effectiveStatus === BookingPaymentStatus.PAUSED) {
        update = {
          remainingValiditySeconds:
            (payment.remainingValiditySeconds ?? 0) + addedSeconds,
        };
      } else {
        const base = Math.max(now.getTime(), payment.validUntil.getTime());
        update = {
          validUntil: new Date(base + addedSeconds * 1000),
          status:
            effectiveStatus === BookingPaymentStatus.EXPIRED
              ? BookingPaymentStatus.RESUMED
              : effectiveStatus,
        };
      }
      const saved = await tx.bookingPayment.update({
        where: { id },
        data: { ...update, extensionCount: { increment: 1 } },
      });
      await this.audit.log(
        {
          entityType: 'BookingPayment',
          entityId: id,
          action: 'VALIDITY_EXTENDED',
          actorId,
          fromStatus: effectiveStatus,
          toStatus: saved.status,
          metadata: { days: dto.days, validUntil: saved.validUntil },
        },
        tx,
      );
      return saved;
    });
    const { signature: _signature, paymentKeyId: _key, ...safe } = updated;
    return safe;
  }

  private uniqueTechnicians<
    T extends { technicianId: string | null },
    U extends { technicianId: string | null },
  >(
    assignments: T[],
    offers: U[],
  ): Array<T | U> {
    const seen = new Set<string>();
    return [...assignments, ...offers].filter((entry) => {
      if (!entry.technicianId || seen.has(entry.technicianId)) return false;
      seen.add(entry.technicianId);
      return true;
    });
  }
}
