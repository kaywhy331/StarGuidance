import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";

import { SESSION_COOKIE } from "@/lib/auth";
import { isHostedNetlifyRuntime } from "@/lib/hosted-runtime";
import { createLocalSession } from "@/lib/local-store";
import { recordSecurityAudit } from "@/lib/persistence";
import {
  ACCOUNT_DISPLAY_NAME_METADATA_KEY,
  POLICY_CONSENT_METADATA_KEY,
  POLICY_VERSIONS,
  signupConsentReceipts,
} from "@/lib/policies";
import { getRuntimeAdapter, RuntimeConfigurationError } from "@/lib/runtime";
import {
  assertRateLimit,
  assertSameOrigin,
  clientRateLimitKey,
  publicRequestOrigin,
  requestSecurityFailure,
} from "@/lib/request-security";
import { RECOVERY_SESSION_COOKIE, verifyRecoveryReceipt } from "@/lib/recovery-session";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase";

const emailSchema = z.string().trim().toLowerCase().pipe(z.email());
const passwordSchema = z.string().min(12).max(72);
const signupConsentSchema = z.object({
  termsAccepted: z.literal(true),
  termsVersion: z.literal(POLICY_VERSIONS.terms),
  privacyAccepted: z.literal(true),
  privacyVersion: z.literal(POLICY_VERSIONS.privacy),
  ageConfirmed: z.literal(true),
  ageEligibilityVersion: z.literal(POLICY_VERSIONS.ageEligibility),
  marketingAccepted: z.boolean(),
  marketingVersion: z.literal(POLICY_VERSIONS.marketing),
});
const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("sign-in"), email: emailSchema, password: passwordSchema }),
  z.object({
    action: z.literal("sign-up"),
    email: emailSchema,
    password: passwordSchema,
    displayName: z.string().trim().min(1).max(80),
    consents: signupConsentSchema,
  }),
  z.object({ action: z.literal("request-password-reset"), email: emailSchema }),
  z.object({ action: z.literal("resend-confirmation"), email: emailSchema }),
  z.object({ action: z.literal("update-password"), password: passwordSchema }),
]);

/** Recognises the provider's outbound-mail quota rejection. */
function isSendRateLimited(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { status?: unknown; code?: unknown };
  return (
    candidate.status === 429 ||
    (typeof candidate.code === "string" && candidate.code === "over_email_send_rate_limit")
  );
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await assertRateLimit(
      `auth:${clientRateLimitKey(request)}`,
      process.env.APP_ENV === "test" ? 200 : 12,
    );
    const input = requestSchema.parse(await request.json());
    if (getRuntimeAdapter() === "local") {
      if (input.action === "request-password-reset" || input.action === "resend-confirmation")
        return NextResponse.json({ ok: true, pending: true });
      if (input.action === "update-password")
        return NextResponse.json({ ok: true, authenticated: true });
      const { token } = createLocalSession(
        input.email,
        input.action === "sign-up"
          ? signupConsentReceipts(new Date().toISOString(), input.consents.marketingAccepted)
          : [],
        input.action === "sign-up" ? input.displayName : undefined,
      );
      const response = NextResponse.json({ ok: true, authenticated: true });
      response.cookies.set(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: "strict",
        secure: false,
        maxAge: 60 * 60 * 8,
        path: "/",
      });
      return response;
    }
    const supabase = await createSupabaseServerClient();
    if (input.action === "sign-in") {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: input.email,
        password: input.password,
      });
      if (error)
        return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
      await recordSecurityAudit(data?.user?.id, "auth.signed_in");
      return NextResponse.json({ ok: true, authenticated: true });
    }

    if (input.action === "update-password") {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      const jar = await cookies();
      if (
        userError ||
        !userData.user ||
        !verifyRecoveryReceipt(jar.get(RECOVERY_SESSION_COOKIE)?.value, userData.user.id)
      )
        return NextResponse.json(
          { error: "Open a fresh password-recovery email before choosing a new password." },
          { status: 403 },
        );
      const { error } = await supabase.auth.updateUser({ password: input.password });
      if (error)
        return NextResponse.json(
          { error: "The password could not be updated. Request a new recovery email." },
          { status: 400 },
        );
      jar.delete(RECOVERY_SESSION_COOKIE);
      await recordSecurityAudit(userData.user.id, "auth.password_changed");
      const { error: revocationError } = await supabase.auth.signOut({ scope: "global" });
      if (revocationError)
        return NextResponse.json(
          {
            error:
              "The password was updated, but revocation of other sessions could not be confirmed. Sign in with the new password and review account activity.",
            passwordUpdated: true,
          },
          { status: 502 },
        );
      return NextResponse.json({ ok: true, authenticated: false });
    }

    const appUrl =
      process.env.APP_ENV === "staging" && isHostedNetlifyRuntime()
        ? publicRequestOrigin(request)
        : process.env.NEXT_PUBLIC_APP_URL;
    if (!appUrl)
      throw new RuntimeConfigurationError("NEXT_PUBLIC_APP_URL is required for Auth redirects.");
    const callbackUrl = new URL("/auth/callback", appUrl);

    if (input.action === "resend-confirmation") {
      callbackUrl.searchParams.set("next", "/onboarding");
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: input.email,
        options: { emailRedirectTo: callbackUrl.toString() },
      });
      if (error && isSendRateLimited(error))
        return NextResponse.json(
          {
            error: "Too many confirmation emails have been requested. Try again shortly.",
            retryable: true,
          },
          { status: 429 },
        );
      // Keep account existence and confirmation state private. The same
      // response covers unknown, already-confirmed, and newly-resent cases.
      return NextResponse.json({ ok: true, pending: true });
    }

    if (input.action === "request-password-reset") {
      callbackUrl.searchParams.set("next", "/reset-password");
      const { error } = await supabase.auth.resetPasswordForEmail(input.email, {
        redirectTo: callbackUrl.toString(),
      });
      if (error) {
        if (isSendRateLimited(error))
          return NextResponse.json(
            {
              error: "Too many recovery emails have been requested. Try again shortly.",
              retryable: true,
            },
            { status: 429 },
          );
        // Recovery must not disclose whether an address exists. Supabase
        // normally obscures that distinction too, but keep the application
        // boundary non-enumerating even if a provider response changes.
        return NextResponse.json({ ok: true, pending: true });
      }
      return NextResponse.json({ ok: true, pending: true });
    }

    callbackUrl.searchParams.set("next", "/onboarding");
    const { data, error } = await supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: { emailRedirectTo: callbackUrl.toString() },
    });
    if (error) {
      if (isSendRateLimited(error))
        return NextResponse.json(
          {
            error: "Too many confirmation emails have been requested. Try again shortly.",
            retryable: true,
          },
          { status: 429 },
        );
      return NextResponse.json({ error: "Unable to create that account." }, { status: 400 });
    }
    if (data.user?.identities?.length) {
      const admin = createSupabaseAdminClient();
      const { error: receiptError } = await admin.auth.admin.updateUserById(data.user.id, {
        app_metadata: {
          ...data.user.app_metadata,
          [ACCOUNT_DISPLAY_NAME_METADATA_KEY]: input.displayName,
          [POLICY_CONSENT_METADATA_KEY]: signupConsentReceipts(
            new Date().toISOString(),
            input.consents.marketingAccepted,
          ),
        },
      });
      if (receiptError) {
        let identityCleanupConfirmed = false;
        let sessionCleanupConfirmed = false;
        try {
          const { error: cleanupError } = await admin.auth.admin.deleteUser(data.user.id);
          identityCleanupConfirmed = !cleanupError;
        } catch {
          // The provider may have completed the delete before a transport
          // failure. Treat the result as unknown rather than claiming either
          // outcome.
        }
        try {
          // A confirmation-disabled signup may already have issued this
          // browser a session. Attempt this independently even if identity
          // cleanup failed or threw.
          const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
          sessionCleanupConfirmed = !signOutError;
        } catch {
          // The response below reports that cleanup could not be confirmed.
        }
        const cleanupConfirmed = identityCleanupConfirmed && sessionCleanupConfirmed;
        return NextResponse.json(
          {
            error: cleanupConfirmed
              ? "Unable to record the required policy acknowledgements. The incomplete account was removed; try again later."
              : "Unable to record the required policy acknowledgements. Account cleanup could not be confirmed; contact support before retrying.",
          },
          { status: 503 },
        );
      }
    }
    return NextResponse.json({
      ok: true,
      authenticated: Boolean(data.session),
      pending: !data.session,
    });
  } catch (error) {
    const security = requestSecurityFailure(error);
    if (security)
      return NextResponse.json(
        {
          error:
            security.status === 503
              ? "Authentication is temporarily unavailable. Try again shortly."
              : security.error,
        },
        { status: security.status, headers: security.headers },
      );
    if (error instanceof RuntimeConfigurationError)
      return NextResponse.json(
        { error: "Authentication is not configured for this deployment." },
        { status: 503 },
      );
    if (error instanceof z.ZodError)
      return NextResponse.json(
        {
          error:
            "Use a valid email, a password between 12 and 72 characters, and accept all required beta policies.",
        },
        { status: 422 },
      );
    return NextResponse.json({ error: "Unable to complete authentication." }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    await assertRateLimit(
      `sign-out:${clientRateLimitKey(request)}`,
      process.env.APP_ENV === "test" ? 200 : 30,
    );
    const response = NextResponse.json({ ok: true });
    if (getRuntimeAdapter() === "local") {
      response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, maxAge: 0, path: "/" });
      return response;
    }
    const supabase = await createSupabaseServerClient();
    // Resolve who is signing out before the session is gone; recorded only
    // after the provider confirms the sign-out actually happened.
    const { data: sessionUser } = await supabase.auth.getUser();
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error)
      return NextResponse.json(
        { error: "The provider could not end this browser session." },
        { status: 502 },
      );
    await recordSecurityAudit(sessionUser?.user?.id, "auth.signed_out");
    return response;
  } catch (error) {
    const security = requestSecurityFailure(error);
    if (security)
      return NextResponse.json(
        { error: security.error },
        { status: security.status, headers: security.headers },
      );
    return NextResponse.json(
      {
        error:
          error instanceof RuntimeConfigurationError
            ? "Runtime is not configured."
            : "Sign-out failed.",
      },
      { status: 503 },
    );
  }
}
