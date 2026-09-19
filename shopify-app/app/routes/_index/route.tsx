import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>SEO / AEO Workspace</h1>
        <p className={styles.text}>
          Research, improve and review your Shopify product content in one
          workspace.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Grounded content.</strong> Generate product copy, FAQ and
            image alt text from your approved store knowledge.
          </li>
          <li>
            <strong>Your approval.</strong> Review every proposal before
            publishing it to your store.
          </li>
          <li>
            <strong>Recoverable changes.</strong> Keep backups and track each
            apply or restore operation.
          </li>
        </ul>
      </div>
    </div>
  );
}
