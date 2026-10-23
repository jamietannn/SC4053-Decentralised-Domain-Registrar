import { ReactNode, useState } from "react";
import { EXPLORER_TX_URL } from "../config";
import { formatCountdown, formatDateTime, shortHash } from "../lib/format";
import { sgdHint } from "../lib/sgd";
import { Phase, PHASE_LABEL } from "../lib/types";
import { useNow } from "../state/hooks";
import { useSgdRate } from "../state/sgdRate";

const PHASE_TONE: Record<Phase, string> = {
  [Phase.None]: "neutral",
  [Phase.Commit]: "blue",
  [Phase.Reveal]: "violet",
  [Phase.Settlement]: "amber",
  [Phase.Settled]: "green",
  [Phase.Closed]: "neutral",
};

export function Badge({ tone = "neutral", children }: { tone?: string; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function PhaseBadge({ phase }: { phase: Phase }) {
  return <Badge tone={PHASE_TONE[phase]}>{PHASE_LABEL[phase]}</Badge>;
}

/** Live countdown to a unix deadline (display aid; the contract decides the phase). */
export function Countdown({ to, suffix = "remaining" }: { to: number; suffix?: string }) {
  const now = useNow();
  const left = to - now;
  if (left <= 0) return <span className="countdown muted">ended — refreshing…</span>;
  return (
    <span className="countdown">
      <span className="mono">{formatCountdown(left)}</span> {suffix}
    </span>
  );
}

export function Card({ title, children, actions }: { title?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="card">
      {(title || actions) && (
        <header className="card-header">
          {title && <h2>{title}</h2>}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "error" | "success"; children: ReactNode }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-small btn-ghost"
      onClick={() =>
        navigator.clipboard.writeText(value).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          () => undefined,
        )
      }
    >
      {copied ? "Copied" : label}
    </button>
  );
}

export function TxLink({ hash }: { hash: string }) {
  if (EXPLORER_TX_URL)
    return (
      <a className="mono" href={EXPLORER_TX_URL + hash} target="_blank" rel="noreferrer">
        {shortHash(hash)}
      </a>
    );
  return (
    <span className="mono" title={hash}>
      {shortHash(hash)}
    </span>
  );
}

export function DetailList({ rows }: { rows: Array<[ReactNode, ReactNode]> }) {
  return (
    <dl className="details">
      {rows.map(([k, v], i) => (
        <div key={i} className="details-row">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Indicative SGD value for an ETH input (SPEC §7). Never changes the ETH amount sent. */
export function SgdHint({ wei }: { wei: bigint | null }) {
  const hint = sgdHint(useSgdRate(), wei, useNow());
  if (!hint) return null;
  if (hint.unavailable) return <p className="hint">SGD estimate unavailable</p>;
  return (
    <p className="hint">
      {hint.estimate} estimate (indicative only) · rate from CoinGecko at {formatDateTime(hint.rateTime)}
    </p>
  );
}

export function Loading({ what = "Loading" }: { what?: string }) {
  return <p className="muted">{what}…</p>;
}
