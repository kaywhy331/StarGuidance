import { randomUUID } from "node:crypto";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import type { BrowserContext, Cookie } from "@playwright/test";

import {
  ACCOUNT_DISPLAY_NAME_METADATA_KEY,
  POLICY_CONSENT_METADATA_KEY,
  signupConsentReceipts,
} from "../../src/lib/policies";
import { syntheticPassword } from "./synthetic-credentials";

/**
 * Credential handling for the staging verification suite.
 *
 * Synthetic identities are created through the Supabase Admin API and never
 * correspond to a real person. Tokens, passwords, cookies, and addresses stay
 * inside this module: nothing here is logged, asserted on, or written to disk.
 *
 * Initial multi-user setup establishes sessions through the same `@supabase/ssr`
 * cookie contract the application writes, which exercises real Supabase JWT
 * validation without sending mail to reserved synthetic addresses. The deployed
 * flow later signs one identity back in through the public email/password API.
 * Delivered signup-confirmation and recovery callbacks remain owner-inbox smoke
 * tests because an admin-generated link is not equivalent to a delivered one.
 */
export const SYNTHETIC_EMAIL_PREFIX = "sg-verify-";

/**
 * Reserved by RFC 6761: `.test` can never resolve or accept mail, so no message
 * can reach a real person. `example.com` is deliberately not used — Supabase's
 * email validator rejects it with `email_address_invalid`, which prevented every
 * synthetic identity from being created.
 */
export const SYNTHETIC_EMAIL_DOMAIN = "starguidance.test";

export interface SyntheticIdentity {
  /** Non-identifying label used in assertion messages, e.g. "user A". */
  readonly alias: string;
  /** Supabase Auth subject. Never record this in evidence. */
  readonly id: string;
  readonly email: string;
  readonly password: string;
  /**
   * Admin API status for the creation call. Before migration 0002 this was 500
   * for every signup, because the SECURITY DEFINER synchronisation trigger could
   * not satisfy forced row level security.
   */
  readonly creationStatus: number;
}

interface TokenSet {
  readonly access_token: string;
  readonly refresh_token: string;
}

function supabaseUrl(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!value) throw new Error("NEXT_PUBLIC_SUPABASE_URL is required");
  return value.replace(/\/$/, "");
}

function anonKey(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!value) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is required");
  return value;
}

function serviceKey(): string {
  const value = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!value) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  return value;
}

/** Creates a confirmed synthetic identity. No email is ever dispatched. */
export async function createSyntheticIdentity(alias: string): Promise<SyntheticIdentity> {
  const runId = process.env.GITHUB_RUN_ID ?? "local";
  const email = `${SYNTHETIC_EMAIL_PREFIX}${runId}-${randomUUID()}@${SYNTHETIC_EMAIL_DOMAIN}`;
  // Register the address with the runner before it can appear anywhere: driver
  // and fetch errors quote their inputs, and this job log is public.
  if (process.env.GITHUB_ACTIONS === "true") process.stdout.write(`::add-mask::${email}\n`);
  const password = syntheticPassword();
  const acceptedAt = new Date().toISOString();
  const response = await fetch(`${supabaseUrl()}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: serviceKey(),
      authorization: `Bearer ${serviceKey()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      app_metadata: {
        [ACCOUNT_DISPLAY_NAME_METADATA_KEY]: `Synthetic ${alias}`,
        [POLICY_CONSENT_METADATA_KEY]: signupConsentReceipts(acceptedAt),
      },
    }),
  });
  if (!response.ok) {
    // Carry the provider's own error code: an opaque status is what made the
    // previous failure take a whole verification run to explain.
    let code = "";
    try {
      const failure = (await response.json()) as { error_code?: string; msg?: string };
      code = failure.error_code ?? failure.msg?.replace(/"[^"]*"/g, "[redacted]") ?? "";
    } catch {
      code = "";
    }
    throw new Error(
      `Creating synthetic ${alias} failed with status ${response.status}${code ? ` (${code})` : ""}`,
    );
  }
  const body = (await response.json()) as { id?: string };
  if (!body.id) throw new Error(`Creating synthetic ${alias} returned no subject`);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.id))
    throw new Error(`Creating synthetic ${alias} returned an identifier that is not a UUID`);
  return { alias, id: body.id, email, password, creationStatus: response.status };
}

/** Exchanges the synthetic credential for a real Supabase session. */
async function requestTokens(identity: SyntheticIdentity): Promise<TokenSet> {
  const response = await fetch(`${supabaseUrl()}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey(), "content-type": "application/json" },
    body: JSON.stringify({ email: identity.email, password: identity.password }),
  });
  if (!response.ok)
    throw new Error(`Authenticating ${identity.alias} failed with status ${response.status}`);
  const body = (await response.json()) as Partial<TokenSet>;
  if (!body.access_token || !body.refresh_token)
    throw new Error(`Authenticating ${identity.alias} returned an incomplete session`);
  return { access_token: body.access_token, refresh_token: body.refresh_token };
}

/**
 * Produces exactly the cookies `@supabase/ssr` would write for this session by
 * driving the library itself, so the encoding cannot drift from the application.
 */
async function sessionCookies(tokens: TokenSet): Promise<{ name: string; value: string }[]> {
  const jar = new Map<string, string>();
  const client = createServerClient(supabaseUrl(), anonKey(), {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (values) => {
        for (const { name, value } of values) jar.set(name, value);
      },
    },
  });
  const { error } = await client.auth.setSession(tokens);
  if (error) throw new Error("Establishing the synthetic session failed");
  if (jar.size === 0) throw new Error("No session cookie was produced");
  return [...jar].map(([name, value]) => ({ name, value }));
}

/** Signs the identity into a browser context. Never exposes the token values. */
export async function authenticate(
  context: BrowserContext,
  identity: SyntheticIdentity,
  baseUrl: string,
): Promise<void> {
  const domain = new URL(baseUrl).hostname;
  const cookies = await sessionCookies(await requestTokens(identity));
  await context.addCookies(
    cookies.map(({ name, value }) => ({
      name,
      value,
      domain,
      path: "/",
      httpOnly: false,
      secure: baseUrl.startsWith("https://"),
      sameSite: "Lax" as const,
    })),
  );
}

/** Clears every cookie, modelling an explicit sign-out. */
export async function signOut(context: BrowserContext): Promise<void> {
  await context.clearCookies();
}

export async function hasAuthCookie(context: BrowserContext): Promise<boolean> {
  const cookies: Cookie[] = await context.cookies();
  return cookies.some(({ name }) => name.includes("auth-token"));
}

/** Confirms whether the Auth identity still exists. Used for deletion evidence. */
export async function authIdentityExists(identity: SyntheticIdentity): Promise<boolean> {
  const response = await fetch(`${supabaseUrl()}/auth/v1/admin/users/${identity.id}`, {
    headers: { apikey: serviceKey(), authorization: `Bearer ${serviceKey()}` },
  });
  return response.status === 200;
}

export async function deleteSyntheticIdentity(identity: SyntheticIdentity): Promise<void> {
  await fetch(`${supabaseUrl()}/auth/v1/admin/users/${identity.id}`, {
    method: "DELETE",
    headers: { apikey: serviceKey(), authorization: `Bearer ${serviceKey()}` },
  }).catch(() => undefined);
}

/**
 * Generates a signup action without dispatching email and confirms that GoTrue
 * preserves the callback requested by the deployed application. The action
 * link and its one-time token never leave this function. This proves the Auth
 * URL allowlist, but deliberately does not claim that a provider template or
 * inbox-delivery path is correct.
 */
export async function signupActionPreservesRedirect(redirectTo: string): Promise<boolean> {
  const requestedRedirect = new URL(redirectTo).toString();
  const runId = process.env.GITHUB_RUN_ID ?? "local";
  const email = `${SYNTHETIC_EMAIL_PREFIX}${runId}-${randomUUID()}@${SYNTHETIC_EMAIL_DOMAIN}`;
  if (process.env.GITHUB_ACTIONS === "true") process.stdout.write(`::add-mask::${email}\n`);

  const client = createClient(supabaseUrl(), serviceKey(), {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  let generatedUserId: string | undefined;

  try {
    const { data, error } = await client.auth.admin.generateLink({
      type: "signup",
      email,
      password: syntheticPassword(),
      options: { redirectTo: requestedRedirect },
    });
    generatedUserId = data.user?.id;
    if (error)
      throw new Error(
        `Generating a synthetic signup action failed with status ${error.status ?? "unknown"}`,
      );

    const actionLink = data.properties?.action_link;
    if (!actionLink) throw new Error("Generating a synthetic signup action returned no link");
    const acceptedRedirect = new URL(actionLink).searchParams.get("redirect_to");
    return acceptedRedirect === requestedRedirect;
  } finally {
    if (generatedUserId) await client.auth.admin.deleteUser(generatedUserId).catch(() => undefined);
  }
}
