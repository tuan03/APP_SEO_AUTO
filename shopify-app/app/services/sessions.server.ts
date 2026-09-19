import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import type { Session } from "@shopify/shopify-api";
import db from "../db.server";
import { encrypt, decrypt } from "./crypto.server";
const adapter = new PrismaSessionStorage(db);
function decode(s: Session | undefined) {
  if (s?.accessToken) s.accessToken = decrypt(s.accessToken);
  if (s?.refreshToken) s.refreshToken = decrypt(s.refreshToken);
  return s;
}
export const secureSessions = {
  async storeSession(s: Session) {
    const copy = Object.assign(
      Object.create(Object.getPrototypeOf(s)),
      s,
    ) as Session;
    if (copy.accessToken) copy.accessToken = encrypt(copy.accessToken);
    if (copy.refreshToken) copy.refreshToken = encrypt(copy.refreshToken);
    return adapter.storeSession(copy);
  },
  async loadSession(id: string) {
    return decode(await adapter.loadSession(id));
  },
  deleteSession: (id: string) => adapter.deleteSession(id),
  deleteSessions: (ids: string[]) => adapter.deleteSessions(ids),
  async findSessionsByShop(shop: string) {
    return (await adapter.findSessionsByShop(shop)).map((s) => decode(s)!);
  },
};
