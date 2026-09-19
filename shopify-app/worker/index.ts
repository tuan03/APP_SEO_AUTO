import "dotenv/config";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import db from "../app/db.server";
import { scheduleTick, storeTick } from "../app/services/jobs.server";
const connection = new Redis(
  process.env.REDIS_URL || "redis://127.0.0.1:6380",
  { maxRetriesPerRequest: null },
);
const queue = new Queue("store-ticks", { connection });
const worker = new Worker(
  "store-ticks",
  async (job) => {
    await storeTick(job.data.storeId);
  },
  {
    connection,
    concurrency: Number(process.env.WORKER_CONCURRENCY || 4),
    lockDuration: 120000,
  },
);
worker.on("failed", (job, error) =>
  console.error("worker", job?.id, error.message),
);
let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    await scheduleTick();
    const stores = await db.store.findMany({
      where: { active: true },
      select: { id: true },
    });
    for (const store of stores)
      await queue.add(
        "tick",
        { storeId: store.id },
        { jobId: store.id, removeOnComplete: true, removeOnFail: true },
      );
    await db.oAuthState.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    await db.webhookReceipt.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - 7 * 86400000) } },
    });
  } catch (e) {
    console.error("scheduler", String(e));
  } finally {
    ticking = false;
  }
}
const interval = setInterval(tick, 10000);
await tick();
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    clearInterval(interval);
    await worker.close();
    await queue.close();
    await connection.quit();
    await db.$disconnect();
    process.exit(0);
  });
console.log("SEO/AEO worker started");
