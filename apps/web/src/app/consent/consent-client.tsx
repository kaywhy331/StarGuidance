"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, LoadingState } from "@starguidance/design-system";

import { requestJson, sendJson } from "@/lib/client-request";
import { POLICY_VERSIONS } from "@/lib/policies";

import { AccountMessage, AccountThreshold } from "../sign-up/account-threshold";

interface ConsentState {
  consents: { requiredCurrent: boolean };
  nextPath: string;
}

export function ConsentClient({ nextPath }: { nextPath?: string | undefined }) {
  const router = useRouter();
  const [state, setState] = useState<ConsentState>();
  const [loadError, setLoadError] = useState<string>();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void requestJson<ConsentState>("/api/settings", { cache: "no-store" }).then((result) => {
      if (cancelled) return;
      if (result.status === 401) {
        router.replace(nextPath ? `/sign-in?next=${encodeURIComponent(nextPath)}` : "/sign-in");
        return;
      }
      if (!result.ok) {
        setLoadError("We couldn't check your account just now. Please try again in a moment.");
        return;
      }
      if (result.data.consents?.requiredCurrent) {
        router.replace(nextPath ?? result.data.nextPath);
        return;
      }
      setState(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [attempt, nextPath, router]);

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError(undefined);
    const result = await sendJson<ConsentState>("/api/settings", "PATCH", {
      action: "accept-required-policies",
      termsAccepted: form.get("termsAccepted") === "on",
      termsVersion: POLICY_VERSIONS.terms,
      privacyAccepted: form.get("privacyAccepted") === "on",
      privacyVersion: POLICY_VERSIONS.privacy,
      ageConfirmed: form.get("ageConfirmed") === "on",
      ageEligibilityVersion: POLICY_VERSIONS.ageEligibility,
    });
    if (!result.ok) {
      setSaving(false);
      setError(result.error);
      return;
    }
    router.replace(nextPath ?? result.data.nextPath);
    router.refresh();
  }

  return (
    <AccountThreshold
      eyebrow="One small step"
      lede="Before your next reading, please take a moment with our Terms and Privacy Notice. They explain what a reading is, and how your details are kept private."
      panelEyebrow="Terms & privacy"
      panelTitle="Before you continue"
      title="A moment before we begin."
    >
      {!state && !loadError ? <LoadingState label="Checking your account…" /> : null}
      {loadError ? (
        <div className="account-retry">
          <AccountMessage tone="error">{loadError}</AccountMessage>
          <Button
            onClick={() => {
              setLoadError(undefined);
              setAttempt((current) => current + 1);
            }}
            type="button"
            variant="secondary"
          >
            Try again
          </Button>
        </div>
      ) : null}
      {state ? (
        <form className="account-form-stage mt-6" onSubmit={accept}>
          <p className="account-consent-intro">
            Please read and agree to the current Terms and Privacy Notice to keep creating readings
            and profiles. If you&apos;ve agreed before, they&apos;ve been updated since. Product
            news stays a separate choice in Account settings.
          </p>
          <div className="account-consent-list">
            <label>
              <input name="termsAccepted" required type="checkbox" />
              <span>
                I accept the current <Link href="/terms">Terms</Link>.
              </span>
            </label>
            <label>
              <input name="privacyAccepted" required type="checkbox" />
              <span>
                I have read the current <Link href="/privacy">Privacy Notice</Link>.
              </span>
            </label>
            <label>
              <input name="ageConfirmed" required type="checkbox" />
              <span>I confirm that I am at least 18 years old.</span>
            </label>
          </div>
          {error ? <AccountMessage tone="error">{error}</AccountMessage> : null}
          <Button disabled={saving} type="submit">
            {saving ? "Saving…" : "Accept and continue"}
          </Button>
        </form>
      ) : null}
    </AccountThreshold>
  );
}
