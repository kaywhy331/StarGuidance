"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field } from "@starguidance/design-system";

export function ResetPasswordForm() {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  return (
    <form
      className="mt-8 grid gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setError(undefined);
        const form = new FormData(event.currentTarget);
        const password = String(form.get("password") ?? "");
        if (password !== String(form.get("confirmPassword") ?? "")) {
          setError("Passwords must match.");
          return;
        }
        setSubmitting(true);
        const response = await fetch("/api/auth", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "update-password", password }),
        });
        const payload = (await response.json()) as { error?: string };
        setSubmitting(false);
        if (!response.ok) return setError(payload.error ?? "Unable to update the password.");
        router.push("/sign-in");
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
      <Field
        autoComplete="new-password"
        hint="Use 12–72 characters. A passphrase is easiest to remember."
        label="New password"
        maxLength={72}
        minLength={12}
        name="password"
        required
        type="password"
      />
      <Field
        autoComplete="new-password"
        label="Confirm new password"
        maxLength={72}
        minLength={12}
        name="confirmPassword"
        required
        type="password"
      />
      <Button disabled={submitting} type="submit">
        {submitting ? "Updating password…" : "Update password"}
      </Button>
    </form>
  );
}
