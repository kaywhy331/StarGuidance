"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Field } from "@starguidance/design-system";

import { POLICY_VERSIONS } from "@/lib/policies";

export function SignUpForm({ nextPath }: { nextPath?: string | undefined }) {
  const router = useRouter();
  const [step, setStep] = useState<"identity" | "permission">("identity");
  const [identity, setIdentity] = useState({
    email: "",
    displayName: "",
    password: "",
    confirmPassword: "",
  });
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [pendingEmail, setPendingEmail] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  return (
    <form
      className="mt-8 grid gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setError(undefined);
        setNotice(undefined);
        if (step === "identity") {
          if (identity.password !== identity.confirmPassword) {
            setError("Passwords must match before you continue.");
            return;
          }
          setStep("permission");
          return;
        }
        const form = new FormData(event.currentTarget);
        const consents = {
          termsAccepted: form.get("termsAccepted") === "on",
          termsVersion: POLICY_VERSIONS.terms,
          privacyAccepted: form.get("privacyAccepted") === "on",
          privacyVersion: POLICY_VERSIONS.privacy,
          ageConfirmed: form.get("ageConfirmed") === "on",
          ageEligibilityVersion: POLICY_VERSIONS.ageEligibility,
          marketingAccepted: false,
          marketingVersion: POLICY_VERSIONS.marketing,
        };
        setSubmitting(true);
        const response = await fetch("/api/auth", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "sign-up",
            email: identity.email,
            password: identity.password,
            displayName: identity.displayName,
            consents,
            next: nextPath,
          }),
        });
        const payload = (await response.json()) as {
          authenticated?: boolean;
          pending?: boolean;
          error?: string;
        };
        setSubmitting(false);
        if (!response.ok) return setError(payload.error ?? "Unable to create the account.");
        if (payload.pending) {
          setPendingEmail(identity.email);
          setNotice(
            "Account created. Check your email once to confirm it, then sign in with your password.",
          );
          return;
        }
        router.push(nextPath ?? "/onboarding");
        router.refresh();
      }}
    >
      <ol aria-label="Account creation progress" className="account-form-progress">
        <li aria-current={step === "identity" ? "step" : undefined}>
          <span>01</span> Your key
        </li>
        <li aria-current={step === "permission" ? "step" : undefined}>
          <span>02</span> Permission
        </li>
      </ol>
      {error ? (
        <p
          aria-live="assertive"
          className="rounded-2xl border border-rose-300/30 bg-rose-950/30 p-3 text-sm text-rose-100"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {step === "identity" ? (
        <fieldset className="account-form-stage">
          <legend>Choose how you return</legend>
          <p>Nothing entered here is used to select cards.</p>
          <Field
            autoComplete="email"
            label="Email"
            name="email"
            onChange={(event) => setIdentity({ ...identity, email: event.target.value })}
            required
            type="email"
            value={identity.email}
          />
          <Field
            autoComplete="nickname"
            hint="Used in the reading experience; separate from your private birth name."
            label="Display name"
            maxLength={80}
            name="displayName"
            onChange={(event) => setIdentity({ ...identity, displayName: event.target.value })}
            required
            value={identity.displayName}
          />
          <div className="account-password-grid">
            <Field
              autoComplete="new-password"
              hint="Use 12–72 characters."
              label="Password"
              maxLength={72}
              minLength={12}
              name="password"
              onChange={(event) => setIdentity({ ...identity, password: event.target.value })}
              required
              type="password"
              value={identity.password}
            />
            <Field
              autoComplete="new-password"
              label="Confirm password"
              maxLength={72}
              minLength={12}
              name="confirmPassword"
              onChange={(event) =>
                setIdentity({ ...identity, confirmPassword: event.target.value })
              }
              required
              type="password"
              value={identity.confirmPassword}
            />
          </div>
          <Button type="submit">Continue to privacy commitments →</Button>
          <p className="account-form-switch">
            Already have an account?{" "}
            <Link href={nextPath ? `/sign-in?next=${encodeURIComponent(nextPath)}` : "/sign-in"}>
              Sign in
            </Link>
          </p>
        </fieldset>
      ) : (
        <fieldset className="account-form-stage account-permission-stage">
          <legend>Open this space with permission</legend>
          <p>
            Review the three required commitments. Product updates stay off and can be enabled later
            in Account settings.
          </p>
          <div className="account-identity-receipt" role="note">
            <span aria-hidden="true">◈</span>
            <span>
              <strong>{identity.displayName}</strong>
              <small>{identity.email}</small>
            </span>
          </div>
          <div className="account-consent-list">
            <label>
              <input name="termsAccepted" required type="checkbox" />
              <span>
                I agree to the versioned <Link href="/terms">Terms</Link>.
              </span>
            </label>
            <label>
              <input name="privacyAccepted" required type="checkbox" />
              <span>
                I have read the versioned <Link href="/privacy">Privacy Notice</Link>.
              </span>
            </label>
            <label>
              <input name="ageConfirmed" required type="checkbox" />
              <span>I confirm that I am at least 18 years old.</span>
            </label>
          </div>
          <div className="account-form-actions">
            <Button onClick={() => setStep("identity")} type="button" variant="quiet">
              ← Back
            </Button>
            <Button disabled={submitting || Boolean(notice)} type="submit">
              {submitting ? "Creating account…" : "Create private account"}
            </Button>
          </div>
        </fieldset>
      )}
      {notice ? (
        <div className="grid gap-3">
          <p aria-live="polite" className="text-sm leading-6 text-emerald-100">
            {notice}
          </p>
          <Button
            disabled={submitting || !pendingEmail}
            onClick={async () => {
              if (!pendingEmail) return;
              setSubmitting(true);
              setError(undefined);
              const response = await fetch("/api/auth", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  action: "resend-confirmation",
                  email: pendingEmail,
                  next: nextPath,
                }),
              });
              const payload = (await response.json()) as { error?: string };
              setSubmitting(false);
              if (!response.ok)
                return setError(payload.error ?? "Unable to resend confirmation just now.");
              setNotice("If this account still needs confirmation, a fresh message is on its way.");
            }}
            type="button"
          >
            {submitting ? "Resending…" : "Resend confirmation email"}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
