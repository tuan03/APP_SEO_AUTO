import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
function key() {
  const k = Buffer.from(process.env.ENCRYPTION_KEY || "", "base64");
  if (k.length !== 32)
    throw new Error("ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  return k;
}
export function encrypt(text: string) {
  const iv = randomBytes(12),
    c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return [
    "enc1",
    iv.toString("base64"),
    c.getAuthTag().toString("base64"),
    data.toString("base64"),
  ].join(":");
}
export function decrypt(text: string) {
  const [v, i, t, d] = text.split(":");
  if (v !== "enc1") throw new Error("Unencrypted credential refused");
  const c = createDecipheriv("aes-256-gcm", key(), Buffer.from(i, "base64"));
  c.setAuthTag(Buffer.from(t, "base64"));
  return Buffer.concat([
    c.update(Buffer.from(d, "base64")),
    c.final(),
  ]).toString("utf8");
}
