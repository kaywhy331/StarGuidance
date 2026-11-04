"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Field, PasswordField } from "@starguidance/design-system";

import { sendJson } from "@/lib/client-request";
import { POLICY_VERSIONS } from "@/lib/policies";

import { AccountMessage } from "./account-threshold";

const PASSWORD_MISMATCH = "These passwords don't match yet. Please type the same password twice.";

/**
 * Shown once an account is waiting for email confirmation. It replaces the
 * form entirely so the next step is unmistakable.
 */
export function ConfirmationPending({
  email,
  nextPath,
}: {
  email?: string | undefined;
  nextPath?: string | undefined;
}) {
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const signInHref = nextPath ? `/sign-in?next=${encodeURIComponent(nextPath)}` : "/sign-in";

  return (
    <section aria-labelledby="confirmation-pending-heading" className="account-pending">
      <span aria-hidden="true" className="account-pending__mark">
        ✉
      </span>
      <h3 id="confirmation-pending-heading" ref={headingRef} tabIndex={-1}>
        Check your email
      </h3>
      <p>
        {email ? (
          <>
            We sent a confirmation link to <strong>{email}</strong>.
          </>
        ) : (
          "We sent you a confirmation link."
        )}{" "}
        Open it on this device to confirm your email and you&apos;ll be signed straight in.
      </p>
      <p className="account-pending__hint">
        It can take a minute or two to arrive. If you can&apos;t find it, look in your spam or
        promotions folder.
      </p>
      {error ? <AccountMessage tone="error">{error}</AccountMessage> : null}
      {notice ? <AccountMessage tone="success">{notice}</AccountMessage> : null}
      <div className="account-pending__actions">
        {email ? (
          <Button
            disabled={resending}
            onClick={async () => {
              setResending(true);
              setError(undefined);
              setNotice(undefined);
              const result = await sendJson("/api/auth", "POST", {
                action: "resend-confirmation",
                email,
                next: nextPath,
              });
              setResending(false);
              if (!result.ok) return setError(result.error);
              setNotice("A fresh confirmation email is on its way.");
            }}
            type="button"
            variant="secondary"
          >
            {resending ? "Sending…" : "Resend confirmation email"}
          </Button>
        ) : null}
        <Link className="sg-button sg-button--quiet" href={signInHref}>
          Open sign in
        </Link>
      </div>
    </section>
  );
}

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
  const [mismatch, setMismatch] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const stepHeadingRef = useRef<HTMLLegendElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    stepHeadingRef.current?.focus();
    setAnnouncement(
      step === "identity" ? "Step 1 of 2: your details." : "Step 2 of 2: a few agreements.",
    );
  }, [step]);

  if (pendingEmail) return <ConfirmationPending email={pendingEmail} nextPath={nextPath} />;

  const confirmError = mismatch ? PASSWORD_MISMATCH : undefined;

  return (
    <form
      className="mt-8 grid gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setError(undefined);
        if (step === "identity") {
          if (identity.password !== identity.confirmPassword) {
            setMismatch(true);
            document.getElementById("confirmPassword")?.focus();
            return;
          }
          setMismatch(false);
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
        const result = await sendJson<{ authenticated?: boolean; pending?: boolean }>(
          "/api/auth",
          "POST",
          {
            action: "sign-up",
            email: identity.email,
            password: identity.password,
            displayName: identity.displayName,
            consents,
            next: nextPath,
          },
        );
        if (!result.ok) {
          setSubmitting(false);
          return setError(result.error);
        }
        if (result.data.pending) {
          setSubmitting(false);
          setPendingEmail(identity.email);
          return;
        }
        router.push(nextPath ?? "/onboarding");
        router.refresh();
      }}
    >
      <ol aria-label="Account creation progress" className="account-form-progress">
        <li aria-current={step === "identity" ? "step" : undefined}>
          <span>01</span> Your details
        </li>
        <li aria-current={step === "permission" ? "step" : undefined}>
          <span>02</span> Agreements
        </li>
      </ol>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {error ? <AccountMessage tone="error">{error}</AccountMessage> : null}
      {step === "identity" ? (
        <fieldset className="account-form-stage">
          <legend ref={stepHeadingRef} tabIndex={-1}>
            How you&apos;ll sign in
          </legend>
          <p>Your email and password are just for getting back in.</p>
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
            hint="What we'll call you in your readings. It can differ from your birth name."
            label="Display name"
            maxLength={80}
            name="displayName"
            onChange={(event) => setIdentity({ ...identity, displayName: event.target.value })}
            required
            value={identity.displayName}
          />
          <div className="account-password-grid">
            <PasswordField
              autoComplete="new-password"
              hint="Use 12–72 characters. A short phrase is easy to remember."
              label="Password"
              maxLength={72}
              minLength={12}
              name="password"
              onChange={(event) => {
                setIdentity({ ...identity, password: event.target.value });
                if (mismatch && event.target.value === identity.confirmPassword) setMismatch(false);
              }}
              required
              value={identity.password}
            />
            <PasswordField
              autoComplete="new-password"
              error={confirmError}
              label="Confirm password"
              maxLength={72}
              minLength={12}
              name="confirmPassword"
              onBlur={() =>
                setMismatch(
                  identity.confirmPassword.length > 0 &&
                    identity.password !== identity.confirmPassword,
                )
              }
              onChange={(event) => {
                setIdentity({ ...identity, confirmPassword: event.target.value });
                if (mismatch && event.target.value === identity.password) setMismatch(false);
              }}
              required
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
          <legend ref={stepHeadingRef} tabIndex={-1}>
            A few agreements
          </legend>
          <p>
            Please tick all three to continue. We won&apos;t send you product news unless you turn
            it on later in Account settings.
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
                I agree to the <Link href="/terms">Terms</Link>.
              </span>
            </label>
            <label>
              <input name="privacyAccepted" required type="checkbox" />
              <span>
                I have read the <Link href="/privacy">Privacy Notice</Link>.
              </span>
            </label>
            <label>
              <input name="ageConfirmed" required type="checkbox" />
              <span>I confirm that I am at least 18 years old.</span>
            </label>
          </div>
          <div className="account-form-actions">
            <Button
              disabled={submitting}
              onClick={() => setStep("identity")}
              type="button"
              variant="quiet"
            >
              ← Back
            </Button>
            <Button disabled={submitting} type="submit">
              {submitting ? "Creating account…" : "Create private account"}
            </Button>
          </div>
        </fieldset>
      )}
    </form>
  );
}
