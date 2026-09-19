import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError, Link } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <nav className="workspace-nav" aria-label="App navigation">
        {[
          ["", "Overview"],
          ["products", "Products"],
          ["collections", "Collections"],
          ["knowledge", "Store knowledge"],
          ["keywords", "Keyword map"],
          ["jobs", "Scan jobs"],
          ["review", "Review"],
          ["history", "History & restore"],
          ["performance", "Search performance"],
          ["settings", "Settings"],
        ].map(([path, label]) => (
          <Link key={path} to={`/app/${path}`}>
            {label}
          </Link>
        ))}
      </nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
