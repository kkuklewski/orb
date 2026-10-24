import { describe, expect, it } from "vitest";
import { rowSpan } from "./masonry";

describe("masonry", () => {
  it("a tile spans the rows its height plus the gap needs, at least one", () => {
    expect(rowSpan(0)).toBe(2);
    expect(rowSpan(100)).toBe(15);  // (100 + 16) / 8 = 14.5
    expect(rowSpan(-50)).toBe(1);
  });
});
