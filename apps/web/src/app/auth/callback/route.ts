import { NextResponse } from "next/server";

import { getRuntimeAdapter } from "@/lib/runtime";
import { createSupabaseServerClient } from "@/lib/supabase";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const requestedNext = url.searchParams.get("next");
  const next =
    requestedNext?.startsWith("/") && !requestedNext.startsWith("//")
      ? requestedNext
      : "/onboarding";
  if (getRuntimeAdapter() !== "supabase" || !code)
    return NextResponse.redirect(new URL("/sign-in?error=invalid-link", url.origin));
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  return NextResponse.redirect(new URL(error ? "/sign-in?error=expired-link" : next, url.origin));
}
