import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  useRevalidator,
} from "react-router";
import { loader, action } from "../services/dashboard.server";
import { Badge, Button, Rule, Empty } from "../components/forms";
import { ProposalEditor, KnowledgeEditor } from "../components/editors";
import { Settings, Performance } from "../components/settings";
import "../styles/dashboard.css";
export { loader, action };
export default function Dashboard() {
  const data = useLoaderData<typeof loader>(),
    result = useActionData<typeof action>(),
    navigation = useNavigation(),
    revalidator = useRevalidator();
  const title = {
    overview: "Overview",
    products: "Products",
    collections: "Collections",
    knowledge: "Store knowledge",
    jobs: "Scan jobs",
    review: "Review",
    history: "History & restore",
    performance: "Search performance",
    settings: "Settings",
  }[data.page];
  return (
    <main className="dashboard">
      <header>
        <div>
          <span className="eyebrow">SEO / AEO WORKSPACE</span>
          <h1>{title}</h1>
          <p className="muted">{data.store.domain}</p>
        </div>
        <button
          onClick={() => revalidator.revalidate()}
          disabled={revalidator.state !== "idle"}
        >
          Refresh
        </button>
      </header>
      {navigation.state !== "idle" && <div className="notice">Saving…</div>}
      {result && (
        <div
          role="status"
          className={`notice ${result.ok ? "success" : "error"}`}
        >
          <pre>{result.message}</pre>
          {"connectUrl" in result && result.connectUrl && (
            <a href={result.connectUrl} target="_top">
              Continue to Google
            </a>
          )}
        </div>
      )}
      {data.page === "overview" && (
        <>
          <div className="stats">
            {["Products", "Collections", "Awaiting review", "Active jobs"].map(
              (t, i) => (
                <section className="card" key={t}>
                  <span>{t}</span>
                  <strong>{data.counts[i].toLocaleString()}</strong>
                </section>
              ),
            )}
          </div>
          <section className="card">
            <h2>Get your store ready</h2>
            <div className="toolbar">
              <Button intent="sync">Sync catalog</Button>
              <Button intent="research">Build store knowledge</Button>
              <Link className="button" to="/app/knowledge">
                Review knowledge
              </Link>
              <Link className="button" to="/app/products">
                Choose products
              </Link>
            </div>
            <p>
              {data.knowledge
                ? "Approved knowledge is ready for generation."
                : "Approve the initial store knowledge before starting content generation."}
            </p>
          </section>
          <section className="card">
            <h2>AI usage</h2>
            <div className="grid">
              {Object.entries(data.usage._sum).map(([key, value]) => (
                <div key={key}>
                  <span className="muted">{key}</span>
                  <p>{value === null ? "Not available" : String(value)}</p>
                </div>
              ))}
            </div>
            <p className="muted">
              Cost estimates require configured rates. Cached tokens are
              included in input. Thinking is separate from response output.
            </p>
          </section>
          <section className="card">
            <h2>Recent activity</h2>
            {data.recent.map((a) => (
              <p key={a.id}>
                {new Date(a.createdAt).toLocaleString("en-GB", {
                  timeZone: data.store.timezone,
                })}{" "}
                · {a.event} · {a.actor}
              </p>
            ))}
          </section>
        </>
      )}
      {(data.page === "products" || data.page === "collections") && (
        <>
          <section className="card">
            <Form method="get" className="filters">
              {["q", "vendor", "tag", "collection", "productType", "after"].map(
                (k) => (
                  <label key={k}>
                    {k === "q"
                      ? "Search title"
                      : k === "collection"
                        ? "Collection Shopify ID"
                        : k === "after"
                          ? "Synced after"
                          : k}
                    <input
                      name={k}
                      type={k === "after" ? "date" : "text"}
                      defaultValue={data.filter[k] || ""}
                    />
                  </label>
                ),
              )}
              <label>
                Status
                <select name="status" defaultValue={data.filter.status || ""}>
                  <option value="">All</option>
                  <option>ACTIVE</option>
                  <option>DRAFT</option>
                  <option>ARCHIVED</option>
                </select>
              </label>
              <label>
                Optimization
                <select
                  name="optimization"
                  defaultValue={data.filter.optimization || ""}
                >
                  <option value="">All</option>
                  <option value="UNSCANNED">Not scanned</option>
                  <option value="SCANNED">Scanned</option>
                </select>
              </label>
              <button>Filter</button>
            </Form>
          </section>
          <section className="card">
            <p>{data.total.toLocaleString()} matching items</p>
            <Form method="post">
              <input type="hidden" name="intent" value="scan" />
              <input
                type="hidden"
                name="filter"
                value={JSON.stringify(data.filter)}
              />
              <div className="toolbar">
                <select name="selection">
                  <option value="selected">Selected items</option>
                  <option value="all">All filtered results (all pages)</option>
                </select>
                <Rule />
                <button className="primary">Create scan job</button>
                <Link to={`/app/jobs?${new URLSearchParams(data.filter)}`}>
                  Schedule this filter
                </Link>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Select</th>
                    <th>Title</th>
                    <th>Status</th>
                    <th>Last scan</th>
                    <th>Versions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <input
                          aria-label={`Select ${r.title}`}
                          type="checkbox"
                          name="selected"
                          value={r.id}
                        />
                      </td>
                      <td>
                        {r.title}
                        <small>{r.gid}</small>
                      </td>
                      <td>
                        <Badge value={r.status} />
                      </td>
                      <td>
                        {r.lastScannedAt
                          ? new Date(r.lastScannedAt).toLocaleString("en-GB", {
                              timeZone: data.store.timezone,
                            })
                          : "Not scanned"}
                      </td>
                      <td>{r._count.proposals}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!data.rows.length && (
                <Empty>
                  No matching items. Sync the catalog or change your filters.
                </Empty>
              )}
            </Form>
            <div className="toolbar">
              <Link
                to={`?${new URLSearchParams({ ...data.filter, offset: String(Math.max(0, data.offset - 25)) })}`}
              >
                Previous
              </Link>
              <Link
                to={`?${new URLSearchParams({ ...data.filter, offset: String(data.offset + 25) })}`}
              >
                Next
              </Link>
            </div>
          </section>
        </>
      )}
      {data.page === "knowledge" && (
        <>
          <div className="toolbar">
            <Button intent="research">Research / refresh knowledge</Button>
            <p>
              Only approved profiles are used. Review market assumptions and
              sources before approving.
            </p>
          </div>
          {data.rows.map((k) => (
            <KnowledgeEditor key={`${k.id}-${k.status}-${k.baseId}`} item={k} />
          ))}
          {!data.rows.length && (
            <Empty>
              Sync your catalog, then build your first store profile.
            </Empty>
          )}
          <section className="card">
            <h2>Crawled sources</h2>
            {data.sources.map((s) => (
              <p key={s.url}>
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.url}
                </a>
              </p>
            ))}
          </section>
        </>
      )}
      {data.page === "review" && (
        <>
          {data.selected && (
            <ProposalEditor
              key={`${data.selected.id}-${data.selected.revision}`}
              proposal={data.selected}
              current={data.current}
              currentHash={data.currentHash}
            />
          )}
          <section className="card">
            <Form method="post">
              <input type="hidden" name="intent" value="approveMany" />
              <button className="primary">
                Approve selected saved versions
              </button>
              <table>
                <thead>
                  <tr>
                    <th>Select</th>
                    <th>Item</th>
                    <th>Created</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <input
                          aria-label={`Select ${p.resource.title}`}
                          type="checkbox"
                          name="selected"
                          value={`${p.id}|${p.revision}`}
                          disabled={p.status !== "PENDING"}
                        />
                      </td>
                      <td>
                        <Link to={`?id=${p.id}`}>{p.resource.title}</Link>
                        <small>{p.resource.kind}</small>
                      </td>
                      <td>
                        {new Date(p.createdAt).toLocaleString("en-GB", {
                          timeZone: data.store.timezone,
                        })}
                      </td>
                      <td>
                        <Badge value={p.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Form>
            {!data.rows.length && (
              <Empty>
                Generated proposals will appear here. Nothing is applied until
                you approve.
              </Empty>
            )}
          </section>
        </>
      )}
      {data.page === "jobs" && (
        <>
          <section className="card">
            <h2>New schedule</h2>
            <Form method="post">
              <input type="hidden" name="intent" value="schedule" />
              <input
                type="hidden"
                name="filter"
                value={JSON.stringify(data.filter)}
              />
              <p>
                Scope:{" "}
                {Object.keys(data.filter).length
                  ? Object.entries(data.filter)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(" · ")
                  : "All products and collections"}
                . Choose filters from Products or Collections to narrow the
                schedule.
              </p>
              <div className="grid">
                <label>
                  Name
                  <input name="name" required />
                </label>
                <label>
                  Frequency
                  <select name="frequency">
                    <option value="once">Once</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="continuous">Continuous (daily check)</option>
                  </select>
                </label>
                <label>
                  One-time run (with timezone offset)
                  <input name="once" placeholder="2026-10-01T09:00:00+07:00" />
                </label>
                <label>
                  Time zone
                  <input name="timezone" defaultValue={data.store.timezone} />
                </label>
                <label>
                  Hour (0–23)
                  <input
                    type="number"
                    name="hour"
                    defaultValue="9"
                    min="0"
                    max="23"
                  />
                </label>
                <label>
                  Weekday
                  <select name="weekday">
                    {[
                      "Sunday",
                      "Monday",
                      "Tuesday",
                      "Wednesday",
                      "Thursday",
                      "Friday",
                      "Saturday",
                    ].map((d, i) => (
                      <option value={i} key={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Day of month (1–28)
                  <input
                    name="day"
                    type="number"
                    defaultValue="1"
                    min="1"
                    max="28"
                  />
                </label>
                <Rule />
              </div>
              <button>Create schedule</button>
            </Form>
            {data.schedules.map((s) => (
              <div className="row" key={s.id}>
                <span>
                  {s.name} · {s.active ? "Enabled" : "Paused"} ·{" "}
                  {new Date(s.nextRun).toLocaleString("en-GB", {
                    timeZone: data.store.timezone,
                  })}{" "}
                  ({s.timezone})
                </span>
                <Button intent="toggleSchedule" id={s.id}>
                  {s.active ? "Pause schedule" : "Enable schedule"}
                </Button>
              </div>
            ))}
          </section>
          <section className="card">
            <h2>Jobs</h2>
            <table>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>State</th>
                  <th>Items</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((j) => (
                  <tr key={j.id}>
                    <td>
                      <Link to={`?id=${j.id}`}>
                        {j.type} ·{" "}
                        {new Date(j.createdAt).toLocaleString("en-GB", {
                          timeZone: data.store.timezone,
                        })}
                      </Link>
                      {j.error && <small className="error">{j.error}</small>}
                    </td>
                    <td>
                      <Badge value={j.status} />
                    </td>
                    <td>{j._count.items}</td>
                    <td>
                      <Button intent="pause" id={j.id}>
                        Pause
                      </Button>
                      <Button intent="resume" id={j.id}>
                        Resume
                      </Button>
                      <Button intent="retryJob" id={j.id}>
                        Retry failures
                      </Button>
                      <Button intent="cancel" id={j.id}>
                        Cancel
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.items && (
              <>
                <h3>Selected job items</h3>
                <p>
                  {data.itemCounts
                    .map((c) => `${c.status}: ${c._count}`)
                    .join(" · ")}
                </p>
                {data.items.map((i) => (
                  <p key={i.id}>
                    {i.resource.title} — {i.status} {i.error}
                  </p>
                ))}
              </>
            )}
          </section>
        </>
      )}
      {data.page === "history" && (
        <section className="card">
          <h2>Apply and restore history</h2>
          <p>
            Restoring backs up the current values first. A conflict requires
            review.
          </p>
          {data.rows.map((a) => (
            <article className="history-row" key={a.id}>
              <h3>{a.resource.title}</h3>
              <Badge value={a.status} />
              <p>
                {new Date(a.createdAt).toLocaleString("en-GB", {
                  timeZone: data.store.timezone,
                })}{" "}
                · {a.actor} · {a.restoreOf ? "Restore" : "Apply"}
              </p>
              {a.error && <p className="error">{a.error}</p>}
              <details>
                <summary>View backed-up values</summary>
                <pre>{JSON.stringify(a.before, null, 2)}</pre>
              </details>
              <div className="toolbar">
                {a.before && (
                  <Button intent="restore" id={a.id}>
                    Restore values from before this operation
                  </Button>
                )}
                {["FAILED", "PARTIAL"].includes(a.status) && (
                  <Button intent="retryApply" id={a.id}>
                    Continue operation
                  </Button>
                )}
              </div>
            </article>
          ))}
          {!data.rows.length && <Empty>No changes have been applied.</Empty>}
        </section>
      )}
      {data.page === "settings" && <Settings data={data} />}
      {data.page === "performance" && <Performance data={data} />}
      {["review", "history"].includes(data.page) && (
        <div className="toolbar">
          <Link to={`?offset=${Math.max(0, data.offset - 25)}`}>Previous</Link>
          <Link to={`?offset=${data.offset + 25}`}>Next</Link>
        </div>
      )}
    </main>
  );
}
