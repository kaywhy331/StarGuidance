import { describe, expect, it } from "vitest";

import { matchingPeople, mentionQueryAt } from "./people-mentions";

describe("@handle autocomplete", () => {
  it("finds the partial handle just before the caret", () => {
    expect(mentionQueryAt("How is @ad", 10)).toEqual({ start: 7, query: "ad" });
    expect(mentionQueryAt("@", 1)).toEqual({ start: 0, query: "" });
    expect(mentionQueryAt("email me@home", 13)).toBe(undefined);
    expect(mentionQueryAt("How is @ada today", 17)).toBe(undefined);
  });

  it("matches saved people by handle or name", () => {
    const people = [
      { id: "1", name: "Ada Lovelace", mention: "@ada-lovelace" },
      { id: "2", name: "Grace Hopper", mention: "@grace-hopper" },
    ];
    expect(matchingPeople(people, "ada").map(({ id }) => id)).toEqual(["1"]);
    expect(matchingPeople(people, "hopper").map(({ id }) => id)).toEqual(["2"]);
    expect(matchingPeople(people, "")).toHaveLength(2);
  });
});
