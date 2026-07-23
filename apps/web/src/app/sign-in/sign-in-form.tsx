"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field } from "@starguidance/design-system";

export function LocalSignInForm() {
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
        setSubmitting(true);
        const email = new FormData(event.currentTarget).get("email");
        const response = await fetch("/api/auth", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email }),
        });
        const payload = (await response.json()) as {
          authenticated?: boolean;
          pending?: boolean;
          error?: string;
        };
        setSubmitting(false);
        if (!response.ok) return setError(payload.error ?? "Unable to sign in securely.");
        if (payload.pending) {
          setNotice("Check your email for a private sign-in link. You can close this page safely.");
          return;
        }
        router.push("/onboarding");
        router.refresh();
      }}
    >
      <Field autoComplete="email" error={error} label="Email" name="email" required type="email" />
      {notice ? (
        <p aria-live="polite" className="text-sm text-emerald-100">
          {notice}
        </p>
      ) : null}
      <Button disabled={submitting} type="submit">
        {submitting ? "Preparing private sign-in…" : "Continue privately"}
      </Button>
    </form>
  );
}
