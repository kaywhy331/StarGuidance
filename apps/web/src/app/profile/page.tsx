"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Field, LoadingState, Panel } from "@starguidance/design-system";
import { signInPathFor } from "@/lib/account-return";
import { requestJson, sendJson } from "@/lib/client-request";
import { PROFILE_REPORT_SECTION_PREVIEW } from "@/lib/report-sections";
import { PrivateSigil } from "../session/[id]/private-sigil";

interface ProfileHighlight {
  key: string;
  symbol: string;
  label: string;
  value: string;
  meaning: string;
}

interface ProfileView {
  snapshot: {
    id: string;
    version: number;
    completeness: "core" | "locationEnhanced" | "complete" | string;
    createdAt?: string;
  };
  highlights?: ProfileHighlight[];
  maskedName: string;
  birthDate: string;
  birthTimeProvided: boolean;
  birthplaceLabel?: string;
}

interface ProfilePayload {
  profile: ProfileView | null;
  profileReportsEnabled: boolean;
  reportOffer?: { priceMinor: number; currency: string };
}

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; profile: ProfileView | null };

const CHECKOUT_KEY_STORAGE = "starguidance:profile-report-checkout-key";

const REPORT_PREVIEW_CHAPTERS = [
  {
    number: "I",
    title: "Foundation",
    keys: ["overview", "core-motivations", "strengths", "growth-opportunities"],
  },
  {
    number: "II",
    title: "Inner life",
    keys: ["emotional-patterns", "relationships", "communication-decisions", "internal-tensions"],
  },
  {
    number: "III",
    title: "The traditions",
    keys: ["astrology", "numerology", "bazi", "dreamspell", "nine-star-ki", "planetary-angularity"],
  },
  {
    number: "IV",
    title: "Bringing it together",
    keys: ["cross-system-convergence", "cross-system-contradictions", "practical-integration"],
  },
] as const;

/** Birth dates are calendar dates, so format them without a timezone shift. */
function formatCalendarDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatTimestamp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? undefined
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function formatReportPrice(offer: ProfilePayload["reportOffer"]): string | undefined {
  if (!offer) return undefined;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: offer.currency,
      minimumFractionDigits: offer.priceMinor % 100 === 0 ? 0 : 2,
    }).format(offer.priceMinor / 100);
  } catch {
    return undefined;
  }
}

function deepenInvitation(completeness: string): { title: string; body: string } | undefined {
  if (completeness === "complete") return undefined;
  if (completeness === "locationEnhanced")
    return {
      title: "Add your birth time to deepen your profile",
      body: "Your birth time unlocks the parts of your map that depend on the exact moment you arrived, like where the planets were rising.",
    };
  return {
    title: "Add your birth time and place to deepen your profile",
    body: "Right now your profile draws on your name and birth date. Your birth time and place unlock more of the traditions in your map.",
  };
}

export default function ProfilePage() {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [message, setMessage] = useState<{ tone: "status" | "error"; text: string }>();
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [checkoutState, setCheckoutState] = useState<"idle" | "cancelled" | "pending">("idle");
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [profileReportsEnabled, setProfileReportsEnabled] = useState(false);
  const [reportOffer, setReportOffer] = useState<ProfilePayload["reportOffer"]>();
  const processedCheckoutReturn = useRef(false);
  const router = useRouter();
  const profile = state.phase === "ready" ? state.profile : undefined;

  const loadProfile = useCallback(async () => {
    setState({ phase: "loading" });
    const result = await requestJson<ProfilePayload>("/api/profile", { cache: "no-store" });
    if (!result.ok) {
      if (result.status === 401) {
        router.push(signInPathFor("/profile"));
        return;
      }
      setState({ phase: "error", message: result.error });
      return;
    }
    setProfileReportsEnabled(result.data.profileReportsEnabled);
    setReportOffer(result.data.reportOffer);
    setState({ phase: "ready", profile: result.data.profile });
  }, [router]);

  useEffect(() => {
    const timer = setTimeout(() => void loadProfile(), 0);
    return () => clearTimeout(timer);
  }, [loadProfile]);

  const submitCheckout = useCallback(
    async (reuseKey: boolean): Promise<"done" | "waiting" | "failed"> => {
      if (!profile && !reuseKey) return "failed";
      const storedKey = window.sessionStorage.getItem(CHECKOUT_KEY_STORAGE);
      const key = reuseKey && storedKey ? storedKey : window.crypto.randomUUID();
      window.sessionStorage.setItem(CHECKOUT_KEY_STORAGE, key);
      setMessage({ tone: "status", text: "Opening secure checkout…" });
      const result = await sendJson("/api/reports/checkout", "POST", undefined, {
        headers: { "idempotency-key": key },
      });
      if (result.status === 428) {
        router.push("/consent?next=/profile");
        return "failed";
      }
      if (result.status === 0) {
        setMessage({
          tone: "error",
          text: "Checkout couldn’t be reached. Nothing was charged and your profile is unchanged — please try again.",
        });
        return "failed";
      }
      const payload = result.data;
      const reportId = typeof payload.reportId === "string" ? payload.reportId : undefined;
      const checkoutUrl = typeof payload.checkoutUrl === "string" ? payload.checkoutUrl : undefined;
      const status = typeof payload.status === "string" ? payload.status : undefined;
      if (reportId) {
        window.sessionStorage.removeItem(CHECKOUT_KEY_STORAGE);
        setCheckoutState(payload.reportStatus === "pending" ? "pending" : "idle");
        router.push(`/report/${reportId}`);
        return "done";
      }
      if (checkoutUrl) {
        window.location.assign(checkoutUrl);
        return "done";
      }
      if (status === "pending" || status === "paid") {
        setCheckoutState("pending");
        setMessage({
          tone: "status",
          text:
            status === "paid"
              ? "Payment confirmed. Your atlas is being prepared."
              : "We’re waiting for your payment to be confirmed. This page will keep checking.",
        });
        return "waiting";
      }
      if (status === "failed" || status === "refunded" || status === "disputed") {
        window.sessionStorage.removeItem(CHECKOUT_KEY_STORAGE);
        setCheckoutState("idle");
      }
      setMessage({
        tone: "error",
        text: result.ok ? "Checkout couldn’t be opened. Please try again shortly." : result.error,
      });
      return "failed";
    },
    [profile, router],
  );

  const startCheckout = useCallback(async () => {
    setCheckoutBusy(true);
    try {
      await submitCheckout(checkoutState === "cancelled");
    } finally {
      setCheckoutBusy(false);
    }
  }, [checkoutState, submitCheckout]);

  useEffect(() => {
    if (state.phase !== "ready" || processedCheckoutReturn.current) return;
    const checkout = new URLSearchParams(window.location.search).get("checkout");
    if (checkout !== "success" && checkout !== "cancelled") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (checkout === "cancelled") {
      timer = setTimeout(() => {
        if (cancelled || processedCheckoutReturn.current) return;
        processedCheckoutReturn.current = true;
        window.history.replaceState({}, "", "/profile");
        setCheckoutState("cancelled");
        setMessage({
          tone: "status",
          text: "Checkout was cancelled and nothing was charged. You can pick up where you left off whenever you like.",
        });
      }, 0);
      return () => {
        cancelled = true;
        if (timer) clearTimeout(timer);
      };
    }
    let attempts = 0;
    const poll = async () => {
      const outcome = await submitCheckout(true);
      attempts += 1;
      if (!cancelled && outcome === "waiting" && attempts < 40)
        timer = setTimeout(() => void poll(), 1_500);
      else if (!cancelled && outcome === "waiting")
        setMessage({
          tone: "status",
          text: "Your payment is safe and your atlas is still being prepared. You can leave this page — it will be waiting in Reports.",
        });
    };
    timer = setTimeout(() => {
      if (cancelled || processedCheckoutReturn.current) return;
      processedCheckoutReturn.current = true;
      window.history.replaceState({}, "", "/profile");
      setCheckoutState("pending");
      setMessage({ tone: "status", text: "Payment received. Checking on your atlas…" });
      void poll();
    }, 0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [state.phase, submitCheckout]);

  if (state.phase === "loading")
    return (
      <main className="profile-vault-loading">
        <LoadingState label="Opening your profile…" />
      </main>
    );

  if (state.phase === "error")
    return (
      <main className="profile-vault-shell">
        <Panel className="account-state-panel" role="alert">
          <span aria-hidden="true" className="account-state-panel__mark">
            ✦
          </span>
          <h1>We couldn’t open your profile</h1>
          <p>{state.message}</p>
          <p>Your birth details are safe — nothing was changed.</p>
          <div className="account-state-panel__actions">
            <Button onClick={() => void loadProfile()}>Try again</Button>
            <Link href="/readings">Back to readings</Link>
          </div>
        </Panel>
      </main>
    );

  const price = formatReportPrice(reportOffer);
  const purchaseLabel =
    checkoutState === "cancelled"
      ? "Resume secure checkout"
      : `Purchase your pattern atlas${price ? ` · ${price}` : ""}`;
  const purchaseButton = (
    <div className="profile-purchase">
      <Button disabled={checkoutBusy} onClick={() => void startCheckout()}>
        {checkoutBusy ? "Opening checkout…" : purchaseLabel}
      </Button>
      <small>
        {price ? `One-time purchase of ${price}. ` : "One-time purchase. "}
        Yours to keep, as a web page and PDF.
      </small>
    </div>
  );
  const invitation = profile ? deepenInvitation(profile.snapshot.completeness) : undefined;
  const updated = formatTimestamp(profile?.snapshot.createdAt);

  return (
    <main className="profile-vault-shell">
      <header className="profile-vault-header">
        <div>
          <p className="page-eyebrow">Your profile</p>
          <h1>Your private pattern map</h1>
          <p>
            Your birth details stay encrypted here. Each reading draws on a small, relevant slice of
            what they reveal — never the details themselves.
          </p>
        </div>
        {profile ? (
          <span className="profile-vault-mark">
            <PrivateSigil seed={profile.snapshot.id} />
          </span>
        ) : (
          <span aria-hidden="true" className="profile-vault-mark">
            <i>✦</i>
          </span>
        )}
      </header>
      {!profile ? (
        <Panel className="profile-vault-empty">
          <h2>You haven’t set up your profile yet</h2>
          <p>
            Add your name and birth date so your readings can reflect you. Birth time and place are
            optional and can be added any time.
          </p>
          <Button onClick={() => router.push("/onboarding")}>Create your profile</Button>
        </Panel>
      ) : (
        <>
          {profile.highlights && profile.highlights.length > 0 ? (
            <section aria-labelledby="profile-highlights-title" className="profile-highlights">
              <h2 id="profile-highlights-title">What your birth details suggest</h2>
              <ul>
                {profile.highlights.map((highlight) => (
                  <li key={highlight.key}>
                    <span aria-hidden="true" className="profile-highlights__symbol">
                      {highlight.symbol}
                    </span>
                    <div>
                      <p>{highlight.label}</p>
                      <h3>{highlight.value}</h3>
                      <span>{highlight.meaning}</span>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="profile-highlights__note">
                These are reflections to test against your own experience, not predictions.
              </p>
            </section>
          ) : null}
          <Panel className="profile-vault-card">
            <header>
              <div>
                <p>Birth details on file</p>
                <h2>{invitation ? "A good foundation" : "Your complete profile"}</h2>
              </div>
            </header>
            {invitation ? (
              <div className="profile-deepen">
                <div>
                  <h3>{invitation.title}</h3>
                  <p>{invitation.body}</p>
                </div>
                <Button onClick={() => router.push("/onboarding")} variant="secondary">
                  Add birth details
                </Button>
              </div>
            ) : null}
            <dl className="profile-vault-facts">
              <div>
                <dt>Birth name</dt>
                <dd>
                  {profile.maskedName}
                  <small>Only the first letter is shown, for your privacy</small>
                </dd>
              </div>
              <div>
                <dt>Birth date</dt>
                <dd>{formatCalendarDate(profile.birthDate)}</dd>
              </div>
              <div>
                <dt>Birth time</dt>
                <dd>{profile.birthTimeProvided ? "Added" : "Not added yet"}</dd>
              </div>
              <div>
                <dt>Birthplace</dt>
                <dd>{profile.birthplaceLabel ?? "Not added yet"}</dd>
              </div>
            </dl>
            <details className="profile-version-details">
              <summary>Details</summary>
              <p>
                Profile version {profile.snapshot.version}
                {updated ? `, saved ${updated}` : ""}. Updating your birth details saves a new
                version; past readings keep the version they began with.
              </p>
            </details>
            <div className="profile-vault-actions">
              <Button onClick={() => router.push("/onboarding")} variant="secondary">
                Update birth details
              </Button>
            </div>
          </Panel>
        </>
      )}
      {message ? (
        <p
          className="profile-vault-message"
          data-tone={message.tone}
          role={message.tone === "error" ? "alert" : "status"}
        >
          {message.text}
        </p>
      ) : null}
      {profile && profileReportsEnabled ? (
        <Panel className="profile-report-preview">
          <header className="atlas-preview-cover">
            <PrivateSigil label="Pattern atlas sigil" seed={profile.snapshot.id} />
            <div>
              <p>A private edition, written for you</p>
              <h2>Your full pattern atlas</h2>
              <span>
                A long-form volume that brings every tradition in your profile together — where they
                agree, where they pull in different directions, and what isn’t included yet.
              </span>
            </div>
            <aside>
              <strong>{PROFILE_REPORT_SECTION_PREVIEW.length}</strong>
              <span>sections</span>
            </aside>
          </header>
          <div aria-label="Pattern atlas chapters" className="atlas-preview-chapters" role="list">
            {REPORT_PREVIEW_CHAPTERS.map((chapter) => {
              const sections = PROFILE_REPORT_SECTION_PREVIEW.filter((section) =>
                (chapter.keys as readonly string[]).includes(section.key),
              );
              return (
                <section key={chapter.number} role="listitem">
                  <span>{chapter.number}</span>
                  <h3>{chapter.title}</h3>
                  <p>{sections.map(({ title }) => title).join(" · ")}</p>
                </section>
              );
            })}
          </div>
          <div className="atlas-preview-integrity" role="note">
            <div aria-hidden="true">
              <span data-status="available">Grounded</span>
              <i />
              <span data-status="conditional">Reflective</span>
              <i />
              <span data-status="gated">Not yet</span>
            </div>
            <p>
              Every insight comes from your own birth details. If a tradition needs details you
              haven’t added, the atlas says so plainly instead of guessing.
            </p>
          </div>
          <footer className="atlas-preview-footer">
            <blockquote>
              <span>Inside the atlas</span>
              “Where different traditions agree, you’ll see it named. Where they pull in different
              directions, both sides stay in view.”
            </blockquote>
            {purchaseButton}
          </footer>
        </Panel>
      ) : null}
      {profile ? (
        <details className="profile-danger-disclosure">
          <summary>Delete your profile</summary>
          <Panel>
            <h2>Delete your profile</h2>
            <p>
              This deletes your birth details and every reading made with them. Pattern atlases you
              purchased stay available with their receipts, and your login stays so you can start
              again whenever you like.
            </p>
            <div>
              <Field
                autoComplete="off"
                label='Type "DELETE PROFILE" to confirm'
                onChange={(event) => setDeleteConfirmation(event.target.value)}
                value={deleteConfirmation}
              />
            </div>
            <Button
              disabled={deleting || deleteConfirmation !== "DELETE PROFILE"}
              onClick={async () => {
                setDeleting(true);
                setMessage(undefined);
                try {
                  const result = await sendJson("/api/profile", "DELETE", {
                    confirmation: deleteConfirmation,
                  });
                  if (!result.ok) {
                    setMessage({ tone: "error", text: result.error });
                    return;
                  }
                  setState({ phase: "ready", profile: null });
                  setDeleteConfirmation("");
                  setMessage({
                    tone: "status",
                    text: "Your profile and the readings made with it were deleted. Purchased atlases are still in Reports.",
                  });
                } finally {
                  setDeleting(false);
                }
              }}
              variant="danger"
            >
              {deleting ? "Deleting profile…" : "Delete profile"}
            </Button>
          </Panel>
        </details>
      ) : null}
    </main>
  );
}
