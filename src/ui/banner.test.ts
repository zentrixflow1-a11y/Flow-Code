import { describe, expect, it } from "vitest";
import { BANNER, BANNER_LINES } from "./banner.js";

describe("banner", () => {
  it("has at least four lines", () => {
    expect(BANNER_LINES.length).toBeGreaterThanOrEqual(4);
  });

  it("draws every line at the same width", () => {
    const widths = new Set(BANNER_LINES.map((line) => line.length));
    expect(widths.size).toBe(1);
  });

  it("shows a prompt chevron above a wave", () => {
    expect(BANNER).toContain(">");
    expect(BANNER).toContain("~");
    const promptLine = BANNER_LINES.findIndex((line) => line.includes(">"));
    const waveLine = BANNER_LINES.findIndex((line) => line.includes("~"));
    expect(promptLine).toBeGreaterThanOrEqual(0);
    expect(waveLine).toBeGreaterThan(promptLine);
  });

  it("joins the lines with newlines", () => {
    expect(BANNER.split("\n")).toEqual([...BANNER_LINES]);
  });
});
