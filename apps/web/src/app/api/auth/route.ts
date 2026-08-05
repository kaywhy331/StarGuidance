import { NextResponse } from "next/server";
import { z } from "zod";

import { SESSION_COOKIE } from "@/lib/auth";
import { isHostedNetlifyRuntime } from "@/lib/hosted-runtime";
import { createLocalSession } from "@/lib/local-store";
import { getRuntimeAdapter, RuntimeConfigurationError } from "@/lib/runtime";
import { assertRateLimit, assertSameOrigin } from "@/lib/request-security";
import { createSupabaseServerClient } from "@/lib/supabase";

const requestSchema = z.object({ email: z.email() });

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
    const { email } = requestSchema.parse(await request.json());
    if (getRuntimeAdapter() === "local") {
      const { token } = createLocalSession(email);
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
    const appUrl =
      process.env.APP_ENV === "staging" && isHostedNetlifyRuntime()
        ? new URL(request.url).origin
        : process.env.NEXT_PUBLIC_APP_URL;
    if (!appUrl)
      throw new RuntimeConfigurationError("NEXT_PUBLIC_APP_URL is required for Auth redirects.");
    const callbackUrl = new URL("/auth/callback", appUrl);
    callbackUrl.searchParams.set("next", "/onboarding");
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callbackUrl.toString() },
    });
    if (error) throw error;
    return NextResponse.json({ ok: true, authenticated: false, pending: true });
  } catch (error) {
    if (error instanceof RuntimeConfigurationError)
      return NextResponse.json(
        { error: "Authentication is not configured for this deployment." },
        { status: 503 },
      );
    // A provider send-rate rejection is not a bad address, and telling someone
    // their sign-in "failed" when the mail quota is momentarily exhausted sends
    // them to correct an address that was fine. Report it as what it is.
    if (isSendRateLimited(error))
      return NextResponse.json(
        {
          error: "Too many sign-in links have been requested. Try again shortly.",
          retryable: true,
        },
        { status: 429 },
      );
    return NextResponse.json(
      { error: "Unable to start a private sign-in session." },
      { status: 400 },
    );
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
