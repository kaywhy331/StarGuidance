import Link from "next/link";
import { redirect } from "next/navigation";

import { safeAccountReturnPath } from "@/lib/account-return";
import { requireUser } from "@/lib/auth";

import { AccountMessage, AccountThreshold } from "../sign-up/account-threshold";
import { ResendConfirmation } from "./resend-confirmation";
import { SignInForm } from "./sign-in-form";

export const metadata = { title: "Sign in" };

type LinkError = "invalid-link" | "expired-link" | "link-browser" | "service-unavailable";
type LinkFlow = "signup" | "recovery" | "other";

const errorMessages: Record<LinkError, Record<LinkFlow, string>> = {
  "invalid-link": {
    signup: "That confirmation link looks incomplete. We can send you a fresh one below.",
    recovery: "That reset link looks incomplete. Please request a new reset email.",
    other: "That link looks incomplete. Please open it again from your email.",
  },
  "expired-link": {
    signup:
      "That confirmation link has expired or was already used. If you've already confirmed, simply sign in — otherwise we can send a fresh link below.",
    recovery: "That reset link has expired or was already used. Please request a new reset email.",
    other: "That link has expired or was already used. Please sign in, or request a new one.",
  },
  "link-browser": {
    signup:
      "That confirmation link opened in a different browser from the one you signed up in. Open it there, or sign in here if you've already confirmed.",
    recovery:
      "That reset link opened in a different browser from the one that asked for it. Open it there, or request a new reset email here.",
    other:
      "That link opened in a different browser from the one that asked for it. Please open it there.",
  },
  "service-unavailable": {
    signup: "We couldn't finish that just now. Please try again in a moment.",
    recovery: "We couldn't finish that just now. Please try again in a moment.",
    other: "We couldn't finish that just now. Please try again in a moment.",
  },
};

const notices: Record<string, { tone: "success" | "info"; message: string }> = {
  "password-updated": {
    tone: "success",
    message: "Your password has been updated. Sign in with your new password to continue.",
  },
  "password-updated-sessions": {
    tone: "info",
    message:
      "Your password has been updated, but we couldn't confirm you were signed out on your other devices. Sign in with your new password, then sign out anywhere you don't recognize from Account settings.",
  },
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string | string[];
    flow?: string | string[];
    next?: string | string[];
    notice?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const nextPath = safeAccountReturnPath(params.next);
  let authenticatedDestination: string | undefined;
  try {
    const user = await requireUser();
    authenticatedDestination = user.requiresPolicyReconsent
      ? "/consent"
      : (nextPath ?? (user.profile ? "/readings" : "/onboarding"));
  } catch {
    // Rendering the sign-in form is the correct anonymous and fail-closed path.
  }
  if (authenticatedDestination) redirect(authenticatedDestination);

  const errorCode = first(params.error);
  const flowParam = first(params.flow);
  const flow: LinkFlow = flowParam === "signup" || flowParam === "recovery" ? flowParam : "other";
  const linkError = errorCode && errorCode in errorMessages ? (errorCode as LinkError) : undefined;
  const notice = notices[first(params.notice) ?? ""];

  return (
    <AccountThreshold
      eyebrow="Welcome back"
      lede="Your readings, your profile, and every thread you chose to keep are waiting where you left them."
      panelEyebrow="Sign in"
      panelTitle="Good to see you again."
      title="Return to your space."
    >
      {notice ? <AccountMessage tone={notice.tone}>{notice.message}</AccountMessage> : null}
      <SignInForm
        initialError={linkError ? errorMessages[linkError][flow] : undefined}
        nextPath={nextPath}
      />
      {linkError && flow === "signup" && linkError !== "service-unavailable" ? (
        <ResendConfirmation nextPath={nextPath} />
      ) : null}
      {linkError && flow === "recovery" ? (
        <p className="account-form-switch">
          <Link href="/forgot-password">Request a new reset email</Link>
        </p>
      ) : null}
    </AccountThreshold>
  );
}
