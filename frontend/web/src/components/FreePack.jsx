/*
 * One human, one free pack of FILTER: verify with World ID, and the server sends it.
 * The server checks the proof and decides. This card only asks and reports.
 */
import { useRef, useState } from "react";
import { Button, Card, StatusPill } from "@ds/ui.jsx";
import { usePoll } from "../lib/chain.js";
import { celebrate } from "./WalletPage.jsx";
import { apiUrl } from "../lib/api.js";

const WORLD_ERROR = {
  user_rejected: "You cancelled, so nothing was claimed.",
  verification_rejected: "You cancelled, so nothing was claimed.",
  credential_unavailable: "This needs a verified World ID, and this one doesn't have the Proof of Human credential.",
  world_id_4_not_available: "This needs World ID 4.0. Update World App and try again.",
  nullifier_replayed: "This World ID has already claimed its free FILTER.",
  connection_failed: "Couldn't connect to World App. Try again.",
  rp_signature_expired: "That request expired. Try again.",
};

async function postJson(url, body) {
  const res = await fetch(apiUrl(url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Something went wrong, so nothing was claimed.");
  return data;
}

async function readStatus(address) {
  const res = await fetch(apiUrl(`/api/world/status?wallet=${encodeURIComponent(address)}`));
  if (!res.ok) throw new Error("status unavailable");
  return res.json();
}

export function FreePack({ wallet, onClaimed }) {
  const address = wallet.address;
  const { data: status, loading, refresh } = usePoll(() => readStatus(address), [address], 0);
  const [widget, setWidget] = useState(null);
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState("");
  const serverProblem = useRef("");

  const start = async () => {
    setStarting(true);
    setProblem("");
    serverProblem.current = "";
    try {
      // World's package is large, so it only loads for people who ask for it.
      const [world, rp] = await Promise.all([import("@worldcoin/idkit"), postJson("/api/world/rp-signature", {})]);
      setWidget({
        ...world,
        open: true,
        rpContext: { rp_id: status.rpId, nonce: rp.nonce, created_at: rp.created_at, expires_at: rp.expires_at, signature: rp.sig },
      });
    } catch (e) {
      setProblem(e.message);
    } finally {
      setStarting(false);
    }
  };

  if (loading && !status) return null;
  if (!status?.enabled) {
    return (
      <Card variant="surface">
        <p className="t-caption m0">Free FILTER for verified humans isn't available right now.</p>
      </Card>
    );
  }

  const Widget = widget?.IDKitRequestWidget;
  return (
    <Card variant="surface" className="stack">
      <div className="section-head">
        <h2 className="t-heading m0">Get {status.amount} free FILTER</h2>
        {status.claimed ? <StatusPill tone="success">Claimed</StatusPill> : <StatusPill tone="neutral">One per person</StatusPill>}
      </div>
      {status.claimed ? (
        <p className="t-body m0 muted">This wallet has claimed its free FILTER. Good luck in the ring.</p>
      ) : (
        <>
          <p className="t-body m0 muted">Prove you're a unique human with World ID and we'll send it to this wallet. No gas needed. World ID doesn't share who you are with us.</p>
          <div>
            <Button variant="secondary" disabled={starting} onClick={start}>
              {starting ? "Starting…" : "Verify with World ID"}
            </Button>
          </div>
          {status.environment !== "production" && <p className="t-caption m0">Test mode: this uses World's simulator and fake identities.</p>}
          {problem && (
            <p className="t-body m0" role="alert">
              {problem}
            </p>
          )}
        </>
      )}
      {Widget && (
        <Widget
          open={widget.open}
          onOpenChange={(open) => setWidget((w) => ({ ...w, open }))}
          app_id={status.appId}
          action={status.action}
          rp_context={widget.rpContext}
          allow_legacy_proofs={false}
          environment={status.environment}
          preset={widget.proofOfHuman({ signal: address.toLowerCase() })}
          handleVerify={async (result) => {
            try {
              await postJson("/api/world/claim", { wallet: address, idkitResponse: result });
            } catch (e) {
              serverProblem.current = e.message;
              throw e;
            }
          }}
          onSuccess={async () => {
            celebrate();
            await Promise.all([refresh(), onClaimed?.()]);
          }}
          onError={(code) => setProblem(serverProblem.current || WORLD_ERROR[code] || "World ID couldn't finish, so nothing was claimed. Try again.")}
        />
      )}
    </Card>
  );
}
