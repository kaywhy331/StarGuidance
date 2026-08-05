import { NextResponse } from "next/server";
import { isAuthPKCECodeVerifierMissingError } from "@supabase/supabase-js";

import { getRuntimeAdapter } from "@/lib/runtime";
import { createSupabaseServerClient } from "@/lib/supabase";

const tokenHashPattern = /^[A-Za-z0-9_-]{20,512}$/;
const supportedEmailOtpTypes = new Set(["email", "magiclink", "signup"] as const);

function safeNext(url: URL): string {
  const requested = url.searchParams.get("next");
  if (!requested?.startsWith("/") || requested.startsWith("//")) return "/onboarding";
  const destination = new URL(requested, url.origin);
  return destination.origin === url.origin
    ? `${destination.pathname}${destination.search}${destination.hash}`
    : "/onboarding";
}

function redirect(url: URL, path: string): NextResponse {
  const response = NextResponse.redirect(new URL(path, url.origin), 303);
  response.headers.set("cache-control", "no-store");
  response.headers.set("referrer-policy", "no-referrer");
  return response;
}

function isMissingVerifier(error: unknown): boolean {
  return (
    isAuthPKCECodeVerifierMissingError(error) ||
    (error instanceof Error && error.name === "AuthPKCECodeVerifierMissingError")
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const otpType = url.searchParams.get("type");
  const next = safeNext(url);
  if (getRuntimeAdapter() !== "supabase") return redirect(url, "/sign-in?error=invalid-link");

  try {
    const supabase = await createSupabaseServerClient();
    if (
      tokenHash &&
      tokenHashPattern.test(tokenHash) &&
      otpType &&
      supportedEmailOtpTypes.has(otpType as "email" | "magiclink" | "signup")
    ) {
      const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: otpType as "email" | "magiclink" | "signup",
      });
      return redirect(url, error ? "/sign-in?error=expired-link" : next);
    }

    if (!code) return redirect(url, "/sign-in?error=invalid-link");
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return redirect(url, next);
    return redirect(
      url,
      isMissingVerifier(error) ? "/sign-in?error=link-browser" : "/sign-in?error=expired-link",
    );
  } catch {
    return redirect(url, "/sign-in?error=service-unavailable");
  }
}
