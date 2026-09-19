import { describe, it, expect } from "vitest";
import { publicIp, extractPage } from "../app/services/crawl.server";
import { encrypt, decrypt } from "../app/services/crypto.server";
import {
  sourceHash,
  validateContent,
  type Snapshot,
} from "../app/core/content";
import { randomBytes } from "node:crypto";
process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");

it("can retain an existing rich description without stripping its images and links", () => {
  const html =
    '<p>Size guide <a href="/pages/size-guide">Read guide</a></p><img src="https://cdn.shopify.com/guide.png" alt="Size guide">';
  const snapshot: Snapshot = {
    id: "one",
    kind: "PRODUCT",
    title: "Rug",
    handle: "rug",
    descriptionHtml: html,
    seo: { title: null, description: null },
    faqs: [],
    images: [],
    context: {},
  };
  const content = {
    title: "Rug",
    descriptionMode: "KEEP",
    descriptionHtml: html,
    seoTitle: "Rug",
    seoDescription: "A printed rug",
    faqs: [],
    imageAlts: [],
    facts: [],
    warnings: [],
    knowledgeSuggestions: [],
  };
  expect(validateContent(content, snapshot).descriptionHtml).toBe(html);
  expect(() =>
    validateContent(
      { ...content, descriptionHtml: html + "<script>alert(1)</script>" },
      snapshot,
    ),
  ).toThrow();
});
describe("crawler network boundaries", () => {
  it("discovers policy links in navigation and footer while excluding navigation text", () => {
    const page = extractPage(
      '<html><body><nav><a href="/pages/about">About</a></nav><main>Product facts</main><footer><a href="/policies/refund-policy">Returns</a></footer></body></html>',
      "https://example.com",
    );
    expect(page.links).toContain("https://example.com/pages/about");
    expect(page.links).toContain("https://example.com/policies/refund-policy");
    expect(page.text).toBe("Product facts");
  });
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "172.16.2.1",
    "192.168.0.1",
    "169.254.169.254",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "0.0.0.0",
  ])("blocks %s", (ip) => expect(publicIp(ip)).toBe(false));
  it("allows public addresses", () => expect(publicIp("8.8.8.8")).toBe(true));
  it("separates source text and JSON-LD from scripts", () => {
    const p = extractPage(
      '<html><body><h1>Store</h1><script>alert(1)</script><script type="application/ld+json">{"@type":"Product"}</script></body></html>',
      "https://example.com",
    );
    expect(p.text).toBe("Store");
    expect(p.schemas).toHaveLength(1);
  });
});
it("encrypts credentials with authentication and refuses plaintext", () => {
  const cipher = encrypt("secret-token");
  expect(cipher).not.toContain("secret-token");
  expect(decrypt(cipher)).toBe("secret-token");
  expect(() => decrypt("secret-token")).toThrow();
  const parts = cipher.split(":");
  parts[3] = Buffer.from("tampered").toString("base64");
  expect(() => decrypt(parts.join(":"))).toThrow();
});
const s: Snapshot = {
  id: "p1",
  kind: "PRODUCT",
  title: "A",
  descriptionHtml: "<p>A</p>",
  handle: "a",
  seo: { title: null, description: null },
  faqs: [],
  images: [{ id: "i1", url: "https://cdn.shopify.com/a.png", alt: "" }],
  context: {
    collections: [{ id: "c1", title: "Collection" }],
    metafields: [
      {
        namespace: "custom",
        key: "material",
        value: "cotton",
        type: "single_line_text_field",
      },
    ],
  },
};
it("uses consistent source fingerprints for bulk and live API representations", () => {
  const other = structuredClone(s);
  other.context.collections = [
    {
      id: "c1",
      title: "Collection",
      descriptionHtml: "Extra",
      __parentId: "p1",
    },
  ];
  other.context.metafields = [
    {
      id: "m1",
      __parentId: "p1",
      namespace: "custom",
      key: "material",
      value: "cotton",
      type: "single_line_text_field",
    },
  ];
  expect(sourceHash(other)).toBe(sourceHash(s));
});
it("blocks unsafe descriptions and incomplete image output", () => {
  const valid = {
    title: "A",
    descriptionHtml: "<p>Useful</p>",
    seoTitle: "A",
    seoDescription: "Useful description",
    faqs: [],
    imageAlts: [{ id: "i1", alt: "Product" }],
    facts: [],
    warnings: [],
    knowledgeSuggestions: [],
  };
  expect(validateContent(valid, s, { wordsMin: 0, faqMin: 0 })).toBeTruthy();
  expect(() =>
    validateContent(
      { ...valid, descriptionHtml: '<p onclick="attack()">X</p>' },
      s,
    ),
  ).toThrow("unsafe");
  expect(() => validateContent({ ...valid, imageAlts: [] }, s)).toThrow(
    "every image",
  );
});
