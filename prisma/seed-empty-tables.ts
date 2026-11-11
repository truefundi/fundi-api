import {
  AdAudience,
  AdBadge,
  AdPlacement,
  BookingPaymentStatus,
  BroadcastChannel,
  BroadcastRole,
  BroadcastStatus,
  CancellationRequester,
  CancellationRequestStatus,
  ChatMessageType,
  ChatSenderRole,
  DisputeOpenedBy,
  JobStatus,
  JobRequestType,
  PrismaClient,
  UserRole,
} from '@prisma/client';
import { ConfigModule } from '@nestjs/config';
import { createHash, createHmac } from 'crypto';

ConfigModule.forRoot();

const prisma = new PrismaClient();
const now = new Date();

function detId(...parts: Array<string | number>): string {
  const hash = createHash('sha256').update(parts.join('|')).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

async function seedAds(adminId: string | null) {
  const ads = [
    {
      id: detId('empty-table-seed', 'ad', 'landing'),
      title: 'Find trusted home services',
      description: 'Book a local professional for repairs and maintenance.',
      imageAlt: 'Home services available on Fundi',
      callToAction: 'Explore services',
      badge: AdBadge.LIVE,
      placement: AdPlacement.LANDING_HERO,
      audience: AdAudience.ALL,
      priority: 100,
    },
    {
      id: detId('empty-table-seed', 'ad', 'mobile'),
      title: 'Your next repair, made simple',
      description: 'Browse available technicians near you.',
      imageAlt: 'Technician services near you',
      callToAction: 'Browse technicians',
      badge: AdBadge.COMING_SOON,
      placement: AdPlacement.MOBILE_HOME,
      audience: AdAudience.CUSTOMER,
      priority: 50,
    },
  ];

  for (const ad of ads) {
    await prisma.ad.upsert({
      where: { id: ad.id },
      update: {},
      create: {
        ...ad,
        startsAt: new Date(now.getTime() - 60 * 60 * 1000),
        endsAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        createdById: adminId,
      },
    });
  }
  console.log(`  Ads ready: ${ads.length}`);
}

async function seedBroadcast(adminId: string | null) {
  const id = detId('empty-table-seed', 'broadcast', 'launch-update');
  await prisma.broadcast.upsert({
    where: { id },
    update: {},
    create: {
      id,
      title: 'Fundi service update',
      message: 'New local service professionals are available. Browse the latest listings in Fundi.',
      roles: [BroadcastRole.CUSTOMER, BroadcastRole.TECHNICIAN],
      channels: [BroadcastChannel.IN_APP],
      status: BroadcastStatus.SENT,
      mode: 'queued',
      userCount: 20,
      inAppRecipientCount: 20,
      inAppSentCount: 20,
      sentAt: now,
      createdById: adminId,
    },
  });
  console.log('  Broadcasts ready: 1');
}

async function seedBookingPayment() {
  const secret = process.env.MOCK_PAYMENT_SECRET;
  if (!secret) {
    console.log('  Booking payments skipped: MOCK_PAYMENT_SECRET is not set.');
    return;
  }

  const job = await prisma.job.findFirst({
    where: { serviceCategoryId: { not: null } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: {
      customer: { select: { phoneNumber: true } },
      serviceCategory: { select: { id: true } },
    },
  });
  if (!job?.serviceCategory) {
    console.log('  Booking payments skipped: no eligible job/category pair exists.');
    return;
  }

  const id = detId('empty-table-seed', 'booking-payment');
  const externalPaymentId = `mock_seed_${detId('external-payment')}`;
  const paidAt = new Date(now.getTime() - 60 * 60 * 1000);
  const amount = 5000;
  const phoneNumber = job.customer.phoneNumber;
  const requestType = JobRequestType.NORMAL;
  const signature = createHmac('sha256', secret)
    .update([
      id,
      externalPaymentId,
      job.customerId,
      job.serviceCategory.id,
      requestType,
      amount,
      phoneNumber,
      paidAt.toISOString(),
    ].join(':'))
    .digest('hex');

  await prisma.bookingPayment.upsert({
    where: { id },
    update: {},
    create: {
      id,
      customerId: job.customerId,
      serviceCategoryId: job.serviceCategory.id,
      jobId: null,
      externalPaymentId,
      paymentKeyId: process.env.MOCK_PAYMENT_KEY || 'local-seed',
      signature,
      phoneNumber,
      amount,
      requestType,
      status: BookingPaymentStatus.VALID,
      paidAt,
      validUntil: new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000),
    },
  });
  console.log('  Booking payments ready: 1');
}

async function seedCancellationAndDispute() {
  const cancellationJob = await prisma.job.findFirst({
    where: {
      status: JobStatus.ASSIGNED,
      technicianId: { not: null },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  if (cancellationJob) {
    const id = detId('empty-table-seed', 'cancellation', cancellationJob.id);
    await prisma.jobCancellationRequest.upsert({
      where: { id },
      update: {},
      create: {
        id,
        jobId: cancellationJob.id,
        actorId: cancellationJob.customerId,
        requester: CancellationRequester.CUSTOMER,
        reason: 'The appointment time no longer works.',
        status: CancellationRequestStatus.PENDING,
      },
    });
  }

  const disputeJob = await prisma.job.findFirst({
    where: {
      status: JobStatus.COMPLETED,
      technicianId: { not: null },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  if (disputeJob) {
    const id = detId('empty-table-seed', 'dispute', disputeJob.id);
    await prisma.dispute.upsert({
      where: { jobId: disputeJob.id },
      update: {},
      create: {
        id,
        jobId: disputeJob.id,
        reason: 'The completed work needs a follow-up review.',
        openedBy: DisputeOpenedBy.CUSTOMER,
      },
    });
  }
  console.log(`  Cancellation requests ready: ${cancellationJob ? 1 : 0}`);
  console.log(`  Disputes ready: ${disputeJob ? 1 : 0}`);
}

async function seedChatMessages() {
  const rooms = await prisma.chatRoom.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    take: 3,
    include: {
      members: {
        orderBy: { createdAt: 'asc' },
        take: 2,
        select: { userId: true, role: true },
      },
    },
  });

  let seededRooms = 0;
  for (const room of rooms) {
    const customer = room.members.find((member) => member.role === UserRole.CUSTOMER);
    const technician = room.members.find((member) => member.role === UserRole.TECHNICIAN);
    if (!customer || !technician) continue;

    const messages = [
      {
        id: detId('empty-table-seed', 'chat-message', room.id, 'customer'),
        senderId: customer.userId,
        senderRole: ChatSenderRole.CUSTOMER,
        text: 'Hello, could you confirm when you are available for this job?',
        readerId: technician.userId,
      },
      {
        id: detId('empty-table-seed', 'chat-message', room.id, 'technician'),
        senderId: technician.userId,
        senderRole: ChatSenderRole.TECHNICIAN,
        text: 'I am available and will follow up with the details shortly.',
        readerId: customer.userId,
      },
    ];

    for (const message of messages) {
      const created = await prisma.chatMessage.upsert({
        where: { id: message.id },
        update: {},
        create: {
          id: message.id,
          roomId: room.id,
          senderId: message.senderId,
          senderRole: message.senderRole,
          type: ChatMessageType.TEXT,
          text: message.text,
        },
        select: { id: true },
      });
      const readId = detId('empty-table-seed', 'chat-read', created.id, message.readerId);
      await prisma.chatMessageRead.upsert({
        where: { messageId_userId: { messageId: created.id, userId: message.readerId } },
        update: {},
        create: { id: readId, messageId: created.id, userId: message.readerId },
      });
    }
    seededRooms += 1;
  }
  console.log(`  Chat rooms with sample messages and reads: ${seededRooms}`);
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Mock data seeding is disabled in production.');
  }

  const admin = await prisma.user.findFirst({
    where: { role: UserRole.ADMIN },
    select: { id: true },
  });

  console.log('Adding mock records to eligible empty feature tables...');
  await seedAds(admin?.id ?? null);
  await seedBroadcast(admin?.id ?? null);
  await seedBookingPayment();
  await seedCancellationAndDispute();
  await seedChatMessages();
  console.log('Mock feature data is ready. Existing rows were preserved.');
}

main()
  .catch((error) => {
    console.error('Error seeding empty-table mock data:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());