import type { Prisma } from "@prisma/client";
import db from "../db.server";

// A pause takes effect after the current checkpoint. Keep progress, never revive
// paused/canceled work when an external request finishes late.
export async function checkpointJob(
  args: { where: { id: string }; data: Prisma.ScanJobUpdateManyMutationInput },
  transaction?: Prisma.TransactionClient,
) {
  const run = async (tx: Prisma.TransactionClient) => {
    const rows = await tx.$queryRaw<
      { status: string }[]
    >`SELECT status FROM "ScanJob" WHERE id = ${args.where.id} FOR UPDATE`;
    const status = rows[0]?.status;
    if (!status || !["QUEUED", "RUNNING", "PAUSED"].includes(status)) return;
    const data = { ...args.data };
    if (status === "PAUSED") delete data.status;
    await tx.scanJob.update({ where: args.where, data });
  };
  if (transaction) await run(transaction);
  else await db.$transaction(run);
}
