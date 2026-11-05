import { SelectField, TextField, useForm } from "../components/fields.jsx";
import { CONTRACT_NETWORKS } from "../config/event.js";
import { emptyContract } from "../lib/form.js";

export function CodeSection() {
  const { data, set } = useForm();
  const contracts = data.code.contracts;
  return (
    <section id="code" className="card sec" aria-labelledby="code-h">
      <h2 id="code-h" className="t-display-md">Code</h2>
      <TextField
        path="code.repoUrl"
        label="GitHub repository"
        type="url"
        inputMode="url"
        mono
        placeholder="https://github.com/team/project"
        help="Public repos only. We pin the exact commit when your submission freezes."
        autoCapitalize="off"
        spellCheck={false}
      />
      <div className="grid2">
        <TextField path="code.ref" label="Branch or commit" optional mono placeholder="main" help="Leave empty to use the default branch." autoCapitalize="off" spellCheck={false} />
        <TextField path="code.monorepoPath" label="Folder in the repo" optional mono placeholder="apps/web" help="Only for monorepos." autoCapitalize="off" spellCheck={false} />
      </div>

      <div className="stack-sm">
        <span className="label">
          Deployed contracts <span className="optional">optional</span>
        </span>
        <p className="t-caption m0">Judges can check these on-chain, which backs up your engineering claims.</p>
        {contracts.map((c, i) => (
          <div key={c.id} className="contract">
            <TextField path={`code.contracts.${i}.address`} label="Address" mono placeholder="0x…" autoCapitalize="off" spellCheck={false} />
            <SelectField path={`code.contracts.${i}.network`} label="Network" options={CONTRACT_NETWORKS} />
            <button
              type="button"
              className="btn btn--ghost btn--sm member__x"
              aria-label={`Remove contract ${i + 1}`}
              onClick={() => set("code.contracts", contracts.filter((x) => x.id !== c.id))}
            >
              Remove
            </button>
          </div>
        ))}
        <div>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => set("code.contracts", [...contracts, emptyContract()])}>
            Add a contract
          </button>
        </div>
      </div>
    </section>
  );
}
