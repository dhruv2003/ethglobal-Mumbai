/* Form fields built on the design system's .field / .input classes. */
import { createContext, useContext } from "react";

export const FormCtx = createContext(null);
export const useForm = () => useContext(FormCtx);

export const fieldId = (path) => `f-${path.replaceAll(".", "-")}`;

export function useField(path) {
  const { get, set, errors, touched, touch, showAll } = useForm();
  return {
    value: get(path),
    set: (v) => set(path, v),
    onBlur: () => touch(path),
    error: touched[path] || showAll ? errors[path] : undefined,
  };
}

/** Error wins over help. One id so aria-describedby stays stable. */
export function Msg({ id, help, error, count }) {
  if (error) return <span id={id} className="field__error">✕ {error}</span>;
  if (!help && !count) return null;
  return (
    <span id={id} className="field__help field__row">
      <span>{help}</span>
      {count}
    </span>
  );
}

export function TextField({ path, label, help, multiline, limit, mono, ...rest }) {
  const f = useField(path);
  const id = fieldId(path);
  const Tag = multiline ? "textarea" : "input";
  const len = String(f.value ?? "").length;
  // Counters only show up once you're getting close to the limit.
  const count = limit && len >= limit * 0.8 ? (
    <span className={`t-num ${len > limit ? "over" : ""}`}>
      {len} / {limit}
    </span>
  ) : null;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <Tag
        id={id}
        className={`input ${multiline ? "input--area" : ""} ${mono ? "t-mono" : ""}`}
        value={f.value ?? ""}
        onChange={(e) => f.set(e.target.value)}
        onBlur={f.onBlur}
        aria-invalid={!!f.error}
        aria-describedby={`${id}-msg`}
        {...rest}
      />
      <Msg id={`${id}-msg`} help={help} error={f.error} count={count} />
    </div>
  );
}
