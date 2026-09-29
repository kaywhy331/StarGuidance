import "server-only";

import { cookies } from "next/headers";

import { SESSION_COOKIE } from "@/lib/auth";
import { getLocalUser } from "@/lib/local-store";
import { getRuntimeAdapter } from "@/lib/runtime";

const SUPABASE_AUTH_COOKIE = /^sb-[^.]+-auth-token(?:\.\d+)?$/;

/**
 * A cheap, never-throwing hint about whether this browser holds a session,
 * used only to choose which navigation to show. It makes no network call and
 * grants nothing: every protected page and API still verifies the session.
 */
export async function hasSessionHint(): Promise<boolean> {
  try {
    const jar = await cookies();
    if (getRuntimeAdapter() === "local")
      return Boolean(getLocalUser(jar.get(SESSION_COOKIE)?.value));
    return jar
      .getAll()
      .some(({ name, value }) => SUPABASE_AUTH_COOKIE.test(name) && value.length > 0);
  } catch {
    return false;
  }
}
