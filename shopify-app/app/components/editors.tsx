import { IntentEvidence } from "./keywords";
import type { ProposalView, KnowledgeView, Profile } from "../core/dashboard";
import { useState } from "react";
import { Form } from "react-router";
import type { Content, Snapshot } from "../core/content";
import { Badge, Button, Field } from "./forms";
export function ProposalEditor({
  proposal,
  current,
  currentHash,
}: {
  proposal: ProposalView;
  current: Snapshot;
  currentHash: string;
}) {
  const [content, set] = useState<Content>(proposal.content);
  const editable = ["PENDING", "CONFLICT"].includes(proposal.status);
  return (
    <section className="card">
      <h2>
        {proposal.resource.title} <Badge value={proposal.status} />
      </h2>
      <p className="muted">
        Knowledge {proposal.knowledgeId} · Prompt {proposal.promptVersion} ·
        Revision {proposal.revision}
      </p>
      <IntentEvidence
        proposal={proposal}
        key={`${proposal.id}-${proposal.revision}`}
      />
      <div className="compare">
        <div>
          <h3>Currently on Shopify</h3>
          <h4>{current.title}</h4>
          <p>{current.seo.title}</p>
          <p>{current.seo.description}</p>
          <iframe
            title="Current description"
            sandbox=""
            srcDoc={current.descriptionHtml}
          />
          <p>
            {current.faqs.length} FAQ entries · {current.images.length} images
          </p>
        </div>
        <div>
          <h3>Proposed content</h3>
          <Field
            label="Title"
            value={content.title}
            onChange={(v) => set({ ...content, title: v })}
          />
          <Field
            label={`SEO title (${[...content.seoTitle].length})`}
            value={content.seoTitle}
            onChange={(v) => set({ ...content, seoTitle: v })}
          />
          <Field
            label={`SEO description (${[...content.seoDescription].length})`}
            value={content.seoDescription}
            onChange={(v) => set({ ...content, seoDescription: v })}
          />
          <label>
            Description action
            <select
              value={content.descriptionMode || "REWRITE"}
              onChange={(e) =>
                set({
                  ...content,
                  descriptionMode: e.target.value as "KEEP" | "REWRITE",
                  ...(e.target.value === "KEEP"
                    ? { descriptionHtml: current.descriptionHtml }
                    : {}),
                })
              }
            >
              <option value="KEEP">
                Keep original description, images and links
              </option>
              <option value="REWRITE">Rewrite with supported HTML</option>
            </select>
          </label>
          <Field
            label="Description HTML"
            value={content.descriptionHtml}
            onChange={(v) => set({ ...content, descriptionHtml: v })}
            multiline
          />
          <details>
            <summary>Preview description</summary>
            <iframe
              title="Proposed description"
              sandbox=""
              srcDoc={content.descriptionHtml}
            />
          </details>
        </div>
      </div>
      <h3>FAQ</h3>
      {content.faqs.map((f, i) => (
        <div className="row" key={i}>
          <Field
            label={`Question ${i + 1}`}
            value={f.question}
            onChange={(v) =>
              set({
                ...content,
                faqs: content.faqs.map((x, j) =>
                  j === i ? { ...x, question: v } : x,
                ),
              })
            }
          />
          <Field
            label="Answer"
            value={f.answer}
            onChange={(v) =>
              set({
                ...content,
                faqs: content.faqs.map((x, j) =>
                  j === i ? { ...x, answer: v } : x,
                ),
              })
            }
          />
        </div>
      ))}
      <h3>Image alt text</h3>
      {content.imageAlts.map((a, i) => (
        <div className="row" key={a.id}>
          <img
            className="thumbnail"
            src={current.images.find((x) => x.id === a.id)?.url}
            alt="Product reference"
          />
          <Field
            label={a.id}
            value={a.alt}
            onChange={(v) =>
              set({
                ...content,
                imageAlts: content.imageAlts.map((x, j) =>
                  j === i ? { ...x, alt: v } : x,
                ),
              })
            }
          />
        </div>
      ))}
      {content.warnings.length > 0 && (
        <div className="notice">
          {content.warnings.map((w, i) => (
            <p key={i}>{w}</p>
          ))}
        </div>
      )}
      <details>
        <summary>Supporting facts</summary>
        {content.facts.map((f, i) => (
          <p key={i}>
            {f.claim} — {f.source}
          </p>
        ))}
      </details>
      {editable && (
        <div className="toolbar">
          <Form method="post">
            <input type="hidden" name="intent" value="saveProposal" />
            <input type="hidden" name="id" value={proposal.id} />
            <input type="hidden" name="revision" value={proposal.revision} />
            <input
              type="hidden"
              name="content"
              value={JSON.stringify(content)}
            />
            <button>Save edits</button>
          </Form>
          <Form method="post">
            <input
              type="hidden"
              name="intent"
              value={
                proposal.sourceHash === currentHash ? "approve" : "forceApprove"
              }
            />
            <input type="hidden" name="id" value={proposal.id} />
            <input type="hidden" name="revision" value={proposal.revision} />
            <input type="hidden" name="currentHash" value={currentHash} />
            <button
              className="primary"
              disabled={
                JSON.stringify(content) !== JSON.stringify(proposal.content)
              }
            >
              {proposal.sourceHash === currentHash
                ? "Approve saved version"
                : "Confirm overwrite of current values"}
            </button>
          </Form>
          <Button intent="reject" id={proposal.id}>
            Reject
          </Button>
        </div>
      )}
      <p className="muted">
        Save edits before approving. Approval applies all fields in this
        version.
      </p>
    </section>
  );
}
export function KnowledgeEditor({ item }: { item: KnowledgeView }) {
  const [content, set] = useState<Profile>(item.content);
  const update = <K extends keyof Profile>(key: K, value: Profile[K]) =>
    set({ ...content, [key]: value });
  return (
    <details className="card">
      <summary>
        <Badge value={item.status} />{" "}
        {new Date(item.createdAt).toISOString().replace("T", " ").slice(0, 16) +
          " UTC"}{" "}
        {item.baseId ? "— proposed addition" : "— store profile"}
      </summary>
      {(["brand", "positioning", "tone"] as const).map((key) => (
        <Field
          key={key}
          label={key}
          value={content[key]}
          onChange={(v) => update(key, v)}
          multiline={key === "positioning"}
        />
      ))}
      {(["markets", "searchIntents", "prohibitedClaims"] as const).map(
        (key) => (
          <Field
            key={key}
            label={`${key} (one per line)`}
            value={(content[key] || []).join("\n")}
            onChange={(v) => update(key, v.split("\n").filter(Boolean))}
            multiline
          />
        ),
      )}
      {(["facts", "audienceHypotheses", "policies"] as const).map((key) => (
        <div key={key}>
          <h3>{key}</h3>
          {(content[key] || []).map(
            (f: { claim: string; source: string }, i: number) => (
              <div className="row" key={i}>
                <Field
                  label="Statement"
                  value={f.claim}
                  onChange={(v) =>
                    update(
                      key,
                      content[key].map(
                        (x: { claim: string; source: string }, j: number) =>
                          j === i ? { ...x, claim: v } : x,
                      ),
                    )
                  }
                />
                <Field
                  label="Source"
                  value={f.source}
                  onChange={(v) =>
                    update(
                      key,
                      content[key].map(
                        (x: { claim: string; source: string }, j: number) =>
                          j === i ? { ...x, source: v } : x,
                      ),
                    )
                  }
                />
              </div>
            ),
          )}
        </div>
      ))}
      {item.status === "PENDING" && (
        <div className="toolbar">
          <Form method="post">
            <input type="hidden" name="intent" value="knowledgeApprove" />
            <input type="hidden" name="id" value={item.id} />
            <input
              type="hidden"
              name="content"
              value={JSON.stringify(content)}
            />
            <button className="primary">Approve knowledge</button>
          </Form>
          {item.baseId && (
            <Button intent="knowledgeRebase" id={item.id}>
              Merge with latest profile for review
            </Button>
          )}
          <Button intent="knowledgeReject" id={item.id}>
            Reject
          </Button>
        </div>
      )}
    </details>
  );
}
