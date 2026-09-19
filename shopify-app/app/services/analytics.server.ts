import { Prisma } from "@prisma/client";
import db from "../db.server";
export type Metrics = {
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
  days: number;
};
export async function metrics(
  storeId: string,
  start: string,
  end: string,
  page?: string,
): Promise<Metrics> {
  const rows = await db.$queryRaw<
    {
      clicks: number;
      impressions: number;
      position: number | null;
      days: bigint;
    }[]
  >(Prisma.sql`
    SELECT COALESCE(SUM(clicks),0)::float8 AS clicks,
      COALESCE(SUM(impressions),0)::float8 AS impressions,
      (SUM(position * impressions) / NULLIF(SUM(impressions),0))::float8 AS position,
      COUNT(DISTINCT date) AS days
    FROM "SearchMetric" WHERE "storeId" = ${storeId} AND date >= ${start} AND date < ${end}
    ${page ? Prisma.sql`AND page = ${page}` : Prisma.empty}
  `);
  const row = rows[0];
  return {
    ...row,
    days: Number(row.days),
    ctr: row.impressions ? row.clicks / row.impressions : null,
  };
}
const day = (time: number) => new Date(time).toISOString().slice(0, 10);
export async function performanceComparisons(
  storeId: string,
  website: string | null,
) {
  const last = await db.searchMetric.findFirst({
    where: { storeId },
    orderBy: { date: "desc" },
    select: { date: true },
  });
  const end = last ? new Date(last.date).getTime() + 86400000 : Date.now();
  const recentStart = day(end - 28 * 86400000),
    previousStart = day(end - 56 * 86400000);
  const periods = await Promise.all([
    metrics(storeId, recentStart, day(end)),
    metrics(storeId, previousStart, recentStart),
  ]);
  const changes = await db.application.findMany({
    where: { storeId, status: "APPLIED" },
    include: { resource: true },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });
  const comparisons = website
    ? await Promise.all(
        changes.map(async (application) => {
          const page = `${website.replace(/\/$/, "")}/${application.resource.kind === "PRODUCT" ? "products" : "collections"}/${application.resource.handle}`;
          const applied = new Date(
            day(application.updatedAt.getTime()),
          ).getTime();
          // Exclude the mixed publication day from both windows.
          const [before, after] = await Promise.all([
            metrics(storeId, day(applied - 28 * 86400000), day(applied), page),
            metrics(
              storeId,
              day(applied + 86400000),
              day(applied + 29 * 86400000),
              page,
            ),
          ]);
          return {
            id: application.id,
            title: application.resource.title,
            appliedAt: application.updatedAt.toISOString(),
            page,
            before,
            after,
          };
        }),
      )
    : [];
  return { periods, comparisons, recentStart, previousStart, end: day(end) };
}
