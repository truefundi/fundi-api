import { BadRequestException, Injectable } from '@nestjs/common';
import { BroadcastRole, JobStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { DashboardRange, resolveDashboardRange } from './dashboard-period';
import {
  DashboardActivityQueryDto,
  DashboardInterval,
  DashboardQueryDto,
  DashboardTrendsQueryDto,
  TopTechniciansQueryDto,
} from './dto/dashboard-query.dto';

interface TrendRow {
  bucket: string;
  count: number;
  amount: number | null;
  average: number | null;
}

@Injectable()
export class AdminDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(query: DashboardQueryDto) {
    const range = resolveDashboardRange(query);
    const usersWhere = this.usersWhere(query, range);
    const newTechniciansWhere = this.techniciansWhere(query, range);
    const techniciansWhere = this.techniciansWhere(query);
    const jobsWhere = this.jobsWhere(query, range);
    const paymentsWhere = this.paymentsWhere(query, range);
    const disputesWhere = this.disputesWhere(query, range);
    const openDisputesWhere = this.disputesWhere(query);
    const messageWhere = this.messagesWhere(query, range);
    const ratingsWhere = this.ratingsWhere(query, range);

    const [
      users,
      newTechnicians,
      verificationStates,
      availabilityStates,
      jobs,
      completedJobs,
      payments,
      paymentStates,
      disputesOpened,
      openDisputes,
      messages,
      chatRooms,
      ratings,
      ratingScores,
      broadcasts,
      notifications,
      conversations,
      documents,
      cancellationRequests,
      offers,
      ads,
      activityEvents,
      verifiedPhones,
      currentVerifiedPhones,
      passkeysCreated,
      currentPasskeys,
      newCatalogCategories,
      currentCatalogCategories,
      newServices,
      currentServices,
    ] = await Promise.all([
      this.prisma.user.groupBy({
        by: ['role', 'status'],
        where: usersWhere,
        _count: { _all: true },
      }),
      this.prisma.technicianProfile.count({ where: newTechniciansWhere }),
      this.prisma.technicianProfile.groupBy({
        by: ['verificationStatus'],
        where: techniciansWhere,
        _count: { _all: true },
      }),
      this.prisma.technicianProfile.groupBy({
        by: ['availabilityStatus'],
        where: techniciansWhere,
        _count: { _all: true },
      }),
      this.prisma.job.groupBy({
        by: ['status', 'requestType'],
        where: jobsWhere,
        _count: { _all: true },
      }),
      this.completedJobsCount(query, range),
      this.prisma.bookingPayment.aggregate({
        where: paymentsWhere,
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.bookingPayment.groupBy({
        by: ['status', 'requestType'],
        where: paymentsWhere,
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.dispute.count({ where: disputesWhere }),
      this.prisma.dispute.count({
        where: { ...openDisputesWhere, resolvedAt: null },
      }),
      this.prisma.chatMessage.count({ where: messageWhere }),
      this.prisma.chatRoom.count({
        where: {
          createdAt: { gte: range.from, lt: range.to },
          ...(this.hasJobContextFilters(query)
            ? { job: this.jobContextFilters(query) }
            : {}),
        },
      }),
      this.prisma.jobRating.count({ where: ratingsWhere }),
      this.prisma.ratingResponse.aggregate({
        where: { jobRating: ratingsWhere },
        _avg: { score: true },
        _count: { _all: true },
      }),
      this.prisma.broadcast.aggregate({
        where: this.broadcastsWhere(query, range),
        _count: { _all: true },
        _sum: {
          userCount: true,
          smsSentCount: true,
          smsFailedCount: true,
          inAppSentCount: true,
        },
      }),
      this.prisma.notification.count({
        where: this.notificationsWhere(query, range),
      }),
      this.prisma.conversation.groupBy({
        by: ['status'],
        where: {
          startedAt: { gte: range.from, lt: range.to },
          ...(this.hasJobContextFilters(query)
            ? { job: this.jobContextFilters(query) }
            : {}),
        },
        _count: { _all: true },
      }),
      this.prisma.technicianDocument.groupBy({
        by: ['status'],
        where: {
          createdAt: { gte: range.from, lt: range.to },
          ...this.technicianDocumentFilters(query),
        },
        _count: { _all: true },
      }),
      this.prisma.jobCancellationRequest.groupBy({
        by: ['status', 'requester'],
        where: {
          createdAt: { gte: range.from, lt: range.to },
          ...(this.hasJobContextFilters(query)
            ? { job: this.jobContextFilters(query) }
            : {}),
        },
        _count: { _all: true },
      }),
      this.prisma.jobOffer.groupBy({
        by: ['status'],
        where: {
          createdAt: { gte: range.from, lt: range.to },
          ...(query.technicianId ? { technicianId: query.technicianId } : {}),
          ...(this.hasJobContextFilters(query)
            ? { job: this.jobContextFilters(query) }
            : {}),
        },
        _count: { _all: true },
      }),
      this.prisma.ad.aggregate({
        _count: { _all: true },
        _sum: { impressions: true, clicks: true },
      }),
      this.prisma.auditLog.count({
        where: { createdAt: { gte: range.from, lt: range.to } },
      }),
      this.prisma.user.count({
        where: {
          phoneVerifiedAt: { gte: range.from, lt: range.to },
          ...this.accountFilters(query),
        },
      }),
      this.prisma.user.count({
        where: {
          phoneVerifiedAt: { not: null },
          ...this.accountFilters(query),
        },
      }),
      this.prisma.passkeyCredential.count({
        where: {
          createdAt: { gte: range.from, lt: range.to },
          ...(query.customerId || query.userRole || query.userStatus
            ? {
                user: {
                  ...this.accountFilters(query),
                },
              }
            : {}),
        },
      }),
      this.prisma.passkeyCredential.count({
        where:
          query.customerId || query.userRole || query.userStatus
            ? { user: { ...this.accountFilters(query) } }
            : {},
      }),
      this.prisma.catalogCategory.groupBy({
        by: ['isActive'],
        where: { createdAt: { gte: range.from, lt: range.to } },
        _count: { _all: true },
      }),
      this.prisma.catalogCategory.groupBy({
        by: ['isActive'],
        _count: { _all: true },
      }),
      this.prisma.serviceCategory.groupBy({
        by: ['isActive'],
        where: {
          createdAt: { gte: range.from, lt: range.to },
          ...(query.serviceCategoryId ? { id: query.serviceCategoryId } : {}),
        },
        _count: { _all: true },
      }),
      this.prisma.serviceCategory.groupBy({
        by: ['isActive'],
        where: query.serviceCategoryId
          ? { id: query.serviceCategoryId }
          : undefined,
        _count: { _all: true },
      }),
    ]);

    const userCounts = this.countRows(users, ['role', 'status']);
    const userCount = userCounts.reduce((sum, row) => sum + row.count, 0);
    const adsImpressions = ads._sum.impressions ?? 0;
    const adsClicks = ads._sum.clicks ?? 0;
    const createdJobCount = jobs.reduce((sum, row) => sum + row._count._all, 0);
    const averageRating = this.round(ratingScores._avg.score);
    const comparison = query.compare
      ? await this.comparePeriod(query, range, {
          newAccounts: userCount,
          jobsCreated: createdJobCount,
          jobsCompleted: completedJobs,
          bookingAmount: payments._sum.amount ?? 0,
          disputesOpened,
          ratingsSubmitted: ratings,
          averageRating,
        })
      : undefined;
    return {
      range: this.rangeResponse(range),
      filters: this.filtersResponse(query),
      generatedAt: new Date().toISOString(),
      ...(comparison ? { comparison } : {}),
      users: {
        newAccounts: userCount,
        byRoleAndStatus: userCounts,
        phonesVerifiedInPeriod: verifiedPhones,
        currentlyPhoneVerified: currentVerifiedPhones,
        passkeysRegisteredInPeriod: passkeysCreated,
        accountsWithPasskeys: currentPasskeys,
      },
      technicians: {
        newProfiles: newTechnicians,
        currentByVerificationStatus: this.countRows(verificationStates),
        currentByAvailability: this.countRows(availabilityStates),
      },
      jobs: {
        created: createdJobCount,
        completedInPeriod: completedJobs,
        createdByStatusAndRequestType: jobs.map((row) => ({
          status: row.status,
          requestType: row.requestType,
          count: row._count._all,
        })),
      },
      payments: {
        count: payments._count._all,
        bookingAmount: payments._sum.amount ?? 0,
        byStatusAndRequestType: paymentStates.map((row) => ({
          status: row.status,
          requestType: row.requestType,
          count: row._count._all,
          amount: row._sum.amount ?? 0,
        })),
      },
      disputes: { opened: disputesOpened, currentlyUnresolved: openDisputes },
      chat: { messages: messages, roomsCreated: chatRooms },
      ratings: {
        count: ratings,
        responseCount: ratingScores._count._all,
        averageScore: averageRating,
      },
      broadcasts: {
        sent: broadcasts._count._all,
        recipients: broadcasts._sum.userCount ?? 0,
        smsSent: broadcasts._sum.smsSentCount ?? 0,
        smsFailed: broadcasts._sum.smsFailedCount ?? 0,
        inAppSent: broadcasts._sum.inAppSentCount ?? 0,
      },
      notificationsCreated: notifications,
      conversations: this.countRows(conversations),
      technicianDocuments: this.countRows(documents),
      cancellationRequests: cancellationRequests.map((row) => ({
        status: row.status,
        requester: row.requester,
        count: row._count._all,
      })),
      jobOffers: this.countRows(offers),
      advertisements: {
        lifetimeCount: ads._count._all,
        lifetimeImpressions: adsImpressions,
        lifetimeClicks: adsClicks,
        clickThroughRate:
          adsImpressions === 0
            ? null
            : Number(((adsClicks / adsImpressions) * 100).toFixed(2)),
        note: 'Ad impression and click counters are lifetime totals, not period-attributed events.',
      },
      catalog: {
        newCategories: this.countRows(newCatalogCategories, ['isActive']),
        newServices: this.countRows(newServices, ['isActive']),
        currentCategories: this.countRows(currentCatalogCategories, [
          'isActive',
        ]),
        currentServices: this.countRows(currentServices, ['isActive']),
      },
      auditEvents: activityEvents,
    };
  }

  async trends(query: DashboardTrendsQueryDto) {
    const range = resolveDashboardRange(query);
    const interval = query.interval ?? this.defaultInterval(range);
    const dateTrunc = Prisma.sql`${interval}::text`;
    const timezone = range.timezone;
    const column = (dateColumn: string, alias?: string) =>
      Prisma.raw(`${alias ? `"${alias}".` : ''}"${dateColumn}"`);
    const common = (
      dateColumn: string,
      conditions: Prisma.Sql[] = [],
      alias?: string,
    ) =>
      Prisma.sql`WHERE ${column(dateColumn, alias)} >= ${range.from}
        AND ${column(dateColumn, alias)} < ${range.to}
        ${conditions.length ? Prisma.sql`AND ${Prisma.join(conditions, ' AND ')}` : Prisma.empty}`;
    const bucket = (dateColumn: string, alias?: string) =>
      Prisma.sql`to_char(date_trunc(${dateTrunc}, (${column(dateColumn, alias)} AT TIME ZONE ${timezone})), 'YYYY-MM-DD"T"HH24:MI:SS')`;

    const [
      users,
      jobs,
      completions,
      payments,
      disputes,
      messages,
      ratings,
      catalogCategories,
      services,
    ] = await Promise.all([
      this.prisma.$queryRaw<TrendRow[]>`
          SELECT ${bucket('createdAt')} AS bucket, COUNT(*)::int AS count,
            NULL::double precision AS amount, NULL::double precision AS average
          FROM "users" ${common('createdAt', [
            Prisma.sql`"role" IN ('CUSTOMER', 'TECHNICIAN')`,
            ...(query.customerId
              ? [Prisma.sql`"id" = ${query.customerId}`]
              : []),
            ...(query.userRole
              ? [Prisma.sql`"role"::text = ${query.userRole}`]
              : []),
            ...(query.userStatus
              ? [Prisma.sql`"status"::text = ${query.userStatus}`]
              : []),
          ])}
          GROUP BY 1 ORDER BY 1`,
      this.prisma.$queryRaw<TrendRow[]>`
          SELECT ${bucket('createdAt')} AS bucket, COUNT(*)::int AS count,
            NULL::double precision AS amount, NULL::double precision AS average
          FROM "jobs" ${common('createdAt', this.jobSqlFilters(query))}
          GROUP BY 1 ORDER BY 1`,
      this.prisma.$queryRaw<TrendRow[]>`
          SELECT ${bucket('completedAt')} AS bucket, COUNT(*)::int AS count,
            NULL::double precision AS amount, NULL::double precision AS average
          FROM "jobs" ${common('completedAt', [
            Prisma.sql`"status" = 'COMPLETED'`,
            ...this.jobSqlFilters(query),
          ])}
          GROUP BY 1 ORDER BY 1`,
      this.prisma.$queryRaw<TrendRow[]>`
          SELECT ${bucket('paidAt')} AS bucket, COUNT(*)::int AS count,
            COALESCE(SUM("amount"), 0)::double precision AS amount,
            NULL::double precision AS average
          FROM "booking_payments" bp LEFT JOIN "jobs" j ON j."id" = bp."jobId"
            ${common('paidAt', this.paymentSqlFilters(query, 'bp'), 'bp')}
          GROUP BY 1 ORDER BY 1`,
      this.prisma.$queryRaw<TrendRow[]>`
            SELECT ${bucket('openedAt', 'd')} AS bucket, COUNT(*)::int AS count,
            NULL::double precision AS amount, NULL::double precision AS average
          FROM "disputes" d JOIN "jobs" j ON j."id" = d."jobId"
            ${common('openedAt', this.jobSqlFilters(query, 'j'), 'd')}
          GROUP BY 1 ORDER BY 1`,
      this.prisma.$queryRaw<TrendRow[]>`
            SELECT ${bucket('createdAt', 'm')} AS bucket, COUNT(*)::int AS count,
            NULL::double precision AS amount, NULL::double precision AS average
          FROM "chat_messages" m JOIN "chat_rooms" cr ON cr."id" = m."roomId"
          JOIN "jobs" j ON j."id" = cr."jobId"
            ${common(
              'createdAt',
              [
                ...this.jobSqlFilters(query, 'j'),
                ...(query.chatMessageType
                  ? [Prisma.sql`m."type"::text = ${query.chatMessageType}`]
                  : []),
              ],
              'm',
            )}
          GROUP BY 1 ORDER BY 1`,
      this.prisma.$queryRaw<TrendRow[]>`
            SELECT ${bucket('submittedAt', 'jr')} AS bucket, COUNT(DISTINCT jr."id")::int AS count,
            NULL::double precision AS amount, AVG(rr."score")::double precision AS average
          FROM "job_ratings" jr LEFT JOIN "rating_responses" rr
            ON rr."jobRatingId" = jr."id"
          JOIN "jobs" j ON j."id" = jr."jobId"
            ${common('submittedAt', this.jobSqlFilters(query, 'j'), 'jr')}
          GROUP BY 1 ORDER BY 1`,
      this.prisma.$queryRaw<TrendRow[]>`
          SELECT ${bucket('createdAt')} AS bucket, COUNT(*)::int AS count,
            NULL::double precision AS amount, NULL::double precision AS average
          FROM "catalog_categories" ${common('createdAt')}
          GROUP BY 1 ORDER BY 1`,
      this.prisma.$queryRaw<TrendRow[]>`
          SELECT ${bucket('createdAt')} AS bucket, COUNT(*)::int AS count,
            NULL::double precision AS amount, NULL::double precision AS average
          FROM "service_categories" ${common('createdAt', [
            ...(query.serviceCategoryId
              ? [Prisma.sql`"id" = ${query.serviceCategoryId}`]
              : []),
          ])}
          GROUP BY 1 ORDER BY 1`,
    ]);

    const series = [
      this.series('users', 'new', users),
      this.series('jobs', 'created', jobs),
      this.series('jobs', 'completed', completions),
      this.series('payments', 'count', payments),
      this.series('payments', 'bookingAmount', payments, 'amount'),
      this.series('disputes', 'opened', disputes),
      this.series('chat', 'messages', messages),
      this.series('ratings', 'submitted', ratings),
      this.series('ratings', 'averageScore', ratings, 'average'),
      this.series('catalog', 'categoriesCreated', catalogCategories),
      this.series('catalog', 'servicesCreated', services),
    ];
    return {
      range: this.rangeResponse(range),
      filters: this.filtersResponse(query),
      interval,
      generatedAt: new Date().toISOString(),
      series,
    };
  }

  async breakdowns(query: DashboardQueryDto) {
    const range = resolveDashboardRange(query);
    const [
      users,
      technicianVerifications,
      technicianAvailability,
      jobs,
      jobsByCategory,
      catalogCategories,
      servicesByCatalogCategory,
      payments,
      disputes,
      messages,
      rooms,
      conversations,
      offers,
      ratingsByItem,
      documents,
      ads,
      broadcasts,
      notifications,
      cancellationRequests,
    ] = await Promise.all([
      this.prisma.user.groupBy({
        by: ['role', 'status'],
        where: this.usersWhere(query, range),
        _count: { _all: true },
      }),
      this.prisma.technicianProfile.groupBy({
        by: ['verificationStatus'],
        where: this.techniciansWhere(query),
        _count: { _all: true },
      }),
      this.prisma.technicianProfile.groupBy({
        by: ['availabilityStatus'],
        where: this.techniciansWhere(query),
        _count: { _all: true },
      }),
      this.prisma.job.groupBy({
        by: ['status', 'requestType', 'priority'],
        where: this.jobsWhere(query, range),
        _count: { _all: true },
      }),
      this.prisma.job.groupBy({
        by: ['serviceCategoryId'],
        where: {
          ...this.jobsWhere(query, range),
          serviceCategoryId: { not: null },
        },
        _count: { _all: true },
      }),
      this.prisma.catalogCategory.groupBy({
        by: ['isActive'],
        where: { createdAt: { gte: range.from, lt: range.to } },
        _count: { _all: true },
      }),
      this.prisma.serviceCategory.groupBy({
        by: ['categoryId', 'isActive'],
        where: {
          createdAt: { gte: range.from, lt: range.to },
          ...(query.serviceCategoryId ? { id: query.serviceCategoryId } : {}),
        },
        _count: { _all: true },
      }),
      this.prisma.bookingPayment.groupBy({
        by: ['status', 'requestType'],
        where: this.paymentsWhere(query, range),
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.dispute.groupBy({
        by: ['openedBy', 'outcome'],
        where: this.disputesWhere(query, range),
        _count: { _all: true },
      }),
      this.prisma.chatMessage.groupBy({
        by: ['senderRole', 'type'],
        where: this.messagesWhere(query, range),
        _count: { _all: true },
      }),
      this.prisma.chatRoom.groupBy({
        by: ['status'],
        where: {
          createdAt: { gte: range.from, lt: range.to },
          ...(this.hasJobContextFilters(query)
            ? { job: this.jobContextFilters(query) }
            : {}),
        },
        _count: { _all: true },
      }),
      this.prisma.conversation.groupBy({
        by: ['status'],
        where: {
          startedAt: { gte: range.from, lt: range.to },
          ...(this.hasJobContextFilters(query)
            ? { job: this.jobContextFilters(query) }
            : {}),
        },
        _count: { _all: true },
      }),
      this.prisma.jobOffer.groupBy({
        by: ['status'],
        where: {
          createdAt: { gte: range.from, lt: range.to },
          ...(query.technicianId ? { technicianId: query.technicianId } : {}),
          ...(this.hasJobContextFilters(query)
            ? { job: this.jobContextFilters(query) }
            : {}),
        },
        _count: { _all: true },
      }),
      this.prisma.ratingResponse.groupBy({
        by: ['itemNameSnapshot'],
        where: {
          jobRating: {
            ...this.ratingsWhere(query, range),
          },
        },
        _avg: { score: true },
        _count: { _all: true },
        orderBy: { itemNameSnapshot: 'asc' },
      }),
      this.prisma.technicianDocument.groupBy({
        by: ['status', 'type'],
        where: {
          createdAt: { gte: range.from, lt: range.to },
          ...this.technicianDocumentFilters(query),
        },
        _count: { _all: true },
      }),
      this.prisma.ad.groupBy({
        by: ['placement', 'audience', 'isActive'],
        _count: { _all: true },
        _sum: { impressions: true, clicks: true },
      }),
      this.prisma.broadcast.groupBy({
        by: ['status'],
        where: this.broadcastsWhere(query, range),
        _count: { _all: true },
        _sum: { userCount: true, smsSentCount: true, smsFailedCount: true },
      }),
      this.prisma.notification.groupBy({
        by: ['type'],
        where: this.notificationsWhere(query, range),
        _count: { _all: true },
      }),
      this.prisma.jobCancellationRequest.groupBy({
        by: ['status', 'requester'],
        where: {
          createdAt: { gte: range.from, lt: range.to },
          ...(this.hasJobContextFilters(query)
            ? { job: this.jobContextFilters(query) }
            : {}),
        },
        _count: { _all: true },
      }),
    ]);
    const categoryIds = jobsByCategory
      .map((row) => row.serviceCategoryId)
      .filter((id): id is string => id !== null);
    const catalogCategoryIds = [
      ...new Set(servicesByCatalogCategory.map((row) => row.categoryId)),
    ];
    const [categories, catalogCategoriesById] = await Promise.all([
      categoryIds.length
        ? this.prisma.serviceCategory.findMany({
            where: { id: { in: categoryIds } },
            select: {
              id: true,
              name: true,
              category: { select: { id: true, name: true } },
            },
          })
        : [],
      catalogCategoryIds.length
        ? this.prisma.catalogCategory.findMany({
            where: { id: { in: catalogCategoryIds } },
            select: { id: true, name: true, description: true },
          })
        : [],
    ]);
    const categoryById = new Map(
      categories.map((category) => [category.id, category]),
    );
    const catalogCategoryById = new Map(
      catalogCategoriesById.map((category) => [category.id, category]),
    );

    return {
      range: this.rangeResponse(range),
      filters: this.filtersResponse(query),
      generatedAt: new Date().toISOString(),
      users: this.countRows(users, ['role', 'status']),
      technicians: {
        verificationStatus: this.countRows(technicianVerifications, [
          'verificationStatus',
        ]),
        availabilityStatus: this.countRows(technicianAvailability, [
          'availabilityStatus',
        ]),
      },
      jobs: {
        statusRequestTypePriority: jobs.map((row) => ({
          status: row.status,
          requestType: row.requestType,
          priority: row.priority,
          count: row._count._all,
        })),
        serviceCategories: jobsByCategory.map((row) => ({
          serviceCategory: row.serviceCategoryId
            ? (categoryById.get(row.serviceCategoryId) ?? null)
            : null,
          count: row._count._all,
        })),
      },
      catalog: {
        categoriesByStatus: this.countRows(catalogCategories, ['isActive']),
        servicesByCategoryAndStatus: servicesByCatalogCategory.map((row) => ({
          category: catalogCategoryById.get(row.categoryId) ?? {
            id: row.categoryId,
            name: null,
            description: null,
          },
          isActive: row.isActive,
          count: row._count._all,
        })),
      },
      payments: payments.map((row) => ({
        status: row.status,
        requestType: row.requestType,
        count: row._count._all,
        amount: row._sum.amount ?? 0,
      })),
      disputes: this.countRows(disputes, ['openedBy', 'outcome']),
      chat: {
        messages: this.countRows(messages, ['senderRole', 'type']),
        rooms: this.countRows(rooms),
      },
      conversations: this.countRows(conversations),
      jobOffers: this.countRows(offers),
      ratingsByItem: ratingsByItem.map((row) => ({
        item: row.itemNameSnapshot,
        averageScore: this.round(row._avg.score),
        responseCount: row._count._all,
      })),
      technicianDocuments: this.countRows(documents, ['status', 'type']),
      advertisements: ads.map((row) => ({
        placement: row.placement,
        audience: row.audience,
        isActive: row.isActive,
        count: row._count._all,
        impressions: row._sum.impressions ?? 0,
        clicks: row._sum.clicks ?? 0,
      })),
      broadcasts: broadcasts.map((row) => ({
        status: row.status,
        count: row._count._all,
        recipients: row._sum.userCount ?? 0,
        smsSent: row._sum.smsSentCount ?? 0,
        smsFailed: row._sum.smsFailedCount ?? 0,
      })),
      notifications: this.countRows(notifications, ['type']),
      cancellationRequests: this.countRows(cancellationRequests, [
        'status',
        'requester',
      ]),
    };
  }

  async topTechnicians(query: TopTechniciansQueryDto) {
    const range = resolveDashboardRange(query);
    const limit = query.limit ?? 10;
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        fullName: string;
        verificationStatus: string;
        availabilityStatus: string;
        completedJobs: number;
        ratingCount: number;
        averageRating: number | null;
      }>
    >`
      WITH completed AS (
        SELECT j."technicianId", COUNT(*)::int AS "completedJobs"
        FROM "jobs" j
        WHERE j."status" = 'COMPLETED'
          AND j."completedAt" >= ${range.from}
          AND j."completedAt" < ${range.to}
          AND (${query.serviceCategoryId ?? null}::text IS NULL OR j."serviceCategoryId" = ${query.serviceCategoryId ?? null})
          AND (${query.customerId ?? null}::text IS NULL OR j."customerId" = ${query.customerId ?? null})
          AND (${query.requestType ?? null}::text IS NULL OR j."requestType"::text = ${query.requestType ?? null})
          AND (${query.jobStatus ?? null}::text IS NULL OR j."status"::text = ${query.jobStatus ?? null})
        GROUP BY j."technicianId"
      ),
      rating_summary AS (
        SELECT jr."technicianId", COUNT(DISTINCT jr."id")::int AS "ratingCount",
          AVG(rr."score")::double precision AS "averageRating"
        FROM "job_ratings" jr
        LEFT JOIN "rating_responses" rr ON rr."jobRatingId" = jr."id"
        JOIN "jobs" j ON j."id" = jr."jobId"
        WHERE jr."submittedAt" >= ${range.from}
          AND jr."submittedAt" < ${range.to}
          AND (${query.serviceCategoryId ?? null}::text IS NULL OR j."serviceCategoryId" = ${query.serviceCategoryId ?? null})
          AND (${query.customerId ?? null}::text IS NULL OR j."customerId" = ${query.customerId ?? null})
          AND (${query.requestType ?? null}::text IS NULL OR j."requestType"::text = ${query.requestType ?? null})
        GROUP BY jr."technicianId"
      )
      SELECT tp."id", u."fullName", tp."verificationStatus"::text AS "verificationStatus",
        tp."availabilityStatus"::text AS "availabilityStatus",
        COALESCE(c."completedJobs", 0)::int AS "completedJobs",
        COALESCE(r."ratingCount", 0)::int AS "ratingCount",
        r."averageRating"
      FROM "technician_profiles" tp
      JOIN "users" u ON u."id" = tp."userId"
      LEFT JOIN completed c ON c."technicianId" = tp."id"
      LEFT JOIN rating_summary r ON r."technicianId" = tp."id"
      WHERE (${query.technicianId ?? null}::text IS NULL OR tp."id" = ${query.technicianId ?? null})
        AND (${query.technicianVerificationStatus ?? null}::text IS NULL OR tp."verificationStatus"::text = ${query.technicianVerificationStatus ?? null})
        AND (${query.technicianAvailability ?? null}::text IS NULL OR tp."availabilityStatus"::text = ${query.technicianAvailability ?? null})
        AND (${query.userStatus ?? null}::text IS NULL OR u."status"::text = ${query.userStatus ?? null})
        AND (${query.userRole ?? null}::text IS NULL OR ${query.userRole ?? null}::text = 'TECHNICIAN')
        AND COALESCE(c."completedJobs", 0) > 0
      ORDER BY "completedJobs" DESC, "averageRating" DESC NULLS LAST, tp."id"
      LIMIT ${limit}`;
    return {
      range: this.rangeResponse(range),
      filters: this.filtersResponse(query),
      generatedAt: new Date().toISOString(),
      data: rows.map((row, index) => ({
        rank: index + 1,
        technicianId: row.id,
        fullName: row.fullName,
        verificationStatus: row.verificationStatus,
        availabilityStatus: row.availabilityStatus,
        completedJobs: row.completedJobs,
        ratingCount: row.ratingCount,
        averageRating: this.round(row.averageRating),
      })),
    };
  }

  async activity(query: DashboardActivityQueryDto) {
    const range = resolveDashboardRange(query);
    const where: Prisma.AuditLogWhereInput = {
      createdAt: { gte: range.from, lt: range.to },
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
    };
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    const [logs, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        skip: offset,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    const actorIds = [
      ...new Set(logs.map((row) => row.actorId).filter(Boolean)),
    ] as string[];
    const actors = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, fullName: true, role: true },
        })
      : [];
    const actorById = new Map(actors.map((actor) => [actor.id, actor]));
    return {
      range: this.rangeResponse(range),
      filters: this.filtersResponse(query),
      data: logs.map((row) => ({
        id: row.id,
        entityType: row.entityType,
        entityId: row.entityId,
        action: row.action,
        fromStatus: row.fromStatus,
        toStatus: row.toStatus,
        actor: row.actorId ? (actorById.get(row.actorId) ?? null) : null,
        metadata: row.metadata,
        createdAt: row.createdAt,
      })),
      pagination: {
        limit,
        offset,
        total,
        hasMore: offset + logs.length < total,
      },
    };
  }

  private async comparePeriod(
    query: DashboardQueryDto,
    range: DashboardRange,
    current: Record<string, number | null>,
  ) {
    const duration = range.to.getTime() - range.from.getTime();
    const previousRange: DashboardRange = {
      ...range,
      from: new Date(range.from.getTime() - duration),
      to: range.from,
    };
    const [
      previousUsers,
      previousJobs,
      previousCompletions,
      previousPayments,
      previousDisputes,
      previousRatings,
      previousRatingScores,
    ] = await Promise.all([
      this.prisma.user.count({ where: this.usersWhere(query, previousRange) }),
      this.prisma.job.count({ where: this.jobsWhere(query, previousRange) }),
      this.completedJobsCount(query, previousRange),
      this.prisma.bookingPayment.aggregate({
        where: this.paymentsWhere(query, previousRange),
        _sum: { amount: true },
      }),
      this.prisma.dispute.count({
        where: this.disputesWhere(query, previousRange),
      }),
      this.prisma.jobRating.count({
        where: this.ratingsWhere(query, previousRange),
      }),
      this.prisma.ratingResponse.aggregate({
        where: { jobRating: this.ratingsWhere(query, previousRange) },
        _avg: { score: true },
      }),
    ]);
    const previous = {
      newAccounts: previousUsers,
      jobsCreated: previousJobs,
      jobsCompleted: previousCompletions,
      bookingAmount: previousPayments._sum.amount ?? 0,
      disputesOpened: previousDisputes,
      ratingsSubmitted: previousRatings,
      averageRating: this.round(previousRatingScores._avg.score),
    };
    const metrics = Object.fromEntries(
      Object.entries(current).map(([key, value]) => {
        const previousValue = previous[key as keyof typeof previous];
        const change =
          value === null || previousValue == null
            ? null
            : value - previousValue;
        return [
          key,
          {
            current: value,
            previous: previousValue,
            change,
            changePercent:
              change === null || previousValue == null || previousValue === 0
                ? null
                : Number(((change / previousValue) * 100).toFixed(2)),
          },
        ];
      }),
    );
    return {
      period: this.rangeResponse(previousRange),
      metrics,
      note: 'Change percentages are null when the previous period is zero or an average is unavailable.',
    };
  }

  activityEvents(lastEventId?: string) {
    const now = new Date();
    if (!lastEventId) {
      return { createdAt: now, id: '' };
    }
    try {
      const cursor = JSON.parse(
        Buffer.from(lastEventId, 'base64url').toString('utf8'),
      ) as { createdAt?: string; id?: string };
      const createdAt = new Date(cursor.createdAt ?? '');
      if (!Number.isFinite(createdAt.getTime()) || !cursor.id) {
        throw new Error('Invalid event cursor.');
      }
      return { createdAt, id: cursor.id };
    } catch {
      throw new BadRequestException('Last-Event-ID is invalid.');
    }
  }

  async activityAfter(cursor: { createdAt: Date; id: string }) {
    const logs = await this.prisma.auditLog.findMany({
      where: {
        OR: [
          { createdAt: { gt: cursor.createdAt } },
          ...(cursor.id
            ? [{ createdAt: cursor.createdAt, id: { gt: cursor.id } }]
            : []),
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 100,
    });
    const actorIds = [
      ...new Set(logs.map((row) => row.actorId).filter(Boolean)),
    ] as string[];
    const actors = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, fullName: true, role: true },
        })
      : [];
    const actorById = new Map(actors.map((actor) => [actor.id, actor]));
    return logs.map((row) => ({
      id: row.id,
      entityType: row.entityType,
      entityId: row.entityId,
      action: row.action,
      fromStatus: row.fromStatus,
      toStatus: row.toStatus,
      actor: row.actorId ? (actorById.get(row.actorId) ?? null) : null,
      metadata: row.metadata,
      createdAt: row.createdAt,
    }));
  }

  private usersWhere(
    query: DashboardQueryDto,
    range: DashboardRange,
  ): Prisma.UserWhereInput {
    return {
      ...this.accountFilters(query),
      createdAt: { gte: range.from, lt: range.to },
    };
  }

  private accountFilters(query: DashboardQueryDto): Prisma.UserWhereInput {
    const role = query.userRole
      ? query.userRole
      : { in: [UserRole.CUSTOMER, UserRole.TECHNICIAN] };
    return {
      role,
      ...(query.customerId ? { id: query.customerId } : {}),
      ...(query.userStatus ? { status: query.userStatus } : {}),
    };
  }

  private techniciansWhere(query: DashboardQueryDto, range?: DashboardRange) {
    return {
      ...(range ? { createdAt: { gte: range.from, lt: range.to } } : {}),
      ...(query.technicianId ? { id: query.technicianId } : {}),
      ...(query.technicianVerificationStatus
        ? { verificationStatus: query.technicianVerificationStatus }
        : {}),
      ...(query.technicianAvailability
        ? { availabilityStatus: query.technicianAvailability }
        : {}),
      ...(query.userStatus ? { user: { status: query.userStatus } } : {}),
      ...(query.userRole === 'CUSTOMER' || query.userRole === 'ADMIN'
        ? { id: '__no_technician__' }
        : {}),
    };
  }

  private technicianDocumentFilters(
    query: DashboardQueryDto,
  ): Prisma.TechnicianDocumentWhereInput {
    return {
      ...(query.technicianId ? { technicianId: query.technicianId } : {}),
      ...(query.technicianVerificationStatus || query.technicianAvailability
        ? {
            technician: {
              ...(query.technicianVerificationStatus
                ? { verificationStatus: query.technicianVerificationStatus }
                : {}),
              ...(query.technicianAvailability
                ? { availabilityStatus: query.technicianAvailability }
                : {}),
            },
          }
        : {}),
    };
  }

  private broadcastsWhere(
    query: DashboardQueryDto,
    range: DashboardRange,
  ): Prisma.BroadcastWhereInput {
    const role =
      query.userRole === UserRole.CUSTOMER
        ? BroadcastRole.CUSTOMER
        : query.userRole === UserRole.TECHNICIAN
          ? BroadcastRole.TECHNICIAN
          : undefined;
    return {
      sentAt: { gte: range.from, lt: range.to },
      ...(role
        ? {
            OR: [{ roles: { isEmpty: true } }, { roles: { has: role } }],
          }
        : query.userRole === UserRole.ADMIN
          ? { id: '__no_broadcast__' }
          : {}),
    };
  }

  private notificationsWhere(
    query: DashboardQueryDto,
    range: DashboardRange,
  ): Prisma.NotificationWhereInput {
    return {
      createdAt: { gte: range.from, lt: range.to },
      ...(query.customerId ? { userId: query.customerId } : {}),
      ...(query.userRole || query.userStatus
        ? {
            user: {
              ...(query.userRole ? { role: query.userRole } : {}),
              ...(query.userStatus ? { status: query.userStatus } : {}),
            },
          }
        : {}),
    };
  }

  private jobsWhere(
    query: DashboardQueryDto,
    range: DashboardRange,
    dateField: 'createdAt' | 'completedAt' = 'createdAt',
  ) {
    return {
      [dateField]: { gte: range.from, lt: range.to },
      ...this.jobContextFilters(query),
    };
  }

  private completedJobsCount(query: DashboardQueryDto, range: DashboardRange) {
    if (query.jobStatus && query.jobStatus !== JobStatus.COMPLETED) {
      return Promise.resolve(0);
    }
    return this.prisma.job.count({
      where: {
        ...this.jobsWhere(query, range, 'completedAt'),
        status: JobStatus.COMPLETED,
      },
    });
  }

  private jobContextFilters(query: DashboardQueryDto): Prisma.JobWhereInput {
    return {
      ...(query.jobStatus ? { status: query.jobStatus } : {}),
      ...(query.requestType ? { requestType: query.requestType } : {}),
      ...(query.serviceCategoryId
        ? { serviceCategoryId: query.serviceCategoryId }
        : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.technicianId ? { technicianId: query.technicianId } : {}),
    };
  }

  private hasJobContextFilters(query: DashboardQueryDto): boolean {
    return Boolean(
      query.jobStatus ||
      query.requestType ||
      query.serviceCategoryId ||
      query.customerId ||
      query.technicianId,
    );
  }

  private paymentsWhere(query: DashboardQueryDto, range: DashboardRange) {
    return {
      paidAt: { gte: range.from, lt: range.to },
      ...(query.paymentStatus ? { status: query.paymentStatus } : {}),
      ...(query.requestType ? { requestType: query.requestType } : {}),
      ...(query.serviceCategoryId
        ? { serviceCategoryId: query.serviceCategoryId }
        : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.technicianId || query.jobStatus
        ? {
            job: {
              ...(query.technicianId
                ? { technicianId: query.technicianId }
                : {}),
              ...(query.jobStatus ? { status: query.jobStatus } : {}),
            },
          }
        : {}),
    };
  }

  private disputesWhere(query: DashboardQueryDto, range?: DashboardRange) {
    return {
      ...(range ? { openedAt: { gte: range.from, lt: range.to } } : {}),
      ...(this.hasJobContextFilters(query)
        ? { job: this.jobContextFilters(query) }
        : {}),
    };
  }

  private messagesWhere(query: DashboardQueryDto, range: DashboardRange) {
    return {
      createdAt: { gte: range.from, lt: range.to },
      ...(query.chatMessageType ? { type: query.chatMessageType } : {}),
      ...(this.hasJobContextFilters(query)
        ? { room: { job: this.jobContextFilters(query) } }
        : {}),
    };
  }

  private ratingsWhere(query: DashboardQueryDto, range: DashboardRange) {
    return {
      submittedAt: { gte: range.from, lt: range.to },
      ...(query.technicianId ? { technicianId: query.technicianId } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(this.hasJobContextFilters(query)
        ? { job: this.jobContextFilters(query) }
        : {}),
    };
  }

  private jobSqlFilters(query: DashboardQueryDto, jobAlias = ''): Prisma.Sql[] {
    const j = jobAlias ? `${jobAlias}.` : '';
    return [
      ...(query.serviceCategoryId
        ? [
            Prisma.sql`${Prisma.raw(`${j}"serviceCategoryId"`)} = ${query.serviceCategoryId}`,
          ]
        : []),
      ...(query.customerId
        ? [Prisma.sql`${Prisma.raw(`${j}"customerId"`)} = ${query.customerId}`]
        : []),
      ...(query.technicianId
        ? [
            Prisma.sql`${Prisma.raw(`${j}"technicianId"`)} = ${query.technicianId}`,
          ]
        : []),
      ...(query.requestType
        ? [
            Prisma.sql`${Prisma.raw(`${j}"requestType"`)}::text = ${query.requestType}`,
          ]
        : []),
      ...(query.jobStatus
        ? [Prisma.sql`${Prisma.raw(`${j}"status"`)}::text = ${query.jobStatus}`]
        : []),
    ];
  }

  private paymentSqlFilters(
    query: DashboardQueryDto,
    paymentAlias = '',
  ): Prisma.Sql[] {
    const p = paymentAlias ? `${paymentAlias}.` : '';
    return [
      ...(query.serviceCategoryId
        ? [
            Prisma.sql`${Prisma.raw(`${p}"serviceCategoryId"`)} = ${query.serviceCategoryId}`,
          ]
        : []),
      ...(query.customerId
        ? [Prisma.sql`${Prisma.raw(`${p}"customerId"`)} = ${query.customerId}`]
        : []),
      ...(query.requestType
        ? [
            Prisma.sql`${Prisma.raw(`${p}"requestType"`)}::text = ${query.requestType}`,
          ]
        : []),
      ...(query.paymentStatus
        ? [
            Prisma.sql`${Prisma.raw(`${p}"status"`)}::text = ${query.paymentStatus}`,
          ]
        : []),
      ...(query.technicianId
        ? [Prisma.sql`j."technicianId" = ${query.technicianId}`]
        : []),
      ...(query.jobStatus
        ? [Prisma.sql`j."status"::text = ${query.jobStatus}`]
        : []),
    ];
  }

  private series(
    domain: string,
    metric: string,
    rows: TrendRow[],
    value: 'count' | 'amount' | 'average' = 'count',
  ) {
    return {
      domain,
      metric,
      data: rows.map((row) => ({
        bucket: row.bucket,
        value:
          value === 'count'
            ? row.count
            : this.round(value === 'amount' ? row.amount : row.average),
      })),
    };
  }

  private countRows<T extends { _count?: true | { _all?: number } }>(
    rows: T[],
    dimensions: Array<keyof T> = [],
  ) {
    return rows.map((row) => ({
      ...Object.fromEntries(
        dimensions.map((dimension) => [String(dimension), row[dimension]]),
      ),
      count: row._count && row._count !== true ? (row._count._all ?? 0) : 0,
    }));
  }

  private rangeResponse(range: DashboardRange) {
    return {
      period: range.period,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      toExclusive: true,
      timezone: range.timezone,
    };
  }

  private filtersResponse(query: DashboardQueryDto) {
    return {
      serviceCategoryId: query.serviceCategoryId ?? null,
      customerId: query.customerId ?? null,
      technicianId: query.technicianId ?? null,
      requestType: query.requestType ?? null,
      jobStatus: query.jobStatus ?? null,
      userRole: query.userRole ?? null,
      userStatus: query.userStatus ?? null,
      technicianVerificationStatus: query.technicianVerificationStatus ?? null,
      technicianAvailability: query.technicianAvailability ?? null,
      paymentStatus: query.paymentStatus ?? null,
      chatMessageType: query.chatMessageType ?? null,
    };
  }

  private defaultInterval(range: DashboardRange): DashboardInterval {
    const days = (range.to.getTime() - range.from.getTime()) / 86_400_000;
    if (days <= 2) return DashboardInterval.HOUR;
    if (days <= 62) return DashboardInterval.DAY;
    if (days <= 500) return DashboardInterval.WEEK;
    return DashboardInterval.MONTH;
  }

  private round(value: number | null) {
    return value === null ? null : Number(value.toFixed(2));
  }
}
