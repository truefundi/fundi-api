import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Prisma, VerificationStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { UpdateTechnicianProfileDto } from './dto/update-technician-profile.dto';

// Loads only the user identity and category fields required by the draft profile view.
const PROFILE_INCLUDE = {
  user: {
    select: { id: true, fullName: true, phoneNumber: true, email: true },
  },
  categories: {
    include: {
      category: { select: { id: true, name: true, slug: true } },
    },
  },
};

@Injectable()
export class TechniciansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // Returns saved wizard data and lazily creates a DRAFT profile when needed.
  async getMyProfile(userId: string) {
    const profile = await this.prisma.technicianProfile.upsert({
      where: { userId },
      update: {},
      create: { userId },
      include: PROFILE_INCLUDE,
    });
    return this.toResponse(profile);
  }

  // Persists provided fields and category assignments in one database transaction.
  async updateProfile(userId: string, dto: UpdateTechnicianProfileDto) {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException(
        'Provide at least one profile field to update.',
      );
    }

    const categoryIds = dto.categoryIds;
    if (categoryIds !== undefined && categoryIds.length > 0) {
      const activeCount = await this.prisma.serviceCategory.count({
        where: { id: { in: categoryIds }, isActive: true },
      });
      if (activeCount !== categoryIds.length) {
        throw new BadRequestException(
          'One or more categories are invalid or inactive.',
        );
      }
    }

    const { email, categoryIds: _categoryIds, ...profileFields } = dto;
    try {
      const profile = await this.prisma.$transaction(async (tx) => {
        if (email !== undefined) {
          await tx.user.update({
            where: { id: userId },
            data: { email: email?.trim().toLowerCase() || null },
          });
        }

        const updated = await tx.technicianProfile.upsert({
          where: { userId },
          create: { userId, ...profileFields },
          update: profileFields,
        });

        if (categoryIds !== undefined) {
          await tx.technicianCategory.deleteMany({
            where: { technicianId: updated.id },
          });
          if (categoryIds.length > 0) {
            await tx.technicianCategory.createMany({
              data: categoryIds.map((categoryId) => ({
                technicianId: updated.id,
                categoryId,
              })),
            });
          }
        }

        await this.audit.log(
          {
            entityType: 'TechnicianProfile',
            entityId: updated.id,
            action: 'DRAFT_UPDATED',
            actorId: userId,
            metadata: { changedFields: Object.keys(dto) },
          },
          tx,
        );

        return tx.technicianProfile.findUniqueOrThrow({
          where: { id: updated.id },
          include: PROFILE_INCLUDE,
        });
      });
      return this.toResponse(profile);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('The email address is already in use.');
      }
      throw error;
    }
  }

  // Shapes the saved profile without exposing fields outside this onboarding phase.
  private toResponse(
    profile: Prisma.TechnicianProfileGetPayload<{
      include: typeof PROFILE_INCLUDE;
    }>,
  ) {
    return {
      id: profile.id,
      user: profile.user,
      verificationStatus: profile.verificationStatus,
      onboardingStep: profile.onboardingStep,
      yearsOfExperience: profile.yearsOfExperience,
      tin: profile.tin,
      categories: profile.categories.map(({ category }) => category),
      location: {
        address: profile.baseAddress,
        latitude: profile.baseLatitude,
        longitude: profile.baseLongitude,
        serviceRadiusKm: profile.serviceRadiusKm,
      },
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }
}
