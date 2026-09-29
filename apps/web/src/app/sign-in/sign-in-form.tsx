"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Field, PasswordField } from "@starguidance/design-system";

import { sendJson } from "@/lib/client-request";

import { AccountMessage } from "../sign-up/account-threshold";

export function SignInForm({
  initialError,
  nextPath,
}: {
  initialError?: string | undefined;
  nextPath?: string | undefined;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | undefined>(initialError);
  const [submitting, setSubmitting] = useState(false);
  return (
    <form
      className="mt-8 grid gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setError(undefined);
        setSubmitting(true);
        const form = new FormData(event.currentTarget);
        const result = await sendJson<{ destination?: string }>("/api/auth", "POST", {
          action: "sign-in",
          email: form.get("email"),
          password: form.get("password"),
          next: nextPath,
        });
        if (!result.ok) {
          setSubmitting(false);
          return setError(result.error);
        }
        const destination = result.data.destination;
        router.push(
          typeof destination === "string" &&
            destination.startsWith("/") &&
            !destination.startsWith("//")
            ? destination
            : (nextPath ?? "/consent"),
        );
        router.refresh();
      }}
    >
      {error ? <AccountMessage tone="error">{error}</AccountMessage> : null}
      <Field autoComplete="email" label="Email" name="email" required type="email" />
      <PasswordField
        autoComplete="current-password"
        label="Password"
        maxLength={72}
        name="password"
        required
      />
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <Link
          className="account-inline-link"
          href={nextPath ? `/sign-up?next=${encodeURIComponent(nextPath)}` : "/sign-up"}
        >
          Create an account
        </Link>
        <Link className="account-inline-link account-inline-link--quiet" href="/forgot-password">
          Forgot password?
        </Link>
      </div>
      <Button disabled={submitting} type="submit">
        {submitting ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
