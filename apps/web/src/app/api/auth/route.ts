import { NextResponse } from "next/server";
import { z } from "zod";

import { SESSION_COOKIE } from "@/lib/auth";
import { isHostedNetlifyRuntime } from "@/lib/hosted-runtime";
import { createLocalSession } from "@/lib/local-store";
import { getRuntimeAdapter, RuntimeConfigurationError } from "@/lib/runtime";
import { assertRateLimit, assertSameOrigin, publicRequestOrigin } from "@/lib/request-security";
import { createSupabaseServerClient } from "@/lib/supabase";

const emailSchema = z.string().trim().toLowerCase().pipe(z.email());
const passwordSchema = z.string().min(12).max(72);
const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("sign-in"), email: emailSchema, password: passwordSchema }),
  z.object({ action: z.literal("sign-up"), email: emailSchema, password: passwordSchema }),
  z.object({ action: z.literal("request-password-reset"), email: emailSchema }),
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
    assertRateLimit(
      `auth:${request.headers.get("x-forwarded-for") ?? "unknown"}`,
      process.env.APP_ENV === "test" ? 200 : 12,
    );
    const input = requestSchema.parse(await request.json());
    if (getRuntimeAdapter() === "local") {
      if (input.action === "request-password-reset")
        return NextResponse.json({ ok: true, pending: true });
      if (input.action === "update-password")
        return NextResponse.json({ ok: true, authenticated: true });
      const { token } = createLocalSession(input.email);
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
      const { error } = await supabase.auth.signInWithPassword({
        email: input.email,
        password: input.password,
      });
      if (error)
        return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
      return NextResponse.json({ ok: true, authenticated: true });
    }

    if (input.action === "update-password") {
      const { error } = await supabase.auth.updateUser({ password: input.password });
      if (error)
        return NextResponse.json(
          { error: "The password could not be updated. Request a new recovery email." },
          { status: 400 },
        );
      return NextResponse.json({ ok: true, authenticated: true });
    }

    const appUrl =
      process.env.APP_ENV === "staging" && isHostedNetlifyRuntime()
        ? publicRequestOrigin(request)
        : process.env.NEXT_PUBLIC_APP_URL;
    if (!appUrl)
      throw new RuntimeConfigurationError("NEXT_PUBLIC_APP_URL is required for Auth redirects.");
    const callbackUrl = new URL("/auth/callback", appUrl);

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
    return NextResponse.json({
      ok: true,
      authenticated: Boolean(data.session),
      pending: !data.session,
    });
  } catch (error) {
    if (error instanceof RuntimeConfigurationError)
      return NextResponse.json(
        { error: "Authentication is not configured for this deployment." },
        { status: 503 },
      );
    if (error instanceof z.ZodError)
      return NextResponse.json(
        { error: "Use a valid email and a password between 12 and 72 characters." },
        { status: 422 },
      );
    return NextResponse.json({ error: "Unable to complete authentication." }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const response = NextResponse.json({ ok: true });
    if (getRuntimeAdapter() === "local") {
      response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, maxAge: 0, path: "/" });
      return response;
    }
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
    return response;
  } catch (error) {
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
