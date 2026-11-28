// Read-only, service-level diagnostics against DATABASE_URL. Does not boot Nest,
// start queue workers, authenticate as a user, or print records/credentials.
require('dotenv').config({ quiet: true });
require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { JobsService } = require('../src/jobs/jobs.service');
const { PaymentsService } = require('../src/payments/payments.service');
const {
  AdminDashboardService,
} = require('../src/admin/admin-dashboard.service');

async function main() {
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set(
    'options',
    [
      url.searchParams.get('options'),
      '-c default_transaction_read_only=on -c statement_timeout=5000',
    ]
      .filter(Boolean)
      .join(' '),
  );
  const prisma = new PrismaClient({
    datasources: { db: { url: url.toString() } },
    log: [{ emit: 'event', level: 'query' }],
  });
  let queries = [];
  prisma.$on('query', (event) => queries.push(event));
  const measure = async (name, run) => {
    queries = [];
    const start = performance.now();
    const result = await run();
    console.log(
      JSON.stringify({
        name,
        elapsedMs: Math.round((performance.now() - start) * 10) / 10,
        sqlStatements: queries.length,
        slowestSqlMs: Math.max(0, ...queries.map((query) => query.duration)),
        responseBytes: Buffer.byteLength(JSON.stringify(result)),
        ...(result.pagination ? { pagination: result.pagination } : {}),
      }),
    );
    return result;
  };
  try {
    const mode = await prisma.$queryRawUnsafe(
      'SHOW default_transaction_read_only',
    );
    assert.equal(mode[0].default_transaction_read_only, 'on');
    // Only these read methods are invoked; their other dependencies are unused.
    const jobs = new JobsService(prisma);
    const payments = new PaymentsService(prisma);
    const dashboard = new AdminDashboardService(prisma);

    await measure('jobs/page-10', () =>
      jobs.listPageForAdmin({ page: 1, limit: 10 }),
    );
    const first = await measure('jobs/page-5', () =>
      jobs.listPageForAdmin({ page: 1, limit: 5 }),
    );
    const second = await jobs.listPageForAdmin({ page: 2, limit: 5 });
    assert.equal(
      new Set([...first.data, ...second.data].map((row) => row.id)).size,
      first.data.length + second.data.length,
    );
    const open = await jobs.listPageForAdmin({
      page: 1,
      limit: 5,
      status: 'OPEN',
    });
    const [openCount] =
      await prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM "jobs" WHERE "status" = 'OPEN'`;
    assert.equal(open.pagination.total, openCount.count);
    assert.ok(open.data.every((row) => row.status === 'OPEN'));

    await measure('payments/page-10', () =>
      payments.listPageForAdmin({ page: 1, limit: 10 }),
    );
    const summary = await measure('payments/summary', () =>
      payments.summaryForAdmin(),
    );
    const [paymentTotals] =
      await prisma.$queryRaw`SELECT COUNT(*)::int AS count, COALESCE(SUM("amount"), 0)::double precision AS amount FROM "booking_payments"`;
    assert.equal(summary.total, paymentTotals.count);
    assert.equal(summary.amount, paymentTotals.amount);
    const expired = await payments.listPageForAdmin({
      page: 1,
      limit: 5,
      status: 'EXPIRED',
    });
    assert.ok(expired.data.every((row) => row.status === 'EXPIRED'));
    assert.equal(
      expired.pagination.total,
      summary.byStatus.find((row) => row.status === 'EXPIRED').count,
    );

    const query = {
      period: 'currentMonth',
      timezone: 'Africa/Kigali',
      compare: false,
    };
    const analytics = () =>
      Promise.all([
        dashboard.overview(query),
        dashboard.trends(query),
        dashboard.breakdowns(query),
      ]);
    await measure('dashboard/cold-concurrent', analytics);
    await measure('dashboard/cached', analytics);
    assert.equal(
      queries.length,
      0,
      'A repeated dashboard query should not hit PostgreSQL',
    );
    console.log(
      'Read-only pagination, filter, summary and cache assertions passed.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(
    `Admin diagnostics failed (${error.name}${error.code ? ` ${error.code}` : ''}). Check schema/client migrations and DATABASE_URL. No database writes were permitted.`,
  );
  process.exitCode = 1;
});
