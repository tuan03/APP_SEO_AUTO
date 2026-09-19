import type { performanceComparisons } from "../services/analytics.server";
import type {
  Application,
  Audit,
  Knowledge,
  Proposal,
  Resource,
  ScanItem,
  ScanJob,
  Schedule,
  SearchMetric,
} from "@prisma/client";
import type { Content, Snapshot, defaults } from "./content";
export type Wire<T> = T extends Date
  ? string
  : T extends readonly (infer U)[]
    ? Wire<U>[]
    : T extends object
      ? { [K in keyof T]: Wire<T[K]> }
      : T;
export type Profile = {
  brand: string;
  positioning: string;
  tone: string;
  markets: string[];
  searchIntents: string[];
  prohibitedClaims: string[];
  facts: { claim: string; source: string }[];
  audienceHypotheses: { claim: string; source: string }[];
  policies: { claim: string; source: string }[];
};
export type KnowledgeView = Omit<Wire<Knowledge>, "content"> & {
  content: Profile;
};
export type ProposalView = Omit<Wire<Proposal>, "content"> & {
  content: Content;
  resource: { title: string; kind: string; gid?: string };
};
type ApplicationView = Wire<Application> & { resource: { title: string } };
type Base = {
  store: {
    domain: string;
    website: string | null;
    timezone: string;
    settings: Partial<typeof defaults> & { schemaAudit?: unknown };
    connected: boolean;
    property: string | null;
    lastSync: string | null;
  };
  offset: number;
  filter: Record<string, string>;
};
export type DailyMetric = {
  date: string;
  _sum: { clicks: number | null; impressions: number | null };
};
export type DashboardData = Base &
  (
    | {
        page: "overview";
        counts: number[];
        usage: { _sum: Record<string, number | null> };
        knowledge: { id: string } | null;
        recent: Wire<Audit>[];
      }
    | {
        page: "products" | "collections";
        total: number;
        rows: (Wire<
          Pick<
            Resource,
            | "id"
            | "gid"
            | "title"
            | "handle"
            | "vendor"
            | "status"
            | "lastScannedAt"
          >
        > & { _count: { proposals: number } })[];
      }
    | {
        page: "knowledge";
        rows: KnowledgeView[];
        sources: { url: string; fetchedAt: string }[];
      }
    | {
        page: "review";
        rows: ProposalView[];
        selected?: ProposalView;
        current: Snapshot;
        currentHash: string;
      }
    | {
        page: "jobs";
        rows: (Wire<ScanJob> & { _count: { items: number } })[];
        schedules: Wire<Schedule>[];
        items?: (Wire<ScanItem> & { resource: { title: string } })[];
        itemCounts: { status: string; _count: number }[];
      }
    | { page: "history"; rows: ApplicationView[] }
    | {
        page: "performance";
        comparison: Awaited<ReturnType<typeof performanceComparisons>>;
        cutoff: string;
        daily: DailyMetric[];
        rows: Wire<SearchMetric>[];
        events: ApplicationView[];
      }
    | {
        page: "settings";
        properties: { siteUrl: string; permissionLevel: string }[];
      }
  );
export type PageData<P extends DashboardData["page"]> = Extract<
  DashboardData,
  { page: P }
>;
