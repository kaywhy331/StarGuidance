"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Field } from "@starguidance/design-system";

export function SignInForm({ initialError }: { initialError?: string | undefined }) {
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
        const response = await fetch("/api/auth", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "sign-in",
            email: form.get("email"),
            password: form.get("password"),
          }),
        });
        const payload = (await response.json()) as { authenticated?: boolean; error?: string };
        setSubmitting(false);
        if (!response.ok) return setError(payload.error ?? "Unable to sign in securely.");
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
        autoComplete="current-password"
        label="Password"
        maxLength={72}
        minLength={12}
        name="password"
        required
        type="password"
      />
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <Link className="text-[#d8b56d] underline-offset-4 hover:underline" href="/sign-up">
          Create an account
        </Link>
        <Link className="text-[#c9bfd4] underline-offset-4 hover:underline" href="/forgot-password">
          Forgot password?
        </Link>
      </div>
      <Button disabled={submitting} type="submit">
        {submitting ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
