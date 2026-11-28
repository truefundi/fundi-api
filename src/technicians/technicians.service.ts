import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  TechnicianAvailability,
  JobStatus,
  TechnicianBusinessType,
  UserRole,
  UserStatus,
  VerificationStatus,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PermissionsService } from '../staff/permissions.service';
import { isStaffRole } from '../staff/staff-roles';
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
} from '../common/dto/pagination.constants';
import { PrismaService } from '../database/prisma.service';
import { StorageService } from '../storage/storage.service';
import { TechnicianDocumentsService } from './documents/technician-documents.service';
import { AdminUpdateTechnicianDto } from './dto/admin-update-technician.dto';
import { CreateTechnicianDto } from './dto/create-technician.dto';
import { ListTechniciansQueryDto } from './dto/list-technicians-query.dto';
import { SearchAvailableTechniciansDto } from './dto/search-available-technicians.dto';
import { SearchTechniciansByUserDto } from './dto/search-technicians-by-user.dto';
import { SearchTechniciansDto } from './dto/search-technicians.dto';
import { ServiceExperienceDto } from './dto/service-experience.dto';
import { UpdateTechnicianProfileDto } from './dto/update-technician-profile.dto';
import { RegisterTechnicianProfileDto } from './dto/register-technician-profile.dto';
import { RegisterTechnicianDto } from './dto/register-technician.dto';
import { NationalIdCryptoService } from './national-id-crypto.service';
import { CompanyDetailsDto } from '../companies/dto/company.dto';

type Viewer = 'owner' | 'admin' | 'authenticated' | 'anonymous';

const PROFILE_INCLUDE = {
  user: {
    select: {
      id: true,
      fullName: true,
      phoneNumber: true,
      email: true,
      role: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  },
  categories: {
    include: { category: { select: { id: true, name: true, slug: true } } },
  },
} satisfies Prisma.TechnicianProfileInclude;

type ProfileWithDetails = Prisma.TechnicianProfileGetPayload<{
  include: typeof PROFILE_INCLUDE;
}>;

// Single, stable response shape — every viewer gets the same keys, only
// values are redacted for non-owner/non-admin viewers.
export interface TechnicianResponse {
  id: string;
  user: {
    id: string;
    fullName: string;
    role: string;
    phoneNumber: string | null;
    email: string | null;
    status: string | null;
    createdAt: Date | null;
    updatedAt: Date | null;
  };
  gender: string;
  businessType: string;
  yearsOfExperience: number;
  serviceExperiences: Array<{
    id: string;
    categoryId: string | null;
    category: { id: string; name: string; slug: string } | null;
    customName: string | null;
    yearsOfExperience: number;
    /** Owner and admin views only: where this service's review stands. */
    status?: VerificationStatus;
    reviewNote?: string | null;
    reviewedAt?: Date | null;
  }>;
  verificationStatus: string;
  /** Why the application was rejected; owner and admin views only. */
  rejectionReason?: string | null;
  availabilityStatus: string;
  /**
   * Owner and admin views only: an individual technician was taken offline
   * because they reached three active jobs; they come back online when one ends.
   */
  capacityAutoOffline?: boolean;
  location: {
    address: string;
    publicLocationLabel: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  profilePictureUrl: string | null;
  /** From customers' ratings and finished jobs; never estimated. */
  stats: TechnicianStats;
  paymentMethod: string | null;
  paymentNumber: string | null;
  nationalIdNumber?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TechnicianStats {
  /** Mean of every rating score (1-5), one decimal; null until the first rating. */
  averageRating: number | null;
  ratingCount: number;
  jobsCompleted: number;
}

const NO_STATS: TechnicianStats = {
  averageRating: null,
  ratingCount: 0,
  jobsCompleted: 0,
};

// Envelope shared by every technician list endpoint: one page of profiles
// plus pagination metadata — the same shape GET /users returns.
export interface PaginatedTechnicianList {
  data: TechnicianResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

@Injectable()
export class TechniciansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly documents: TechnicianDocumentsService,
    private readonly nationalIdCrypto: NationalIdCryptoService,
    private readonly permissions: PermissionsService,
  ) {}

  // ─── Technician self-service ────────────────────────────────────────────

  async registerMyProfile(userId: string, dto: RegisterTechnicianProfileDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { phoneVerifiedAt: true, role: true },
    });
    if (!user) throw new NotFoundException('User account not found.');
    // Applying needs a phone confirmed by SMS (signing in with a PIN does not
    // confirm it). Verify via POST /api/v1/jobs/phone-verification/request.
    if (!user.phoneVerifiedAt) {
      throw new ConflictException(
        'Verify your phone number with the SMS code before applying.',
      );
    }
    const businessType = this.registrationBusinessType(dto);
    const { company, ...profileInput } = dto;
    const profileDto = await this.resolveProfileCoordinates(profileInput);
    this.assertCoordinatePair(profileDto);
    this.assertServiceExperiences(profileDto.serviceExperiences);
    try {
      const profile = await this.runSerializable(async (tx) => {
        const existing = await tx.technicianProfile.findUnique({
          where: { userId },
          select: {
            id: true,
            verificationStatus: true,
            nationalIdEncrypted: true,
          },
        });
        if (existing) {
          // A rejected applicant starts over: the same full application as a
          // first-timer, sent back to review. Anyone else edits with PUT.
          if (existing.verificationStatus === VerificationStatus.REJECTED) {
            return this.resubmitRejectedApplication(
              tx,
              existing,
              profileDto,
              userId,
              businessType,
              company,
            );
          }
          throw new ConflictException(
            'A technician profile already exists. Use PUT to update it.',
          );
        }
        this.assertRequiredProfileFieldsForCreate(profileDto);
        // Applying keeps the account's role; once approved, the user switches
        // with PATCH /api/v1/users/me/role.
        const created = await tx.technicianProfile.create({
          data: {
            ...this.buildProfileCreateData(userId, profileDto),
            businessType,
          },
        });
        if (company) {
          await this.createRegisteredCompany(tx, created.id, company, userId);
        }
        await this.lockProfile(tx, created.id);
        await this.replaceServiceExperiences(
          tx,
          created.id,
          profileDto.serviceExperiences ?? [],
        );
        await this.writePostgisLocation(tx, created.id, profileDto);
        await this.audit.log(
          {
            entityType: 'TechnicianProfile',
            entityId: created.id,
            action: 'PROFILE_REGISTERED',
            actorId: userId,
            toStatus: VerificationStatus.PENDING,
          },
          tx,
        );
        return tx.technicianProfile.findUniqueOrThrow({
          where: { id: created.id },
          include: PROFILE_INCLUDE,
        });
      });
      return this.toResponse(profile, 'owner');
    } catch (error) {
      this.throwWriteError(error);
    }
  }

  /**
   * Turns a rejected application into a new one: every required field is
   * checked as on a first application (the ID number on file may be kept),
   * the details and trades are replaced, and it goes back to PENDING review.
   */
  private async resubmitRejectedApplication(
    tx: Prisma.TransactionClient,
    existing: { id: string; nationalIdEncrypted: string | null },
    dto: UpdateTechnicianProfileDto,
    userId: string,
    businessType: TechnicianBusinessType,
    company?: CompanyDetailsDto,
  ) {
    this.assertRequiredProfileFieldsForCreate(dto, {
      nationalIdOnFile: !!existing.nationalIdEncrypted,
    });
    if (dto.availabilityStatus === TechnicianAvailability.ONLINE) {
      throw new BadRequestException(
        'A new application must be submitted offline.',
      );
    }
    await this.lockProfile(tx, existing.id);
    // Under review again, so off duty, whatever availability was left behind.
    await this.saveProfileFields(
      tx,
      existing.id,
      { ...dto, availabilityStatus: TechnicianAvailability.OFFLINE },
      userId,
      'owner',
    );
    await tx.technicianProfile.update({
      where: { id: existing.id },
      data: {
        verificationStatus: VerificationStatus.PENDING,
        availabilityStatus: TechnicianAvailability.OFFLINE,
        rejectionReason: null,
        businessType,
      },
    });
    await this.syncResubmittedCompany(
      tx,
      existing.id,
      businessType,
      company,
      userId,
    );
    await this.audit.log(
      {
        entityType: 'TechnicianProfile',
        entityId: existing.id,
        action: 'APPLICATION_RESUBMITTED',
        actorId: userId,
        fromStatus: VerificationStatus.REJECTED,
        toStatus: VerificationStatus.PENDING,
        metadata: { keptNationalId: !dto.nationalIdNumber },
      },
      tx,
    );
    return tx.technicianProfile.findUniqueOrThrow({
      where: { id: existing.id },
      include: PROFILE_INCLUDE,
    });
  }

  async registerPublicTechnician(dto: RegisterTechnicianDto) {
    const businessType = this.registrationBusinessType(dto.profile);
    const { company, ...profileInput } = dto.profile;
    const profileDto = await this.resolveProfileCoordinates(profileInput);
    this.assertCoordinatePair(profileDto);
    this.assertServiceExperiences(profileDto.serviceExperiences);
    this.assertRequiredProfileFieldsForCreate(profileDto);
    if (profileDto.availabilityStatus === TechnicianAvailability.ONLINE) {
      throw new BadRequestException('New technicians must be created offline.');
    }
    try {
      const profile = await this.runSerializable(async (tx) => {
        const user = await tx.user.create({
          data: {
            fullName: dto.user.fullName.trim(),
            phoneNumber: dto.user.phoneNumber,
            email: dto.user.email?.trim().toLowerCase() || null,
            role: UserRole.TECHNICIAN,
            status: UserStatus.ACTIVE,
          },
        });
        const created = await tx.technicianProfile.create({
          data: {
            ...this.buildProfileCreateData(user.id, profileDto),
            businessType,
          },
        });
        if (company) {
          await this.createRegisteredCompany(tx, created.id, company, user.id);
        }
        await this.lockProfile(tx, created.id);
        await this.replaceServiceExperiences(
          tx,
          created.id,
          profileDto.serviceExperiences ?? [],
        );
        await this.writePostgisLocation(tx, created.id, profileDto);
        await this.audit.log(
          {
            entityType: 'TechnicianProfile',
            entityId: created.id,
            action: 'PUBLIC_TECHNICIAN_REGISTRATION_STARTED',
            actorId: user.id,
            toStatus: VerificationStatus.PENDING,
          },
          tx,
        );
        return tx.technicianProfile.findUniqueOrThrow({
          where: { id: created.id },
          include: PROFILE_INCLUDE,
        });
      });
      return this.toResponse(profile, 'owner');
    } catch (error) {
      this.throwWriteError(error);
    }
  }

  private registrationBusinessType(dto: RegisterTechnicianProfileDto) {
    const businessType =
      dto.businessType ??
      (dto.company
        ? TechnicianBusinessType.COMPANY
        : TechnicianBusinessType.INDIVIDUAL);
    if (businessType === TechnicianBusinessType.COMPANY && !dto.company) {
      throw new BadRequestException(
        'Company details are required when registering as a company owner.',
      );
    }
    if (businessType === TechnicianBusinessType.INDIVIDUAL && dto.company) {
      throw new BadRequestException(
        'Company details can only be supplied when businessType is COMPANY.',
      );
    }
    return businessType;
  }

  /**
   * A rejected applicant re-applying may change how they work. A company in
   * the new application is created, or its details replaced and sent back for
   * review; applying as an individual removes a company that was never approved.
   */
  private async syncResubmittedCompany(
    tx: Prisma.TransactionClient,
    technicianId: string,
    businessType: TechnicianBusinessType,
    details: CompanyDetailsDto | undefined,
    actorId: string,
  ) {
    const current = await tx.company.findUnique({ where: { technicianId } });
    if (businessType === TechnicianBusinessType.COMPANY && details) {
      if (!current) {
        await this.createRegisteredCompany(tx, technicianId, details, actorId);
        return;
      }
      const updated = await tx.company.update({
        where: { id: current.id },
        data: {
          name: details.name.trim(),
          location: details.location.trim(),
          email: details.email.trim().toLowerCase(),
          phoneNumber: details.phoneNumber,
          description: details.description?.trim() || null,
          verificationStatus: VerificationStatus.PENDING,
          rejectionReason: null,
          verifiedAt: null,
          verifiedById: null,
        },
      });
      await this.audit.log(
        {
          entityType: 'Company',
          entityId: updated.id,
          action: 'RESUBMITTED',
          actorId,
          fromStatus: current.verificationStatus,
          toStatus: VerificationStatus.PENDING,
          metadata: { technicianId, name: updated.name },
        },
        tx,
      );
      return;
    }
    if (
      businessType === TechnicianBusinessType.INDIVIDUAL &&
      current &&
      current.verificationStatus !== VerificationStatus.APPROVED
    ) {
      await tx.company.delete({ where: { id: current.id } });
      await this.audit.log(
        {
          entityType: 'Company',
          entityId: current.id,
          action: 'REMOVED',
          actorId,
          fromStatus: current.verificationStatus,
          metadata: { technicianId, reason: 'Re-applied as an individual.' },
        },
        tx,
      );
    }
  }

  private async createRegisteredCompany(
    tx: Prisma.TransactionClient,
    technicianId: string,
    details: CompanyDetailsDto,
    actorId: string,
  ) {
    const company = await tx.company.create({
      data: {
        technicianId,
        name: details.name.trim(),
        location: details.location.trim(),
        email: details.email.trim().toLowerCase(),
        phoneNumber: details.phoneNumber,
        description: details.description?.trim() || null,
        verificationStatus: VerificationStatus.PENDING,
      },
    });
    await this.audit.log(
      {
        entityType: 'Company',
        entityId: company.id,
        action: 'REGISTERED',
        actorId,
        toStatus: VerificationStatus.PENDING,
        metadata: { technicianId, name: company.name },
      },
      tx,
    );
    return company;
  }

  async getMyProfile(userId: string): Promise<TechnicianResponse> {
    const profile = await this.prisma.technicianProfile.findUnique({
      where: { userId },
      include: PROFILE_INCLUDE,
    });
    if (!profile) {
      throw new NotFoundException(
        'Technician profile not found. Register one first via POST /api/v1/technicians/profile.',
      );
    }
    return this.toResponse(profile, 'owner');
  }

  async updateMyProfile(userId: string, dto: UpdateTechnicianProfileDto) {
    this.assertUpdateHasFields(dto);
    const profileDto = await this.resolveProfileCoordinates(dto);
    this.assertCoordinatePair(profileDto);
    this.assertServiceExperiences(profileDto.serviceExperiences);
    try {
      const profile = await this.runSerializable(async (tx) => {
        const saved = await tx.technicianProfile.findUnique({
          where: { userId },
          select: { id: true, businessType: true },
        });
        if (!saved) {
          throw new NotFoundException(
            'Technician profile not found. Register one first via POST /api/v1/technicians/profile.',
          );
        }
        await this.lockProfile(tx, saved.id);
        await this.saveProfileFields(tx, saved.id, profileDto, userId, 'owner');
        return tx.technicianProfile.findUniqueOrThrow({
          where: { id: saved.id },
          include: PROFILE_INCLUDE,
        });
      });
      return this.toResponse(profile, 'owner');
    } catch (error) {
      this.throwWriteError(error);
    }
  }

  async updateMyAvailability(
    userId: string,
    availabilityStatus: TechnicianAvailability,
  ) {
    return this.updateMyProfile(userId, { availabilityStatus });
  }

  // ─── Discovery (authenticated + anonymous) ─────────────────────────────

  async listAvailable(
    dto: SearchAvailableTechniciansDto,
    viewer: Viewer,
  ): Promise<PaginatedTechnicianList> {
    const where: Prisma.TechnicianProfileWhereInput = {
      verificationStatus: VerificationStatus.APPROVED,
      availabilityStatus: TechnicianAvailability.ONLINE,
      user: { is: { status: UserStatus.ACTIVE, role: UserRole.TECHNICIAN } },
      ...this.combineFilters(this.buildDiscoveryFilters(dto)),
    };
    return this.findPage(
      where,
      dto,
      [{ updatedAt: 'desc' }, { id: 'asc' }],
      viewer,
    );
  }

  async listApproved(
    dto: SearchAvailableTechniciansDto,
    viewer: Viewer,
  ): Promise<PaginatedTechnicianList> {
    const where: Prisma.TechnicianProfileWhereInput = {
      verificationStatus: VerificationStatus.APPROVED,
      user: { is: { status: UserStatus.ACTIVE, role: UserRole.TECHNICIAN } },
      ...this.combineFilters(this.buildDiscoveryFilters(dto)),
    };
    return this.findPage(
      where,
      dto,
      [{ updatedAt: 'desc' }, { id: 'asc' }],
      viewer,
    );
  }

  async getAvailableById(
    profileId: string,
    viewer: Viewer,
  ): Promise<TechnicianResponse> {
    const profile = await this.prisma.technicianProfile.findFirst({
      where: {
        id: profileId,
        verificationStatus: VerificationStatus.APPROVED,
        availabilityStatus: TechnicianAvailability.ONLINE,
        user: { is: { status: UserStatus.ACTIVE, role: UserRole.TECHNICIAN } },
      },
      include: PROFILE_INCLUDE,
    });
    if (!profile) {
      throw new NotFoundException('Available technician not found.');
    }
    return this.toResponse(profile, viewer);
  }

  async getApprovedById(
    profileId: string,
    viewer: Viewer,
  ): Promise<TechnicianResponse> {
    const profile = await this.prisma.technicianProfile.findFirst({
      where: {
        id: profileId,
        verificationStatus: VerificationStatus.APPROVED,
        user: { is: { status: UserStatus.ACTIVE, role: UserRole.TECHNICIAN } },
      },
      include: PROFILE_INCLUDE,
    });
    if (!profile) {
      throw new NotFoundException('Approved technician not found.');
    }
    return this.toResponse(profile, viewer);
  }

  async listPublic(
    dto: SearchAvailableTechniciansDto,
  ): Promise<PaginatedTechnicianList> {
    return this.listAvailable(dto, 'anonymous');
  }

  async getPublicById(profileId: string): Promise<TechnicianResponse> {
    return this.getAvailableById(profileId, 'anonymous');
  }

  // ─── Admin ─────────────────────────────────────────────────────────────

  async createByAdmin(dto: CreateTechnicianDto, actorId: string) {
    if (!dto.user?.fullName?.trim() || !dto.user.phoneNumber) {
      throw new BadRequestException(
        'Technician fullName and phoneNumber are required.',
      );
    }
    const profileDto = await this.resolveProfileCoordinates(dto.profile ?? {});
    this.assertCoordinatePair(profileDto);
    this.assertServiceExperiences(profileDto.serviceExperiences);
    this.assertRequiredProfileFieldsForCreate(profileDto);
    if (profileDto.availabilityStatus === TechnicianAvailability.ONLINE) {
      throw new BadRequestException('New technicians must be created offline.');
    }
    try {
      const profile = await this.runSerializable(async (tx) => {
        const user = await tx.user.create({
          data: {
            fullName: dto.user.fullName.trim(),
            phoneNumber: dto.user.phoneNumber,
            email: dto.user.email?.trim().toLowerCase() || null,
            role: UserRole.TECHNICIAN,
            status: UserStatus.ACTIVE,
          },
        });
        const created = await tx.technicianProfile.create({
          data: this.buildProfileCreateData(user.id, profileDto),
        });
        await this.lockProfile(tx, created.id);
        await this.replaceServiceExperiences(
          tx,
          created.id,
          profileDto.serviceExperiences ?? [],
        );
        await this.writePostgisLocation(tx, created.id, profileDto);
        await this.audit.log(
          {
            entityType: 'TechnicianProfile',
            entityId: created.id,
            action: 'CREATED',
            actorId,
            toStatus: VerificationStatus.PENDING,
          },
          tx,
        );
        return tx.technicianProfile.findUniqueOrThrow({
          where: { id: created.id },
          include: PROFILE_INCLUDE,
        });
      });
      return this.toResponse(profile, 'admin');
    } catch (error) {
      this.throwWriteError(error);
    }
  }

  async listAllByAdmin(
    query: ListTechniciansQueryDto = {},
  ): Promise<PaginatedTechnicianList> {
    const where = this.combineFilters(this.buildAdminFilters(query));
    return this.findPage(
      where,
      query,
      [{ createdAt: 'desc' }, { id: 'asc' }],
      'admin',
    );
  }

  async getByIdForAdmin(profileId: string): Promise<TechnicianResponse> {
    const profile = await this.prisma.technicianProfile.findUnique({
      where: { id: profileId },
      include: PROFILE_INCLUDE,
    });
    if (!profile) throw new NotFoundException('Technician not found.');
    return this.toResponse(profile, 'admin');
  }

  async searchByAdmin(
    query: SearchTechniciansDto,
  ): Promise<PaginatedTechnicianList> {
    const filters = this.buildAdminFilters(query);
    if (query.query) {
      const term = query.query.trim();
      filters.push({ OR: this.buildBroadSearchClauses(term, 'admin') });
    }
    return this.findPage(
      this.combineFilters(filters),
      query,
      [{ createdAt: 'desc' }, { id: 'asc' }],
      'admin',
    );
  }

  async searchByUserDetails(
    query: SearchTechniciansByUserDto,
  ): Promise<TechnicianResponse[]> {
    if (
      !query.userId &&
      !query.phoneNumber &&
      !query.email &&
      !query.fullName
    ) {
      throw new BadRequestException(
        'Provide at least one of userId, phoneNumber, email, or fullName.',
      );
    }
    const userWhere: Prisma.UserWhereInput = {};
    if (query.userId) userWhere.id = query.userId;
    if (query.phoneNumber) userWhere.phoneNumber = query.phoneNumber;
    if (query.email) userWhere.email = query.email.trim().toLowerCase();
    if (query.fullName) {
      userWhere.fullName = { contains: query.fullName, mode: 'insensitive' };
    }

    const profiles = await this.prisma.technicianProfile.findMany({
      where: { user: { is: userWhere } },
      include: PROFILE_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(profiles.map((p) => this.toResponse(p, 'admin')));
  }

  async updateByAdmin(
    profileId: string,
    dto: AdminUpdateTechnicianDto & { rejectionReason?: string },
    actorId: string,
  ) {
    this.assertUpdateHasFields(dto);
    this.assertCoordinatePair(dto);
    this.assertServiceExperiences(dto.serviceExperiences);
    try {
      const profile = await this.runSerializable(async (tx) => {
        const found = await tx.technicianProfile.findUnique({
          where: { id: profileId },
        });
        if (!found) throw new NotFoundException('Technician not found.');
        await this.assertNonStaffAccount(tx, found.userId);
        if (dto.verificationStatus !== undefined)
          await this.permissions.require(actorId, ['technicians.approve'], tx);
        await this.lockProfile(tx, profileId);
        await this.saveProfileFields(tx, profileId, dto, actorId, 'admin');
        return tx.technicianProfile.findUniqueOrThrow({
          where: { id: profileId },
          include: PROFILE_INCLUDE,
        });
      });
      return this.toResponse(profile, 'admin');
    } catch (error) {
      this.throwWriteError(error);
    }
  }

  async setVerificationStatus(
    profileId: string,
    verificationStatus: VerificationStatus,
    actorId: string,
    reason?: string,
  ) {
    if (verificationStatus === VerificationStatus.REJECTED && !reason?.trim()) {
      throw new BadRequestException(
        'Give a reason when rejecting an application.',
      );
    }
    return this.updateByAdmin(
      profileId,
      { verificationStatus, rejectionReason: reason },
      actorId,
    );
  }

  async setAvailabilityByAdmin(
    profileId: string,
    availabilityStatus: TechnicianAvailability,
    actorId: string,
  ) {
    return this.updateByAdmin(profileId, { availabilityStatus }, actorId);
  }

  // Changes the account status behind a technician profile. Anything other
  // than ACTIVE blocks logins and existing sessions (JWT strategy) and forces
  // the technician offline so suspended or inactive accounts cannot be found
  // for jobs. Restoring ACTIVE re-enables access; going online still requires
  // an APPROVED verification state.
  async setAccountStatusByAdmin(
    profileId: string,
    status: UserStatus,
    actorId: string,
  ) {
    return this.runSerializable(async (tx) => {
      const current = await tx.technicianProfile.findUnique({
        where: { id: profileId },
        include: PROFILE_INCLUDE,
      });
      if (!current) throw new NotFoundException('Technician not found.');
      await this.assertNonStaffAccount(tx, current.userId);
      await this.lockProfile(tx, profileId);

      if (current.user.status === status) {
        return this.toResponse(current, 'admin');
      }

      await tx.user.update({
        where: { id: current.userId },
        data: { status },
      });

      const nextAvailability =
        status === UserStatus.ACTIVE
          ? current.availabilityStatus
          : TechnicianAvailability.OFFLINE;
      const profile = await tx.technicianProfile.update({
        where: { id: current.id },
        data: { availabilityStatus: nextAvailability },
        include: PROFILE_INCLUDE,
      });

      await this.audit.log(
        {
          entityType: 'TechnicianProfile',
          entityId: current.id,
          action: 'ACCOUNT_STATUS_UPDATED',
          fromStatus: current.user.status,
          toStatus: status,
          actorId,
        },
        tx,
      );

      return this.toResponse(profile, 'admin');
    });
  }

  async deleteByAdmin(profileId: string, actorId: string) {
    return this.runSerializable(async (tx) => {
      const profile = await tx.technicianProfile.findUnique({
        where: { id: profileId },
      });
      if (!profile) throw new NotFoundException('Technician not found.');
      await this.assertNonStaffAccount(tx, profile.userId);
      await this.lockProfile(tx, profileId);
      await this.audit.log(
        {
          entityType: 'TechnicianProfile',
          entityId: profileId,
          action: 'DELETED',
          actorId,
          fromStatus: profile.verificationStatus,
        },
        tx,
      );
      await tx.user.delete({ where: { id: profile.userId } });
      return { message: 'Technician deleted successfully.' };
    });
  }

  // ─── Private helpers ───────────────────────────────────────────────────

  private async assertNonStaffAccount(
    tx: Prisma.TransactionClient,
    userId: string,
  ) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(734321)::text`;
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (user && isStaffRole(user.role))
      throw new ForbiddenException(
        'Manage staff accounts through staff account management.',
      );
  }

  // Counts and fetches one page with the same where clause, so pagination
  // metadata stays accurate. Mirrors the users list implementation.
  private async findPage(
    where: Prisma.TechnicianProfileWhereInput,
    query: { page?: number; limit?: number },
    orderBy: Prisma.TechnicianProfileOrderByWithRelationInput[],
    viewer: Viewer,
  ): Promise<PaginatedTechnicianList> {
    const { page, limit } = this.resolvePaging(query);
    const [total, profiles] = await Promise.all([
      this.prisma.technicianProfile.count({ where }),
      this.prisma.technicianProfile.findMany({
        where,
        include: PROFILE_INCLUDE,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    const stats = await this.loadStats(profiles.map((p) => p.id));
    const data = await Promise.all(
      profiles.map((p) => this.toResponse(p, viewer, stats.get(p.id))),
    );
    return {
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  // Validates paging input so invalid values fail with a 400 before any query runs.
  private resolvePaging(query: { page?: number; limit?: number }): {
    page: number;
    limit: number;
  } {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    if (!Number.isInteger(page) || page < DEFAULT_PAGE) {
      throw new BadRequestException(
        'The page query parameter must be an integer of 1 or more.',
      );
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
      throw new BadRequestException(
        `The limit query parameter must be an integer between 1 and ${MAX_PAGE_LIMIT}.`,
      );
    }
    return { page, limit };
  }

  // Rejects blank text filters so invalid values fail with a 400 before any query runs.
  private assertTextFiltersAreValid(query: {
    search?: string;
    query?: string;
    location?: string;
    category?: string;
  }): void {
    for (const key of ['search', 'query', 'location', 'category'] as const) {
      const value = query[key];
      if (value !== undefined && (typeof value !== 'string' || !value.trim())) {
        throw new BadRequestException(
          `The ${key} query parameter must not be empty.`,
        );
      }
    }
  }

  // AND-combines filters; no filters means no extra clause.
  private combineFilters(
    filters: Prisma.TechnicianProfileWhereInput[],
  ): Prisma.TechnicianProfileWhereInput {
    return filters.length ? { AND: filters } : {};
  }

  // Applies the optional discovery filters: category (ID or name/slug),
  // free text, area, and minimum years of experience.
  private buildDiscoveryFilters(
    dto: SearchAvailableTechniciansDto,
  ): Prisma.TechnicianProfileWhereInput[] {
    this.assertTextFiltersAreValid(dto);
    const filters: Prisma.TechnicianProfileWhereInput[] = [];
    if (dto.categoryId) {
      filters.push({
        categories: {
          some: {
            categoryId: dto.categoryId,
            status: VerificationStatus.APPROVED,
          },
        },
      });
    }
    const category = dto.category?.trim();
    if (category) {
      filters.push({
        categories: {
          some: { category: this.buildCategoryNameClause(category) },
        },
      });
    }
    if (dto.minYearsOfExperience !== undefined) {
      filters.push({
        categories: {
          some: { yearsOfExperience: { gte: dto.minYearsOfExperience } },
        },
      });
    }
    const text = dto.query?.trim();
    if (text) {
      filters.push({ OR: this.buildBroadSearchClauses(text, 'discovery') });
    }
    const location = dto.location?.trim();
    if (location) {
      filters.push({ OR: this.buildLocationClauses(location) });
    }
    return filters;
  }

  // Applies the shared list filters behind both admin list endpoints.
  private buildAdminFilters(
    query: ListTechniciansQueryDto,
  ): Prisma.TechnicianProfileWhereInput[] {
    this.assertTextFiltersAreValid(query);
    const filters: Prisma.TechnicianProfileWhereInput[] = [];
    const search = query.search?.trim();
    if (search) {
      filters.push({ OR: this.buildIdentityClauses(search) });
    }
    const location = query.location?.trim();
    if (location) {
      filters.push({ OR: this.buildLocationClauses(location) });
    }
    if (query.status !== undefined) {
      filters.push({ user: { is: { status: query.status } } });
    }
    if (query.verificationStatus !== undefined) {
      filters.push({ verificationStatus: query.verificationStatus });
    }
    if (query.availabilityStatus !== undefined) {
      filters.push({ availabilityStatus: query.availabilityStatus });
    }
    if (query.categoryId) {
      filters.push({
        categories: {
          some: {
            categoryId: query.categoryId,
            status: VerificationStatus.APPROVED,
          },
        },
      });
    }
    const category = query.category?.trim();
    if (category) {
      filters.push({
        categories: {
          some: { category: this.buildCategoryNameClause(category) },
        },
      });
    }
    if (query.minYearsOfExperience !== undefined) {
      filters.push({
        categories: {
          some: { yearsOfExperience: { gte: query.minYearsOfExperience } },
        },
      });
    }
    return filters;
  }

  // Substring clauses for the `search` parameter (identity fields only).
  private buildIdentityClauses(
    term: string,
  ): Prisma.TechnicianProfileWhereInput[] {
    return [
      { user: { is: { fullName: { contains: term, mode: 'insensitive' } } } },
      { user: { is: { phoneNumber: { contains: term } } } },
      { user: { is: { email: { contains: term, mode: 'insensitive' } } } },
    ];
  }

  // Substring clauses for the `location` parameter (area text only).
  private buildLocationClauses(
    term: string,
  ): Prisma.TechnicianProfileWhereInput[] {
    return [
      { baseAddress: { contains: term, mode: 'insensitive' } },
      { publicLocationLabel: { contains: term, mode: 'insensitive' } },
    ];
  }

  // Case-insensitive match of a catalogue category by name or slug, so the
  // frontend can send "Plumbing" while matching logic can send "plumbing".
  private buildCategoryNameClause(
    name: string,
  ): Prisma.ServiceCategoryWhereInput {
    return {
      OR: [
        { name: { equals: name, mode: 'insensitive' } },
        { slug: { equals: name, mode: 'insensitive' } },
      ],
    };
  }

  // Broad free-text clauses for the `query` parameter. The admin sweep also
  // matches contact details and exact numeric coordinates; discovery matches
  // only name, area, and service names.
  private buildBroadSearchClauses(
    term: string,
    scope: 'admin' | 'discovery',
  ): Prisma.TechnicianProfileWhereInput[] {
    const matches: Prisma.TechnicianProfileWhereInput[] = [
      { user: { is: { fullName: { contains: term, mode: 'insensitive' } } } },
    ];
    if (scope === 'admin') {
      matches.push(
        { user: { is: { phoneNumber: { contains: term } } } },
        { user: { is: { email: { contains: term, mode: 'insensitive' } } } },
      );
    }
    matches.push(
      ...this.buildLocationClauses(term),
      {
        categories: {
          some: {
            category: { name: { contains: term, mode: 'insensitive' } },
          },
        },
      },
      {
        categories: {
          some: { customName: { contains: term, mode: 'insensitive' } },
        },
      },
    );
    if (scope === 'admin') {
      const numeric = Number(term);
      if (Number.isFinite(numeric)) {
        matches.push({ baseLatitude: numeric }, { baseLongitude: numeric });
      }
    }
    return matches;
  }

  private async saveProfileFields(
    tx: Prisma.TransactionClient,
    profileId: string,
    dto: UpdateTechnicianProfileDto & {
      verificationStatus?: VerificationStatus;
      rejectionReason?: string;
    },
    actorId: string,
    viewer: Viewer,
  ) {
    const current = await tx.technicianProfile.findUniqueOrThrow({
      where: { id: profileId },
      include: PROFILE_INCLUDE,
    });
    const clearCoordinates =
      (dto.baseLatitude === null && dto.baseLongitude === null) ||
      ((dto.baseAddress !== undefined ||
        dto.publicLocationLabel !== undefined) &&
        dto.baseLatitude === undefined);

    const requestedVerification: VerificationStatus =
      viewer === 'admin'
        ? (dto.verificationStatus ?? current.verificationStatus)
        : current.verificationStatus;

    if (
      viewer === 'admin' &&
      requestedVerification === VerificationStatus.APPROVED &&
      current.verificationStatus !== VerificationStatus.APPROVED
    ) {
      await this.documents.assertReadyForApproval(tx, current.id);
    }

    let nextAvailability = dto.availabilityStatus ?? current.availabilityStatus;
    if (
      nextAvailability === TechnicianAvailability.ONLINE &&
      (requestedVerification !== VerificationStatus.APPROVED ||
        current.user.status !== UserStatus.ACTIVE)
    ) {
      throw new ConflictException(
        'Only active, approved technicians can be online.',
      );
    }
    if (
      nextAvailability === TechnicianAvailability.ONLINE &&
      current.businessType === TechnicianBusinessType.INDIVIDUAL
    ) {
      const activeJobs = await tx.job.count({
        where: {
          technicianId: current.id,
          status: { in: [JobStatus.ASSIGNED, JobStatus.PAUSED] },
        },
      });
      if (activeJobs >= 3) {
        throw new ConflictException(
          'A technician with three active jobs cannot go online.',
        );
      }
    }
    if (requestedVerification !== VerificationStatus.APPROVED) {
      nextAvailability = TechnicianAvailability.OFFLINE;
    }

    const userData: Prisma.UserUpdateInput = {};
    if (dto.fullName !== undefined) userData.fullName = dto.fullName.trim();
    if (dto.phoneNumber !== undefined) userData.phoneNumber = dto.phoneNumber;
    if (dto.email !== undefined) {
      userData.email = dto.email?.trim().toLowerCase() || null;
    }
    if (Object.keys(userData).length) {
      await tx.user.update({ where: { id: current.userId }, data: userData });
    }

    await tx.technicianProfile.update({
      where: { id: current.id },
      data: {
        ...(dto.gender !== undefined && { gender: dto.gender }),
        ...(dto.nationalIdNumber !== undefined && {
          nationalIdEncrypted: this.nationalIdCrypto.encrypt(
            dto.nationalIdNumber,
          ),
          nationalIdHash: this.nationalIdCrypto.hash(dto.nationalIdNumber),
          nationalIdLast4: this.nationalIdCrypto.lastFour(dto.nationalIdNumber),
        }),
        ...(dto.baseAddress !== undefined && {
          baseAddress: dto.baseAddress.trim(),
        }),
        ...(dto.publicLocationLabel !== undefined && {
          publicLocationLabel: dto.publicLocationLabel?.trim() || null,
        }),
        ...(dto.baseLatitude !== undefined && {
          baseLatitude: dto.baseLatitude,
        }),
        ...(dto.baseLongitude !== undefined && {
          baseLongitude: dto.baseLongitude,
        }),
        ...(clearCoordinates && {
          baseLatitude: null,
          baseLongitude: null,
        }),
        ...(dto.paymentMethod !== undefined && {
          paymentMethod: dto.paymentMethod,
        }),
        ...(dto.paymentNumber !== undefined && {
          paymentNumber: dto.paymentNumber,
        }),
        ...(requestedVerification !== current.verificationStatus && {
          verificationStatus: requestedVerification,
        }),
        // A rejection carries the admin's reason; any other decision clears it.
        ...(viewer === 'admin' &&
          (dto.verificationStatus !== undefined ||
            dto.rejectionReason !== undefined) && {
            rejectionReason:
              requestedVerification === VerificationStatus.REJECTED
                ? dto.rejectionReason?.trim() || current.rejectionReason || null
                : null,
          }),
        availabilityStatus: nextAvailability,
        ...(dto.availabilityStatus !== undefined && {
          capacityAutoOffline: false,
        }),
      },
    });

    if (dto.serviceExperiences !== undefined) {
      // Once approved, services are added and reviewed one at a time
      // (POST /technicians/profile/services), so approved ones are never reset.
      if (
        viewer === 'owner' &&
        current.verificationStatus === VerificationStatus.APPROVED
      ) {
        throw new BadRequestException(
          'Your services are reviewed one at a time now: add or change them from your services list.',
        );
      }
      await this.replaceServiceExperiences(
        tx,
        current.id,
        dto.serviceExperiences,
        viewer === 'admin' &&
          requestedVerification === VerificationStatus.APPROVED
          ? { status: VerificationStatus.APPROVED, reviewedById: actorId }
          : undefined,
      );
    }
    if (
      viewer === 'admin' &&
      requestedVerification === VerificationStatus.APPROVED &&
      current.verificationStatus !== VerificationStatus.APPROVED
    ) {
      await tx.technicianCategory.updateMany({
        where: { technicianId: current.id, status: VerificationStatus.PENDING },
        data: {
          status: VerificationStatus.APPROVED,
          reviewNote: null,
          reviewedById: actorId,
          reviewedAt: new Date(),
        },
      });
    }
    await this.writePostgisLocation(tx, current.id, dto, clearCoordinates);
    await this.audit.log(
      {
        entityType: 'TechnicianProfile',
        entityId: current.id,
        action:
          Object.keys(dto).length === 1 && dto.availabilityStatus
            ? 'AVAILABILITY_UPDATED'
            : 'UPDATED',
        fromStatus: current.verificationStatus,
        toStatus: requestedVerification,
        actorId,
        metadata: {
          changedFields: Object.keys(dto),
          ...(dto.rejectionReason ? { reason: dto.rejectionReason } : {}),
        },
      },
      tx,
    );
  }

  /**
   * A service typed by name that is in the catalog is saved as that catalog
   * service, so jobs for it (matched by category id) reach the technician.
   */
  async linkCatalogNames(
    tx: Prisma.TransactionClient,
    items: ServiceExperienceDto[],
  ): Promise<ServiceExperienceDto[]> {
    const names = [
      ...new Set(
        items
          .filter((item) => !item.categoryId && item.customName?.trim())
          .map((item) => item.customName!.trim().toLowerCase()),
      ),
    ];
    if (!names.length) return items;
    const rows = await tx.$queryRaw<Array<{ id: string; key: string }>>`
      SELECT "id", LOWER(BTRIM("name")) AS "key" FROM "service_categories"
      WHERE "isActive" = TRUE AND LOWER(BTRIM("name")) IN (${Prisma.join(names)})`;
    const byName = new Map(rows.map((row) => [row.key, row.id]));
    return items.map((item) => {
      const id =
        !item.categoryId && item.customName
          ? byName.get(item.customName.trim().toLowerCase())
          : undefined;
      return id
        ? { categoryId: id, yearsOfExperience: item.yearsOfExperience }
        : item;
    });
  }

  private async replaceServiceExperiences(
    tx: Prisma.TransactionClient,
    profileId: string,
    requested: ServiceExperienceDto[],
    /** Admin edits of an approved profile save the services as approved. */
    review?: { status: VerificationStatus; reviewedById: string },
  ) {
    if (requested.length > 10) {
      throw new BadRequestException(
        'A technician can list at most 10 services.',
      );
    }

    await tx.technicianCategory.deleteMany({
      where: { technicianId: profileId },
    });
    if (!requested.length) return;

    const items = await this.linkCatalogNames(tx, requested);
    // Distinct ids: a repeated service is reported as a duplicate below.
    const realCategoryIds = [
      ...new Set(
        items.map((i) => i.categoryId).filter((id): id is string => !!id),
      ),
    ];

    if (realCategoryIds.length) {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "service_categories"
        WHERE "id" IN (${Prisma.join(realCategoryIds)}) AND "isActive" = TRUE
        FOR SHARE`;
      if (rows.length !== realCategoryIds.length) {
        throw new BadRequestException(
          'One or more categories are invalid or inactive.',
        );
      }
    }

    const seen = new Set<string>();
    const data = items.map((item) => {
      if (item.categoryId) {
        const key = `cat:${item.categoryId}`;
        if (seen.has(key)) {
          throw new BadRequestException(
            `Duplicate service category: ${item.categoryId}.`,
          );
        }
        seen.add(key);
        return {
          technicianId: profileId,
          categoryId: item.categoryId,
          customName: null,
          customNameNormalized: '',
          yearsOfExperience: item.yearsOfExperience,
        };
      }
      const trimmed = item.customName!.trim();
      const normalized = trimmed.toLowerCase();
      const key = `custom:${normalized}`;
      if (seen.has(key)) {
        throw new BadRequestException(`Duplicate custom service: ${trimmed}.`);
      }
      seen.add(key);
      return {
        technicianId: profileId,
        categoryId: null,
        customName: trimmed,
        customNameNormalized: normalized,
        yearsOfExperience: item.yearsOfExperience,
      };
    });

    await tx.technicianCategory.createMany({
      data: review
        ? data.map((row) => ({
            ...row,
            status: review.status,
            reviewedById: review.reviewedById,
            reviewedAt: new Date(),
          }))
        : data,
    });
  }

  private buildProfileCreateData(
    userId: string,
    dto: UpdateTechnicianProfileDto,
  ): Prisma.TechnicianProfileCreateInput {
    this.assertRequiredProfileFieldsForCreate(dto);
    return {
      user: { connect: { id: userId } },
      gender: dto.gender!,
      nationalIdEncrypted: this.nationalIdCrypto.encrypt(dto.nationalIdNumber!),
      nationalIdHash: this.nationalIdCrypto.hash(dto.nationalIdNumber!),
      nationalIdLast4: this.nationalIdCrypto.lastFour(dto.nationalIdNumber!),
      baseAddress:
        dto.baseAddress?.trim() ||
        dto.publicLocationLabel?.trim() ||
        `${dto.baseLatitude}, ${dto.baseLongitude}`,
      publicLocationLabel: dto.publicLocationLabel?.trim() || null,
      baseLatitude: dto.baseLatitude ?? null,
      baseLongitude: dto.baseLongitude ?? null,
      paymentMethod: dto.paymentMethod!,
      paymentNumber: dto.paymentNumber!,
      verificationStatus: VerificationStatus.PENDING,
      availabilityStatus: TechnicianAvailability.OFFLINE,
    };
  }

  private assertRequiredProfileFieldsForCreate(
    dto: UpdateTechnicianProfileDto,
    options: { nationalIdOnFile?: boolean } = {},
  ) {
    const missing: string[] = [];
    if (!dto.gender) missing.push('gender');
    if (!dto.nationalIdNumber && !options.nationalIdOnFile) {
      missing.push('nationalIdNumber');
    }
    const hasCoordinates =
      typeof dto.baseLatitude === 'number' &&
      typeof dto.baseLongitude === 'number';
    if (
      !hasCoordinates &&
      !dto.baseAddress?.trim() &&
      !dto.publicLocationLabel?.trim()
    ) {
      missing.push('baseAddress or publicLocationLabel');
    }
    if (!dto.paymentMethod) missing.push('paymentMethod');
    if (!dto.paymentNumber) missing.push('paymentNumber');
    if (!dto.serviceExperiences?.length) missing.push('serviceExperiences');
    if (missing.length) {
      throw new BadRequestException(
        `Missing required technician fields: ${missing.join(', ')}.`,
      );
    }
  }

  private assertServiceExperiences(items?: ServiceExperienceDto[]) {
    if (items === undefined) return;
    if (!items.length) {
      throw new BadRequestException('Provide at least one service experience.');
    }
    for (const item of items) {
      if (!item.categoryId && !item.customName) {
        throw new BadRequestException(
          'Each service must have either categoryId or customName.',
        );
      }
      if (item.categoryId && item.customName) {
        throw new BadRequestException(
          'Each service must use either categoryId or customName, not both.',
        );
      }
    }
  }

  private async runSerializable<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (this.isPrismaCode(error, 'P2034') && attempt < 2) continue;
        if (this.isPrismaCode(error, 'P2034')) {
          throw new ConflictException(
            'The technician profile changed concurrently. Retry the update.',
          );
        }
        throw error;
      }
    }
    throw new ConflictException(
      'The technician profile changed concurrently. Retry the update.',
    );
  }

  private async lockProfile(tx: Prisma.TransactionClient, profileId: string) {
    await tx.$queryRaw`SELECT "id" FROM "technician_profiles" WHERE "id" = ${profileId} FOR UPDATE`;
  }

  private assertCoordinatePair(
    dto: Pick<UpdateTechnicianProfileDto, 'baseLatitude' | 'baseLongitude'>,
  ) {
    const hasLatitude = dto.baseLatitude !== undefined;
    const hasLongitude = dto.baseLongitude !== undefined;
    if (hasLatitude !== hasLongitude) {
      throw new BadRequestException(
        'baseLatitude and baseLongitude must be provided together.',
      );
    }
    if ((dto.baseLatitude === null) !== (dto.baseLongitude === null)) {
      throw new BadRequestException(
        'Set both coordinates to null when location coordinates are unavailable.',
      );
    }
  }

  private async resolveProfileCoordinates(
    dto: UpdateTechnicianProfileDto,
  ): Promise<UpdateTechnicianProfileDto> {
    this.assertCoordinatePair(dto);
    return dto;
  }

  private assertUpdateHasFields(dto: object) {
    if (!Object.keys(dto).length) {
      throw new BadRequestException(
        'Provide at least one technician field to update.',
      );
    }
  }

  private async writePostgisLocation(
    tx: Prisma.TransactionClient,
    profileId: string,
    dto: Pick<UpdateTechnicianProfileDto, 'baseLatitude' | 'baseLongitude'>,
    clearWhenMissing = false,
  ) {
    if (dto.baseLatitude === null && dto.baseLongitude === null) {
      await tx.$executeRaw`
        UPDATE "technician_profiles"
        SET "baseLocation" = NULL
        WHERE "id" = ${profileId}`;
      return;
    }
    if (dto.baseLatitude === undefined || dto.baseLongitude === undefined) {
      if (clearWhenMissing) {
        await tx.$executeRaw`
          UPDATE "technician_profiles"
          SET "baseLocation" = NULL
          WHERE "id" = ${profileId}`;
      }
      return;
    }
    await tx.$executeRaw`
      UPDATE "technician_profiles"
      SET "baseLocation" = ST_SetSRID(
        ST_MakePoint(${dto.baseLongitude}::double precision, ${dto.baseLatitude}::double precision),
        4326
      )::geography
      WHERE "id" = ${profileId}`;
  }

  private async profilePictureUrl(
    profile: Pick<ProfileWithDetails, 'profilePictureObjectKey'>,
  ): Promise<string | null> {
    if (!profile.profilePictureObjectKey) return null;
    return this.storage.getDownloadUrl(profile.profilePictureObjectKey);
  }

  /** Ratings and completed jobs per technician, for a page of profiles at once. */
  private async loadStats(
    profileIds: string[],
  ): Promise<Map<string, TechnicianStats>> {
    const stats = new Map<string, TechnicianStats>();
    if (!profileIds.length) return stats;
    const [ratings, completed] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          technicianId: string;
          ratingCount: number;
          averageScore: number | null;
        }>
      >`
        SELECT jr."technicianId",
               COUNT(DISTINCT jr."id")::int AS "ratingCount",
               AVG(rr."score")::float AS "averageScore"
        FROM "job_ratings" jr
        LEFT JOIN "rating_responses" rr ON rr."jobRatingId" = jr."id"
        WHERE jr."technicianId" IN (${Prisma.join(profileIds)})
        GROUP BY jr."technicianId"`,
      this.prisma.job.groupBy({
        by: ['technicianId'],
        where: {
          technicianId: { in: profileIds },
          status: JobStatus.COMPLETED,
        },
        _count: { _all: true },
      }),
    ]);
    for (const id of profileIds) stats.set(id, { ...NO_STATS });
    for (const row of ratings) {
      const entry = stats.get(row.technicianId);
      if (!entry) continue;
      entry.ratingCount = Number(row.ratingCount);
      entry.averageRating =
        row.averageScore === null
          ? null
          : Math.round(Number(row.averageScore) * 10) / 10;
    }
    for (const row of completed) {
      const entry = row.technicianId ? stats.get(row.technicianId) : undefined;
      if (entry) entry.jobsCompleted = row._count._all;
    }
    return stats;
  }

  private async toResponse(
    profile: ProfileWithDetails,
    viewer: Viewer,
    knownStats?: TechnicianStats,
  ): Promise<TechnicianResponse> {
    const stats =
      knownStats ??
      (await this.loadStats([profile.id])).get(profile.id) ??
      NO_STATS;
    const isOwner = viewer === 'owner';
    const isAdmin = viewer === 'admin';

    // Customers only see services Fundi approved; the owner and admins see
    // every service with where its review stands.
    const shownServices =
      isOwner || isAdmin
        ? profile.categories
        : profile.categories.filter(
            (row) => row.status === VerificationStatus.APPROVED,
          );
    const serviceExperiences = shownServices.map((row) => ({
      id: row.id,
      categoryId: row.categoryId,
      category: row.category,
      customName: row.customName,
      yearsOfExperience: row.yearsOfExperience,
      ...(isOwner || isAdmin
        ? {
            status: row.status,
            reviewNote: row.reviewNote,
            reviewedAt: row.reviewedAt,
          }
        : {}),
    }));

    const totalYearsOfExperience = shownServices.length
      ? Math.max(...shownServices.map((c) => c.yearsOfExperience))
      : 0;

    const profilePictureUrl = await this.profilePictureUrl(profile);

    // ─── Owner / admin: full payload
    if (isOwner || isAdmin) {
      return {
        id: profile.id,
        user: {
          id: profile.user.id,
          fullName: profile.user.fullName,
          role: profile.user.role,
          phoneNumber: profile.user.phoneNumber,
          email: profile.user.email,
          status: profile.user.status,
          createdAt: profile.user.createdAt,
          updatedAt: profile.user.updatedAt,
        },
        gender: profile.gender,
        businessType: profile.businessType,
        nationalIdNumber: profile.nationalIdLast4
          ? `****${profile.nationalIdLast4}`
          : null,
        yearsOfExperience: totalYearsOfExperience,
        serviceExperiences,
        verificationStatus: profile.verificationStatus,
        rejectionReason: profile.rejectionReason ?? null,
        availabilityStatus: profile.availabilityStatus,
        capacityAutoOffline: profile.capacityAutoOffline,
        location: {
          address: profile.baseAddress,
          publicLocationLabel: profile.publicLocationLabel,
          latitude: profile.baseLatitude,
          longitude: profile.baseLongitude,
        },
        profilePictureUrl,
        stats,
        paymentMethod: profile.paymentMethod,
        paymentNumber: profile.paymentNumber,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      };
    }

    // ─── Authenticated non-owner: contact visible, payment hidden
    if (viewer === 'authenticated') {
      return {
        id: profile.id,
        user: {
          id: profile.user.id,
          fullName: profile.user.fullName,
          role: profile.user.role,
          phoneNumber: profile.user.phoneNumber,
          email: profile.user.email,
          status: profile.user.status,
          createdAt: profile.user.createdAt,
          updatedAt: profile.user.updatedAt,
        },
        gender: profile.gender,
        businessType: profile.businessType,
        yearsOfExperience: totalYearsOfExperience,
        serviceExperiences,
        verificationStatus: profile.verificationStatus,
        availabilityStatus: profile.availabilityStatus,
        location: {
          address: profile.baseAddress,
          publicLocationLabel: profile.publicLocationLabel,
          latitude: profile.baseLatitude,
          longitude: profile.baseLongitude,
        },
        profilePictureUrl,
        stats,
        paymentMethod: null,
        paymentNumber: null,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      };
    }

    // ─── Anonymous: same key set as above, sensitive values null
    return {
      id: profile.id,
      user: {
        id: profile.user.id,
        fullName: profile.user.fullName,
        role: profile.user.role,
        phoneNumber: null,
        email: null,
        status: null,
        createdAt: null,
        updatedAt: null,
      },
      gender: profile.gender,
      businessType: profile.businessType,
      nationalIdNumber: null,
      yearsOfExperience: totalYearsOfExperience,
      serviceExperiences,
      verificationStatus: profile.verificationStatus,
      availabilityStatus: profile.availabilityStatus,
      location: {
        address: profile.baseAddress,
        publicLocationLabel: profile.publicLocationLabel,
        latitude: profile.baseLatitude,
        longitude: profile.baseLongitude,
      },
      profilePictureUrl,
      stats,
      paymentMethod: null,
      paymentNumber: null,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }

  private throwWriteError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        const target = JSON.stringify(error.meta?.target ?? '');
        if (target.includes('phoneNumber')) {
          throw new ConflictException(
            'A user with this phone number already exists.',
          );
        }
        if (target.includes('email')) {
          throw new ConflictException('A user with this email already exists.');
        }
        if (target.includes('nationalIdHash')) {
          throw new ConflictException(
            'This technician ID number is already associated with another profile.',
          );
        }
        if (target.includes('customNameNormalized')) {
          throw new ConflictException(
            'This custom service is already listed for this technician.',
          );
        }
        if (target.includes('categoryId')) {
          throw new ConflictException(
            'This service category is already listed for this technician.',
          );
        }
        throw new ConflictException(
          'A technician with a conflicting unique field already exists.',
        );
      }
      if (error.code === 'P2025') {
        throw new NotFoundException('Technician not found.');
      }
      if (error.code === 'P2034') {
        throw new ConflictException(
          'The record changed concurrently. Retry the request.',
        );
      }
    }
    throw error;
  }

  private isPrismaCode(error: unknown, code: string) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === code
    );
  }
}
