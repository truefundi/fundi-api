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
  TechnicianGender,
  UserRole,
  UserStatus,
  VerificationStatus,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { NationalIdCryptoService } from './national-id-crypto.service';
import { AdminUpdateTechnicianDto } from './dto/admin-update-technician.dto';
import { CreateTechnicianDto } from './dto/create-technician.dto';
import { SearchTechniciansDto } from './dto/search-technicians.dto';
import {
  UpdateTechnicianProfileDto,
  TECHNICIAN_IMAGE_MIME_TYPES,
} from './dto/update-technician-profile.dto';

const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;

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
    include: {
      category: { select: { id: true, name: true, slug: true } },
    },
  },
} satisfies Prisma.TechnicianProfileInclude;

type TechnicianProfileWithDetails = Prisma.TechnicianProfileGetPayload<{
  include: typeof PROFILE_INCLUDE;
}>;

type ProfilePhotoData = {
  profilePicture?: Uint8Array<ArrayBuffer> | null;
  profilePictureMimeType?: string | null;
};

@Injectable()
export class TechniciansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly nationalIdCrypto: NationalIdCryptoService,
  ) {}

  // Returns the technician's complete profile after they explicitly register it.
  async getMyProfile(userId: string) {
    const profile = await this.prisma.technicianProfile.findUnique({
      where: { userId },
      include: PROFILE_INCLUDE,
    });
    if (!profile) {
      throw new NotFoundException('Register your technician profile first.');
    }
    return this.toResponse(profile);
  }

  // Creates the technician profile explicitly with whatever optional details are available.
  async registerMyProfile(userId: string, dto: UpdateTechnicianProfileDto) {
    this.assertUpdateHasFields(dto);
    this.assertCoordinatePair(dto);
    const photo = this.decodePhoto(dto);
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
        const created = await tx.technicianProfile.create({ data: { userId } });
        await this.lockProfile(tx, created.id);
        const current = await tx.technicianProfile.findUniqueOrThrow({
          where: { id: created.id },
          include: PROFILE_INCLUDE,
        });
        return this.saveProfileFields(
          tx,
          current,
          dto,
          photo,
          userId,
          false,
          'PROFILE_REGISTERED',
        );
      });
      return this.toResponse(profile);
    } catch (error) {
      this.throwWriteError(error);
    }
  }

  // Saves account and technician fields atomically in one profile update request.
  async updateMyProfile(userId: string, dto: UpdateTechnicianProfileDto) {
    this.assertUpdateHasFields(dto);
    this.assertCoordinatePair(dto);
    const photo = this.decodePhoto(dto);

    try {
      const profile = await this.runSerializable(async (tx) => {
        const saved = await tx.technicianProfile.findUnique({
          where: { userId },
          select: { id: true },
        });
        if (!saved) {
          throw new NotFoundException(
            'Register your technician profile before updating it.',
          );
        }
        await this.lockProfile(tx, saved.id);
        const current = await tx.technicianProfile.findUniqueOrThrow({
          where: { id: saved.id },
          include: PROFILE_INCLUDE,
        });
        return this.saveProfileFields(tx, current, dto, photo, userId);
      });
      return this.toResponse(profile);
    } catch (error) {
      this.throwWriteError(error);
    }
  }

  // Changes availability separately while enforcing verification requirements.
  async updateMyAvailability(
    userId: string,
    availabilityStatus: TechnicianAvailability,
  ) {
    return this.updateMyProfile(userId, { availabilityStatus });
  }

  // Lists only active, approved, online technicians for authenticated customers.
  async listAvailable() {
    const profiles = await this.prisma.technicianProfile.findMany({
      where: {
        verificationStatus: VerificationStatus.APPROVED,
        availabilityStatus: TechnicianAvailability.ONLINE,
        user: { is: { status: UserStatus.ACTIVE, role: UserRole.TECHNICIAN } },
      },
      include: PROFILE_INCLUDE,
      orderBy: { updatedAt: 'desc' },
    });
    return profiles.map((profile) => this.toMarketplaceResponse(profile));
  }

  // Hides pending, offline, and inactive accounts from customer technician details.
  async getAvailableById(profileId: string) {
    const profile = await this.prisma.technicianProfile.findFirst({
      where: {
        id: profileId,
        verificationStatus: VerificationStatus.APPROVED,
        availabilityStatus: TechnicianAvailability.ONLINE,
        user: { is: { status: UserStatus.ACTIVE, role: UserRole.TECHNICIAN } },
      },
      include: PROFILE_INCLUDE,
    });
    if (!profile)
      throw new NotFoundException('Available technician not found.');
    return this.toMarketplaceResponse(profile);
  }

  // Provides an anonymous-safe active technician list for public landing pages.
  async listPublic() {
    return this.listAvailable();
  }

  // Provides one anonymous-safe active technician card by profile ID.
  async getPublicById(profileId: string) {
    return this.getAvailableById(profileId);
  }

  // Creates a technician user and profile together for an administrator.
  async createByAdmin(dto: CreateTechnicianDto, actorId: string) {
    if (!dto.user?.fullName?.trim() || !dto.user.phoneNumber) {
      throw new BadRequestException(
        'Technician fullName and phoneNumber are required.',
      );
    }
    const profileDto = dto.profile ?? {};
    this.assertCoordinatePair(profileDto);
    const photo = this.decodePhoto(profileDto);
    const nationalIdFields = this.encodeNationalId(
      profileDto.nationalIdNumber,
    );
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
            user: { connect: { id: user.id } },
            gender: profileDto.gender ?? null,
            yearsOfExperience: profileDto.yearsOfExperience ?? null,
            ...nationalIdFields,
            baseAddress: profileDto.baseAddress?.trim() || null,
            publicLocationLabel:
              profileDto.publicLocationLabel?.trim() || null,
            baseLatitude: profileDto.baseLatitude ?? null,
            baseLongitude: profileDto.baseLongitude ?? null,
            profilePicture: photo.profilePicture ?? null,
            profilePictureMimeType: photo.profilePictureMimeType ?? null,
            verificationStatus: VerificationStatus.PENDING,
            availabilityStatus: TechnicianAvailability.OFFLINE,
          },
        });
        await this.lockProfile(tx, created.id);
        await this.assertActiveCategories(tx, profileDto.categoryIds ?? []);
        await this.replaceCategories(tx, created.id, profileDto.categoryIds);
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
      return this.toResponse(profile);
    } catch (error) {
      this.throwWriteError(error);
    }
  }

  // Lists all technician profiles, including pending and offline records, for admins.
  async listAllByAdmin() {
    const profiles = await this.prisma.technicianProfile.findMany({
      include: PROFILE_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return profiles.map((profile) => this.toResponse(profile));
  }

  // Retrieves any technician profile by its profile ID for administrators.
  async getByIdForAdmin(profileId: string) {
    const profile = await this.prisma.technicianProfile.findUnique({
      where: { id: profileId },
      include: PROFILE_INCLUDE,
    });
    if (!profile) throw new NotFoundException('Technician not found.');
    return this.toResponse(profile);
  }

  // Returns every technician matching identity, address, category, gender, or numeric location text.
  async searchByAdmin(query: SearchTechniciansDto) {
    const filters: Prisma.TechnicianProfileWhereInput[] = [];
    if (query.query) {
      const term = query.query.trim();
      const matches: Prisma.TechnicianProfileWhereInput[] = [
        { user: { is: { fullName: { contains: term, mode: 'insensitive' } } } },
        { user: { is: { phoneNumber: { contains: term } } } },
        { user: { is: { email: { contains: term, mode: 'insensitive' } } } },
        { baseAddress: { contains: term, mode: 'insensitive' } },
        {
          publicLocationLabel: {
            contains: term,
            mode: 'insensitive',
          },
        },
        {
          publicLocationLabel: {
            contains: term,
            mode: 'insensitive',
          },
        },
        {
          categories: {
            some: {
              category: { name: { contains: term, mode: 'insensitive' } },
            },
          },
        },
      ];
      const gender = Object.values(TechnicianGender).find(
        (value) => value.toLowerCase() === term.toLowerCase(),
      );
      if (gender) matches.push({ gender });
      const numeric = Number(term);
      if (Number.isFinite(numeric)) {
        matches.push(
          { baseLatitude: numeric },
          { baseLongitude: numeric },
          { yearsOfExperience: numeric },
        );
      }
      filters.push({ OR: matches });
    }
    if (query.categoryId) {
      filters.push({ categories: { some: { categoryId: query.categoryId } } });
    }
    if (query.nationalIdNumber) {
      filters.push({
        nationalIdHash: this.nationalIdCrypto.hash(query.nationalIdNumber),
      });
    }
    if (query.verificationStatus) {
      filters.push({ verificationStatus: query.verificationStatus });
    }
    if (query.availabilityStatus) {
      filters.push({ availabilityStatus: query.availabilityStatus });
    }

    const profiles = await this.prisma.technicianProfile.findMany({
      where: filters.length ? { AND: filters } : {},
      include: PROFILE_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return profiles.map((profile) => this.toResponse(profile));
  }

  // Updates technician profile and account fields for an admin in one transaction.
  async updateByAdmin(
    profileId: string,
    dto: AdminUpdateTechnicianDto,
    actorId: string,
  ) {
    this.assertUpdateHasFields(dto);
    this.assertCoordinatePair(dto);
    const photo = this.decodePhoto(dto);
    try {
      const profile = await this.runSerializable(async (tx) => {
        const found = await tx.technicianProfile.findUnique({
          where: { id: profileId },
        });
        if (!found) throw new NotFoundException('Technician not found.');
        await this.lockProfile(tx, profileId);
        const current = await tx.technicianProfile.findUniqueOrThrow({
          where: { id: profileId },
          include: PROFILE_INCLUDE,
        });
        return this.saveProfileFields(tx, current, dto, photo, actorId, true);
      });
      return this.toResponse(profile);
    } catch (error) {
      this.throwWriteError(error);
    }
  }

  // Changes verification status; non-approved technicians are forced offline.
  async setVerificationStatus(
    profileId: string,
    verificationStatus: VerificationStatus,
    actorId: string,
  ) {
    return this.updateByAdmin(profileId, { verificationStatus }, actorId);
  }

  // Changes technician availability for an administrator.
  async setAvailabilityByAdmin(
    profileId: string,
    availabilityStatus: TechnicianAvailability,
    actorId: string,
  ) {
    return this.updateByAdmin(profileId, { availabilityStatus }, actorId);
  }

  // Deletes the associated user and profile, cascading login sessions and category links.
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

  // Applies a single request to user and profile tables and replaces categories safely.
  private async saveProfileFields(
    tx: Prisma.TransactionClient,
    current: TechnicianProfileWithDetails,
    dto: UpdateTechnicianProfileDto & {
      verificationStatus?: VerificationStatus;
    },
    photo: ProfilePhotoData,
    actorId: string,
    admin = false,
    auditAction?: string,
  ) {
    if (dto.categoryIds !== undefined) {
      await this.assertActiveCategories(tx, dto.categoryIds);
    }

    const requestedVerification: VerificationStatus = admin
      ? (dto.verificationStatus ?? current.verificationStatus)
      : current.verificationStatus;
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

    const profileData: Prisma.TechnicianProfileUpdateInput = {
      ...(dto.gender !== undefined && { gender: dto.gender }),
      ...(dto.yearsOfExperience !== undefined && {
        yearsOfExperience: dto.yearsOfExperience,
      }),
      ...nationalIdFields,
      ...(dto.baseAddress !== undefined && {
        baseAddress: dto.baseAddress?.trim() || null,
      }),
      ...(dto.publicLocationLabel !== undefined && {
        publicLocationLabel: dto.publicLocationLabel?.trim() || null,
      }),
      ...(dto.baseLatitude !== undefined && { baseLatitude: dto.baseLatitude }),
      ...(dto.baseLongitude !== undefined && {
        baseLongitude: dto.baseLongitude,
      }),
      ...(requestedVerification !== current.verificationStatus && {
        verificationStatus: requestedVerification,
      }),
      availabilityStatus: nextAvailability,
      ...photo,
    };
    await tx.technicianProfile.update({
      where: { id: current.id },
      data: profileData,
    });

    if (dto.categoryIds !== undefined) {
      await this.replaceCategories(tx, current.id, dto.categoryIds);
    }
    await this.writePostgisLocation(tx, current.id, dto);
    await this.audit.log(
      {
        entityType: 'TechnicianProfile',
        entityId: current.id,
        action:
          auditAction ??
          (Object.keys(dto).length === 1 && dto.availabilityStatus
            ? 'AVAILABILITY_UPDATED'
            : 'UPDATED'),
        fromStatus: current.verificationStatus,
        toStatus: requestedVerification,
        actorId,
        metadata: { changedFields: Object.keys(dto) },
      },
      tx,
    );
    return tx.technicianProfile.findUniqueOrThrow({
      where: { id: current.id },
      include: PROFILE_INCLUDE,
    });
  }

  // Executes serializable writes with bounded retries for PostgreSQL write conflicts.
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

  // Locks a technician row so simultaneous profile/category replacements serialize.
  private async lockProfile(tx: Prisma.TransactionClient, profileId: string) {
    await tx.$queryRaw`SELECT "id" FROM "technician_profiles" WHERE "id" = ${profileId} FOR UPDATE`;
  }

  // Locks active categories while assigning them, preventing a concurrent deactivation race.
  private async assertActiveCategories(
    tx: Prisma.TransactionClient,
    categoryIds: string[],
  ) {
    if (!categoryIds.length) return;
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "service_categories"
      WHERE "id" IN (${Prisma.join(categoryIds)}) AND "isActive" = TRUE
      FOR SHARE`;
    if (rows.length !== categoryIds.length) {
      throw new BadRequestException(
        'One or more categories are invalid or inactive.',
      );
    }
  }

  // Replaces category links inside the surrounding transaction.
  private async replaceCategories(
    tx: Prisma.TransactionClient,
    profileId: string,
    categoryIds?: string[],
  ) {
    if (categoryIds === undefined) return;
    await tx.technicianCategory.deleteMany({
      where: { technicianId: profileId },
    });
    if (categoryIds.length) {
      await tx.technicianCategory.createMany({
        data: categoryIds.map((categoryId) => ({
          technicianId: profileId,
          categoryId,
        })),
      });
    }
  }

  // Creates the PostGIS geography point from longitude/latitude coordinates.
  private async writePostgisLocation(
    tx: Prisma.TransactionClient,
    profileId: string,
    dto: Pick<UpdateTechnicianProfileDto, 'baseLatitude' | 'baseLongitude'>,
  ) {
    if (dto.baseLatitude === undefined || dto.baseLongitude === undefined)
      return;
    if (dto.baseLatitude === null && dto.baseLongitude === null) {
      await tx.$executeRaw`UPDATE "technician_profiles" SET "baseLocation" = NULL WHERE "id" = ${profileId}`;
      return;
    }
    if (dto.baseLatitude === null || dto.baseLongitude === null) {
      throw new BadRequestException(
        'To clear coordinates, set both coordinate fields to null.',
      );
    }
    await tx.$executeRaw`
      UPDATE "technician_profiles"
      SET "baseLocation" = ST_SetSRID(
        ST_MakePoint(${dto.baseLongitude}::double precision, ${dto.baseLatitude}::double precision),
        4326
      )::geography
      WHERE "id" = ${profileId}`;
  }

  // Rejects incomplete coordinate pairs before a database transaction starts.
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
        'To clear coordinates, set both coordinate fields to null.',
      );
    }
  }

  // Validates binary image size and verifies its signature against the supplied MIME type.
  private decodePhoto(
    dto: Pick<
      UpdateTechnicianProfileDto,
      'profilePictureBase64' | 'profilePictureMimeType'
    >,
  ): ProfilePhotoData {
    if (dto.profilePictureBase64 === undefined) {
      if (dto.profilePictureMimeType !== undefined) {
        throw new BadRequestException(
          'profilePictureBase64 is required with profilePictureMimeType.',
        );
      }
      return {};
    }
    if (dto.profilePictureBase64 === null) {
      return { profilePicture: null, profilePictureMimeType: null };
    }
    if (!dto.profilePictureMimeType) {
      throw new BadRequestException(
        'profilePictureMimeType is required with profilePictureBase64.',
      );
    }
    if (
      !TECHNICIAN_IMAGE_MIME_TYPES.includes(
        dto.profilePictureMimeType as (typeof TECHNICIAN_IMAGE_MIME_TYPES)[number],
      )
    ) {
      throw new BadRequestException(
        'Profile image type must be JPEG, PNG, or WebP.',
      );
    }
    const decoded = Buffer.from(dto.profilePictureBase64, 'base64');
    if (!decoded.length || decoded.length > MAX_PROFILE_IMAGE_BYTES) {
      throw new BadRequestException(
        'Profile images must be smaller than 5 MB.',
      );
    }
    if (this.detectImageMime(decoded) !== dto.profilePictureMimeType) {
      throw new BadRequestException(
        'Profile image content does not match its MIME type.',
      );
    }
    const bytes = new Uint8Array(decoded.length);
    bytes.set(decoded);
    return {
      profilePicture: bytes,
      profilePictureMimeType: dto.profilePictureMimeType,
    };
  }

  // Recognizes image signatures so arbitrary binary data cannot be saved as an image.
  private detectImageMime(bytes: Buffer): string | null {
    if (
      bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      return 'image/png';
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
      return 'image/jpeg';
    if (
      bytes.toString('ascii', 0, 4) === 'RIFF' &&
      bytes.toString('ascii', 8, 12) === 'WEBP'
    )
      return 'image/webp';
    return null;
  }

  // Builds scalar profile data shared by technician and administrator updates.
  private profileData(
    dto: UpdateTechnicianProfileDto & {
      verificationStatus?: VerificationStatus;
    },
    photo: ProfilePhotoData,
  ): Prisma.TechnicianProfileUpdateInput {
    return {
      ...(dto.gender !== undefined && { gender: dto.gender }),
      ...(dto.yearsOfExperience !== undefined && {
        yearsOfExperience: dto.yearsOfExperience,
      }),
      ...(dto.baseAddress !== undefined && {
        baseAddress: dto.baseAddress?.trim() || null,
      }),
      ...(dto.baseLatitude !== undefined && { baseLatitude: dto.baseLatitude }),
      ...(dto.baseLongitude !== undefined && {
        baseLongitude: dto.baseLongitude,
      }),
      ...(dto.availabilityStatus !== undefined && {
        availabilityStatus: dto.availabilityStatus,
      }),
      ...photo,
    };
  }

  // Enforces a non-empty patch body for profile updates.
  private assertUpdateHasFields(dto: object) {
    if (!Object.keys(dto).length) {
      throw new BadRequestException(
        'Provide at least one technician field to update.',
      );
    }
  }

  // Converts bytea profile pictures to a data URI that frontend clients can display.
  private toResponse(profile: TechnicianProfileWithDetails) {
    const profilePicture = profile.profilePicture
      ? `data:${profile.profilePictureMimeType};base64,${Buffer.from(profile.profilePicture).toString('base64')}`
      : null;
    return {
      id: profile.id,
      user: profile.user,
      gender: profile.gender,
      yearsOfExperience: profile.yearsOfExperience,
      nationalIdNumber: profile.nationalIdEncrypted
        ? this.nationalIdCrypto.decrypt(profile.nationalIdEncrypted)
        : null,
      verificationStatus: profile.verificationStatus,
      availabilityStatus: profile.availabilityStatus,
      categories: profile.categories.map(({ category }) => category),
      location: {
        address: profile.baseAddress,
        publicLocationLabel: profile.publicLocationLabel,
        latitude: profile.baseLatitude,
        longitude: profile.baseLongitude,
      },
      profilePicture,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }

  // Creates the limited data shown to visitors and signed-in marketplace users.
  private toMarketplaceResponse(profile: TechnicianProfileWithDetails) {
    const profilePicture = profile.profilePicture
      ? `data:${profile.profilePictureMimeType};base64,${Buffer.from(profile.profilePicture).toString('base64')}`
      : null;
    return {
      id: profile.id,
      fullName: profile.user.fullName,
      gender: profile.gender,
      yearsOfExperience: profile.yearsOfExperience,
      categories: profile.categories.map(({ category }) => category),
      location: profile.publicLocationLabel,
      profilePicture,
    };
  }

  // Encrypts national IDs and stores only a keyed digest for uniqueness checks.
  private encodeNationalId(value: string | null | undefined) {
    if (value === undefined) return {};
    if (value === null || value.trim() === '') {
      return { nationalIdEncrypted: null, nationalIdHash: null };
    }
    return {
      nationalIdEncrypted: this.nationalIdCrypto.encrypt(value),
      nationalIdHash: this.nationalIdCrypto.hash(value),
    };
  }

  // Converts known database conflicts to actionable client errors.
  private throwWriteError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        const target = JSON.stringify(error.meta?.target ?? '');
        if (target.includes('phoneNumber'))
          throw new ConflictException(
            'A user with this phone number already exists.',
          );
        if (target.includes('email'))
          throw new ConflictException('A user with this email already exists.');
        if (target.includes('nationalIdHash')) {
          throw new ConflictException(
            'This national ID is already registered to a technician.',
          );
        }
        throw new ConflictException(
          'A technician with a conflicting unique field already exists.',
        );
      }
      if (error.code === 'P2025')
        throw new NotFoundException('Technician not found.');
      if (error.code === 'P2034')
        throw new ConflictException(
          'The record changed concurrently. Retry the request.',
        );
    }
    throw error;
  }

  // Identifies retryable Prisma transaction serialization conflicts.
  private isPrismaCode(error: unknown, code: string) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === code
    );
  }
}
