import Link from "next/link";
import type { ReactNode } from "react";
import { Panel } from "@starguidance/design-system";

export interface ThresholdPromise {
  title: string;
  detail: string;
}

/**
 * The shared shell for every account doorway (sign up, sign in, password
 * recovery, policy review) so they read as one calm place with a way home.
 */
export function AccountThreshold({
  eyebrow,
  title,
  lede,
  promises,
  panelEyebrow,
  panelTitle,
  panelLede,
  children,
}: {
  eyebrow: string;
  title: string;
  lede: ReactNode;
  promises?: readonly ThresholdPromise[];
  panelEyebrow: string;
  panelTitle: string;
  panelLede?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="account-threshold-shell">
      <section aria-labelledby="account-threshold-heading" className="account-threshold-story">
        <Link className="account-threshold-brand" href="/">
          <span aria-hidden="true">✦</span> StarGuidance
        </Link>
        <div>
          <p className="page-eyebrow">{eyebrow}</p>
          <h1 id="account-threshold-heading">{title}</h1>
          <p className="account-threshold-lede">{lede}</p>
        </div>
        {promises?.length ? (
          <ol aria-label="What we promise" className="account-threshold-promises">
            {promises.map((promise, index) => (
              <li key={promise.title}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{promise.title}</strong>
                <small>{promise.detail}</small>
              </li>
            ))}
          </ol>
        ) : null}
        <div aria-hidden="true" className="account-threshold-orbit">
          <i />
          <span>Private by design</span>
        </div>
      </section>

      <Panel className="account-threshold-panel">
        <p className="page-eyebrow">{panelEyebrow}</p>
        <h2>{panelTitle}</h2>
        {panelLede ? <p>{panelLede}</p> : null}
        {children}
      </Panel>
    </main>
  );
}

/** A calm inline message used by every account form. */
export function AccountMessage({
  tone,
  children,
}: {
  tone: "error" | "success" | "info";
  children: ReactNode;
}) {
  return (
    <p
      aria-live={tone === "error" ? "assertive" : "polite"}
      className={`account-message account-message--${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      {children}
    </p>
  );
}
