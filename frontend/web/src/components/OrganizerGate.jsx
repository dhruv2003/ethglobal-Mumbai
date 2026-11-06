/* Shows its children only to a signed-in organizer wallet. The backend enforces the same rule. */
import { useState } from "react";
import { Button, Card } from "@ds/ui.jsx";
import { Link } from "../lib/router.jsx";
import { useOrganizer } from "../lib/organizer.js";
import { WalletGate } from "./ChainBits.jsx";

export function OrganizerGate({ wallet, children }) {
  const org = useOrganizer(wallet);
  const [error, setError] = useState("");
  if (wallet.status !== "connected") return <WalletGate wallet={wallet} reason="to sign in as an organizer" />;
  if (org.checking) return <div className="skeleton skeleton--seat" aria-label="Checking this wallet" />;
  if (!org.isOrganizer)
    return (
      <Card variant="surface" className="empty">
        <span className="t-body muted">Only organizer wallets can see this page.</span>
        <Link className="btn btn--secondary btn--sm" to="/tournaments">
          See tournaments
        </Link>
      </Card>
    );
  if (!org.signedIn)
    return (
      <Card variant="surface" className="empty">
        <span className="t-body muted">Sign in with this wallet to continue. It costs no gas.</span>
        <Button variant="primary" size="sm" onClick={() => org.signIn().catch((e) => setError(wallet.friendlyError?.(e) ?? e.message))}>
          Sign in as organizer
        </Button>
        {error && <p className="field__error" role="alert">{error}</p>}
      </Card>
    );
  return children;
}
