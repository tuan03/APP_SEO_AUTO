import "dotenv/config";
import { z } from "zod";
import db from "../app/db.server";
import { generate } from "../app/services/gemini.server";
import { safeGet } from "../app/services/crawl.server";
const store = await db.store.create({
  data: { domain: `smoke-${Date.now()}.myshopify.com`, active: false },
});
try {
  const result = await safeGet("https://example.com");
  console.log(
    "Public HTTPS crawler:",
    result.type,
    result.body.length,
    "bytes",
  );
  if (process.argv.includes("--gemini")) {
    const output = await generate(
      store.id,
      "SMOKE",
      "Return a JSON object with message set to Hello, world!",
      z.object({ message: z.string() }),
    );
    console.log("Vertex structured output:", output);
    const usage = await db.usage.findMany({
      where: { storeId: store.id },
      select: { input: true, output: true, cached: true, thinking: true },
    });
    console.log("Usage:", usage);
  }
} finally {
  await db.store.delete({ where: { id: store.id } });
  await db.$disconnect();
}
