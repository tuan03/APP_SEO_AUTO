import { OAuth2Client } from "google-auth-library";
import { randomBytes } from "node:crypto";
import db from "../db.server";
import { encrypt, decrypt } from "./crypto.server";
const client = () =>
  new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );
export async function googleConnect(storeId: string) {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET)
    throw new Error("Google OAuth credentials are not configured");
  const state = randomBytes(32).toString("hex");
  await db.oAuthState.create({
    data: { id: state, storeId, expiresAt: new Date(Date.now() + 600000) },
  });
  return client().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/webmasters.readonly"],
    state,
  });
}
export async function googleCallback(state: string, code: string) {
  const row = await db.oAuthState.findUniqueOrThrow({ where: { id: state } });
  if (row.expiresAt < new Date()) throw new Error("OAuth state expired");
  const consumed = await db.oAuthState.deleteMany({ where: { id: state } });
  if (consumed.count !== 1) throw new Error("OAuth state already used");
  const { tokens } = await client().getToken(code);
  if (!tokens.refresh_token)
    throw new Error(
      "Google did not provide a refresh token; reconnect with consent",
    );
  return db.store.update({
    where: { id: row.storeId },
    data: { gscToken: encrypt(JSON.stringify(tokens)) },
  });
}
async function gsc(storeId: string, path: string, body?: unknown) {
  const store = await db.store.findUniqueOrThrow({ where: { id: storeId } });
  if (!store.active || !store.gscToken)
    throw new Error("Search Console is not connected");
  const c = client();
  const previous = JSON.parse(decrypt(store.gscToken));
  c.setCredentials(previous);
  const token = await c.getAccessToken();
  if (c.credentials.access_token !== previous.access_token)
    await db.store.update({
      where: { id: storeId },
      data: {
        gscToken: encrypt(JSON.stringify({ ...previous, ...c.credentials })),
      },
    });
  const r = await fetch(`https://www.googleapis.com/webmasters/v3/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token.token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok)
    throw new Error(
      `Search Console HTTP ${r.status}; reconnect or check property access`,
    );
  return r.json();
}
export async function properties(storeId: string) {
  const r = await gsc(storeId, "sites");
  return (r.siteEntry || []) as { siteUrl: string; permissionLevel: string }[];
}
export async function chooseProperty(storeId: string, siteUrl: string) {
  if (
    !(await properties(storeId)).some(
      (p) =>
        p.siteUrl === siteUrl && p.permissionLevel !== "siteUnverifiedUser",
    )
  )
    throw new Error("Property is not accessible");
  const store = await db.store.findUniqueOrThrow({ where: { id: storeId } });
  if (!store.website)
    throw new Error("Sync store before connecting a property");
  const host = new URL(store.website).hostname;
  if (
    siteUrl.startsWith("sc-domain:")
      ? !(host === siteUrl.slice(10) || host.endsWith(`.${siteUrl.slice(10)}`))
      : new URL(siteUrl).hostname !== host
  )
    throw new Error("Property must match the store website");
  await db.store.update({
    where: { id: storeId },
    data: { gscProperty: siteUrl, lastAnalytics: null },
  });
}
export async function syncSearchDay(storeId: string, day: string) {
  const store = await db.store.findUniqueOrThrow({ where: { id: storeId } });
  if (!store.gscProperty)
    throw new Error("Select a Search Console property first");
  const path = `sites/${encodeURIComponent(store.gscProperty)}/searchAnalytics/query`;
  let startRow = 0;
  await db.searchMetric.deleteMany({ where: { storeId, date: day } });
  let more = true;
  while (more) {
    const r = await gsc(storeId, path, {
      startDate: day,
      endDate: day,
      dimensions: ["page"],
      dataState: "final",
      type: "web",
      rowLimit: 25000,
      startRow,
    });
    const rows = r.rows || [];
    for (let i = 0; i < rows.length; i += 1000)
      await db.searchMetric.createMany({
        data: rows
          .slice(i, i + 1000)
          .map(
            (row: {
              keys: string[];
              clicks: number;
              impressions: number;
              ctr: number;
              position: number;
            }) => ({
              storeId,
              date: day,
              page: row.keys[0],
              clicks: row.clicks,
              impressions: row.impressions,
              ctr: row.ctr,
              position: row.position,
            }),
          ),
        skipDuplicates: true,
      });
    more = rows.length === 25000;
    startRow += rows.length;
  }
}
