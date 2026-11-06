/*
 * The Testing tab's smart contract panel: what `forge test` said about the team's contracts,
 * run by the platform in a sandbox. Laid out like forge's own output ([PASS] / [FAIL]),
 * failing tests first, one block per test contract.
 */
import { useEffect, useState } from "react";
import { api } from "../../lib/api.js";
import { Icon } from "../Icon.jsx";

/** Load the report (from the API for submissions), polling while the step is still to come. */
function useContractTests(project, pending) {
  const [got, setGot] = useState({ id: project.id, ct: null });
  useEffect(() => {
    setGot((g) => (g.id === project.id ? g : { id: project.id, ct: null }));
    if (project.contractTests || project.kind !== "submitted") return undefined;
    let alive = true;
    let timer;
    const load = async () => {
      const r = await api(`/projects/${encodeURIComponent(project.id)}/contracts`).catch(() => null);
      if (!alive) return;
      if (r?.contractTests) setGot({ id: project.id, ct: r.contractTests });
      if (pending) timer = setTimeout(load, 6000);
    };
    load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [project.id, project.kind, project.contractTests, pending]);
  return project.contractTests ?? (got.id === project.id ? got.ct : null);
}

const fmtGas = (n) => (n == null ? "" : Number(n).toLocaleString("en"));
const fmtMs = (ms) => (ms == null ? "" : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.max(0.1, ms).toFixed(ms < 10 ? 1 : 0)}ms`);

function TestLine({ t }) {
  const [open, setOpen] = useState(false);
  const more = t.reason || t.counterexample || t.logs?.length;
  const tag = t.status === "passed" ? "PASS" : t.status === "failed" ? "FAIL" : "SKIP";
  const meta = t.kind === "fuzz" ? `runs: ${t.runs ?? "?"}, μ: ${fmtGas(t.gas)}` : t.kind === "invariant" ? `runs: ${t.runs ?? "?"}, calls: ${t.calls ?? "?"}` : t.gas != null ? `gas: ${fmtGas(t.gas)}` : "";
  return (
    <li className={`ct__test ct__test--${t.status}`}>
      <button type="button" className="ct__line" onClick={() => more && setOpen(!open)} aria-expanded={more ? open : undefined} disabled={!more}>
        <span className="ct__tag">[{tag}]</span>
        <span className="ct__name">{t.name}</span>
        {t.kind !== "unit" && <span className="ct__kind">{t.kind}</span>}
        <span className="ct__meta t-num">
          {meta && `(${meta})`} {fmtMs(t.ms)}
        </span>
      </button>
      {open && (
        <div className="ct__more">
          {t.reason && <p className="m0">{t.reason}</p>}
          {t.counterexample && (
            <p className="m0">
              <b>Counterexample:</b> <code>{t.counterexample}</code>
            </p>
          )}
          {t.logs?.length > 0 && <pre className="m0">{t.logs.join("\n")}</pre>}
        </div>
      )}
    </li>
  );
}

function Suite({ s }) {
  const failed = s.tests.filter((t) => t.status === "failed").length;
  const [open, setOpen] = useState(failed > 0);
  const order = { failed: 0, skipped: 1, passed: 2 };
  return (
    <li className="ct__suite">
      <button type="button" className="ct__suitehead" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className={`ct__dot ct__dot--${failed ? "bad" : "good"}`} aria-hidden="true">
          {failed ? "✕" : "✓"}
        </span>
        <span className="ct__contract">{s.contract}</span>
        <code className="ct__file">{s.file}</code>
        <span className="ct__count t-num">
          {s.tests.length - failed}/{s.tests.length}
        </span>
        <span className="tmx__chev" aria-hidden="true" style={{ transform: open ? "rotate(90deg)" : "none" }}>
          ›
        </span>
      </button>
      {open && (
        <ul className="ct__tests m0">
          {[...s.tests].sort((a, b) => order[a.status] - order[b.status]).map((t) => (
            <TestLine key={t.name} t={t} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function ContractTests({ project, live }) {
  const step = live?.state?.steps?.find((s) => s.id === "contracts");
  const pending = step?.status === "running" || step?.status === "queued";
  const ct = useContractTests(project, pending);

  if (ct?.status === "none") return null;
  if (!ct) {
    if (!pending) return null;
    return (
      <section className="rv-card ct" aria-labelledby="ct-h">
        <header className="rv-card__head">
          <h3 id="ct-h" className="m0">
            Smart contract tests
          </h3>
          <span className="tpill tpill--live">
            <span className="tpill__dot" /> {step?.status === "running" ? "Running" : "Waiting"}
          </span>
        </header>
        <p className="m0 rv-card__sub">{step?.detail || "Compiling and testing the contracts with Foundry, in a sandbox."}</p>
      </section>
    );
  }

  const t = ct.totals ?? { passed: 0, failed: 0, skipped: 0, fuzz: 0, invariant: 0 };
  const projects = ct.projects ?? [];
  return (
    <section className="rv-card ct" aria-labelledby="ct-h">
      <header className="rv-card__head">
        <h3 id="ct-h" className="m0">
          <Icon name="contract" size={16} /> Smart contract tests
        </h3>
        <span className="ct__pills">
          {t.passed + t.failed > 0 && <span className="tpill tpill--good">✓ {t.passed} pass</span>}
          {t.failed > 0 && <span className="tpill tpill--bad">✕ {t.failed} fail</span>}
          {t.skipped > 0 && <span className="tpill tpill--skip">– {t.skipped} skipped</span>}
          {t.fuzz + t.invariant > 0 && <span className="tpill tpill--skip">{t.fuzz + t.invariant} fuzz/invariant</span>}
          {ct.status === "not_run" && <span className="tpill tpill--skip">Not run</span>}
        </span>
      </header>
      <p className="m0 rv-card__sub">
        Run by FightClub with {String(ct.tool ?? "Foundry").replace(/^forge Version:\s*/i, "forge ")}
        {ct.commit ? ` at commit ${ct.commit.slice(0, 7)}` : ""}. Sandboxed: no FFI or file access, network only to public hosts, fuzz runs capped at 1,000.
      </p>

      {projects.map((p) => (
        <div key={p.root} className="ct__project">
          {projects.length > 1 && <span className="ov-kicker">{p.root === "." ? "Repository root" : p.root}</span>}
          {p.dependencies?.length > 0 && (
            <ul className="ct__deps m0">
              {p.dependencies.map((d) => (
                <li key={`${d.kind}-${d.name}`} className={d.ok ? "" : "ct__dep--bad"} title={d.detail}>
                  {d.ok ? "✓" : "!"} {d.name}
                </li>
              ))}
            </ul>
          )}
          {p.build && !p.build.ok && (
            <div className="ct__err">
              <b>Didn't compile.</b>
              <pre className="m0">{p.build.error}</pre>
            </div>
          )}
          {p.error && (
            <div className="ct__err">
              <pre className="m0">{p.error}</pre>
            </div>
          )}
          {p.suites?.length > 0 && (
            <ul className="ct__suites m0">
              {[...p.suites]
                .sort((a, b) => b.tests.filter((x) => x.status === "failed").length - a.tests.filter((x) => x.status === "failed").length)
                .map((s) => (
                  <Suite key={`${s.file}:${s.contract}`} s={s} />
                ))}
            </ul>
          )}
          {p.build?.ok && !p.suites?.length && !p.error && <p className="m0 rv-card__sub">Compiled, but no Foundry tests were found.</p>}
        </div>
      ))}

      {ct.hardhat?.length > 0 && (
        <p className="m0 ct__note">
          Hardhat: {ct.hardhat.map((h) => `${h.testFiles} JS test file${h.testFiles === 1 ? "" : "s"} in ${h.root === "." ? "the root" : h.root}`).join(", ")}. Not run: Hardhat tests are JavaScript with full Node access and need a container sandbox.
        </p>
      )}
      {ct.status === "error" && ct.error && <p className="m0 ct__note">{ct.error}</p>}
    </section>
  );
}
