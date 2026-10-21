import { PrismaClient, UserRole, UserStatus, TechnicianGender, VerificationStatus, TechnicianAvailability, PaymentMethod, DocumentType, CertificateType, DocumentStatus, JobStatus, JobPriority, JobDispatchStatus, JobProgressStatus, JobOfferStatus } from '@prisma/client';
import { randomUUID, createHash, randomBytes, createCipheriv, createHmac } from 'crypto';
import { encryptionKeyFromHex } from '../src/common/crypto/aes-gcm';

const prisma = new PrismaClient();

// National ID crypto helpers. The key is read from the environment only, so the
// seeder can never write national IDs the API would be unable to decrypt.
const NATIONAL_ID_KEY = encryptionKeyFromHex(
  process.env.NATIONAL_ID_ENCRYPTION_KEY,
  'NATIONAL_ID_ENCRYPTION_KEY',
);

function normalizeNid(value: string): string {
  return value.normalize('NFKC').trim().replace(/[\s-]/g, '').toUpperCase();
}

function encryptNid(value: string): string {
  const normalized = normalizeNid(value);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', NATIONAL_ID_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(normalized, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64url');
}

function hashNid(value: string): string {
  return createHmac('sha256', NATIONAL_ID_KEY)
    .update('fundi:national-id:v1:')
    .update(normalizeNid(value))
    .digest('hex');
}

async function main() {
  console.log('Starting mock data seeding...');

  // Create customers
  const customers = [];
  for (let i = 0; i < 5; i++) {
    const customer = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `customer${i + 1}@fundi.rw`,
        phoneNumber: `+25078800${String(1000 + i).padStart(4, '0')}`,
        fullName: `Customer ${i + 1}`,
        role: UserRole.CUSTOMER,
        status: UserStatus.ACTIVE,
        passwordHash: null,
      },
    });
    customers.push(customer);
    console.log(`Created customer: ${customer.fullName} (${customer.phoneNumber})`);
  }

  // Create technicians
  const categories = await prisma.serviceCategory.findMany();
  
  const technicians = [];
  for (let i = 0; i < 8; i++) {
    const cat = categories[i % categories.length];
    const nid = `11990000${String(1000 + i).padStart(4, '0')}`;
    const techUser = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `tech${i + 1}@fundi.rw`,
        phoneNumber: `+25078900${String(1000 + i).padStart(4, '0')}`,
        fullName: `Technician ${i + 1}`,
        role: UserRole.TECHNICIAN,
        status: UserStatus.ACTIVE,
        passwordHash: null,
      },
    });
    
    const profile = await prisma.technicianProfile.create({
      data: {
        id: randomUUID(),
        userId: techUser.id,
        gender: i % 2 === 0 ? TechnicianGender.MALE : TechnicianGender.FEMALE,
        nationalIdEncrypted: encryptNid(nid),
        nationalIdHash: hashNid(nid),
        baseAddress: `Kigali, District ${i + 1}`,
        publicLocationLabel: `Area ${i + 1}, Kigali`,
        baseLatitude: -1.9536 + (i * 0.01),
        baseLongitude: 30.0605 + (i * 0.01),
        paymentMethod: PaymentMethod.MOMO,
        paymentNumber: techUser.phoneNumber,
        verificationStatus: i < 6 ? VerificationStatus.APPROVED : VerificationStatus.PENDING,
        availabilityStatus: i < 5 ? TechnicianAvailability.ONLINE : TechnicianAvailability.OFFLINE,
      },
    });
    
    // Add service category for technician
    await prisma.technicianCategory.create({
      data: {
        technicianId: profile.id,
        categoryId: cat.id,
        yearsOfExperience: 2 + (i % 8),
      },
    });
    
    technicians.push({ profile, user: techUser });
    console.log(`Created technician: ${techUser.fullName} - ${cat.name} (${profile.verificationStatus}, ${profile.availabilityStatus})`);
  }

  // Create some jobs
  const jobs = [];
  for (let i = 0; i < 10; i++) {
    const customer = customers[i % customers.length];
    const cat = categories[i % categories.length];
    const job = await prisma.job.create({
      data: {
        id: randomUUID(),
        customerId: customer.id,
        serviceCategoryId: cat.id,
        description: `Need ${cat.name.toLowerCase()} service - job request #${i + 1}`,
        locationAddress: `Kigali, Near Location ${i + 1}`,
        latitude: -1.9536 + (i * 0.005),
        longitude: 30.0605 + (i * 0.005),
        offeredAmount: 10000 + (i * 5000),
        currency: 'RWF',
        priority: [JobPriority.LOW, JobPriority.NORMAL, JobPriority.HIGH][i % 3],
        status: [JobStatus.OPEN, JobStatus.ASSIGNED, JobStatus.COMPLETED][i % 3],
        dispatchStatus: JobDispatchStatus.PENDING,
        customerProgress: JobProgressStatus.PENDING,
        technicianProgress: JobProgressStatus.PENDING,
      },
    });
    jobs.push(job);
    console.log(`Created job: ${job.description.substring(0, 40)}... (Status: ${job.status})`);
  }

  // Assign some technicians to jobs
  const assignedJobs = jobs.filter(j => j.status === JobStatus.ASSIGNED);
  for (let i = 0; i < assignedJobs.length; i++) {
    const job = assignedJobs[i];
    const tech = technicians[i % technicians.length];
    if (tech.profile.verificationStatus === VerificationStatus.APPROVED) {
      await prisma.job.update({
        where: { id: job.id },
        data: {
          technicianId: tech.profile.id,
          assignedAt: new Date(),
          technicianProgress: JobProgressStatus.STARTED,
        },
      });
      
      await prisma.jobAssignmentHistory.create({
        data: {
          jobId: job.id,
          technicianId: tech.profile.id,
          technicianName: tech.user.fullName,
          acceptedAt: new Date(),
        },
      });
      console.log(`Assigned ${tech.user.fullName} to job ${job.id}`);
    }
  }

  console.log('Mock data seeding completed!');
  console.log(`- Customers: ${customers.length}`);
  console.log(`- Technicians: ${technicians.length}`);
  console.log(`- Jobs: ${jobs.length}`);
}

main()
  .catch((e) => {
    console.error('Error seeding mock data:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
