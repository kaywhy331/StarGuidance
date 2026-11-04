import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";

import { requireUser, SESSION_COOKIE } from "@/lib/auth";
import { safeAccountReturnPath } from "@/lib/account-return";
import { isHostedNetlifyRuntime } from "@/lib/hosted-runtime";
import { createLocalSession } from "@/lib/local-store";
import { recordSecurityAudit } from "@/lib/persistence";
import {
  ACCOUNT_DISPLAY_NAME_METADATA_KEY,
  POLICY_CONSENT_METADATA_KEY,
  POLICY_VERSIONS,
  signupConsentReceipts,
} from "@/lib/policies";
import { tryRecordProductEvent } from "@/lib/product-telemetry";
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
const PRIVATE_TESTING_AUTH_MODE = "private-testing";
const AUTH_USER_PAGE_SIZE = 100;
const AUTH_USER_MAX_PAGES = 10;
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
  z.object({
    action: z.literal("sign-in"),
    email: emailSchema,
    password: passwordSchema,
    next: z.string().optional(),
  }),
  z.object({
    action: z.literal("sign-up"),
    email: emailSchema,
    password: passwordSchema,
    displayName: z.string().trim().min(1).max(80),
    consents: signupConsentSchema,
    next: z.string().optional(),
  }),
  z.object({ action: z.literal("request-password-reset"), email: emailSchema }),
  z.object({
    action: z.literal("resend-confirmation"),
    email: emailSchema,
    next: z.string().optional(),
  }),
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

function hasAuthErrorCode(error: unknown, ...codes: string[]): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown };
  return typeof candidate.code === "string" && codes.includes(candidate.code);
}

function privateTestingAuthEnabled(): boolean {
  return process.env.AUTH_EMAIL_CONFIRMATION_MODE === PRIVATE_TESTING_AUTH_MODE;
}

function signupAppMetadata(
  existing: unknown,
  displayName: string,
  marketingAccepted: boolean,
): Record<string, unknown> {
  const current =
    typeof existing === "object" && existing !== null ? (existing as Record<string, unknown>) : {};
  return {
    ...current,
    [ACCOUNT_DISPLAY_NAME_METADATA_KEY]: displayName,
    [POLICY_CONSENT_METADATA_KEY]: signupConsentReceipts(
      new Date().toISOString(),
      marketingAccepted,
    ),
  };
}

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Finds an exact Auth identity only inside the explicitly enabled private-test
 * lane. The address and the scanned identities never leave this server route.
 */
async function confirmPrivateTestingAccount(
  admin: SupabaseAdminClient,
  email: string,
): Promise<boolean> {
  for (let page = 1; page <= AUTH_USER_MAX_PAGES; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: AUTH_USER_PAGE_SIZE,
    });
    if (error) return false;
    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email);
    if (user) {
      const { error: confirmationError } = await admin.auth.admin.updateUserById(user.id, {
        email_confirm: true,
      });
      return !confirmationError;
    }
    if (data.users.length < AUTH_USER_PAGE_SIZE) return false;
  }
  return false;
}

async function signInWithPrivateTestingRecovery(
  supabase: SupabaseServerClient,
  admin: SupabaseAdminClient,
  email: string,
  password: string,
) {
  let result = await supabase.auth.signInWithPassword({ email, password });
  if (!privateTestingAuthEnabled() || !hasAuthErrorCode(result.error, "email_not_confirmed"))
    return { result, recoveryFailed: false };

  // Supabase Auth checks the password before returning email_not_confirmed.
  // Only that password-proven state may activate a pre-existing test account.
  // Invalid credentials never reach the admin lookup.
  const confirmed = await confirmPrivateTestingAccount(admin, email);
  if (!confirmed) return { result, recoveryFailed: true };
  result = await supabase.auth.signInWithPassword({ email, password });
  return { result, recoveryFailed: false };
}

async function recordAuthFailure(
  errorClass:
    | "authentication"
    | "authorization"
    | "rate_limited"
    | "provider_rejected"
    | "persistence"
    | "configuration"
    | "unclassified",
): Promise<void> {
  await tryRecordProductEvent({
    idempotencyKey: `auth:failed:${randomUUID()}`,
    name: "auth_failed",
    properties: { errorClass, statusClass: "failed" },
  });
}

/**
 * Where a freshly signed-in person should land, from their existing consent
 * and profile state: review policies only when a required one is missing,
 * finish a profile when none exists, otherwise go where they were headed.
 * Runs after the session cookies are written, so requireUser() (the one
 * provisioning boundary) sees the new session. Never throws — an unknown
 * state falls back to the consent page, which forwards anyone already current.
 */
async function signedInDestination(requestedNext: string | undefined): Promise<string> {
  const next = safeAccountReturnPath(requestedNext);
  const consentPath = next ? `/consent?next=${encodeURIComponent(next)}` : "/consent";
  try {
    const user = await requireUser();
    if (user.requiresPolicyReconsent) return consentPath;
    return next ?? (user.profile ? "/readings" : "/onboarding");
  } catch {
    return consentPath;
  }
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
      const { token, user } = createLocalSession(
        input.email,
        input.action === "sign-up"
          ? signupConsentReceipts(new Date().toISOString(), input.consents.marketingAccepted)
          : [],
        input.action === "sign-up" ? input.displayName : undefined,
      );
      const sessionCookie = {
        httpOnly: true,
        sameSite: "strict" as const,
        secure: false,
        maxAge: 60 * 60 * 8,
        path: "/",
      };
      let destination: string | undefined;
      if (input.action === "sign-in") {
        // Make the new session visible to requireUser() within this request.
        (await cookies()).set(SESSION_COOKIE, token, sessionCookie);
        destination = await signedInDestination(input.next);
      }
      const response = NextResponse.json({
        ok: true,
        authenticated: true,
        ...(destination ? { destination } : {}),
      });
      response.cookies.set(SESSION_COOKIE, token, sessionCookie);
      if (input.action === "sign-up")
        await tryRecordProductEvent({
          idempotencyKey: `consent:${user.id}:${POLICY_VERSIONS.terms}:${POLICY_VERSIONS.privacy}`,
          name: "consent_completed",
          properties: { routeClass: "consent", statusClass: "completed" },
        });
      return response;
    }
    const supabase = await createSupabaseServerClient();
    if (input.action === "sign-in") {
      const { result, recoveryFailed } = privateTestingAuthEnabled()
        ? await signInWithPrivateTestingRecovery(
            supabase,
            createSupabaseAdminClient(),
            input.email,
            input.password,
          )
        : {
            result: await supabase.auth.signInWithPassword({
              email: input.email,
              password: input.password,
            }),
            recoveryFailed: false,
          };
      const { data, error } = result;
      if (recoveryFailed) {
        await recordAuthFailure("persistence");
        return NextResponse.json(
          { error: "We couldn't open your account just now. Please try again in a moment." },
          { status: 503 },
        );
      }
      if (error) {
        await recordAuthFailure("authentication");
        return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
      }
      await recordSecurityAudit(data?.user?.id, "auth.signed_in");
      const destination = await signedInDestination(input.next);
      return NextResponse.json({ ok: true, authenticated: true, destination });
    }

    if (input.action === "update-password") {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      const jar = await cookies();
      if (
        userError ||
        !userData.user ||
        !verifyRecoveryReceipt(jar.get(RECOVERY_SESSION_COOKIE)?.value, userData.user.id)
      ) {
        await recordAuthFailure("authorization");
        return NextResponse.json(
          {
            error:
              "This reset link has expired or was opened elsewhere. Request a new one to choose a password.",
          },
          { status: 403 },
        );
      }
      const { error } = await supabase.auth.updateUser({ password: input.password });
      if (error) {
        await recordAuthFailure("provider_rejected");
        return NextResponse.json(
          {
            error:
              "We couldn't save that password. Please request a new reset email and try again.",
          },
          { status: 400 },
        );
      }
      jar.delete(RECOVERY_SESSION_COOKIE);
      await recordSecurityAudit(userData.user.id, "auth.password_changed");
      const { error: revocationError } = await supabase.auth.signOut({ scope: "global" });
      if (revocationError) {
        await recordAuthFailure("provider_rejected");
        return NextResponse.json(
          {
            error:
              "Your password was updated, but we couldn't confirm you were signed out on your other devices. Sign in with your new password, then sign out anywhere you don't recognize.",
            passwordUpdated: true,
          },
          { status: 502 },
        );
      }
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
      callbackUrl.searchParams.set("next", safeAccountReturnPath(input.next) ?? "/onboarding");
      callbackUrl.searchParams.set("flow", "signup");
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: input.email,
        options: { emailRedirectTo: callbackUrl.toString() },
      });
      if (error && isSendRateLimited(error)) {
        await recordAuthFailure("rate_limited");
        return NextResponse.json(
          {
            error:
              "We've sent several confirmation emails already. Please wait a few minutes and try again.",
            retryable: true,
          },
          { status: 429 },
        );
      }
      // Keep account existence and confirmation state private. The same
      // response covers unknown, already-confirmed, and newly-resent cases.
      return NextResponse.json({ ok: true, pending: true });
    }

    if (input.action === "request-password-reset") {
      callbackUrl.searchParams.set("next", "/reset-password");
      callbackUrl.searchParams.set("flow", "recovery");
      const { error } = await supabase.auth.resetPasswordForEmail(input.email, {
        redirectTo: callbackUrl.toString(),
      });
      if (error) {
        if (isSendRateLimited(error)) {
          await recordAuthFailure("rate_limited");
          return NextResponse.json(
            {
              error:
                "We've sent several reset emails already. Please wait a few minutes and try again.",
              retryable: true,
            },
            { status: 429 },
          );
        }
        // Recovery must not disclose whether an address exists. Supabase
        // normally obscures that distinction too, but keep the application
        // boundary non-enumerating even if a provider response changes.
        return NextResponse.json({ ok: true, pending: true });
      }
      return NextResponse.json({ ok: true, pending: true });
    }

    callbackUrl.searchParams.set("next", safeAccountReturnPath(input.next) ?? "/onboarding");
    callbackUrl.searchParams.set("flow", "signup");
    const metadata = signupAppMetadata({}, input.displayName, input.consents.marketingAccepted);

    if (privateTestingAuthEnabled()) {
      const admin = createSupabaseAdminClient();
      const { data: created, error: creationError } = await admin.auth.admin.createUser({
        email: input.email,
        password: input.password,
        email_confirm: true,
        app_metadata: metadata,
      });
      const existingAccount = hasAuthErrorCode(
        creationError,
        "email_exists",
        "user_already_exists",
      );
      if (creationError && !existingAccount) {
        await recordAuthFailure("provider_rejected");
        return NextResponse.json(
          { error: "We couldn't create that account. Please check your details and try again." },
          { status: 400 },
        );
      }

      const { result, recoveryFailed } = await signInWithPrivateTestingRecovery(
        supabase,
        admin,
        input.email,
        input.password,
      );
      if (recoveryFailed) {
        if (created.user) await admin.auth.admin.deleteUser(created.user.id);
        await recordAuthFailure("persistence");
        return NextResponse.json(
          { error: "We couldn't open your new account just now. Please try again in a moment." },
          { status: 503 },
        );
      }
      if (result.error || !result.data.user) {
        if (created.user) await admin.auth.admin.deleteUser(created.user.id);
        await recordAuthFailure("authentication");
        return NextResponse.json(
          { error: "We couldn't create that account. Please check your details and try again." },
          { status: 400 },
        );
      }

      if (!created.user) {
        const { error: receiptError } = await admin.auth.admin.updateUserById(result.data.user.id, {
          app_metadata: signupAppMetadata(
            result.data.user.app_metadata,
            input.displayName,
            input.consents.marketingAccepted,
          ),
        });
        if (receiptError) {
          await supabase.auth.signOut({ scope: "local" });
          await recordAuthFailure("persistence");
          return NextResponse.json(
            {
              error:
                "We couldn't save your agreement to the Terms and Privacy Notice. Please try again in a little while.",
            },
            { status: 503 },
          );
        }
      }

      await tryRecordProductEvent({
        idempotencyKey: `consent:${result.data.user.id}:${POLICY_VERSIONS.terms}:${POLICY_VERSIONS.privacy}`,
        name: "consent_completed",
        properties: { routeClass: "consent", statusClass: "completed" },
      });
      await recordSecurityAudit(result.data.user.id, "auth.signed_in");
      return NextResponse.json({ ok: true, authenticated: true, pending: false });
    }

    const { data, error } = await supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: { emailRedirectTo: callbackUrl.toString() },
    });
    if (error) {
      if (isSendRateLimited(error)) {
        await recordAuthFailure("rate_limited");
        return NextResponse.json(
          {
            error: "Too many confirmation emails have been requested. Try again shortly.",
            retryable: true,
          },
          { status: 429 },
        );
      }
      await recordAuthFailure("provider_rejected");
      return NextResponse.json(
        { error: "We couldn't create that account. Please check your details and try again." },
        { status: 400 },
      );
    }
    if (data.user?.identities?.length) {
      const admin = createSupabaseAdminClient();
      const { error: receiptError } = await admin.auth.admin.updateUserById(data.user.id, {
        app_metadata: signupAppMetadata(
          data.user.app_metadata,
          input.displayName,
          input.consents.marketingAccepted,
        ),
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
        await recordAuthFailure("persistence");
        return NextResponse.json(
          {
            error: cleanupConfirmed
              ? "We couldn't save your agreement to the Terms and Privacy Notice, so the unfinished account was removed. Please try again in a little while."
              : "We couldn't save your agreement to the Terms and Privacy Notice, and we couldn't confirm the unfinished account was removed. Please contact us before trying again.",
          },
          { status: 503 },
        );
      }
      await tryRecordProductEvent({
        idempotencyKey: `consent:${data.user.id}:${POLICY_VERSIONS.terms}:${POLICY_VERSIONS.privacy}`,
        name: "consent_completed",
        properties: { routeClass: "consent", statusClass: "completed" },
      });
    }
    return NextResponse.json({
      ok: true,
      authenticated: Boolean(data.session),
      pending: !data.session,
    });
  } catch (error) {
    const security = requestSecurityFailure(error);
    if (security) {
      await recordAuthFailure(
        security.status === 429
          ? "rate_limited"
          : security.status === 503
            ? "configuration"
            : "authorization",
      );
      return NextResponse.json(
        {
          error:
            security.status === 503
              ? "Accounts are briefly unavailable. Please try again in a moment."
              : security.error,
        },
        { status: security.status, headers: security.headers },
      );
    }
    if (error instanceof RuntimeConfigurationError) {
      await recordAuthFailure("configuration");
      return NextResponse.json(
        { error: "Accounts aren't available here just now. Please try again later." },
        { status: 503 },
      );
    }
    if (error instanceof z.ZodError)
      return NextResponse.json(
        {
          error:
            "Please use a valid email and a password of 12 to 72 characters, and tick each required box.",
        },
        { status: 422 },
      );
    await recordAuthFailure("unclassified");
    return NextResponse.json(
      { error: "We couldn't finish that just now. Please try again." },
      { status: 400 },
    );
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
        { error: "We couldn't sign you out just now. Please try again." },
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
            ? "Accounts aren't available here just now. Please try again later."
            : "We couldn't sign you out just now. Please try again.",
      },
      { status: 503 },
    );
  }
}
