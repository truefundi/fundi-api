import { AdAudience, AdBadge, AdPlacement, PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';

/**
 * The mobile home carousel's launch ads. Idempotent: each ad has a fixed id and
 * is created once; later runs leave admin edits alone.
 *   npm run prisma:seed-ads
 */
const prisma = new PrismaClient();

function detId(...parts: string[]): string {
  const hash = createHash('sha256').update(parts.join('|')).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

const MOBILE_HOME_ADS = [
  {
    key: 'homeshub',
    title: 'HomesHub Kigali',
    description: 'Find apartments, houses, and premium rentals across Kigali with ease.',
    callToAction: 'Explore Houses',
    targetUrl: 'https://homeshub.rw',
    imageUrl: 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=1000&q=80',
    imageAlt: 'A modern house with a pool',
    priority: 30,
  },
  {
    key: 'rides',
    title: 'Rides Kigali',
    description: 'Fast, secure, and affordable on-demand rides everywhere in Rwanda.',
    callToAction: 'Book a Ride',
    targetUrl: 'https://rides.rw',
    imageUrl: 'https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?auto=format&fit=crop&w=1000&q=80',
    imageAlt: 'A car on a city road',
    priority: 20,
  },
  {
    key: 'eventis',
    title: 'Eventis Rwanda',
    description: 'Seamless event ticketing, concert passes, and venue coordination.',
    callToAction: 'Discover Events',
    targetUrl: 'https://eventis.rw',
    imageUrl: 'https://images.unsplash.com/photo-1511578314322-379afb476865?auto=format&fit=crop&w=1000&q=80',
    imageAlt: 'A conference hall set up for an event',
    priority: 10,
  },
];

async function main() {
  for (const { key, ...ad } of MOBILE_HOME_ADS) {
    await prisma.ad.upsert({
      where: { id: detId('mobile-home-ad', key) },
      update: {},
      create: {
        id: detId('mobile-home-ad', key),
        ...ad,
        badge: AdBadge.LIVE,
        placement: AdPlacement.MOBILE_HOME,
        audience: AdAudience.ALL,
        isActive: true,
      },
    });
  }
  console.log(`Mobile home ads ready: ${MOBILE_HOME_ADS.length}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
