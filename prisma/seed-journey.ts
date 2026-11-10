import {
  PaymentMethod,
  PrismaClient,
  TechnicianAvailability,
  TechnicianGender,
  UserRole,
  UserStatus,
  VerificationStatus,
} from '@prisma/client';

/**
 * Accounts for testing the request -> agreement journey by hand on a phone or
 * the web: one technician per service category, approved, online, with no
 * active job (so they can accept a request), based in central Kigali, plus a
 * customer whose phone is already verified (so no per-job code is asked).
 *
 * Idempotent: re-running resets these accounts to a clean, available state.
 * Run after the other seeds: npm run prisma:seed-journey
 */
const prisma = new PrismaClient();

// Kigali city centre; every journey technician is within a few kilometres.
const BASE = { lat: -1.9441, lng: 30.0619 };

const CUSTOMER = { phoneNumber: '+250788300000', fullName: 'Journey Customer' };

async function seedTechnician(
  index: number,
  category: { id: string; name: string },
) {
  const phoneNumber = `+25079830${String(index).padStart(4, '0')}`;
  const fullName = `${category.name} Tech`;
  const lat = BASE.lat + (index % 5) * 0.004;
  const lng = BASE.lng + Math.floor(index / 5) * 0.004;

  const user = await prisma.user.upsert({
    where: { phoneNumber },
    update: { fullName, role: UserRole.TECHNICIAN, status: UserStatus.ACTIVE },
    create: {
      phoneNumber,
      fullName,
      role: UserRole.TECHNICIAN,
      status: UserStatus.ACTIVE,
      phoneVerifiedAt: new Date(),
    },
  });
  const profileData = {
    gender: index % 2 === 0 ? TechnicianGender.MALE : TechnicianGender.FEMALE,
    baseAddress: 'Kigali City Centre',
    publicLocationLabel: 'Kigali',
    baseLatitude: lat,
    baseLongitude: lng,
    paymentMethod: PaymentMethod.MOMO,
    paymentNumber: phoneNumber,
    verificationStatus: VerificationStatus.APPROVED,
    availabilityStatus: TechnicianAvailability.ONLINE,
    rejectionCount: 0,
    cancellationCount: 0,
  };
  const profile = await prisma.technicianProfile.upsert({
    where: { userId: user.id },
    update: profileData,
    create: { userId: user.id, ...profileData },
  });
  await prisma.technicianCategory.deleteMany({
    where: { technicianId: profile.id },
  });
  await prisma.technicianCategory.create({
    data: {
      technicianId: profile.id,
      categoryId: category.id,
      yearsOfExperience: 5,
    },
  });
  await prisma.$executeRaw`
    UPDATE "technician_profiles"
    SET "baseLocation" = ST_SetSRID(
      ST_MakePoint(${lng}::double precision, ${lat}::double precision),
      4326
    )::geography
    WHERE "id" = ${profile.id}`;
  return { phoneNumber, fullName };
}

async function main() {
  const categories = await prisma.serviceCategory.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
  if (!categories.length) {
    throw new Error('No service categories. Run `npm run prisma:seed` first.');
  }

  await prisma.user.upsert({
    where: { phoneNumber: CUSTOMER.phoneNumber },
    update: {
      fullName: CUSTOMER.fullName,
      role: UserRole.CUSTOMER,
      status: UserStatus.ACTIVE,
      phoneVerifiedAt: new Date(),
    },
    create: {
      ...CUSTOMER,
      role: UserRole.CUSTOMER,
      status: UserStatus.ACTIVE,
      phoneVerifiedAt: new Date(),
    },
  });

  const technicians = [];
  for (const [index, category] of categories.entries()) {
    technicians.push(await seedTechnician(index, category));
  }

  console.log('Journey test accounts (log in by phone; the OTP prints in the API terminal):');
  console.log(`  Customer   ${CUSTOMER.phoneNumber}  ${CUSTOMER.fullName} (phone verified)`);
  for (const technician of technicians) {
    console.log(`  Technician ${technician.phoneNumber}  ${technician.fullName}`);
  }
  console.log('Technicians are online and free; requests located in Kigali will match them.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
