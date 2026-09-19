import type { LoaderFunctionArgs } from "react-router";
import { tenant } from "../services/tenant.server";
import db from "../db.server";
import { keywordFilter } from "../services/keyword-dashboard.server";
import { csvCell } from "../core/keywords";

export async function loader({ request }: LoaderFunctionArgs) {
  const { store } = await tenant(request);
  const where = keywordFilter(store.id, new URL(request.url));
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(
          encoder.encode(
            "\uFEFF" +
              [
                "Page",
                "Kind",
                "Handle",
                "Market",
                "Language",
                "State",
                "Primary",
                "Secondary",
                "Cluster",
                "Intent",
                "Buyer need",
                "Evidence level",
                "Rationale",
                "Version ID",
              ]
                .map(csvCell)
                .join(",") +
              "\r\n",
          ),
        );
        let cursor: string | undefined;
        while (!request.signal.aborted) {
          const rows = await db.keywordTarget.findMany({
            where: {
              AND: [where, ...(cursor ? [{ id: { gt: cursor } }] : [])],
            },
            orderBy: { id: "asc" },
            take: 500,
            include: {
              resource: { select: { title: true, kind: true, handle: true } },
            },
          });
          if (!rows.length) break;
          controller.enqueue(
            encoder.encode(
              rows
                .map((r) =>
                  [
                    r.resource.title,
                    r.resource.kind,
                    r.resource.handle,
                    r.market,
                    r.language,
                    r.state,
                    r.primary,
                    r.secondary.join("; "),
                    r.cluster,
                    r.intent,
                    r.buyerNeed,
                    r.evidenceLevel,
                    r.rationale,
                    r.id,
                  ]
                    .map(csvCell)
                    .join(","),
                )
                .join("\r\n") + "\r\n",
            ),
          );
          cursor = rows.at(-1)!.id;
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="keyword-map.csv"',
      "Cache-Control": "no-store",
    },
  });
}
