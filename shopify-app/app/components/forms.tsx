import { Form } from "react-router";
export function Badge({ value }: { value: string }) {
  return (
    <span className={`badge ${value.toLowerCase()}`}>
      {value.replaceAll("_", " ")}
    </span>
  );
}
export function Button({
  intent,
  id,
  children,
}: {
  intent: string;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <Form method="post" className="inline">
      <input type="hidden" name="intent" value={intent} />
      {id && <input type="hidden" name="id" value={id} />}
      <button>{children}</button>
    </Form>
  );
}
export function Rule() {
  return (
    <>
      <label>
        Rescan rule
        <select name="rule" defaultValue="UNSCANNED">
          <option value="UNSCANNED">Not scanned successfully</option>
          <option value="CHANGED">Source changed</option>
          <option value="AGED">Older than N days</option>
          <option value="ALL">All matching items</option>
        </select>
      </label>
      <label>
        Age (days)
        <input name="ageDays" type="number" min="1" defaultValue="30" />
      </label>
    </>
  );
}
export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}
export function Field({
  label,
  value,
  onChange,
  multiline = false,
  type = "text",
}: {
  label: string;
  value: string | number;
  onChange: (x: string) => void;
  multiline?: boolean;
  type?: string;
}) {
  return (
    <label>
      {label}
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={5}
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}
