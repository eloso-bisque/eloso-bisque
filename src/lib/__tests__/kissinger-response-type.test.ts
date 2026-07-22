/**
 * Tests for the ResponseType <-> Kissinger ResponseTypeGql enum-casing
 * mapping (GH #43 — bug discovered during manual testing).
 *
 * Kissinger's GraphQL `ResponseTypeGql` enum values are SCREAMING_SNAKE_CASE
 * ("INTERESTED", "NOT_NOW", "WRONG_PERSON", "NO_REPLY", "BOUNCED") — confirmed
 * via a live introspection query against prod Kissinger. The app's
 * `ResponseType` had been passing its own PascalCase-ish values
 * ("Interested", "NotNow", ...) straight through, which Kissinger rejects
 * with a GraphQL enum validation error on every call. This is why
 * `recordOutreachResponse` — and therefore "Log Response" — had never
 * actually worked in production; the error was silently swallowed into a
 * generic null/500.
 */

import { describe, it, expect } from "vitest";
import { toKissingerResponseTypeEnum, fromKissingerResponseTypeEnum, type ResponseType } from "@/lib/kissinger";

describe("toKissingerResponseTypeEnum", () => {
  const cases: [ResponseType, string][] = [
    ["Interested", "INTERESTED"],
    ["NotNow", "NOT_NOW"],
    ["WrongPerson", "WRONG_PERSON"],
    ["NoReply", "NO_REPLY"],
    ["Bounced", "BOUNCED"],
  ];

  it.each(cases)("maps app ResponseType %s to Kissinger enum %s", (appValue, kissingerValue) => {
    expect(toKissingerResponseTypeEnum(appValue)).toBe(kissingerValue);
  });
});

describe("fromKissingerResponseTypeEnum", () => {
  it("maps a Kissinger enum value back to the app's ResponseType casing", () => {
    expect(fromKissingerResponseTypeEnum("INTERESTED")).toBe("Interested");
    expect(fromKissingerResponseTypeEnum("NOT_NOW")).toBe("NotNow");
  });

  it("returns undefined for an unrecognized value rather than throwing", () => {
    expect(fromKissingerResponseTypeEnum("SOMETHING_ELSE")).toBeUndefined();
  });
});
