/**
 * Additive, idempotent test-data seeder.
 *
 * Everything here is keyed on stable identifiers (unique phone numbers, slugs, or
 * deterministic UUIDs), so running it repeatedly tops up the database rather than
 * duplicating rows. It is meant to sit on top of `seed-mock.ts` and adds the data
 * that the base seed is missing: conversation history (messages and price offers)
 * across every status, plus enough users, technicians, and jobs to exercise list
 * filters and pagination on the real endpoints.
 *
 * Run with:  npx ts-node prisma/seed-test-data.ts
 * (or)       npm run prisma:seed-test-data
 *
 * Endpoints this dataset is shaped for:
 *   GET /api/v1/conversations            (customer/technician, status filter, paging)
 *   GET /api/v1/admin/conversations      (status + search filter, paging)
 *   GET /api/v1/users                    (role/status/search filters, paging)
 *   GET /api/v1/admin/technicians        (many filters, paging)
 *   GET /api/v1/jobs/customer, /jobs/technician/offers, /admin/jobs
 *
 * See the "Seeded test accounts" section at the bottom of this file.
 */
import {
  Prisma,
  PrismaClient,
  UserRole,
  UserStatus,
  TechnicianGender,
  VerificationStatus,
  TechnicianAvailability,
  PaymentMethod,
  JobStatus,
  JobPriority,
  JobDispatchStatus,
  JobProgressStatus,
  JobOfferStatus,
  ConversationStatus,
  ConversationSender,
  ConversationMessageType,
  PriceOfferStatus,
} from '@prisma/client';
import {
  createCipheriv,
  createHash,
  createHmac,
  randomBytes,
} from 'crypto';

// Prisma CLI loads .env, but running this file through ts-node directly does not.
// dotenv is present as a dependency of @nestjs/config, so this keeps the script
// runnable either way.
import { config as loadEnv } from 'dotenv';
loadEnv();

const prisma = new PrismaClient();

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const NOW = new Date();
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * HOUR);
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * MINUTE);

// ─── Counts ────────────────────────────────────────────────────────────────
// Customers 0-11 own jobs; 12 and 13 have none, so their conversation list is
// empty. 10 technicians, 6 of them approved and active so they can be assigned.
const CUSTOMER_COUNT = 14;
const TECHNICIAN_COUNT = 10;
const JOB_COUNT = 36;
// Jobs 0..25 are ASSIGNED and get a conversation (one per status, cycling).
const CONVERSATION_JOB_COUNT = 26;

// ─── Helpers ───────────────────────────────────────────────────────────────

// A stable, UUID-v4-shaped id derived from its parts, so repeated runs address
// the same row through `upsert({ where: { id } })`.
function detId(...parts: Array<string | number>): string {
  const h = createHash('sha256').update(parts.join('|')).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// National ID encryption must match NationalIdCryptoService and the AES-GCM
// helper exactly (key = first 64 hex chars, payload = iv.tag.ciphertext base64,
// digest = HMAC-SHA256 over "fundi:national-id:v1:<normalised>").
const keyMaterial = (process.env.NATIONAL_ID_ENCRYPTION_KEY ?? '').trim();
const nidKeyHex = /^[0-9a-fA-F]{128}$/.test(keyMaterial)
  ? keyMaterial.slice(0, 64)
  : keyMaterial;
if (!/^[0-9a-fA-F]{64}$/.test(nidKeyHex)) {
  throw new Error(
    'NATIONAL_ID_ENCRYPTION_KEY must be set to 64 or 128 hexadecimal characters (check .env).',
  );
}
const NID_KEY = Buffer.from(nidKeyHex, 'hex');

const normalizeNid = (value: string) =>
  value.normalize('NFKC').trim().replace(/[\s-]/g, '').toUpperCase();

function encryptNid(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', NID_KEY, iv);
  const ciphertext = Buffer.concat([
    cipher.update(normalizeNid(value), 'utf8'),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), ciphertext]
    .map((part) => part.toString('base64'))
    .join('.');
}

function hashNid(value: string): string {
  return createHmac('sha256', NID_KEY)
    .update('fundi:national-id:v1:')
    .update(normalizeNid(value))
    .digest('hex');
}

// ─── Reference data ────────────────────────────────────────────────────────

const CATEGORIES = [
  'Plumbing',
  'Electrical',
  'Carpentry',
  'Painting',
  'Appliance Repair',
  'HVAC & Refrigeration',
  'Masonry',
  'Welding & Metalwork',
  'Roofing',
  'Locksmith',
];

const CUSTOMER_NAMES = [
  'Alice Uwimana',
  'Bernard Nkurunziza',
  'Claudine Mukamana',
  'David Habimana',
  'Esther Ingabire',
  'Fabrice Rwigema',
  'Grace Gatete',
  'Hakim Nsengiyumva',
  'Immaculee Mugisha',
  'Joseph Bizimana',
  'Keza Uwase',
  'Liliane Kagabo',
  'Moses Rukundo',
  'Nadia Mutoni',
];

const TECHNICIAN_NAMES = [
  'Emmanuel Shyaka',
  'Fidele Twagirayezu',
  'Gaspard Munyaneza',
  'Honorine Uwamahoro',
  'Innocent Ndayisenga',
  'Jacqueline Kayitesi',
  'Kevin Rugamba',
  'Laetitia Iradukunda',
  'Martin Mugabo',
  'Nadine Nyirahabimana',
];

// Areas carry coordinates so dispatch matching (ST_DWithin) can also be tested.
const AREAS = [
  { address: 'Kigali, Gasabo, Kimironko', label: 'Kimironko, Gasabo', lat: -1.943, lng: 30.101 },
  { address: 'Kigali, Kicukiro, Kanombe', label: 'Kanombe, Kicukiro', lat: -1.968, lng: 30.13 },
  { address: 'Kigali, Nyarugenge, Nyamirambo', label: 'Nyamirambo, Nyarugenge', lat: -1.981, lng: 30.044 },
  { address: 'Kigali, Gasabo, Gisozi', label: 'Gisozi, Gasabo', lat: -1.922, lng: 30.083 },
  { address: 'Musanze, Northern Province', label: 'Musanze Town', lat: -1.499, lng: 29.634 },
  { address: 'Huye, Southern Province', label: 'Huye Town', lat: -2.596, lng: 29.739 },
  { address: 'Rubavu, Western Province', label: 'Gisenyi, Rubavu', lat: -1.678, lng: 29.26 },
  { address: 'Muhanga, Southern Province', label: 'Muhanga Town', lat: -2.084, lng: 29.756 },
  { address: 'Rwamagana, Eastern Province', label: 'Rwamagana Town', lat: -1.949, lng: 30.435 },
  { address: 'Kigali, Kicukiro, Niboye', label: 'Niboye, Kicukiro', lat: -1.978, lng: 30.099 },
];

const PROBLEMS = [
  'a leaking pipe under the sink',
  'a broken socket in the kitchen',
  'a door that will not close properly',
  'repainting two bedrooms',
  'a fridge that stopped cooling',
  'an air conditioner that needs servicing',
  'a cracked wall that needs repairing',
  'a gate that needs welding',
  'a leaking roof after the rain',
  'a front door lock that is stuck',
];

// ─── Types ─────────────────────────────────────────────────────────────────

interface SeedCustomer {
  id: string;
  fullName: string;
  phoneNumber: string;
}

interface SeedTechnician {
  userId: string;
  profileId: string;
  fullName: string;
  verificationStatus: VerificationStatus;
  userStatus: UserStatus;
}

interface SeedJob {
  id: string;
  customerId: string;
  technicianId: string | null;
  serviceCategoryId: string;
  serviceName: string;
  description: string;
  locationAddress: string;
  latitude: number;
  longitude: number;
  offeredAmount: number;
}

const at = (anchor: Date, minutesBefore: number) =>
  new Date(anchor.getTime() - minutesBefore * MINUTE);

// ─── Seeders ───────────────────────────────────────────────────────────────

async function seedCategories() {
  const categories = [];
  for (const name of CATEGORIES) {
    const slug = slugify(name);
    const category = await prisma.serviceCategory.upsert({
      where: { slug },
      update: { name, isActive: true },
      create: { name, slug },
    });
    categories.push(category);
  }
  return categories;
}

async function seedCustomers(): Promise<SeedCustomer[]> {
  const customers: SeedCustomer[] = [];
  for (let i = 0; i < CUSTOMER_COUNT; i += 1) {
    const phoneNumber = `+25078820${String(1000 + i)}`;
    const email = `test.customer.${String(i + 1).padStart(2, '0')}@fundi.rw`;
    const fullName = CUSTOMER_NAMES[i];
    // Vary account status so the users list `status` filter has hits.
    const status =
      i === 12
        ? UserStatus.SUSPENDED
        : i === 13
          ? UserStatus.INACTIVE
          : UserStatus.ACTIVE;

    const user = await prisma.user.upsert({
      where: { phoneNumber },
      update: { email, fullName, role: UserRole.CUSTOMER, status },
      create: {
        id: detId('customer', i),
        email,
        phoneNumber,
        fullName,
        role: UserRole.CUSTOMER,
        status,
        createdAt: minutesAgo((i + 1) * 10),
      },
    });
    customers.push({ id: user.id, fullName: user.fullName, phoneNumber: user.phoneNumber });
  }
  return customers;
}

async function seedTechnicians(
  categories: { id: string; name: string }[],
): Promise<SeedTechnician[]> {
  const technicians: SeedTechnician[] = [];

  for (let i = 0; i < TECHNICIAN_COUNT; i += 1) {
    const phoneNumber = `+25078920${String(1000 + i)}`;
    const email = `test.tech.${String(i + 1).padStart(2, '0')}@fundi.rw`;
    const fullName = TECHNICIAN_NAMES[i];
    const userStatus =
      i === 8 ? UserStatus.SUSPENDED : i === 9 ? UserStatus.INACTIVE : UserStatus.ACTIVE;
    const verificationStatus =
      i < 6
        ? VerificationStatus.APPROVED
        : i < 8
          ? VerificationStatus.PENDING
          : i === 8
            ? VerificationStatus.REJECTED
            : VerificationStatus.PENDING;
    // Only approved technicians may be online.
    const availabilityStatus =
      verificationStatus === VerificationStatus.APPROVED && i % 2 === 0
        ? TechnicianAvailability.ONLINE
        : TechnicianAvailability.OFFLINE;

    const user = await prisma.user.upsert({
      where: { phoneNumber },
      update: { email, fullName, role: UserRole.TECHNICIAN, status: userStatus },
      create: {
        id: detId('technician', i),
        email,
        phoneNumber,
        fullName,
        role: UserRole.TECHNICIAN,
        status: userStatus,
        createdAt: minutesAgo((i + 1) * 10 + 5),
      },
    });

    const area = AREAS[i % AREAS.length];
    const nationalId = `1198${String(700000 + i)}`;
    const profile = await prisma.technicianProfile.upsert({
      where: { userId: user.id },
      update: {
        gender: i % 2 === 0 ? TechnicianGender.MALE : TechnicianGender.FEMALE,
        nationalIdEncrypted: encryptNid(nationalId),
        nationalIdHash: hashNid(nationalId),
        baseAddress: area.address,
        publicLocationLabel: area.label,
        baseLatitude: area.lat,
        baseLongitude: area.lng,
        paymentMethod: i % 3 === 0 ? PaymentMethod.BANK_TRANSFER : PaymentMethod.MOMO,
        paymentNumber: phoneNumber,
        verificationStatus,
        availabilityStatus,
      },
      create: {
        id: detId('technician-profile', i),
        userId: user.id,
        gender: i % 2 === 0 ? TechnicianGender.MALE : TechnicianGender.FEMALE,
        nationalIdEncrypted: encryptNid(nationalId),
        nationalIdHash: hashNid(nationalId),
        baseAddress: area.address,
        publicLocationLabel: area.label,
        baseLatitude: area.lat,
        baseLongitude: area.lng,
        paymentMethod: i % 3 === 0 ? PaymentMethod.BANK_TRANSFER : PaymentMethod.MOMO,
        paymentNumber: phoneNumber,
        verificationStatus,
        availabilityStatus,
        createdAt: minutesAgo((i + 1) * 10 + 5),
      },
    });

    // Rebuild service categories so re-runs do not accumulate duplicates.
    await prisma.technicianCategory.deleteMany({ where: { technicianId: profile.id } });
    const primary = categories[i % categories.length];
    const secondary = categories[(i + 3) % categories.length];
    await prisma.technicianCategory.createMany({
      data: [
        { technicianId: profile.id, categoryId: primary.id, yearsOfExperience: 2 + (i % 10) },
        { technicianId: profile.id, categoryId: secondary.id, yearsOfExperience: 1 + (i % 5) },
      ],
    });

    // The geography column is not writable through the typed client.
    await prisma.$executeRaw`
      UPDATE "technician_profiles"
      SET "baseLocation" = ST_SetSRID(
        ST_MakePoint(${area.lng}::double precision, ${area.lat}::double precision),
        4326
      )::geography
      WHERE "id" = ${profile.id}`;

    technicians.push({
      userId: user.id,
      profileId: profile.id,
      fullName: user.fullName,
      verificationStatus,
      userStatus,
    });
  }

  return technicians;
}

function jobStatusFor(index: number): JobStatus {
  if (index < 26) return JobStatus.ASSIGNED;
  if (index < 30) return JobStatus.OPEN;
  if (index < 34) return JobStatus.COMPLETED;
  if (index === 34) return JobStatus.FAILED;
  return JobStatus.CANCELLED;
}

const PRIORITIES = [
  JobPriority.LOW,
  JobPriority.NORMAL,
  JobPriority.HIGH,
  JobPriority.URGENT,
];

async function seedJobs(
  customers: SeedCustomer[],
  technicians: SeedTechnician[],
  categories: { id: string; name: string }[],
): Promise<SeedJob[]> {
  const assignable = technicians.filter(
    (t) =>
      t.verificationStatus === VerificationStatus.APPROVED &&
      t.userStatus === UserStatus.ACTIVE,
  );
  if (assignable.length === 0) {
    throw new Error('No approved, active technicians to assign jobs to.');
  }

  const jobs: SeedJob[] = [];

  for (let i = 0; i < JOB_COUNT; i += 1) {
    // Customer 0 owns jobs 0..12 (enough conversations for a second page); the
    // rest are spread over customers 0..11. Customers 12 and 13 stay jobless.
    const customer = customers[i < 13 ? 0 : i % 12];
    const category = categories[i % categories.length];
    const area = AREAS[i % AREAS.length];
    const status = jobStatusFor(i);
    const assigned = status === JobStatus.ASSIGNED || status === JobStatus.COMPLETED;
    // Give technician 0 the first 11 conversations so the technician-side list
    // also spans more than one page at limit=10.
    const technician = assigned
      ? assignable[i < 11 ? 0 : i % assignable.length]
      : null;

    const createdAt = hoursAgo((i + 1) * 6);
    const assignedAt = assigned ? new Date(createdAt.getTime() + 30 * MINUTE) : null;
    const completedAt =
      status === JobStatus.COMPLETED
        ? new Date(createdAt.getTime() + 3 * HOUR)
        : null;
    const description = `Need ${category.name.toLowerCase()} help with ${PROBLEMS[i % PROBLEMS.length]} in ${area.label}.`;
    const offeredAmount = 10000 + (i % 9) * 5000;

    const job = await prisma.job.upsert({
      where: { id: detId('job', i) },
      update: {
        customerId: customer.id,
        technicianId: technician?.profileId ?? null,
        serviceCategoryId: category.id,
        description,
        locationAddress: area.address,
        latitude: area.lat,
        longitude: area.lng,
        offeredAmount,
        currency: 'RWF',
        priority: PRIORITIES[i % PRIORITIES.length],
        status,
        dispatchStatus: assigned
          ? JobDispatchStatus.STOPPED
          : status === JobStatus.OPEN
            ? JobDispatchStatus.OFFERED
            : JobDispatchStatus.PENDING,
        dispatchRound: 1,
        customerProgress: JobProgressStatus.PENDING,
        technicianProgress:
          status === JobStatus.COMPLETED
            ? JobProgressStatus.COMPLETED
            : assigned
              ? JobProgressStatus.STARTED
              : JobProgressStatus.PENDING,
        assignedAt,
        completedAt,
      },
      create: {
        id: detId('job', i),
        customerId: customer.id,
        technicianId: technician?.profileId ?? null,
        serviceCategoryId: category.id,
        description,
        locationAddress: area.address,
        latitude: area.lat,
        longitude: area.lng,
        offeredAmount,
        currency: 'RWF',
        priority: PRIORITIES[i % PRIORITIES.length],
        status,
        dispatchStatus: assigned
          ? JobDispatchStatus.STOPPED
          : status === JobStatus.OPEN
            ? JobDispatchStatus.OFFERED
            : JobDispatchStatus.PENDING,
        dispatchRound: 1,
        customerProgress: JobProgressStatus.PENDING,
        technicianProgress:
          status === JobStatus.COMPLETED
            ? JobProgressStatus.COMPLETED
            : assigned
              ? JobProgressStatus.STARTED
              : JobProgressStatus.PENDING,
        assignedAt,
        completedAt,
        createdAt,
      },
    });

    await prisma.$executeRaw`
      UPDATE "jobs"
      SET "location" = ST_SetSRID(
        ST_MakePoint(${area.lng}::double precision, ${area.lat}::double precision),
        4326
      )::geography
      WHERE "id" = ${job.id}`;

    if (assigned && technician) {
      await prisma.jobAssignmentHistory.upsert({
        where: { id: detId('job-assignment', i) },
        update: {
          jobId: job.id,
          technicianId: technician.profileId,
          technicianName: technician.fullName,
          acceptedAt: assignedAt ?? createdAt,
          endedAt: status === JobStatus.COMPLETED ? completedAt : null,
        },
        create: {
          id: detId('job-assignment', i),
          jobId: job.id,
          technicianId: technician.profileId,
          technicianName: technician.fullName,
          acceptedAt: assignedAt ?? createdAt,
          endedAt: status === JobStatus.COMPLETED ? completedAt : null,
          createdAt,
        },
      });
    }

    // A couple of dispatch offers on the OPEN jobs, so the technician offers
    // endpoint and the admin job detail have something to show.
    if (status === JobStatus.OPEN) {
      const offerTechnician = assignable[i % assignable.length];
      const rejected = i % 2 === 1;
      await prisma.jobOffer.upsert({
        where: { id: detId('job-offer', i) },
        update: {
          jobId: job.id,
          technicianId: offerTechnician.profileId,
          round: 1,
          matchScore: 60 + (i % 40),
          distanceMeters: 500 + i * 250,
          status: rejected ? JobOfferStatus.REJECTED : JobOfferStatus.OFFERED,
          offeredAt: createdAt,
          expiresAt: rejected ? new Date(createdAt.getTime() + HOUR) : new Date(NOW.getTime() + 23 * HOUR),
          respondedAt: rejected ? new Date(createdAt.getTime() + 20 * MINUTE) : null,
          rejectionReason: rejected ? 'Not available today.' : null,
        },
        create: {
          id: detId('job-offer', i),
          jobId: job.id,
          technicianId: offerTechnician.profileId,
          round: 1,
          matchScore: 60 + (i % 40),
          distanceMeters: 500 + i * 250,
          status: rejected ? JobOfferStatus.REJECTED : JobOfferStatus.OFFERED,
          offeredAt: createdAt,
          expiresAt: rejected ? new Date(createdAt.getTime() + HOUR) : new Date(NOW.getTime() + 23 * HOUR),
          respondedAt: rejected ? new Date(createdAt.getTime() + 20 * MINUTE) : null,
          rejectionReason: rejected ? 'Not available today.' : null,
          createdAt,
        },
      });
    }

    jobs.push({
      id: job.id,
      customerId: job.customerId,
      technicianId: job.technicianId,
      serviceCategoryId: category.id,
      serviceName: category.name,
      description,
      locationAddress: area.address,
      latitude: area.lat,
      longitude: area.lng,
      offeredAmount,
    });
  }

  return jobs;
}

const CONVERSATION_STATUS_CYCLE: ConversationStatus[] = [
  ConversationStatus.PENDING,
  ConversationStatus.NEGOTIATING,
  ConversationStatus.AGREED,
  ConversationStatus.DECLINED,
  ConversationStatus.EXPIRED,
];

async function seedConversation(
  index: number,
  job: SeedJob,
  customer: SeedCustomer,
  technician: SeedTechnician,
): Promise<void> {
  const status = CONVERSATION_STATUS_CYCLE[index % CONVERSATION_STATUS_CYCLE.length];
  const lastMessageAt = hoursAgo(index * 3 + 1);
  const startedAt = new Date(lastMessageAt.getTime() - 3 * HOUR);
  const base = at(lastMessageAt, 0);

  const conversation = await prisma.conversation.upsert({
    where: { jobId: job.id },
    update: { status, currency: 'RWF', startedAt, lastMessageAt },
    create: {
      id: detId('conversation', job.id),
      jobId: job.id,
      status,
      currency: 'RWF',
      startedAt,
      lastMessageAt,
    },
    select: { id: true },
  });

  await prisma.$transaction(async (tx) => {
    // Rebuild the transcript so re-runs stay deterministic.
    await tx.conversationMessage.deleteMany({ where: { conversationId: conversation.id } });

    let messageSeq = 0;
    const addMessage = (data: {
      senderRole: ConversationSender;
      senderId: string | null;
      type: ConversationMessageType;
      text?: string | null;
      metadata?: Record<string, unknown> | null;
      minutesBefore: number;
    }) =>
      tx.conversationMessage.create({
        data: {
          id: detId('conversation-message', conversation.id, messageSeq++),
          conversationId: conversation.id,
          senderId: data.senderId,
          senderRole: data.senderRole,
          type: data.type,
          text: data.text ?? null,
          metadata: (data.metadata ?? undefined) as
            | Prisma.InputJsonValue
            | undefined,
          createdAt: at(lastMessageAt, data.minutesBefore),
        },
        select: { id: true },
      });

    let offerSeq = 0;
    let offerCount = 0;
    let agreedAmount: number | null = null;
    let declinedById: string | null = null;
    let declineReason: string | null = null;
    let closedAt: Date | null = null;

    // Every conversation opens with the service request.
    await addMessage({
      senderRole: ConversationSender.SYSTEM,
      senderId: null,
      type: ConversationMessageType.SERVICE_REQUEST,
      metadata: {
        service: job.serviceName,
        description: job.description,
        locationAddress: job.locationAddress,
        latitude: job.latitude,
        longitude: job.longitude,
      },
      minutesBefore: 180,
    });

    if (status !== ConversationStatus.PENDING) {
      await addMessage({
        senderRole: ConversationSender.TECHNICIAN,
        senderId: technician.userId,
        type: ConversationMessageType.TECHNICIAN_RESPONSE,
        metadata: { decision: 'ACCEPTED' },
        minutesBefore: 160,
      });
    }

    if (status === ConversationStatus.NEGOTIATING) {
      await addMessage({
        senderRole: ConversationSender.CUSTOMER,
        senderId: customer.id,
        type: ConversationMessageType.TEXT,
        text: 'Hello, when could you come and take a look?',
        minutesBefore: 140,
      });
      await addMessage({
        senderRole: ConversationSender.TECHNICIAN,
        senderId: technician.userId,
        type: ConversationMessageType.TEXT,
        text: 'I can come tomorrow morning around 9.',
        minutesBefore: 120,
      });
      const message = await addMessage({
        senderRole: ConversationSender.CUSTOMER,
        senderId: customer.id,
        type: ConversationMessageType.PRICE_OFFER,
        text: 'My offer, can we agree on this?',
        minutesBefore: 60,
      });
      await tx.priceOffer.create({
        data: {
          id: detId('price-offer', conversation.id, offerSeq++),
          conversationId: conversation.id,
          messageId: message.id,
          amount: job.offeredAmount,
          currency: 'RWF',
          senderRole: ConversationSender.CUSTOMER,
          status: PriceOfferStatus.PENDING,
          notes: 'My offer, can we agree on this?',
          expiresAt: new Date(NOW.getTime() + 20 * HOUR),
          createdAt: at(lastMessageAt, 60),
        },
      });
      offerCount = 1;
    } else if (status === ConversationStatus.AGREED) {
      const counter = await addMessage({
        senderRole: ConversationSender.CUSTOMER,
        senderId: customer.id,
        type: ConversationMessageType.PRICE_OFFER,
        text: 'Would you accept this amount?',
        minutesBefore: 120,
      });
      await tx.priceOffer.create({
        data: {
          id: detId('price-offer', conversation.id, offerSeq++),
          conversationId: conversation.id,
          messageId: counter.id,
          amount: job.offeredAmount,
          currency: 'RWF',
          senderRole: ConversationSender.CUSTOMER,
          status: PriceOfferStatus.SUPERSEDED,
          notes: 'Would you accept this amount?',
          respondedAt: at(lastMessageAt, 90),
          createdAt: at(lastMessageAt, 120),
        },
      });
      const finalOffer = await addMessage({
        senderRole: ConversationSender.TECHNICIAN,
        senderId: technician.userId,
        type: ConversationMessageType.PRICE_OFFER,
        text: 'I can do it for this.',
        minutesBefore: 90,
      });
      const finalAmount = job.offeredAmount + 2000;
      await tx.priceOffer.create({
        data: {
          id: detId('price-offer', conversation.id, offerSeq++),
          conversationId: conversation.id,
          messageId: finalOffer.id,
          amount: finalAmount,
          currency: 'RWF',
          senderRole: ConversationSender.TECHNICIAN,
          status: PriceOfferStatus.ACCEPTED,
          notes: 'I can do it for this.',
          respondedAt: at(lastMessageAt, 30),
          createdAt: at(lastMessageAt, 90),
        },
      });
      await addMessage({
        senderRole: ConversationSender.SYSTEM,
        senderId: null,
        type: ConversationMessageType.SYSTEM,
        text: `Agreed at ${finalAmount} RWF.`,
        minutesBefore: 0,
      });
      offerCount = 2;
      agreedAmount = finalAmount;
      closedAt = base;
    } else if (status === ConversationStatus.DECLINED) {
      if (index % 2 === 0) {
        // The assigned technician declined the job request itself.
        const reason = 'Too far from my base.';
        await addMessage({
          senderRole: ConversationSender.TECHNICIAN,
          senderId: technician.userId,
          type: ConversationMessageType.TECHNICIAN_RESPONSE,
          metadata: { decision: 'DECLINED', reason },
          minutesBefore: 120,
        });
        declinedById = technician.userId;
        declineReason = reason;
      } else {
        const message = await addMessage({
          senderRole: ConversationSender.CUSTOMER,
          senderId: customer.id,
          type: ConversationMessageType.PRICE_OFFER,
          text: 'This is the most I can pay.',
          minutesBefore: 90,
        });
        await tx.priceOffer.create({
          data: {
            id: detId('price-offer', conversation.id, offerSeq++),
            conversationId: conversation.id,
            messageId: message.id,
            amount: job.offeredAmount,
            currency: 'RWF',
            senderRole: ConversationSender.CUSTOMER,
            status: PriceOfferStatus.DECLINED,
            notes: 'This is the most I can pay.',
            respondedAt: at(lastMessageAt, 60),
            createdAt: at(lastMessageAt, 90),
          },
        });
        await addMessage({
          senderRole: ConversationSender.SYSTEM,
          senderId: null,
          type: ConversationMessageType.SYSTEM,
          text: 'Offer declined: the amount is too low.',
          minutesBefore: 0,
        });
        offerCount = 1;
        declinedById = technician.userId;
        declineReason = 'the amount is too low';
      }
      closedAt = base;
    } else if (status === ConversationStatus.EXPIRED) {
      const message = await addMessage({
        senderRole: ConversationSender.CUSTOMER,
        senderId: customer.id,
        type: ConversationMessageType.PRICE_OFFER,
        text: 'Let me know if this works.',
        minutesBefore: 90,
      });
      await tx.priceOffer.create({
        data: {
          id: detId('price-offer', conversation.id, offerSeq++),
          conversationId: conversation.id,
          messageId: message.id,
          amount: job.offeredAmount,
          currency: 'RWF',
          senderRole: ConversationSender.CUSTOMER,
          status: PriceOfferStatus.EXPIRED,
          notes: 'Let me know if this works.',
          expiresAt: at(lastMessageAt, 60),
          respondedAt: at(lastMessageAt, 10),
          createdAt: at(lastMessageAt, 90),
        },
      });
      await addMessage({
        senderRole: ConversationSender.SYSTEM,
        senderId: null,
        type: ConversationMessageType.SYSTEM,
        text: 'A price offer expired.',
        minutesBefore: 0,
      });
      offerCount = 1;
      closedAt = base;
    }

    await tx.conversation.update({
      where: { id: conversation.id },
      data: { agreedAmount, offerCount, declinedById, declineReason, closedAt },
    });
  });
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('Seeding additive test data...');

  const categories = await seedCategories();
  console.log(`  Service categories ready: ${categories.length}`);

  const customers = await seedCustomers();
  console.log(`  Customers ready: ${customers.length}`);

  const technicians = await seedTechnicians(categories);
  const approved = technicians.filter(
    (t) => t.verificationStatus === VerificationStatus.APPROVED,
  ).length;
  console.log(`  Technicians ready: ${technicians.length} (${approved} approved)`);

  const jobs = await seedJobs(customers, technicians, categories);
  console.log(`  Jobs ready: ${jobs.length}`);

  const byId = new Map(customers.map((c) => [c.id, c]));
  const techById = new Map(technicians.map((t) => [t.profileId, t]));

  let conversations = 0;
  for (let i = 0; i < CONVERSATION_JOB_COUNT; i += 1) {
    const job = jobs[i];
    if (!job || !job.technicianId) continue;
    const customer = byId.get(job.customerId);
    const technician = techById.get(job.technicianId);
    if (!customer || !technician) continue;
    await seedConversation(i, job, customer, technician);
    conversations += 1;
  }
  console.log(`  Conversations ready: ${conversations}`);

  console.log('\nDone. Seeded test accounts:');
  console.log('  Customers (login by phone, OTP in the API terminal):');
  console.log(`    +250788201000  Alice Uwimana      -> ${CUSTOMER_COUNT} conversations across 2 pages at limit=10`);
  console.log('    +250788201001  Bernard Nkurunziza');
  console.log('    +250788201012  Moses Rukundo       (SUSPENDED)');
  console.log('    +250788201013  Nadia Mutoni        (INACTIVE, no jobs)');
  console.log('  Technicians:');
  console.log('    +250789201000  Emmanuel Shyaka     -> technician-side list spans 2 pages at limit=10');
  console.log('    +250789201001  Fidele Twagirayezu');
  console.log('    +250789201008  Martin Mugabo       (SUSPENDED)');
  console.log('    +250789201009  Nadine Nyirahabimana (INACTIVE)');
  console.log('  Admin: ADMIN_EMAIL / ADMIN_PASSWORD from .env (see npm run prisma:seed-admin).');
}

main()
  .catch((error) => {
    console.error('Error seeding test data:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
