import type { Metrics } from "../services/analytics.server";
import type { PageData } from "../core/dashboard";
import type { defaults } from "../core/content";
import { useState } from "react";
import { Form } from "react-router";
import { Button, Field, Empty } from "./forms";
export function Settings({ data }: { data: PageData<"settings"> }) {
  const [settings, set] = useState<typeof defaults>({
    titleMax: 120,
    seoTitleMax: 60,
    seoDescriptionMax: 160,
    wordsMin: 600,
    wordsMax: 1000,
    faqMin: 5,
    faqMax: 8,
    tone: "Clear, helpful and factual",
    notes: "",
    ...data.store.settings,
  });
  return (
    <>
      <section className="card">
        <h2>Writing preferences</h2>
        <p>
          The app maintains the prompt. These controls adjust its writing
          limits.
        </p>
        <Form method="post">
          <input type="hidden" name="intent" value="settings" />
          <input
            type="hidden"
            name="content"
            value={JSON.stringify(settings)}
          />
          <div className="grid">
            {(
              [
                "titleMax",
                "seoTitleMax",
                "seoDescriptionMax",
                "wordsMin",
                "wordsMax",
                "faqMin",
                "faqMax",
              ] as const
            ).map((k) => (
              <Field
                key={k}
                label={k}
                type="number"
                value={settings[k]}
                onChange={(v) => set({ ...settings, [k]: Number(v) })}
              />
            ))}
          </div>
          <Field
            label="Tone"
            value={settings.tone}
            onChange={(v) => set({ ...settings, tone: v })}
          />
          <Field
            label="Additional guidance"
            multiline
            value={settings.notes}
            onChange={(v) => set({ ...settings, notes: v })}
          />
          <button className="primary">Save preferences</button>
        </Form>
      </section>
      <section className="card">
        <h2>Google Search Console</h2>
        <p>
          {data.store.connected
            ? "Google connected"
            : "Connect Google to track search performance."}
        </p>
        <Button intent="googleConnect">Connect / reconnect Google</Button>
        {data.store.connected && (
          <>
            <Form method="post" className="toolbar">
              <input type="hidden" name="intent" value="property" />
              <select name="property" defaultValue={data.store.property || ""}>
                <option value="">Choose property</option>
                {data.properties.map((p) => (
                  <option key={p.siteUrl}>{p.siteUrl}</option>
                ))}
              </select>
              <button>Save property</button>
            </Form>
            <Button intent="disconnectGoogle">Disconnect</Button>
          </>
        )}
      </section>
      <section className="card">
        <h2>FAQ and structured data</h2>
        <ol>
          <li>Open your published theme in the theme editor.</li>
          <li>
            Add the “SEO/AEO FAQ” app block to product and collection templates.
          </li>
          <li>
            Run the check below to inspect JSON-LD on a sample product page.
          </li>
          <li>
            Keep the current schema provider, or disable it before activating
            “SEO/AEO Schema” in App embeds.
          </li>
          <li>
            Publish theme changes and check again. A sample check cannot
            guarantee every template is free of duplicate schema.
          </li>
        </ol>
        <a
          className="button"
          href={`https://${data.store.domain}/admin/themes/current/editor`}
          target="_blank"
          rel="noreferrer"
        >
          Open theme editor
        </a>{" "}
        <Button intent="schemaAudit">Check storefront</Button>
        {Boolean(data.store.settings.schemaAudit) && (
          <pre>{JSON.stringify(data.store.settings.schemaAudit, null, 2)}</pre>
        )}
      </section>
    </>
  );
}
export function Performance({ data }: { data: PageData<"performance"> }) {
  return (
    <section className="card">
      <div className="toolbar">
        <h2>Search performance</h2>
        <Button intent="searchSync">Sync data</Button>
      </div>
      <p>
        Finalized Google data. Comparisons do not establish causation. Search
        Console may omit low-volume rows.
      </p>
      {!data.daily.length ? (
        <Empty>
          Connect a property in Settings, then sync. No data is available yet.
        </Empty>
      ) : (
        <>
          <p>
            Latest window: {data.comparison.recentStart} to{" "}
            {data.comparison.end} (end exclusive).
          </p>
          <MetricTable
            rows={data.comparison.periods.map((metric, i) => ({
              label: i ? "Previous 28 days" : "Latest 28 days available",
              metric,
            }))}
          />
          <h3>Page performance (100 recent rows)</h3>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Page</th>
                <th>Clicks</th>
                <th>Impressions</th>
                <th>Position</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.date}</td>
                  <td>{r.page}</td>
                  <td>{r.clicks}</td>
                  <td>{r.impressions}</td>
                  <td>{r.position.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <h3>Before / after content changes</h3>
      <p>
        28 days before and after each apply, excluding publication day. Days
        with data are shown; incomplete periods are not directly comparable.
      </p>
      {data.comparison.comparisons.map((change) => (
        <details className="card" key={change.id}>
          <summary>
            {change.title} ?{" "}
            {new Date(change.appliedAt).toISOString().slice(0, 10)}
          </summary>
          <p>{change.page}</p>
          <MetricTable
            rows={[
              { label: "Before", metric: change.before },
              { label: "After", metric: change.after },
            ]}
          />
        </details>
      ))}
    </section>
  );
}

function MetricTable({ rows }: { rows: { label: string; metric: Metrics }[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Period</th>
          <th>Days with data</th>
          <th>Clicks</th>
          <th>Impressions</th>
          <th>CTR</th>
          <th>Average position</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ label, metric: m }) => (
          <tr key={label}>
            <td>{label}</td>
            <td>{m.days}/28</td>
            <td>{m.days ? m.clicks : "?"}</td>
            <td>{m.days ? m.impressions : "?"}</td>
            <td>{m.ctr === null ? "?" : `${(m.ctr * 100).toFixed(2)}%`}</td>
            <td>{m.position?.toFixed(1) ?? "?"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
