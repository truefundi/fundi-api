import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TechnicianBusinessType, VerificationStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { CreateAdminCompanyDto, UpdateCompanyDto, UpdateCompanyVerificationDto } from './dto/company.dto';
import { ListCompaniesDto } from './dto/list-companies.dto';

const COMPANY_INCLUDE = {
  technician: {
    select: {
      id: true,
      verificationStatus: true,
      user: {
        select: { id: true, fullName: true, email: true, phoneNumber: true },
      },
    },
  },
  verifiedBy: { select: { id: true, fullName: true, email: true } },
} satisfies Prisma.CompanyInclude;

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listForAdmin(query: ListCompaniesDto) {
    return this.prisma.company.findMany({
      where: query.verificationStatus
        ? { verificationStatus: query.verificationStatus }
        : undefined,
      include: COMPANY_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
  }

  async getForAdmin(id: string) {
    const company = await this.prisma.company.findUnique({
      where: { id },
      include: COMPANY_INCLUDE,
    });
    if (!company) throw new NotFoundException('Company not found.');
    return company;
  }

  async getMine(userId: string) {
    const company = await this.prisma.company.findFirst({
      where: { technician: { userId } },
      include: { technician: { select: { id: true, verificationStatus: true } } },
    });
    if (!company) throw new NotFoundException('You do not have a registered company.');
    return company;
  }

  async updateMine(userId: string, dto: UpdateCompanyDto) {
    this.assertUpdateHasFields(dto);
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.company.findFirst({
        where: { technician: { userId } },
      });
      if (!current) throw new NotFoundException('You do not have a registered company.');
      if (current.verificationStatus === VerificationStatus.APPROVED) {
        throw new ConflictException(
          'Company details cannot be changed after administrator approval.',
        );
      }
      const updated = await tx.company.update({
        where: { id: current.id },
        data: this.companyUpdateData(dto, {
          verificationStatus: VerificationStatus.PENDING,
          // Corrected details go back to review; the old reason no longer applies.
          rejectionReason: null,
          verifiedAt: null,
          verifiedBy: { disconnect: true },
        }),
        include: { technician: { select: { id: true, verificationStatus: true } } },
      });
      await this.audit.log(
        {
          entityType: 'Company',
          entityId: updated.id,
          action: 'OWNER_UPDATED',
          actorId: userId,
          fromStatus: current.verificationStatus,
          toStatus: updated.verificationStatus,
          metadata: this.changedFields(dto),
        },
        tx,
      );
      return updated;
    });
  }

  async createByAdmin(dto: CreateAdminCompanyDto, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const technician = await tx.technicianProfile.findUnique({
        where: { id: dto.technicianId },
        select: { id: true, businessType: true },
      });
      if (!technician) throw new NotFoundException('Technician profile not found.');
      const created = await tx.company.create({
        data: {
          technicianId: technician.id,
          name: dto.name.trim(),
          location: dto.location.trim(),
          email: dto.email.trim().toLowerCase(),
          phoneNumber: dto.phoneNumber,
          description: dto.description?.trim() || null,
          verificationStatus: VerificationStatus.PENDING,
        },
        include: COMPANY_INCLUDE,
      });
      await tx.technicianProfile.update({
        where: { id: technician.id },
        data: { businessType: TechnicianBusinessType.COMPANY },
      });
      await this.audit.log(
        {
          entityType: 'Company',
          entityId: created.id,
          action: 'ADMIN_CREATED',
          actorId,
          toStatus: created.verificationStatus,
          metadata: { technicianId: technician.id, name: created.name },
        },
        tx,
      );
      return created;
    }).catch((error: unknown) => this.handleWriteError(error));
  }

  async updateByAdmin(id: string, dto: UpdateCompanyDto, actorId: string) {
    this.assertUpdateHasFields(dto);
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.company.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('Company not found.');
      const updated = await tx.company.update({
        where: { id },
        data: this.companyUpdateData(dto),
        include: COMPANY_INCLUDE,
      });
      await this.audit.log(
        {
          entityType: 'Company',
          entityId: id,
          action: 'ADMIN_UPDATED',
          actorId,
          fromStatus: current.verificationStatus,
          toStatus: updated.verificationStatus,
          metadata: this.changedFields(dto),
        },
        tx,
      );
      return updated;
    }).catch((error: unknown) => this.handleWriteError(error));
  }

  async updateVerification(
    id: string,
    dto: UpdateCompanyVerificationDto,
    actorId: string,
  ) {
    const current = await this.getForAdmin(id);
    const approved = dto.verificationStatus === VerificationStatus.APPROVED;
    const updated = await this.prisma.$transaction(async (tx) => {
      const company = await tx.company.update({
        where: { id },
        data: {
          verificationStatus: dto.verificationStatus,
          // Only a rejection carries a reason; any other decision clears it.
          rejectionReason:
            dto.verificationStatus === VerificationStatus.REJECTED
              ? dto.reason ?? null
              : null,
          verifiedAt: approved ? new Date() : null,
          verifiedBy: approved
            ? { connect: { id: actorId } }
            : { disconnect: true },
        },
        include: COMPANY_INCLUDE,
      });
      await this.audit.log(
        {
          entityType: 'Company',
          entityId: id,
          action: 'VERIFICATION_STATUS_UPDATED',
          actorId,
          fromStatus: current.verificationStatus,
          toStatus: company.verificationStatus,
          ...(company.rejectionReason
            ? { metadata: { reason: company.rejectionReason } }
            : {}),
        },
        tx,
      );
      return company;
    });
    return updated;
  }

  async deleteByAdmin(id: string, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const company = await tx.company.findUnique({
        where: { id },
        select: { id: true, name: true, technicianId: true, verificationStatus: true },
      });
      if (!company) throw new NotFoundException('Company not found.');
      await this.audit.log(
        {
          entityType: 'Company',
          entityId: id,
          action: 'DELETED',
          actorId,
          fromStatus: company.verificationStatus,
          metadata: { technicianId: company.technicianId, name: company.name },
        },
        tx,
      );
      await tx.company.delete({ where: { id } });
      await tx.technicianProfile.update({
        where: { id: company.technicianId },
        data: { businessType: TechnicianBusinessType.INDIVIDUAL },
      });
      return { id, deleted: true };
    });
  }

  private assertUpdateHasFields(dto: UpdateCompanyDto) {
    if (
      dto.name === undefined &&
      dto.location === undefined &&
      dto.email === undefined &&
      dto.phoneNumber === undefined &&
      dto.description === undefined
    ) {
      throw new BadRequestException('Provide a company field to update.');
    }
  }

  private companyUpdateData(
    dto: UpdateCompanyDto,
    extra: Prisma.CompanyUpdateInput = {},
  ): Prisma.CompanyUpdateInput {
    return {
      ...extra,
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.location !== undefined ? { location: dto.location.trim() } : {}),
      ...(dto.email !== undefined
        ? { email: dto.email.trim().toLowerCase() }
        : {}),
      ...(dto.phoneNumber !== undefined ? { phoneNumber: dto.phoneNumber } : {}),
      ...(dto.description !== undefined
        ? { description: dto.description?.trim() || null }
        : {}),
    };
  }

  private changedFields(dto: UpdateCompanyDto) {
    return {
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.location !== undefined ? { location: dto.location.trim() } : {}),
      ...(dto.email !== undefined
        ? { email: dto.email.trim().toLowerCase() }
        : {}),
      ...(dto.phoneNumber !== undefined
        ? { phoneNumber: dto.phoneNumber }
        : {}),
      ...(dto.description !== undefined
        ? { description: dto.description?.trim() || null }
        : {}),
    };
  }

  private handleWriteError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException(
        'This technician already has a company registered.',
      );
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    ) {
      throw new NotFoundException('Company or technician profile not found.');
    }
    throw error;
  }
}
