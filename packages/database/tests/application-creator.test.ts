import { describe, expect, it } from "vitest";

import { APPLICATION_CREATOR, applicationCreatorRefusal } from "../src/browser-access-privileges";

describe("application DDL creator contract", () => {
  it("names postgres as the explicit application creator", () => {
    expect(APPLICATION_CREATOR).toBe("postgres");
  });

  it("accepts only a direct postgres session", () => {
    expect(applicationCreatorRefusal({ sessionUser: "postgres", currentUser: "postgres" })).toBe(
      undefined,
    );
  });

  it("rejects alternate logins, SET ROLE, and platform creators", () => {
    const cases = [
      { sessionUser: "migrator", currentUser: "migrator" },
      { sessionUser: "migrator", currentUser: "postgres" },
      { sessionUser: "postgres", currentUser: "supabase_admin" },
      { sessionUser: "supabase_admin", currentUser: "supabase_admin" },
      { sessionUser: "", currentUser: "" },
    ];
    for (const identity of cases) {
      expect(applicationCreatorRefusal(identity), JSON.stringify(identity)).toMatch(
        /direct "postgres" connection/,
      );
    }
  });
});
