import { hash } from "./content";
export function packBackup(
  value: unknown,
  applicationId: string,
  maxBytes = 90000,
) {
  const encoded = Buffer.from(JSON.stringify(value)).toString("base64");
  const parts = encoded.match(new RegExp(`.{1,${maxBytes}}`, "g")) || [];
  if (parts.length > 200)
    throw new Error(
      "Backup exceeds supported metafield capacity; no changes were applied",
    );
  return {
    manifest: {
      applicationId,
      encoding: "base64",
      count: parts.length,
      checksum: hash(value),
    },
    parts,
  };
}
export function unpackBackup(
  manifest: ReturnType<typeof packBackup>["manifest"],
  parts: string[],
) {
  if (parts.length !== manifest.count) throw new Error("Incomplete backup");
  const result = JSON.parse(
    Buffer.from(parts.join(""), "base64").toString("utf8"),
  );
  if (hash(result) !== manifest.checksum)
    throw new Error("Backup checksum mismatch");
  return result;
}
