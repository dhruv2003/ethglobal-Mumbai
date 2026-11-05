/* Form fields built on the design system's .field / .input classes. */
import { createContext, useContext, useRef, useState } from "react";
import { acceptFor, checkFile, fileStore, readVideoDuration } from "../lib/files.js";
import { fmtSize } from "../lib/validate.js";

export const FormCtx = createContext(null);
export const useForm = () => useContext(FormCtx);

export const fieldId = (path) => `f-${path.replaceAll(".", "-")}`;

export function useField(path) {
  const { get, set, errors, warnings, touched, touch, showAll } = useForm();
  return {
    value: get(path),
    set: (v) => set(path, v),
    onBlur: () => touch(path),
    error: touched[path] || showAll ? errors[path] : undefined,
    warning: warnings[path],
  };
}

/** Error wins over warning wins over help. One id so aria-describedby stays stable. */
export function Msg({ id, help, error, warning, count }) {
  if (error) return <span id={id} className="field__error">✕ {error}</span>;
  if (warning) return <span id={id} className="field__warn">! {warning}</span>;
  if (help || count) {
    return (
      <span id={id} className="field__help field__row">
        <span>{help}</span>
        {count}
      </span>
    );
  }
  return null;
}

export function TextField({ path, label, help, multiline, limit, optional, mono, ...rest }) {
  const f = useField(path);
  const id = fieldId(path);
  const Tag = multiline ? "textarea" : "input";
  const len = String(f.value ?? "").length;
  const count = limit ? (
    <span className={`t-num ${len > limit ? "over" : ""}`}>
      {len} / {limit}
    </span>
  ) : null;
  return (
    <div className="field">
      <label htmlFor={id}>
        {label} {optional && <span className="optional">optional</span>}
      </label>
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
      <Msg id={`${id}-msg`} help={help} error={f.error} warning={f.warning} count={count} />
    </div>
  );
}

export function SelectField({ path, label, options, placeholder = "Choose one" }) {
  const f = useField(path);
  const id = fieldId(path);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        className="input input--select"
        value={f.value ?? ""}
        onChange={(e) => f.set(e.target.value)}
        onBlur={f.onBlur}
        aria-invalid={!!f.error}
        aria-describedby={`${id}-msg`}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <Msg id={`${id}-msg`} error={f.error} />
    </div>
  );
}

export function Checkbox({ path, children }) {
  const f = useField(path);
  const id = fieldId(path);
  return (
    <div className="field">
      <label className="check" htmlFor={id}>
        <input id={id} type="checkbox" checked={!!f.value} onChange={(e) => f.set(e.target.checked)} onBlur={f.onBlur} aria-describedby={`${id}-msg`} />
        <span className="t-body">{children}</span>
      </label>
      <Msg id={`${id}-msg`} error={f.error} />
    </div>
  );
}

/** Real radios, styled as option cards (design system a11y rule). */
export function RadioCards({ path, legend, options }) {
  const f = useField(path);
  const id = fieldId(path);
  return (
    <fieldset className="field radios" aria-describedby={`${id}-msg`}>
      <legend>{legend}</legend>
      <div className="radios__row" id={id} tabIndex={-1}>
        {options.map((o) => (
          <label key={o.value} className="radio-card">
            <input type="radio" name={id} value={o.value} checked={f.value === o.value} onChange={() => f.set(o.value)} onBlur={f.onBlur} />
            <span className="radio-card__body">
              <span className="t-body-strong">{o.label}</span>
              {o.hint && <span className="t-caption">{o.hint}</span>}
            </span>
          </label>
        ))}
      </div>
      <Msg id={`${id}-msg`} error={f.error} />
    </fieldset>
  );
}

/**
 * File picker. `multiple` stores an array of metas, otherwise one meta or null.
 * Rejections are listed per file, never silently dropped (SUB-02).
 */
export function FileField({ path, label, help, kinds, multiple, optional, errorPath }) {
  const f = useField(path);
  const extra = useField(errorPath ?? path);
  const inputRef = useRef(null);
  const [rejected, setRejected] = useState([]);
  const id = fieldId(path);
  const current = multiple ? f.value ?? [] : f.value ? [f.value] : [];

  async function onPick(e) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = "";
    const bad = [];
    const good = [];
    for (const file of picked) {
      const { meta, error } = checkFile(file, kinds);
      if (error) {
        bad.push(error);
        continue;
      }
      if (meta.kind === "video") meta.duration = await readVideoDuration(file);
      fileStore.set(meta.id, file);
      good.push(meta);
    }
    setRejected(bad);
    if (good.length) f.set(multiple ? [...current, ...good] : good[0]);
    f.onBlur();
  }

  function remove(meta) {
    fileStore.delete(meta.id);
    if (meta.previewUrl) URL.revokeObjectURL(meta.previewUrl);
    f.set(multiple ? current.filter((m) => m.id !== meta.id) : null);
  }

  const err = f.error ?? (errorPath ? extra.error : undefined);
  const warn = f.warning ?? (errorPath ? extra.warning : undefined);
  return (
    <div className="field">
      <span className="label" id={`${id}-label`}>
        {label} {optional && <span className="optional">optional</span>}
      </span>
      {current.length > 0 && (
        <ul className="files">
          {current.map((m) => (
            <li key={m.id} className="file">
              {m.previewUrl ? <img src={m.previewUrl} alt="" className="file__thumb" /> : <span className="file__thumb file__kind">{m.kind}</span>}
              <span className="file__name">{m.name}</span>
              <span className="t-caption t-num">
                {fmtSize(m.size)}
                {m.duration ? ` · ${Math.floor(m.duration / 60)}:${String(Math.round(m.duration % 60)).padStart(2, "0")}` : ""}
              </span>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => remove(m)} aria-label={`Remove ${m.name}`}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {(multiple || current.length === 0) && (
        <div>
          <input ref={inputRef} id={id} type="file" className="visually-hidden" accept={acceptFor(kinds)} multiple={multiple} onChange={onPick} aria-labelledby={`${id}-label`} aria-describedby={`${id}-msg`} />
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => inputRef.current?.click()}>
            {current.length ? "Add more files" : multiple ? "Choose files" : "Choose a file"}
          </button>
        </div>
      )}
      {rejected.map((r) => (
        <span key={r} className="field__error">✕ {r}</span>
      ))}
      <Msg id={`${id}-msg`} help={help} error={err} warning={warn} />
    </div>
  );
}

/** Free-form tags: Enter or comma adds one. */
export function TagInput({ path, label, help, max = 10 }) {
  const f = useField(path);
  const [draft, setDraft] = useState("");
  const id = fieldId(path);
  const tags = f.value ?? [];
  const add = () => {
    const t = draft.trim().replace(/,$/, "");
    if (t && !tags.some((x) => x.toLowerCase() === t.toLowerCase()) && tags.length < max) f.set([...tags, t]);
    setDraft("");
  };
  return (
    <div className="field">
      <label htmlFor={id}>
        {label} <span className="optional">optional</span>
      </label>
      <div className="tags">
        {tags.map((t) => (
          <span key={t} className="chip chip--tag">
            {t}
            <button type="button" className="tag-x" aria-label={`Remove ${t}`} onClick={() => f.set(tags.filter((x) => x !== t))}>
              ×
            </button>
          </span>
        ))}
        {tags.length < max && (
          <input
            id={id}
            className="input tags__input"
            value={draft}
            placeholder="Add a tag"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                add();
              } else if (e.key === "Backspace" && !draft && tags.length) f.set(tags.slice(0, -1));
            }}
            onBlur={() => {
              add();
              f.onBlur();
            }}
            aria-describedby={`${id}-msg`}
          />
        )}
      </div>
      <Msg id={`${id}-msg`} help={help} error={f.error} />
    </div>
  );
}
