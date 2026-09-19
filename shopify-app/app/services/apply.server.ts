import { approveTarget, activateTarget } from "./keywords.server";
import {
  researchFingerprint,
  type ResearchRecord,
} from "./intent-research.server";
import { qaGate } from "../core/keywords";
import { settingsSchema, hash } from "../core/content";
import db from "../db.server";
import { applySafely, type ApplyRecord } from "../core/apply";
import {
  contentHash,
  validateContent,
  withContent,
  type Snapshot,
} from "../core/content";
import {
  readSnapshot,
  writeBackup,
  writeCore,
  writeImage,
  setMetafields,
  saveResource,
} from "./shopify-api.server";
import { audit } from "./tenant.server";
const json = (x: unknown) => JSON.parse(JSON.stringify(x));
export async function approveProposal(
  storeId: string,
  id: string,
  actor: string,
  force = false,
  expectedRevision?: number,
  observedHash?: string,
) {
  const p = await db.proposal.findFirstOrThrow({
    where: { id, storeId, status: { in: ["PENDING", "CONFLICT"] } },
    include: { resource: true, store: true },
  });
  const current = await readSnapshot(p.store.domain, p.resource.gid);
  if (expectedRevision !== undefined && p.revision !== expectedRevision)
    throw new Error("Proposal revision changed; refresh before approving");
  if (force && (!observedHash || contentHash(current) !== observedHash))
    throw new Error(
      "Store changed since you reviewed the overwrite; refresh the comparison",
    );
  if (!force && contentHash(current) !== p.sourceHash) {
    await db.proposal.update({ where: { id }, data: { status: "CONFLICT" } });
    throw new Error(
      "CONFLICT: Shopify content changed. Compare the latest content before confirming overwrite.",
    );
  }
  const content = validateContent(p.content, current, p.store.settings);
  if (p.research) {
    const problem = qaGate(p.qa, researchFingerprint(p.content, p.research));
    if (problem) throw Error(problem);
    const record = p.research as unknown as ResearchRecord;
    if (record.market !== settingsSchema.parse(p.store.settings).targetMarket)
      throw Error("Target country changed; rescan before approving");
    if (hash(current) !== record.sourceFingerprint)
      throw Error(
        "Source facts changed after intent research; rescan this version before approval",
      );
  }
  await db.$transaction(async (tx) => {
    await approveTarget(tx, storeId, id);
    if (
      await tx.application.count({
        where: {
          storeId,
          proposalId: id,
          status: { in: ["QUEUED", "RUNNING", "PARTIAL", "FAILED"] },
        },
      })
    )
      throw Error(
        "An existing application must finish before this proposal can be approved again",
      );
    const updated = await tx.proposal.updateMany({
      where: {
        id,
        storeId,
        revision: p.revision,
        status: { in: ["PENDING", "CONFLICT"] },
      },
      data: { status: "APPROVED" },
    });
    if (updated.count !== 1)
      throw new Error("Proposal was changed or approved in another session");
    await tx.application.create({
      data: {
        storeId,
        resourceId: p.resourceId,
        proposalId: id,
        target: json(withContent(current, content)),
        expectedHash: contentHash(current),
        actor,
      },
    });
    await tx.audit.create({
      data: {
        storeId,
        actor,
        event: force ? "APPROVE_FORCE" : "APPROVE",
        target: id,
      },
    });
  });
}
export async function requestRestore(
  storeId: string,
  id: string,
  actor: string,
) {
  const app = await db.application.findFirstOrThrow({
    where: { id, storeId },
    include: { store: true, resource: true },
  });
  if (!app.before) throw new Error("No backup exists for this operation");
  const current = await readSnapshot(app.store.domain, app.resource.gid);
  const before = app.before as unknown as Snapshot;
  const target: Snapshot = {
    ...current,
    title: before.title,
    descriptionHtml: before.descriptionHtml,
    seo: before.seo,
    faqs: before.faqs,
    images: current.images.map((image) => ({
      ...image,
      alt: before.images.find((old) => old.id === image.id)?.alt ?? image.alt,
    })),
  };
  await db.application.create({
    data: {
      storeId,
      resourceId: app.resourceId,
      restoreOf: id,
      target: json(target),
      expectedHash: contentHash(current),
      actor,
    },
  });
  await audit(storeId, actor, "RESTORE_REQUESTED", id);
}
export async function executeApplication(id: string) {
  const app = await db.application.findUniqueOrThrow({
    where: { id },
    include: { store: true, resource: true },
  });
  if (!app.store.active || !["QUEUED", "RUNNING"].includes(app.status)) return;
  const record: ApplyRecord = {
    before: app.before as unknown as Snapshot | null,
    target: app.target as unknown as Snapshot,
    expectedHash: app.expectedHash,
    steps: app.steps as Record<string, boolean>,
  };
  await db.application.update({
    where: { id },
    data: { status: "RUNNING", error: null },
  });
  try {
    if (app.proposalId) {
      const proposal = await db.proposal.findFirstOrThrow({
        where: { id: app.proposalId, storeId: app.storeId },
      });
      if (proposal.research) {
        const expected = withContent(
          proposal.sourceSnapshot as unknown as Snapshot,
          validateContent(
            proposal.content,
            proposal.sourceSnapshot as unknown as Snapshot,
            app.store.settings,
          ),
        );
        if (contentHash(expected) !== contentHash(record.target))
          throw Error(
            "CONFLICT: proposal differs from this application's saved target",
          );
        const problem = qaGate(
          proposal.qa,
          researchFingerprint(proposal.content, proposal.research),
        );
        if (problem) throw Error(problem);
      }
    }
    await applySafely(record, {
      read: () => readSnapshot(app.store.domain, app.resource.gid),
      checkpoint: async (r) => {
        await db.application.update({
          where: { id },
          data: { before: json(r.before), steps: json(r.steps) },
        });
      },
      backup: (s) => writeBackup(app.store.domain, s, id),
      core: (s) => writeCore(app.store.domain, s),
      faq: (s) =>
        setMetafields(app.store.domain, s.id, [{ key: "faqs", value: s.faqs }]),
      image: (s, i) => writeImage(app.store.domain, s, i),
    });
    const resource = await saveResource(
      app.storeId,
      await readSnapshot(app.store.domain, app.resource.gid),
    );
    await db.resource.update({
      where: { id: resource.id },
      data: { lastAppliedHash: resource.sourceHash },
    });
    await db.$transaction(async (tx) => {
      await activateTarget(
        tx,
        app.storeId,
        resource.id,
        app.proposalId,
        resource.snapshot as unknown as Snapshot,
      );
      await tx.application.update({
        where: { id },
        data: { status: "APPLIED" },
      });
      if (app.proposalId)
        await tx.proposal.updateMany({
          where: { id: app.proposalId, storeId: app.storeId },
          data: { status: "APPLIED" },
        });
    });
    await audit(
      app.storeId,
      app.actor,
      app.restoreOf ? "RESTORED" : "APPLIED",
      id,
    );
  } catch (e) {
    const error = String(e);
    if (app.proposalId && error.includes("CONFLICT"))
      await db.proposal.updateMany({
        where: { id: app.proposalId, storeId: app.storeId, status: "APPROVED" },
        data: { status: "CONFLICT" },
      });
    await db.application.update({
      where: { id },
      data: {
        status:
          record.steps.core || record.steps.faq
            ? "PARTIAL"
            : error.includes("CONFLICT")
              ? "CONFLICT"
              : "FAILED",
        error,
      },
    });
  }
}
