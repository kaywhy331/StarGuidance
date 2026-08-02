import { randomUUID } from "node:crypto";

import { createServerClient } from "@supabase/ssr";
import type { BrowserContext, Cookie } from "@playwright/test";

/**
 * Credential handling for the staging verification suite.
 *
 * Synthetic identities are created through the Supabase Admin API and never
 * correspond to a real person. Tokens, passwords, cookies, and addresses stay
 * inside this module: nothing here is logged, asserted on, or written to disk.
 *
 * The application's magic-link callback uses the PKCE `?code=` exchange, whose
 * verifier is bound to the browser that initiated `signInWithOtp`. An
 * admin-generated link carries no such verifier, so it cannot drive a positive
 * callback without an inbox. This module therefore establishes the session
 * through the same `@supabase/ssr` cookie contract the application itself
 * writes, which exercises real Supabase JWT validation server-side. The
 * positive `?code=` exchange remains an owner inbox smoke test.
 */
export const SYNTHETIC_EMAIL_PREFIX = "sg-verify-";

export interface SyntheticIdentity {
  /** Non-identifying label used in assertion messages, e.g. "user A". */
  readonly alias: string;
  /** Supabase Auth subject. Never record this in evidence. */
  readonly id: string;
  readonly email: string;
  readonly password: string;
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
  const email = `${SYNTHETIC_EMAIL_PREFIX}${runId}-${randomUUID()}@example.com`;
  const password = `Sg!${randomUUID()}${randomUUID()}`;
  const response = await fetch(`${supabaseUrl()}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: serviceKey(),
      authorization: `Bearer ${serviceKey()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!response.ok)
    throw new Error(`Creating synthetic ${alias} failed with status ${response.status}`);
  const body = (await response.json()) as { id?: string };
  if (!body.id) throw new Error(`Creating synthetic ${alias} returned no subject`);
  return { alias, id: body.id, email, password };
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
