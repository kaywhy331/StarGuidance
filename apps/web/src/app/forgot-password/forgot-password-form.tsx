"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, Field } from "@starguidance/design-system";

import { sendJson } from "@/lib/client-request";

import { AccountMessage } from "../sign-up/account-threshold";

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
        const result = await sendJson("/api/auth", "POST", {
          action: "request-password-reset",
          email,
        });
        setSubmitting(false);
        if (!result.ok) return setError(result.error);
        setNotice(
          "If there's an account for that email, a reset link is on its way. It can take a minute or two — check your spam folder too.",
        );
      }}
    >
      {error ? <AccountMessage tone="error">{error}</AccountMessage> : null}
      <Field autoComplete="email" label="Email" name="email" required type="email" />
      {notice ? <AccountMessage tone="success">{notice}</AccountMessage> : null}
      <Button disabled={submitting || Boolean(notice)} type="submit">
        {submitting ? "Sending…" : notice ? "Reset link sent" : "Email me a reset link"}
      </Button>
      <p className="account-form-switch">
        <Link href="/sign-in">Back to sign in</Link>
      </p>
    </form>
  );
}
