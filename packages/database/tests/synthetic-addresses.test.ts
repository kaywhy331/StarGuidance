import { describe, expect, it } from "vitest";

import {
  assertUsableSubject,
  SYNTHETIC_EMAIL_DOMAIN,
  SYNTHETIC_PREFIX,
  syntheticEmail,
} from "./support/synthetic-subjects";

/**
 * Guards the address policy for synthetic verification identities.
 *
 * Two independent constraints have to hold at once, and the obvious choice
 * violates one of them:
 *
 * - The domain must never be able to deliver mail to a real person. RFC 6761
 *   reserves `.test` for exactly this and guarantees it cannot resolve.
 * - The domain must survive Supabase's email validator. `example.com` does not:
 *   Supabase rejects it with `email_address_invalid`, which meant every
 *   synthetic identity failed to be created and the whole staging gate stalled
 *   on an opaque error.
 *
 * The prefix is equally load-bearing: the cleanup utility finds identities to
 * remove by matching it, so an address that drops it becomes an orphan.
 */
const PROVIDER_REJECTED_DOMAINS = [
  "example.com",
  "example.co.uk",
  "test.com",
  "email.com",
] as const;

describe("synthetic verification addresses", () => {
  it("uses a reserved top-level domain that cannot receive mail", () => {
    expect(SYNTHETIC_EMAIL_DOMAIN.endsWith(".test")).toBe(true);
  });

  it("never uses a domain the provider rejects as invalid", () => {
    for (const domain of PROVIDER_REJECTED_DOMAINS) {
      expect(SYNTHETIC_EMAIL_DOMAIN, `${domain} is refused by Supabase's email validator`).not.toBe(
        domain,
      );
    }
  });

  it("keeps every generated address findable by the cleanup utility", () => {
    for (const label of ["rls-a", "provision-b", "accessibility"]) {
      const address = syntheticEmail(label);
      expect(address.startsWith(SYNTHETIC_PREFIX)).toBe(true);
      expect(address.endsWith(`@${SYNTHETIC_EMAIL_DOMAIN}`)).toBe(true);
      expect(address).toContain(label);
    }
  });

  it("refuses to let an unusable subject identifier reach a query", () => {
    // This is the guard that keeps a provider rejection legible. Without it an
    // empty id reached every statement and surfaced as 22P02 invalid-UUID
    // errors, which read as a database defect rather than a failed signup.
    for (const unusable of ["", " ", "undefined", "null", "not-a-uuid", "12345"]) {
      expect(
        () => assertUsableSubject(unusable, "a query"),
        `${JSON.stringify(unusable)} must be refused`,
      ).toThrow(/not a UUID/);
    }
  });

  it("explains that the identity was never created rather than blaming the query", () => {
    expect(() => assertUsableSubject("", "synthetic subject teardown")).toThrow(
      /Auth identity was never created/,
    );
    expect(() => assertUsableSubject("", "synthetic subject teardown")).toThrow(
      /synthetic subject teardown/,
    );
  });

  it("accepts a well-formed identifier in either case", () => {
    const lower = "0f8fad5b-d9cb-469f-a165-70867728950e";
    expect(assertUsableSubject(lower, "a query")).toBe(lower);
    expect(assertUsableSubject(lower.toUpperCase(), "a query")).toBe(lower.toUpperCase());
  });

  it("generates a distinct address every time", () => {
    const addresses = new Set(Array.from({ length: 25 }, () => syntheticEmail("rls-a")));
    expect(addresses.size).toBe(25);
  });
});
