"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, PasswordField } from "@starguidance/design-system";

import { sendJson } from "@/lib/client-request";

import { AccountMessage } from "../sign-up/account-threshold";

const PASSWORD_MISMATCH = "These passwords don't match yet. Please type the same password twice.";

export function ResetPasswordForm() {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [mismatch, setMismatch] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  return (
    <form
      className="mt-8 grid gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setError(undefined);
        if (password !== confirmPassword) {
          setMismatch(true);
          document.getElementById("confirmPassword")?.focus();
          return;
        }
        setSubmitting(true);
        const result = await sendJson("/api/auth", "POST", { action: "update-password", password });
        if (!result.ok && result.data.passwordUpdated !== true) {
          setSubmitting(false);
          return setError(result.error);
        }
        router.push(
          result.ok
            ? "/sign-in?notice=password-updated"
            : "/sign-in?notice=password-updated-sessions",
        );
        router.refresh();
      }}
    >
      {error ? <AccountMessage tone="error">{error}</AccountMessage> : null}
      <PasswordField
        autoComplete="new-password"
        hint="Use 12–72 characters. A short phrase is easy to remember."
        label="New password"
        maxLength={72}
        minLength={12}
        name="password"
        onChange={(event) => {
          setPassword(event.target.value);
          if (mismatch && event.target.value === confirmPassword) setMismatch(false);
        }}
        required
        value={password}
      />
      <PasswordField
        autoComplete="new-password"
        error={mismatch ? PASSWORD_MISMATCH : undefined}
        label="Confirm new password"
        maxLength={72}
        minLength={12}
        name="confirmPassword"
        onBlur={() => setMismatch(confirmPassword.length > 0 && password !== confirmPassword)}
        onChange={(event) => {
          setConfirmPassword(event.target.value);
          if (mismatch && event.target.value === password) setMismatch(false);
        }}
        required
        value={confirmPassword}
      />
      <Button disabled={submitting} type="submit">
        {submitting ? "Saving your new password…" : "Update password"}
      </Button>
    </form>
  );
}
