import { Avatar } from "@ds/ui.jsx";
import { Checkbox, Msg, TextField, useForm } from "../components/fields.jsx";
import { emptyMember } from "../lib/form.js";

const initials = (name) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?";

export function TeamSection({ wallet }) {
  const { data, set, errors, showAll } = useForm();
  const members = data.team.members;
  const ownerErr = showAll ? errors["team.ownerWallet"] : undefined;
  const reward = data.team.rewardDifferent ? data.team.rewardWallet.trim() : wallet.address;

  return (
    <section id="team" className="card sec" aria-labelledby="team-h">
      <h2 id="team-h" className="t-display-md">Team</h2>
      <TextField path="team.name" label="Team name" autoComplete="organization" />

      <div className="stack-sm">
        <span className="label">Members</span>
        <p className="t-caption m0">Name each person. GitHub usernames help us match commits to people.</p>
        {members.map((m, i) => (
          <div key={m.id} className="member">
            <Avatar initials={initials(m.name)} tint="crush-soft" size={44} />
            <TextField path={`team.members.${i}.name`} label="Name" autoComplete="name" />
            <TextField path={`team.members.${i}.github`} label="GitHub" optional mono placeholder="@username" autoCapitalize="off" spellCheck={false} />
            <TextField path={`team.members.${i}.role`} label="Role" optional placeholder="Contracts, frontend…" />
            {members.length > 1 && (
              <button
                type="button"
                className="btn btn--ghost btn--sm member__x"
                aria-label={`Remove ${m.name || `member ${i + 1}`}`}
                onClick={() => set("team.members", members.filter((x) => x.id !== m.id))}
              >
                Remove
              </button>
            )}
          </div>
        ))}
        <div>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => set("team.members", [...members, emptyMember()])}>
            Add a member
          </button>
        </div>
      </div>

      <div className="grid2">
        <div className="field">
          <span className="label" id="owner-l">Owner wallet</span>
          <div className="wallet-box" aria-labelledby="owner-l">
            {wallet.status === "connected" ? (
              <>
                <span className="t-mono addr">{wallet.address}</span>
                <span className="t-mono-caption">from MetaMask</span>
              </>
            ) : (
              <>
                <span className="t-body">Not connected yet</span>
                {wallet.status !== "unavailable" && (
                  <button type="button" className="btn btn--oracle btn--sm" onClick={wallet.connect}>
                    Connect wallet
                  </button>
                )}
              </>
            )}
          </div>
          <Msg id="f-team-ownerWallet-msg" help="Whoever connects owns this submission and can edit it until freeze." error={ownerErr} />
        </div>

        <div className="field">
          <span className="label">Reward wallet</span>
          <div className="reward-box">
            <span className="t-mono addr">{reward || "Connect a wallet or enter one below"}</span>
            <span className="t-caption ink">The project's 20% of every winning pool goes here. It's locked at freeze.</span>
          </div>
          <Checkbox path="team.rewardDifferent">Send rewards to a different wallet</Checkbox>
          {data.team.rewardDifferent && (
            <TextField path="team.rewardWallet" label="Reward wallet address" mono placeholder="0x…" autoCapitalize="off" spellCheck={false} />
          )}
        </div>
      </div>
    </section>
  );
}
