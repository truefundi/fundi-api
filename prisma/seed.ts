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

async function main() {
  for (const name of CATEGORIES) {
    await prisma.serviceCategory.upsert({
      where: { slug: slugify(name) },
      update: {},
      create: { name, slug: slugify(name) },
    });
  }
  console.log(`Seeded ${CATEGORIES.length} service categories`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
