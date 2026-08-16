import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { createBoundedFetch } from "./bounded-fetch";
import { RuntimeConfigurationError } from "./runtime";

const SUPABASE_REQUEST_TIMEOUT_MS = 15_000;

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
          for (const { name, value, options } of values) jar.set(name, value, options);
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
