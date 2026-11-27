import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const CATEGORY_FEES: Record<string, { fee: number; sos: number }> = {
  'plumbing': { fee: 3000, sos: 5000 },
  'electrical': { fee: 3000, sos: 5000 },
  'carpentry': { fee: 2500, sos: 4000 },
  'painting': { fee: 2500, sos: 4000 },
  'appliance-repair': { fee: 3500, sos: 6000 },
  'hvac-refrigeration': { fee: 3500, sos: 6000 },
  'masonry': { fee: 2500, sos: 4000 },
  'welding-metalwork': { fee: 3000, sos: 5000 },
  'roofing': { fee: 3000, sos: 5000 },
  'locksmith': { fee: 2500, sos: 4000 },
};

async function main() {
  const category = await prisma.catalogCategory.upsert({
    where: { name: 'Home Services' },
    update: { description: 'Repairs and maintenance for homes.' },
    create: {
      name: 'Home Services',
      description: 'Repairs and maintenance for homes.',
    },
  });

  for (const name of CATEGORIES) {
    const slug = slugify(name);
    const feeInfo = CATEGORY_FEES[slug] ?? { fee: 2500, sos: 5000 };
    await prisma.serviceCategory.upsert({
      where: { slug },
      update: {
        categoryId: category.id,
        visitFee: feeInfo.fee,
        emergencyVisitFee: Math.round(feeInfo.fee * 1.5),
        sosBookingFee: feeInfo.sos,
      },
      create: {
        name,
        slug,
        categoryId: category.id,
        visitFee: feeInfo.fee,
        emergencyVisitFee: Math.round(feeInfo.fee * 1.5),
        sosBookingFee: feeInfo.sos,
      },
    });
  }
  console.log(
    `Seeded ${CATEGORIES.length} services under the ${category.name} category`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
