import { hash } from "./content";
export function mergeProfiles(
  base: Record<string, unknown>,
  current: Record<string, unknown>,
  proposed: Record<string, unknown>,
) {
  const result = { ...current };
  for (const key of Object.keys(proposed)) {
    if (hash(proposed[key]) === hash(base[key])) continue;
    if (
      hash(current[key]) === hash(base[key]) ||
      hash(current[key]) === hash(proposed[key])
    ) {
      result[key] = proposed[key];
      continue;
    }
    if (
      Array.isArray(base[key]) &&
      Array.isArray(current[key]) &&
      Array.isArray(proposed[key])
    ) {
      const original = base[key] as unknown[],
        next = proposed[key] as unknown[],
        latest = current[key] as unknown[];
      const removed = new Set(
        original
          .filter((x) => !next.some((y) => hash(x) === hash(y)))
          .map(hash),
      );
      const merged = latest.filter((x) => !removed.has(hash(x)));
      for (const x of next.filter(
        (x) => !original.some((y) => hash(y) === hash(x)),
      ))
        if (!merged.some((y) => hash(y) === hash(x))) merged.push(x);
      result[key] = merged;
    } else
      throw new Error(
        `Knowledge conflict in ${key}; compare the current approved profile before merging`,
      );
  }
  return result;
}
