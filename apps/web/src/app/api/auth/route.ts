import { NextResponse } from "next/server";
import { z } from "zod";

import { SESSION_COOKIE } from "@/lib/auth";
import { isHostedNetlifyRuntime } from "@/lib/hosted-runtime";
import { createLocalSession } from "@/lib/local-store";
import { getRuntimeAdapter, RuntimeConfigurationError } from "@/lib/runtime";
import { assertRateLimit, assertSameOrigin } from "@/lib/request-security";
import { createSupabaseServerClient } from "@/lib/supabase";

const requestSchema = z.object({ email: z.email() });

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
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${appUrl.replace(/\/$/, "")}/auth/callback?next=/onboarding` },
    });
    if (error) throw error;
    return NextResponse.json({ ok: true, authenticated: false, pending: true });
  } catch (error) {
    const configurationError = error instanceof RuntimeConfigurationError;
    return NextResponse.json(
      {
        error: configurationError
          ? "Authentication is not configured for this deployment."
          : "Unable to start a private sign-in session.",
      },
      { status: configurationError ? 503 : 400 },
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
