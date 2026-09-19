import { contentHash, hash, type Snapshot } from "./content";
export interface ApplyRecord {
  before: Snapshot | null;
  target: Snapshot;
  expectedHash: string;
  steps: Record<string, boolean>;
}
export interface ApplyIO {
  read(): Promise<Snapshot>;
  checkpoint(record: ApplyRecord): Promise<void>;
  backup(s: Snapshot): Promise<void>;
  core(s: Snapshot): Promise<void>;
  faq(s: Snapshot): Promise<void>;
  image(s: Snapshot, i: Snapshot["images"][number]): Promise<void>;
}
const core = (s: Snapshot) => ({
  title: s.title,
  descriptionHtml: s.descriptionHtml,
  handle: s.handle,
  seo: s.seo,
});
export async function applySafely(record: ApplyRecord, io: ApplyIO) {
  let current = await io.read();
  if (!record.before) {
    if (contentHash(current) !== record.expectedHash)
      throw new Error(
        "CONFLICT: Shopify content changed; review before overwriting",
      );
    record.before = current;
    await io.checkpoint(record);
  }
  const before = record.before;
  const acceptable = (actual: unknown, old: unknown, next: unknown) =>
    hash(actual) === hash(old) || hash(actual) === hash(next);
  const guard = (s: Snapshot) => {
    if (
      !acceptable(core(s), core(before), core(record.target)) ||
      !acceptable(s.faqs, before.faqs, record.target.faqs)
    )
      throw new Error("CONFLICT: content changed during apply");
    if (
      hash(s.images.map((i) => i.id).sort()) !==
      hash(before.images.map((i) => i.id).sort())
    )
      throw new Error("CONFLICT: image membership changed");
    for (const i of s.images)
      if (
        !acceptable(
          i.alt,
          before.images.find((x) => x.id === i.id)?.alt,
          record.target.images.find((x) => x.id === i.id)?.alt,
        )
      )
        throw new Error("CONFLICT: image alt changed");
  };
  guard(current);
  if (!record.steps.backup) {
    await io.backup(before);
    record.steps.backup = true;
    await io.checkpoint(record);
  }
  current = await io.read();
  guard(current);
  if (hash(core(current)) !== hash(core(record.target)))
    await io.core(record.target);
  record.steps.core = true;
  await io.checkpoint(record);
  current = await io.read();
  guard(current);
  if (hash(current.faqs) !== hash(record.target.faqs))
    await io.faq(record.target);
  record.steps.faq = true;
  await io.checkpoint(record);
  for (const image of record.target.images) {
    current = await io.read();
    guard(current);
    if (current.images.find((i) => i.id === image.id)?.alt !== image.alt)
      await io.image(record.target, image);
    record.steps[`image:${image.id}`] = true;
    await io.checkpoint(record);
  }
  if (contentHash(await io.read()) !== contentHash(record.target))
    throw new Error("PARTIAL: verification does not match approved content");
  record.steps.verified = true;
  await io.checkpoint(record);
}
