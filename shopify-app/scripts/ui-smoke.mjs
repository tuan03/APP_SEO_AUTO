import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const browser = await chromium.launch(
  process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {},
);
try {
  for (const width of [1440, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    for (const name of [
      "overview",
      "products",
      "collections",
      "knowledge",
      "review",
      "jobs",
      "history",
      "performance",
      "settings",
    ]) {
      await page.goto(
        pathToFileURL(resolve(`test-results/ui/${name}.html`)).href,
      );
      assert.equal(await page.locator("h1").count(), 1);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      );
      assert.equal(overflow, false, `${name} overflows at ${width}px`);
      if (["overview", "products", "settings"].includes(name))
        await page.screenshot({
          path: `test-results/ui/${name}-${width}.png`,
          fullPage: true,
        });
    }
    await page.close();
  }
  console.log(
    "Nine dashboard fixtures render at desktop and mobile widths without horizontal page overflow.",
  );
} finally {
  await browser.close();
}
