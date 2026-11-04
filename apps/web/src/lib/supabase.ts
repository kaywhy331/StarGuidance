import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { createBoundedFetch } from "./bounded-fetch";
import { RuntimeConfigurationError } from "./runtime";

const SUPABASE_REQUEST_TIMEOUT_MS = 15_000;
const READ_ONLY_COOKIE_STORE_ERROR =
  "Cookies can only be modified in a Server Action or Route Handler";

function isReadOnlyCookieStoreError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(READ_ONLY_COOKIE_STORE_ERROR);
}

function providerFetch(): typeof fetch {
  return createBoundedFetch(globalThis.fetch, SUPABASE_REQUEST_TIMEOUT_MS);
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new RuntimeConfigurationError(`${name} is required for Supabase Auth.`);
  return value;
}

export async function createSupabaseServerClient() {
  const jar = await cookies();
  return createServerClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (values) => {
          try {
            for (const { name, value, options } of values) jar.set(name, value, options);
          } catch (error) {
            // Supabase may refresh an expired session while requireUser() is
            // running in a Server Component. Next exposes the request cookies
            // there but intentionally rejects writes. The refreshed session is
            // still valid for this render; a Route Handler can persist it on
            // the next request. Do not hide any other cookie-store failure.
            if (!isReadOnlyCookieStoreError(error)) throw error;
          }
        },
      },
      global: { fetch: providerFetch() },
    },
  );
}

export function createSupabaseAdminClient() {
  return createClient(required("NEXT_PUBLIC_SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: providerFetch() },
  });
}
