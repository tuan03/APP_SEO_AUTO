import { Form, Link } from "react-router";
import { useState } from "react";
import type { PageData, ProposalView } from "../core/dashboard";
import type { ResearchRecord } from "../services/intent-research.server";
import { Badge, Button, Empty } from "./forms";

export function KeywordMap({ data }: { data: PageData<"keywords"> }) {
  const m = data.keywordMap;
  const params = new URLSearchParams({
    q: m.q,
    state: m.state,
    market: m.market,
  });
  return (
    <>
      <section className="card">
        <h2>Store keyword map</h2>
        <p>
          {m.indexed.toLocaleString()} / {m.resources.toLocaleString()} pages
          have mapped targets in this scope. Baselines inferred from titles are
          unverified; scan pages to research their intent.
        </p>
        <div className="toolbar">
          <Button intent="keywordIndex">
            Index / reconcile entire catalog
          </Button>
          <Button intent="searchSync">Sync search queries</Button>
          <Link reloadDocument to={`/app/keywords-export?${params}`}>
            Export filtered CSV
          </Link>
        </div>
        <Form method="get" className="toolbar">
          <label>
            Keyword, topic or page
            <input name="q" defaultValue={m.q} />
          </label>
          <label>
            Country
            <input
              name="market"
              placeholder="USA / GBR / GLOBAL"
              defaultValue={m.market}
            />
          </label>
          <label>
            State
            <select name="state" defaultValue={m.state}>
              <option value="">Current & pending</option>
              {[
                "BASELINE",
                "PROPOSED",
                "APPROVED",
                "ACTIVE",
                "ARCHIVED",
                "REJECTED",
              ].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <button>Filter</button>
        </Form>
        <p className="muted">
          Overlap checks compare primary/secondary keyword signatures and topic
          clusters across this store and market. Related topics and shared words
          do not prove cannibalization. Exact same-target overlaps require a
          recorded decision before approval.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Page / state</th>
                <th>Primary / secondary</th>
                <th>Intent / buyer need</th>
                <th>Evidence / scope</th>
                <th>Overlaps</th>
              </tr>
            </thead>
            <tbody>
              {m.rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link to={`?${params}&id=${r.id}`}>{r.resource.title}</Link>
                    <p>
                      {r.resource.kind} · <Badge value={r.state} />
                    </p>
                  </td>
                  <td>
                    <strong>{r.primary}</strong>
                    <p>{r.secondary.join(" · ")}</p>
                    <small>Topic: {r.cluster}</small>
                  </td>
                  <td>
                    {r.intent}
                    <p>{r.buyerNeed}</p>
                  </td>
                  <td>
                    {r.evidenceLevel}
                    <p>
                      {r.market} / {r.language}
                    </p>
                  </td>
                  <td>
                    <Link to={`?${params}&id=${r.id}`}>
                      {r.overlaps} potential · {r.blocking} need a decision
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!m.rows.length && (
          <Empty>
            No targets match. Sync and index the catalog, then scan products or
            collections.
          </Empty>
        )}
        <div className="toolbar">
          <Link to={`?${params}&offset=${Math.max(0, data.offset - 25)}`}>
            Previous
          </Link>
          <span>{m.total} target versions</span>
          <Link to={`?${params}&offset=${data.offset + 25}`}>Next</Link>
        </div>
      </section>
      {m.detail && (
        <section className="card">
          <h2>{m.detail.primary}</h2>
          <p>{m.detail.rationale}</p>
          {m.detail.proposalId && (
            <Link to={`/app/review?id=${m.detail.proposalId}`}>
              Review content and edit keyword strategy
            </Link>
          )}
          <h3>Potential overlaps across the map</h3>
          {m.conflicts.map((c) => (
            <article className="card" key={c.pairKey}>
              <h4>
                {c.other.resource.title}: {c.other.primary}
              </h4>
              <Badge value={c.type} />
              <p>{c.reason}</p>
              <p>Other buyer need: {c.other.buyerNeed}</p>
              <p>
                {c.other.state} · {c.other.evidenceLevel}
              </p>
              <Link to={`?id=${c.other.id}`}>View other target</Link>
              {c.decision ? (
                <p className="notice">
                  {c.decision.decision}: {c.decision.reason} —{" "}
                  {c.decision.actor}
                </p>
              ) : (
                <Form method="post">
                  <input type="hidden" name="intent" value="keywordDecision" />
                  <input type="hidden" name="id" value={m.detail!.id} />
                  <input type="hidden" name="otherId" value={c.other.id} />
                  <input type="hidden" name="pairKey" value={c.pairKey} />
                  <label>
                    Decision
                    <select name="decision">
                      <option value="DISTINCT_INTENT">
                        Keep: distinct buyer needs
                      </option>
                      <option value="HIERARCHY">
                        Keep: collection / product hierarchy
                      </option>
                      <option value="ACCEPT_OVERLAP">
                        Accept overlap with a documented reason
                      </option>
                    </select>
                  </label>
                  <label>
                    Evidence and reason
                    <textarea
                      name="reason"
                      required
                      minLength={15}
                      maxLength={2000}
                      placeholder="Explain the real distinction or why both pages should remain targeted."
                    />
                  </label>
                  <button>Record decision for these versions</button>
                </Form>
              )}
              <p className="muted">
                To change targeting, edit the proposal strategy and content,
                then rerun QA; or reject and rescan. This decision does not edit
                Shopify.
              </p>
            </article>
          ))}
          {!m.conflicts.length && (
            <p>No overlaps found by the current indexed checks.</p>
          )}
          {m.nextPeer && (
            <Link to={`?id=${m.detail.id}&peerAfter=${m.nextPeer}`}>
              Next overlap page
            </Link>
          )}
          <details>
            <summary>Decision history for this target</summary>
            {m.decisions.map((d) => (
              <p key={d.id}>
                {d.createdAt} · {d.actor} · {d.decision}: {d.reason}
              </p>
            ))}
          </details>
        </section>
      )}
      <section className="card">
        <h2>Observed search queries</h2>
        <p>
          Latest available rows, separate from intended targets. Search Console
          may omit queries; missing rows do not mean zero demand.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date / page</th>
                <th>Query</th>
                <th>Country / device</th>
                <th>Clicks / impressions</th>
              </tr>
            </thead>
            <tbody>
              {m.queries.map((q) => (
                <tr key={q.id}>
                  <td>
                    {q.date}
                    <p>{q.page}</p>
                  </td>
                  <td>{q.query}</td>
                  <td>
                    {q.country} / {q.device}
                  </td>
                  <td>
                    {q.clicks} / {q.impressions}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!m.queries.length && (
          <Empty>
            Connect Search Console and sync queries to add observed demand
            evidence.
          </Empty>
        )}
      </section>
    </>
  );
}

export function IntentEvidence({ proposal }: { proposal: ProposalView }) {
  const record = proposal.research as unknown as ResearchRecord | null;
  const qa = proposal.qa as unknown as {
    status?: string;
    summary?: string;
    checkedAt?: string;
    issues?: { severity: string; field: string; message: string }[];
  } | null;
  const [plan, setPlan] = useState(JSON.stringify(record?.plan, null, 2));
  if (!record)
    return (
      <p className="notice">
        Legacy proposal: rescan to add keyword research and independent QA.
      </p>
    );
  const editable = ["PENDING", "CONFLICT"].includes(proposal.status);
  return (
    <section className="card">
      <h3>Intent and keyword strategy</h3>
      <p>
        <strong>{record.plan.primary}</strong> · {record.market} /{" "}
        {record.language} · {record.evidenceLevel}
      </p>
      <p>{record.plan.buyerNeed}</p>
      <p>{record.plan.rationale}</p>
      <p>
        {record.plan.changeScope} · {record.plan.intent}
      </p>
      <details open>
        <summary>Buyer situations and decision questions</summary>
        {record.plan.buyerScenarios?.length ? (
          record.plan.buyerScenarios.map((s) => (
            <article key={s.id}>
              <h4>{s.situation}</h4>
              <Badge value={s.status} />
              <p>Desired outcome: {s.desiredOutcome}</p>
              <ul>
                {s.decisionQuestions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
              <p className="muted">Uncertainty: {s.uncertainty}</p>
              <small>
                Product-fit evidence: {s.evidenceIds.join(", ")} · Scenario:{" "}
                {s.id}
              </small>
            </article>
          ))
        ) : (
          <p>Rescan this earlier version to add structured buyer scenarios.</p>
        )}
      </details>
      <h4>Independent content QA: {qa?.status || "NOT_RUN"}</h4>
      <p>{qa?.summary}</p>
      {qa?.issues?.map((i, n) => (
        <p key={n}>
          <strong>
            {i.severity} · {i.field}
          </strong>
          : {i.message}
        </p>
      ))}
      {editable && (
        <Button intent="recheckProposal" id={proposal.id}>
          Run QA on saved version
        </Button>
      )}
      <details>
        <summary>Candidate keywords and reasons</summary>
        {record.plan.candidates.map((c) => (
          <p key={c.keyword}>
            <strong>{c.keyword}</strong> ({c.origin}) — {c.reason}
            <br />
            Evidence: {c.evidenceIds.join(", ")} · Buyer scenarios:{" "}
            {c.scenarioIds?.join(", ") || "Not recorded"}
          </p>
        ))}
      </details>
      <details>
        <summary>Evidence and limitations</summary>
        {[...record.limitations, ...record.plan.limitations].map((l, i) => (
          <p key={i}>{l}</p>
        ))}
        {record.evidence.map((e) => (
          <details key={e.id}>
            <summary>
              {e.id} · {e.kind} · {e.capturedAt}
            </summary>
            <pre>{e.text}</pre>
          </details>
        ))}
      </details>
      {editable && (
        <details>
          <summary>Edit keyword strategy</summary>
          <p>
            Keep candidate evidence IDs. Changing the strategy invalidates QA
            and previous overlap decisions. Save content edits separately first.
          </p>
          <Form method="post">
            <input type="hidden" name="intent" value="saveProposal" />
            <input type="hidden" name="id" value={proposal.id} />
            <input type="hidden" name="revision" value={proposal.revision} />
            <input
              type="hidden"
              name="content"
              value={JSON.stringify(proposal.content)}
            />
            <label>
              Research plan JSON
              <textarea
                name="researchPlan"
                rows={18}
                value={plan}
                onChange={(e) => setPlan(e.target.value)}
              />
            </label>
            <button>Save strategy and require new QA</button>
          </Form>
        </details>
      )}
      <Link to="/app/keywords">Open store keyword map</Link>
    </section>
  );
}
