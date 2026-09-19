import { redirect, type LoaderFunctionArgs } from "react-router";
import { googleCallback } from "../services/search-console.server";
export async function loader({ request }: LoaderFunctionArgs) {
  const u = new URL(request.url);
  if (u.searchParams.get("error"))
    return new Response(
      "Google authorization was canceled. Return to Shopify and reconnect.",
      { status: 400 },
    );
  const store = await googleCallback(
    u.searchParams.get("state") || "",
    u.searchParams.get("code") || "",
  );
  return redirect(
    `https://${store.domain}/admin/apps/${process.env.SHOPIFY_API_KEY}`,
  );
}
