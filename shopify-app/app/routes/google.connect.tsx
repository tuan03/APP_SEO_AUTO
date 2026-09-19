import { redirect, type LoaderFunctionArgs } from "react-router";
import { tenant } from "../services/tenant.server";
import { googleConnect } from "../services/search-console.server";
export async function loader({ request }: LoaderFunctionArgs) {
  const { store } = await tenant(request);
  return redirect(await googleConnect(store.id));
}
