"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, Field } from "@starguidance/design-system";

export function ForgotPasswordForm() {
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  return (
    <form
      className="mt-8 grid gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setError(undefined);
        const email = new FormData(event.currentTarget).get("email");
        setSubmitting(true);
        const response = await fetch("/api/auth", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "request-password-reset", email }),
        });
        const payload = (await response.json()) as { error?: string };
        setSubmitting(false);
        if (!response.ok) return setError(payload.error ?? "Unable to request recovery.");
        setNotice(
          "If an account exists for that email, a password recovery message is on its way.",
        );
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
      {notice ? (
        <p aria-live="polite" className="text-sm leading-6 text-emerald-100">
          {notice}
        </p>
      ) : null}
      <Button disabled={submitting || Boolean(notice)} type="submit">
        {submitting ? "Requesting recovery…" : "Email recovery instructions"}
      </Button>
      <Link
        className="text-center text-sm text-[#d8b56d] underline-offset-4 hover:underline"
        href="/sign-in"
      >
        Return to sign in
      </Link>
    </form>
  );
}
