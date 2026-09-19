import { describe, it, expect } from "vitest";
import { applySafely, type ApplyRecord, type ApplyIO } from "../app/core/apply";
import { contentHash, eligible, type Snapshot } from "../app/core/content";
import { packBackup, unpackBackup } from "../app/core/backup";
const base: Snapshot = {
  id: "gid://shopify/Product/1",
  kind: "PRODUCT",
  title: "Old",
  descriptionHtml: "<p>Old</p>",
  handle: "stable",
  seo: { title: null, description: null },
  faqs: [],
  images: [{ id: "image1", url: "https://cdn.shopify.com/a.png", alt: "old" }],
  context: {},
};
function fixture() {
  let live = structuredClone(base);
  const rec: ApplyRecord = {
    before: null,
    target: {
      ...structuredClone(base),
      title: "New",
      faqs: [{ question: "Q", answer: "A" }],
      images: [{ ...base.images[0], alt: "new" }],
    },
    expectedHash: contentHash(base),
    steps: {},
  };
  const calls: string[] = [];
  const io: ApplyIO = {
    read: async () => structuredClone(live),
    checkpoint: async () => {},
    backup: async () => {
      calls.push("backup");
    },
    core: async (s) => {
      calls.push("core");
      live = {
        ...live,
        title: s.title,
        descriptionHtml: s.descriptionHtml,
        handle: s.handle,
        seo: s.seo,
      };
    },
    faq: async (s) => {
      calls.push("faq");
      live.faqs = s.faqs;
    },
    image: async (_s, i) => {
      calls.push("image");
      live.images = [i];
    },
  };
  return {
    rec,
    io,
    calls,
    change: () => {
      live.title = "Merchant changed";
    },
  };
}
describe("safe apply", () => {
  it("backs up before any write and verifies full apply", async () => {
    const f = fixture();
    await applySafely(f.rec, f.io);
    expect(f.calls).toEqual(["backup", "core", "faq", "image"]);
    expect(f.rec.steps.verified).toBe(true);
  });
  it("never writes when backup fails", async () => {
    const f = fixture();
    f.io.backup = async () => {
      throw Error("unavailable");
    };
    await expect(applySafely(f.rec, f.io)).rejects.toThrow();
    expect(f.calls).toEqual([]);
  });
  it("refuses edits made after generation", async () => {
    const f = fixture();
    f.change();
    await expect(applySafely(f.rec, f.io)).rejects.toThrow("CONFLICT");
    expect(f.calls).toEqual([]);
  });
  it("recovers an ambiguous timeout without writing the core again", async () => {
    const f = fixture(),
      write = f.io.core;
    f.io.core = async (s) => {
      await write(s);
      throw Error("timeout");
    };
    await expect(applySafely(f.rec, f.io)).rejects.toThrow("timeout");
    f.io.core = write;
    await applySafely(f.rec, f.io);
    expect(f.calls.filter((x) => x === "core")).toHaveLength(1);
    expect(f.calls.filter((x) => x === "backup")).toHaveLength(1);
  });
  it("does not overwrite a merchant edit during recovery", async () => {
    const f = fixture();
    f.io.faq = async () => {
      throw Error("outage");
    };
    await expect(applySafely(f.rec, f.io)).rejects.toThrow();
    f.change();
    await expect(applySafely(f.rec, f.io)).rejects.toThrow("CONFLICT");
  });
});
it("preserves large Unicode backup and detects missing/corrupt chunks", () => {
  const value = { text: "Tiếng Việt 🦋".repeat(20000) };
  const { manifest, parts } = packBackup(value, "app1");
  expect(parts.length).toBeGreaterThan(1);
  expect(unpackBackup(manifest, parts)).toEqual(value);
  expect(() => unpackBackup(manifest, parts.slice(1))).toThrow();
});
it("does not rescan self-applied content as an external change", () => {
  expect(
    eligible("CHANGED", {
      lastScannedAt: new Date(),
      sourceHash: "new",
      scannedHash: "old",
      lastAppliedHash: "new",
    }),
  ).toBe(false);
});
