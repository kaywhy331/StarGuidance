"use client";

import { useState } from "react";
import { Button, Field } from "@starguidance/design-system";

import { sendJson } from "@/lib/client-request";

import { AccountMessage } from "../sign-up/account-threshold";

/** Lets someone whose confirmation link failed ask for a fresh one. */
export function ResendConfirmation({ nextPath }: { nextPath?: string | undefined }) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  return (
    <form
      aria-labelledby="resend-confirmation-heading"
      className="account-resend"
      onSubmit={async (event) => {
        event.preventDefault();
        const email = new FormData(event.currentTarget).get("resendEmail");
        setSending(true);
        setError(undefined);
        setNotice(undefined);
        const result = await sendJson("/api/auth", "POST", {
          action: "resend-confirmation",
          email,
          next: nextPath,
        });
        setSending(false);
        if (!result.ok) return setError(result.error);
        setNotice(
          "If that address still needs confirming, a fresh link is on its way. Check your spam folder too.",
        );
      }}
    >
      <h3 id="resend-confirmation-heading">Need a new confirmation link?</h3>
      {error ? <AccountMessage tone="error">{error}</AccountMessage> : null}
      {notice ? <AccountMessage tone="success">{notice}</AccountMessage> : null}
      <Field
        autoComplete="email"
        hint="Use the address you signed up with."
        label="Send the new link to"
        name="resendEmail"
        required
        type="email"
      />
      <Button disabled={sending} type="submit" variant="secondary">
        {sending ? "Sending…" : "Send a new confirmation link"}
      </Button>
    </form>
  );
}
