import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  TechnicianAvailability,
  UserRole,
  UserStatus,
  VerificationStatus,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
} from '../common/dto/pagination.constants';
import { PrismaService } from '../database/prisma.service';
import { StorageService } from '../storage/storage.service';
import { TechnicianDocumentsService } from './documents/technician-documents.service';
import { NationalIdCryptoService } from './national-id-crypto.service';
import { AdminUpdateTechnicianDto } from './dto/admin-update-technician.dto';
import { CreateTechnicianDto } from './dto/create-technician.dto';
import { ListTechniciansQueryDto } from './dto/list-technicians-query.dto';
import { SearchAvailableTechniciansDto } from './dto/search-available-technicians.dto';
import { SearchTechniciansByUserDto } from './dto/search-technicians-by-user.dto';
import { SearchTechniciansDto } from './dto/search-technicians.dto';
import { ServiceExperienceDto } from './dto/service-experience.dto';
import { UpdateTechnicianProfileDto } from './dto/update-technician-profile.dto';

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
  yearsOfExperience: number;
  serviceExperiences: Array<{
    categoryId: string | null;
    category: { id: string; name: string; slug: string } | null;
    customName: string | null;
    yearsOfExperience: number;
  }>;
  verificationStatus: string;
  availabilityStatus: string;
  location: {
    address: string;
    publicLocationLabel: string | null;
    latitude: number;
    longitude: number;
  };
  profilePictureUrl: string | null;
  nationalIdNumber?: string | null;
  paymentMethod: string | null;
  paymentNumber: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// Envelope shared by every technician list endpoint: one page of profiles
// plus pagination metadata — the same shape GET /users returns.
export interface PaginatedTechnicianList {
  data: TechnicianResponse[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

@Injectable()
export class TechniciansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly nationalIdCrypto: NationalIdCryptoService,
    private readonly storage: StorageService,
    private readonly documents: TechnicianDocumentsService,
  ) {}

  // ─── Technician self-service ────────────────────────────────────────────

  async registerMyProfile(userId: string, dto: UpdateTechnicianProfileDto) {
    this.assertCoordinatePair(dto);
    this.assertServiceExperiences(dto.serviceExperiences);
    try {
      const profile = await this.runSerializable(async (tx) => {
        const existing = await tx.technicianProfile.findUnique({
          where: { userId },
          select: { id: true },
        });
        if (existing) {
          throw new ConflictException(
            'A technician profile already exists. Use PUT to update it.',
          );
        }
        this.assertRequiredProfileFieldsForCreate(dto);
        const created = await tx.technicianProfile.create({
          data: this.buildProfileCreateData(userId, dto),
        });
        await this.lockProfile(tx, created.id);
        await this.replaceServiceExperiences(
          tx,
          created.id,
          dto.serviceExperiences ?? [],
        );
        await this.writePostgisLocation(tx, created.id, dto);
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
    this.assertCoordinatePair(dto);
    this.assertServiceExperiences(dto.serviceExperiences);
    try {
      const profile = await this.runSerializable(async (tx) => {
        const saved = await tx.technicianProfile.findUnique({
          where: { userId },
          select: { id: true },
        });
        if (!saved) {
          throw new NotFoundException(
            'Technician profile not found. Register one first via POST /api/v1/technicians/profile.',
          );
        }
        await this.lockProfile(tx, saved.id);
        await this.saveProfileFields(tx, saved.id, dto, userId, 'owner');
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
    const profileDto = dto.profile ?? {};
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
    if (query.nationalIdNumber) {
      filters.push({
        nationalIdHash: this.nationalIdCrypto.hash(query.nationalIdNumber),
      });
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
    dto: AdminUpdateTechnicianDto,
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
  ) {
    return this.updateByAdmin(profileId, { verificationStatus }, actorId);
  }

  async setAvailabilityByAdmin(
    profileId: string,
    availabilityStatus: TechnicianAvailability,
    actorId: string,
  ) {
    return this.updateByAdmin(profileId, { availabilityStatus }, actorId);
  }

  async deleteByAdmin(profileId: string, actorId: string) {
    return this.runSerializable(async (tx) => {
      const profile = await tx.technicianProfile.findUnique({
        where: { id: profileId },
      });
      if (!profile) throw new NotFoundException('Technician not found.');
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
    const data = await Promise.all(
      profiles.map((p) => this.toResponse(p, viewer)),
    );
    return {
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  // Validates paging input so invalid values fail with a 400 before any query runs.
  private resolvePaging(query: {
    page?: number;
    limit?: number;
  }): { page: number; limit: number } {
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
      filters.push({ categories: { some: { categoryId: dto.categoryId } } });
    }
    const category = dto.category?.trim();
    if (category) {
      filters.push({
        categories: { some: { category: this.buildCategoryNameClause(category) } },
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
      filters.push({ categories: { some: { categoryId: query.categoryId } } });
    }
    const category = query.category?.trim();
    if (category) {
      filters.push({
        categories: { some: { category: this.buildCategoryNameClause(category) } },
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
  private buildCategoryNameClause(name: string): Prisma.ServiceCategoryWhereInput {
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
    },
    actorId: string,
    viewer: Viewer,
  ) {
    const current = await tx.technicianProfile.findUniqueOrThrow({
      where: { id: profileId },
      include: PROFILE_INCLUDE,
    });

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

    const nationalIdFields = this.encodeNationalId(dto.nationalIdNumber);

    await tx.technicianProfile.update({
      where: { id: current.id },
      data: {
        ...(dto.gender !== undefined && { gender: dto.gender }),
        ...nationalIdFields,
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
        ...(dto.paymentMethod !== undefined && {
          paymentMethod: dto.paymentMethod,
        }),
        ...(dto.paymentNumber !== undefined && {
          paymentNumber: dto.paymentNumber,
        }),
        ...(requestedVerification !== current.verificationStatus && {
          verificationStatus: requestedVerification,
        }),
        availabilityStatus: nextAvailability,
      },
    });

    if (dto.serviceExperiences !== undefined) {
      await this.replaceServiceExperiences(
        tx,
        current.id,
        dto.serviceExperiences,
      );
    }
    await this.writePostgisLocation(tx, current.id, dto);
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
        metadata: { changedFields: Object.keys(dto) },
      },
      tx,
    );
  }

  private async replaceServiceExperiences(
    tx: Prisma.TransactionClient,
    profileId: string,
    items: ServiceExperienceDto[],
  ) {
    if (items.length > 10) {
      throw new BadRequestException(
        'A technician can list at most 10 services.',
      );
    }

    await tx.technicianCategory.deleteMany({
      where: { technicianId: profileId },
    });
    if (!items.length) return;

    const realCategoryIds = items
      .map((i) => i.categoryId)
      .filter((id): id is string => !!id);

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

    await tx.technicianCategory.createMany({ data });
  }

  private buildProfileCreateData(
    userId: string,
    dto: UpdateTechnicianProfileDto,
  ): Prisma.TechnicianProfileCreateInput {
    this.assertRequiredProfileFieldsForCreate(dto);
    const nationalIdFields = this.encodeNationalId(dto.nationalIdNumber);
    return {
      user: { connect: { id: userId } },
      gender: dto.gender!,
      nationalIdEncrypted: nationalIdFields.nationalIdEncrypted!,
      nationalIdHash: nationalIdFields.nationalIdHash!,
      baseAddress: dto.baseAddress!.trim(),
      publicLocationLabel: dto.publicLocationLabel?.trim() || null,
      baseLatitude: dto.baseLatitude!,
      baseLongitude: dto.baseLongitude!,
      paymentMethod: dto.paymentMethod!,
      paymentNumber: dto.paymentNumber!,
      verificationStatus: VerificationStatus.PENDING,
      availabilityStatus: TechnicianAvailability.OFFLINE,
    };
  }

  private assertRequiredProfileFieldsForCreate(
    dto: UpdateTechnicianProfileDto,
  ) {
    const missing: string[] = [];
    if (!dto.gender) missing.push('gender');
    if (!dto.nationalIdNumber) missing.push('nationalIdNumber');
    if (!dto.baseAddress?.trim()) missing.push('baseAddress');
    if (dto.baseLatitude === undefined || dto.baseLatitude === null) {
      missing.push('baseLatitude');
    }
    if (dto.baseLongitude === undefined || dto.baseLongitude === null) {
      missing.push('baseLongitude');
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
    if (dto.baseLatitude === null || dto.baseLongitude === null) {
      throw new BadRequestException(
        'baseLatitude and baseLongitude cannot be null for a technician.',
      );
    }
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
  ) {
    if (dto.baseLatitude === undefined || dto.baseLongitude === undefined) {
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

  private encodeNationalId(value: string | null | undefined) {
    if (value === undefined) return {};
    if (value === null || value.trim() === '') {
      throw new BadRequestException(
        'nationalIdNumber is required and cannot be cleared.',
      );
    }
    return {
      nationalIdEncrypted: this.nationalIdCrypto.encrypt(value),
      nationalIdHash: this.nationalIdCrypto.hash(value),
    };
  }

  private async profilePictureUrl(
    profile: Pick<ProfileWithDetails, 'profilePictureObjectKey'>,
  ): Promise<string | null> {
    if (!profile.profilePictureObjectKey) return null;
    return this.storage.getDownloadUrl(profile.profilePictureObjectKey);
  }

  private async toResponse(
    profile: ProfileWithDetails,
    viewer: Viewer,
  ): Promise<TechnicianResponse> {
    const isOwner = viewer === 'owner';
    const isAdmin = viewer === 'admin';

    const serviceExperiences = profile.categories.map((row) => ({
      categoryId: row.categoryId,
      category: row.category,
      customName: row.customName,
      yearsOfExperience: row.yearsOfExperience,
    }));

    const totalYearsOfExperience = profile.categories.length
      ? Math.max(...profile.categories.map((c) => c.yearsOfExperience))
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
        nationalIdNumber: profile.nationalIdEncrypted
          ? this.nationalIdCrypto.decrypt(profile.nationalIdEncrypted)
          : null,
        paymentMethod: profile.paymentMethod,
        paymentNumber: profile.paymentNumber,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      };
    }

    // ─── Authenticated non-owner: contact visible, payment + NID hidden
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
        nationalIdNumber: null,
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
      nationalIdNumber: null,
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
            'This national ID is already registered to a technician.',
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
