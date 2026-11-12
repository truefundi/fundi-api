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
    await prisma.serviceCategory.upsert({
      where: { slug },
      update: { categoryId: category.id },
      create: { name, slug, categoryId: category.id },
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
