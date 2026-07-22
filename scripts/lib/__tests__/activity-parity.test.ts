import { describe, it, expect } from "vitest";
import { compareValues, buildParityRow, summarizeParity } from "../activity-parity";

describe("compareValues", () => {
  it("matches equal numbers", () => {
    expect(compareValues(3, 3)).toBe(true);
  });

  it("does not match different numbers", () => {
    expect(compareValues(3, 4)).toBe(false);
  });

  it("treats null vs null as a match (both sources agree: no data)", () => {
    expect(compareValues(null, null)).toBe(true);
  });

  it("does not match null vs a real value", () => {
    expect(compareValues(null, 3)).toBe(false);
    expect(compareValues(3, null)).toBe(false);
  });
});

describe("summarizeParity", () => {
  it("reports all rows matched when every row matches", () => {
    const rows = [
      buildParityRow("drew@eloso.ai", "logins", "2026-07-20", 2, 2),
      buildParityRow("drew@eloso.ai", "logins", "2026-07-21", 0, 0),
    ];
    const summary = summarizeParity(rows);
    expect(summary.total).toBe(2);
    expect(summary.matched).toBe(2);
    expect(summary.mismatched).toHaveLength(0);
  });

  it("collects mismatched rows for reporting", () => {
    const rows = [
      buildParityRow("drew@eloso.ai", "logins", "2026-07-20", 2, 2),
      buildParityRow("drew@eloso.ai", "outreach_sent", "2026-07-20", 5, 3),
    ];
    const summary = summarizeParity(rows);
    expect(summary.matched).toBe(1);
    expect(summary.mismatched).toHaveLength(1);
    expect(summary.mismatched[0].metric).toBe("outreach_sent");
  });
});
