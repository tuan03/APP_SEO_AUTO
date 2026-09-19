import https from "node:https";
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { load } from "cheerio";
import robotsParser from "robots-parser";
import { chromium } from "playwright";
export function publicIp(address: string) {
  const ip = ipaddr.process(address);
  return ip.range() === "unicast";
}
export async function safeGet(
  url: string,
  allowedHosts?: Set<string>,
  maxBytes = 2000000,
  redirects = 0,
): Promise<{ body: Buffer; type: string; url: string }> {
  const u = new URL(url);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    (u.port && u.port !== "443") ||
    (allowedHosts && !allowedHosts.has(u.hostname))
  )
    throw new Error("URL is outside allowed HTTPS hosts");
  const records = await lookup(u.hostname, { all: true });
  if (!records.length || records.some((r) => !publicIp(r.address)))
    throw new Error("Private or reserved network address refused");
  const pin = records[0];
  return new Promise((resolve, reject) => {
    const req = https.get(
      u,
      {
        headers: { "User-Agent": "ShopifySeoAeoBot/1.0" },
        lookup: (_host, _opts, cb) => {
          if (_opts.all)
            (
              cb as unknown as (
                error: Error | null,
                addresses: { address: string; family: number }[],
              ) => void
            )(null, [pin]);
          else cb(null, pin.address, pin.family);
        },
      },
      (res) => {
        if (
          res.statusCode &&
          [301, 302, 303, 307, 308].includes(res.statusCode)
        ) {
          res.resume();
          if (redirects >= 5 || !res.headers.location)
            return reject(Error("Too many redirects"));
          safeGet(
            new URL(res.headers.location, u).href,
            allowedHosts,
            maxBytes,
            redirects + 1,
          ).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(Error(`HTTP ${res.statusCode} fetching ${u.hostname}`));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            res.destroy(Error("Response exceeds size limit"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () =>
          resolve({
            body: Buffer.concat(chunks),
            type: String(res.headers["content-type"] || ""),
            url: u.href,
          }),
        );
      },
    );
    req.setTimeout(30000, () => req.destroy(Error("Fetch timeout")));
    req.on("error", reject);
  });
}
export function extractPage(html: string, url: string) {
  const $ = load(html);
  const schemas: string[] = [];
  $('script[type="application/ld+json"]').each((_i, e) => {
    schemas.push($(e).text());
  });
  const links = $("a[href]")
    .map((_i, e) => {
      try {
        return new URL($(e).attr("href")!, url).href;
      } catch {
        return "";
      }
    })
    .get();
  $("script,style,nav,footer,header,noscript,form").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim().slice(0, 30000);
  return { url, text, title: $("title").text(), links, schemas };
}
export async function crawlStore(website: string, maxPages = 40) {
  const root = new URL(website);
  const hosts = new Set([root.hostname]);
  const robots = await safeGet(`${root.origin}/robots.txt`, hosts)
    .then((r) => robotsParser(`${root.origin}/robots.txt`, r.body.toString()))
    .catch(() => null);
  const queue = [root.origin],
    seen = new Set<string>();
  const pages: ReturnType<typeof extractPage>[] = [];
  const errors: string[] = [];
  while (queue.length && pages.length < maxPages && seen.size < maxPages * 3) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    if (robots?.isAllowed(url, "ShopifySeoAeoBot") === false) continue;
    try {
      const r = await safeGet(url, hosts);
      if (!r.type.includes("text/html")) continue;
      let p = extractPage(r.body.toString(), url);
      if (p.text.length < 200) {
        const browser = await chromium.launch({ headless: true });
        try {
          const context = await browser.newContext({ serviceWorkers: "block" });
          const page = await context.newPage();
          await page.route("**/*", async (route) => {
            try {
              if (
                ["image", "media", "font"].includes(
                  route.request().resourceType(),
                )
              )
                return route.abort();
              const r = await safeGet(route.request().url(), hosts);
              await route.fulfill({ body: r.body, contentType: r.type });
            } catch {
              await route.abort();
            }
          });
          await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 30000,
          });
          p = extractPage(await page.content(), url);
        } finally {
          await browser.close();
        }
      }
      pages.push(p);
      for (const link of p.links) {
        const u = new URL(link);
        if (
          u.origin !== root.origin ||
          u.search ||
          u.hash ||
          /\/(cart|checkout|account|search|products)\b/.test(u.pathname)
        )
          continue;
        if (/\/(pages|policies|collections|blogs)\b/.test(u.pathname))
          queue.push(u.href);
      }
    } catch (e) {
      errors.push(`${url}: ${String(e)}`);
    }
  }
  if (!pages.length)
    throw new Error(
      `Store crawl produced no pages: ${errors.slice(0, 3).join("; ")}`,
    );
  return { pages, errors };
}
