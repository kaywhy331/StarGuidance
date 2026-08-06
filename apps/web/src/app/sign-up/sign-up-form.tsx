"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Field } from "@starguidance/design-system";

import { POLICY_VERSIONS } from "@/lib/policies";

export function SignUpForm() {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  return (
    <form
      className="mt-8 grid gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setError(undefined);
        setNotice(undefined);
        const form = new FormData(event.currentTarget);
        const password = String(form.get("password") ?? "");
        if (password !== String(form.get("confirmPassword") ?? "")) {
          setError("Passwords must match.");
          return;
        }
        const consents = {
          termsAccepted: form.get("termsAccepted") === "on",
          termsVersion: POLICY_VERSIONS.terms,
          privacyAccepted: form.get("privacyAccepted") === "on",
          privacyVersion: POLICY_VERSIONS.privacy,
          ageConfirmed: form.get("ageConfirmed") === "on",
          ageEligibilityVersion: POLICY_VERSIONS.ageEligibility,
        };
        setSubmitting(true);
        const response = await fetch("/api/auth", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "sign-up",
            email: form.get("email"),
            password,
            consents,
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
          setNotice(
            "Account created. Check your email once to confirm it, then sign in with your password.",
          );
          return;
        }
        router.push("/onboarding");
        router.refresh();
      }}
    >
      {error ? (
        <p
          aria-live="assertive"
          className="rounded-2xl border border-rose-300/30 bg-rose-950/30 p-3 text-sm text-rose-100"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      <Field autoComplete="email" label="Email" name="email" required type="email" />
      <Field
        autoComplete="new-password"
        hint="Use 12–72 characters. A passphrase is easiest to remember."
        label="Password"
        maxLength={72}
        minLength={12}
        name="password"
        required
        type="password"
      />
      <fieldset className="grid gap-3 rounded-2xl border border-white/10 p-4">
        <legend className="px-2 text-sm text-[#c9bfd4]">Required beta acknowledgements</legend>
        <label className="flex items-start gap-3 text-sm leading-6">
          <input className="mt-1" name="termsAccepted" required type="checkbox" />
          <span>
            I agree to the versioned <Link href="/terms">Terms</Link>.
          </span>
        </label>
        <label className="flex items-start gap-3 text-sm leading-6">
          <input className="mt-1" name="privacyAccepted" required type="checkbox" />
          <span>
            I have read the versioned <Link href="/privacy">Privacy Notice</Link>.
          </span>
        </label>
        <label className="flex items-start gap-3 text-sm leading-6">
          <input className="mt-1" name="ageConfirmed" required type="checkbox" />
          <span>I confirm that I am at least 18 years old.</span>
        </label>
      </fieldset>
      <Field
        autoComplete="new-password"
        label="Confirm password"
        maxLength={72}
        minLength={12}
        name="confirmPassword"
        required
        type="password"
      />
      {notice ? (
        <p aria-live="polite" className="text-sm leading-6 text-emerald-100">
          {notice}
        </p>
      ) : null}
      <p className="text-sm text-[#c9bfd4]">
        Already have an account?{" "}
        <Link className="text-[#d8b56d] underline-offset-4 hover:underline" href="/sign-in">
          Sign in
        </Link>
      </p>
      <Button disabled={submitting || Boolean(notice)} type="submit">
        {submitting ? "Creating account…" : "Create private account"}
      </Button>
    </form>
  );
}
