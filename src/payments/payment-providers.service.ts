import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MobilePaymentProvider, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class PaymentProvidersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  simulationAvailable() {
    const environment = this.config.get<string>(
      'environment',
      process.env.NODE_ENV || 'development',
    );
    return environment === 'development' || environment === 'test';
  }

  assertSimulationAvailable() {
    if (!this.simulationAvailable()) {
      throw new ServiceUnavailableException(
        'Mobile money API payments are simulated only in development/test. Use manual payments until live provider integration is configured.',
      );
    }
  }

  private response(
    provider: MobilePaymentProvider,
    apiEnabled: boolean,
    updatedAt: Date | null,
  ) {
    const apiAvailable = this.simulationAvailable();
    return {
      provider,
      apiEnabled,
      mode: apiEnabled && apiAvailable ? 'API' : 'MANUAL',
      apiAvailable,
      executionMode: apiAvailable ? 'SIMULATED' : 'UNAVAILABLE',
      updatedAt,
    };
  }

  async list() {
    const settings = await this.prisma.paymentProviderSetting.findMany();
    return Object.values(MobilePaymentProvider).map((provider) => {
      const setting = settings.find((row) => row.provider === provider);
      return this.response(
        provider,
        setting?.apiEnabled ?? false,
        setting?.updatedAt ?? null,
      );
    });
  }

  async update(
    provider: MobilePaymentProvider,
    apiEnabled: boolean,
    actorId: string,
  ) {
    if (apiEnabled) this.assertSimulationAvailable();
    return this.prisma.$transaction(async (tx) => {
      // Settings are seeded by the migration. Serialize toggles with payment starts.
      await tx.$queryRaw`SELECT "provider" FROM "payment_provider_settings"
        WHERE "provider"::text = ${provider} FOR UPDATE`;
      const previous = await tx.paymentProviderSetting.findUnique({
        where: { provider },
      });
      const setting = await tx.paymentProviderSetting.upsert({
        where: { provider },
        create: { provider, apiEnabled },
        update: { apiEnabled },
      });
      await this.audit.log(
        {
          entityType: 'PaymentProviderSetting',
          entityId: provider,
          action: 'PAYMENT_MODE_UPDATED',
          actorId,
          fromStatus: previous?.apiEnabled ? 'API' : 'MANUAL',
          toStatus: apiEnabled ? 'API' : 'MANUAL',
          metadata: { provider, apiEnabled },
        },
        tx,
      );
      return this.response(provider, setting.apiEnabled, setting.updatedAt);
    });
  }

  async assertMode(
    tx: Prisma.TransactionClient,
    provider: MobilePaymentProvider,
    mode: 'API' | 'MANUAL',
  ) {
    await tx.$queryRaw`SELECT "provider" FROM "payment_provider_settings"
      WHERE "provider"::text = ${provider} FOR SHARE`;
    const setting = await tx.paymentProviderSetting.findUnique({
      where: { provider },
    });
    const effectiveMode =
      setting?.apiEnabled && this.simulationAvailable() ? 'API' : 'MANUAL';
    if (effectiveMode !== mode) {
      throw new ConflictException({
        message:
          effectiveMode === 'MANUAL'
            ? 'This provider uses manual payments. Pay externally and submit a claim for admin approval.'
            : 'This provider uses API payments. Enter your phone number and initiate payment.',
        provider,
        mode: effectiveMode,
      });
    }
  }
}
