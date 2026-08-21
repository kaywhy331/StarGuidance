"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, LoadingState, Panel } from "@starguidance/design-system";
import { PROFILE_REPORT_SECTION_PREVIEW } from "@/lib/report-sections";
import { PrivateSigil } from "../session/[id]/private-sigil";

interface ProfileView {
  snapshot: { id: string; version: number; completeness: string };
  maskedName: string;
  birthDate: string;
  birthTimeProvided: boolean;
  birthplaceLabel?: string;
}

const CHECKOUT_KEY_STORAGE = "starguidance:profile-report-checkout-key";
const COMPLETENESS_LABELS: Record<string, string> = {
  core: "Core",
  locationEnhanced: "Location-Enhanced",
  complete: "Complete",
};

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
    title: "Source systems",
    keys: ["astrology", "numerology", "bazi", "dreamspell", "nine-star-ki", "planetary-angularity"],
  },
  {
    number: "IV",
    title: "Integration",
    keys: ["cross-system-convergence", "cross-system-contradictions", "practical-integration"],
  },
] as const;

export default function ProfilePage() {
  const [profile, setProfile] = useState<ProfileView | null>();
  const [message, setMessage] = useState<string>();
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [checkoutState, setCheckoutState] = useState<"idle" | "cancelled" | "pending">("idle");
  const [profileReportsEnabled, setProfileReportsEnabled] = useState(false);
  const processedCheckoutReturn = useRef(false);
  const router = useRouter();
  useEffect(() => {
    void fetch("/api/profile", { cache: "no-store" }).then(async (response) => {
      if (response.status === 401) return router.push("/sign-in");
      const payload = (await response.json()) as {
        profile: ProfileView | null;
        profileReportsEnabled: boolean;
      };
      setProfile(payload.profile);
      setProfileReportsEnabled(payload.profileReportsEnabled);
    });
  }, [router]);

  const submitCheckout = useCallback(
    async (reuseKey: boolean): Promise<"done" | "waiting" | "failed"> => {
      if (!profile && !reuseKey) return "failed";
      const storedKey = window.sessionStorage.getItem(CHECKOUT_KEY_STORAGE);
      const key = reuseKey && storedKey ? storedKey : window.crypto.randomUUID();
      window.sessionStorage.setItem(CHECKOUT_KEY_STORAGE, key);
      setMessage("Preparing your secure report purchase…");
      let response: Response;
      try {
        response = await fetch("/api/reports/checkout", {
          method: "POST",
          headers: { "idempotency-key": key },
        });
      } catch {
        setMessage("Checkout is temporarily unreachable. Your cards and profile are unchanged.");
        return "failed";
      }
      const payload = (await response.json()) as {
        reportId?: string;
        reportStatus?: "pending" | "ready" | "failed";
        checkoutUrl?: string;
        status?: "pending" | "paid" | "failed" | "refunded" | "disputed";
        error?: string;
      };
      if (response.status === 428) {
        router.push("/consent");
        return "failed";
      }
      if (payload.reportId) {
        window.sessionStorage.removeItem(CHECKOUT_KEY_STORAGE);
        setCheckoutState(payload.reportStatus === "pending" ? "pending" : "idle");
        router.push(`/report/${payload.reportId}`);
        return "done";
      }
      if (payload.checkoutUrl) {
        window.location.assign(payload.checkoutUrl);
        return "done";
      }
      if (payload.status === "pending" || payload.status === "paid") {
        setCheckoutState("pending");
        setMessage(
          payload.status === "paid"
            ? "Payment is confirmed. Your report is entering the preparation queue."
            : "Payment confirmation is still arriving. This page will keep checking.",
        );
        return "waiting";
      }
      if (
        payload.status === "failed" ||
        payload.status === "refunded" ||
        payload.status === "disputed"
      ) {
        window.sessionStorage.removeItem(CHECKOUT_KEY_STORAGE);
        setCheckoutState("idle");
      }
      setMessage(payload.error ?? "Checkout could not be prepared. Try again shortly.");
      return "failed";
    },
    [profile, router],
  );

  useEffect(() => {
    if (profile === undefined || processedCheckoutReturn.current) return;
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
        setMessage("Checkout was cancelled. No new charge was confirmed; you can resume securely.");
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
        setMessage(
          "Your payment is retained and preparation is still pending. You can leave this page and return later.",
        );
    };
    timer = setTimeout(() => {
      if (cancelled || processedCheckoutReturn.current) return;
      processedCheckoutReturn.current = true;
      window.history.replaceState({}, "", "/profile");
      setCheckoutState("pending");
      setMessage("Payment received. Checking report preparation…");
      void poll();
    }, 0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [profile, submitCheckout]);
  if (profile === undefined)
    return (
      <main className="profile-vault-loading">
        <LoadingState label="Opening your private profile vault…" />
      </main>
    );
  return (
    <main className="profile-vault-shell">
      <header className="profile-vault-header">
        <div>
          <p className="page-eyebrow">Encrypted profile vault</p>
          <h1>Your private pattern map</h1>
          <p>
            Your birth facts stay protected here. StarGuidance derives a compact lens for each
            reading while keeping the original details away from the narrator.
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
          <h2>No private profile exists yet</h2>
          <p>Create the protected foundation that personalizes your readings.</p>
          <Button onClick={() => router.push("/onboarding")}>Create private profile</Button>
        </Panel>
      ) : (
        <Panel className="profile-vault-card">
          <header>
            <div>
              <p>Current capability</p>
              <h2>
                {COMPLETENESS_LABELS[profile.snapshot.completeness] ??
                  profile.snapshot.completeness}
              </h2>
            </div>
            <span>Snapshot v{profile.snapshot.version}</span>
          </header>
          <div aria-hidden="true" className="profile-capability-orbit">
            <span data-active="true">Core</span>
            <i />
            <span data-active={profile.snapshot.completeness !== "core"}>Place</span>
            <i />
            <span data-active={profile.snapshot.completeness === "complete"}>Time</span>
          </div>
          <dl className="profile-vault-facts">
            <div>
              <dt>Birth name</dt>
              <dd>{profile.maskedName}</dd>
            </div>
            <div>
              <dt>Birth date</dt>
              <dd>{profile.birthDate}</dd>
            </div>
            <div>
              <dt>Birth time</dt>
              <dd>{profile.birthTimeProvided ? "Provided" : "Not provided"}</dd>
            </div>
            <div>
              <dt>Birthplace</dt>
              <dd>{profile.birthplaceLabel ?? "Not provided"}</dd>
            </div>
          </dl>
          <footer>
            <span aria-hidden="true">◈</span>
            <p>
              Edits create a new snapshot. Past readings always keep the version they began with.
            </p>
          </footer>
          <div className="profile-vault-actions">
            <Button onClick={() => router.push("/onboarding")} variant="secondary">
              Update birth facts
            </Button>
            {profileReportsEnabled && (profile || checkoutState === "cancelled") && (
              <Button onClick={() => void submitCheckout(checkoutState === "cancelled")}>
                {checkoutState === "cancelled"
                  ? "Resume secure checkout"
                  : "Get full profile report"}
              </Button>
            )}
          </div>
        </Panel>
      )}
      {message && (
        <p className="profile-vault-message" role="alert">
          {message}
        </p>
      )}
      {profile && profileReportsEnabled ? (
        <Panel className="profile-report-preview">
          <header className="atlas-preview-cover">
            <PrivateSigil label="Pattern atlas sigil" seed={profile.snapshot.id} />
            <div>
              <p>Private edition · snapshot v{profile.snapshot.version}</p>
              <h2>Your full pattern atlas</h2>
              <span>
                A designed long-form volume that keeps sources, contradictions, and unavailable
                systems visible.
              </span>
            </div>
            <aside>
              <strong>{PROFILE_REPORT_SECTION_PREVIEW.length}</strong>
              <span>structured sections</span>
            </aside>
          </header>
          <div aria-label="Pattern atlas chapters" className="atlas-preview-chapters">
            {REPORT_PREVIEW_CHAPTERS.map((chapter) => {
              const sections = PROFILE_REPORT_SECTION_PREVIEW.filter((section) =>
                (chapter.keys as readonly string[]).includes(section.key),
              );
              return (
                <section key={chapter.number}>
                  <span>{chapter.number}</span>
                  <h3>{chapter.title}</h3>
                  <p>{sections.map(({ title }) => title).join(" · ")}</p>
                </section>
              );
            })}
          </div>
          <div className="atlas-preview-integrity" role="note">
            <div aria-hidden="true">
              <span data-status="available">Deterministic</span>
              <i />
              <span data-status="conditional">Contextual</span>
              <i />
              <span data-status="gated">Unavailable</span>
            </div>
            <p>
              Every claim carries its source and version. A system that lacks validated inputs or
              approved calculations appears as an explicit gap—not invented insight.
            </p>
          </div>
          <footer className="atlas-preview-footer">
            <blockquote>
              <span>Inside the atlas</span>
              “Where independent signals agree, convergence is named. Where they pull in different
              directions, the tension stays intact.”
            </blockquote>
            <Button onClick={() => void submitCheckout(checkoutState === "cancelled")}>
              {checkoutState === "cancelled" ? "Resume secure checkout" : "Open your full atlas"}
            </Button>
          </footer>
        </Panel>
      ) : null}
      {profile ? (
        <details className="profile-danger-disclosure">
          <summary>Profile privacy & deletion controls</summary>
          <Panel>
            <h2>Delete private profile</h2>
            <p>
              This removes every profile snapshot and its dependent readings. Paid order,
              entitlement, and generated-report records remain under the finance retention policy;
              your login and policy receipts remain so you can start over.
            </p>
            <div>
              <Field
                autoComplete="off"
                label='Type "DELETE PROFILE"'
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
                  const response = await fetch("/api/profile", {
                    method: "DELETE",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ confirmation: deleteConfirmation }),
                  });
                  const payload = (await response.json()) as { error?: string };
                  if (!response.ok) {
                    setMessage(payload.error ?? "The private profile could not be deleted.");
                    return;
                  }
                  setProfile(null);
                  setDeleteConfirmation("");
                  setMessage(
                    "Your private profile and dependent readings were deleted. Commerce records were retained under the finance policy.",
                  );
                } finally {
                  setDeleting(false);
                }
              }}
              variant="danger"
            >
              {deleting ? "Deleting profile…" : "Delete private profile"}
            </Button>
          </Panel>
        </details>
      ) : null}
    </main>
  );
}
