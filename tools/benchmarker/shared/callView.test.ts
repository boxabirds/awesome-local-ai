import { describe, expect, it } from "vitest";
import { outputSplit } from "./callView.ts";

// A call's output tokens are recorded for the call, not for its parts. The parts' tokens are the total shared out by the
// characters each holds (thinking, visible text, tool arguments), rounded so they add up to the total.
describe("a call's output tokens, shared out by characters", () => {
  it("shares out in proportion to characters and adds up to the total", () => {
    const s = outputSplit(1000, { thinking: 600, text: 100, tools: 300 })!;
    expect(s).toEqual({ thinking: 600, text: 100, tools: 300 });
  });

  it("rounds so the parts always sum to the total (largest remainder)", () => {
    const s = outputSplit(100, { thinking: 1, text: 1, tools: 1 })!;
    expect(s.thinking + s.text + s.tools).toBe(100);
    expect([s.thinking, s.text, s.tools].sort()).toEqual([33, 33, 34]);
  });

  it("the real call: nearly all thinking", () => {
    // v2-fresh-r2 story 1, call 5: 104,291 characters of thinking, 152 of text, 456 of tool arguments, 31,527 output tokens.
    const s = outputSplit(31_527, { thinking: 104_291, text: 152, tools: 456 })!;
    expect(s.thinking + s.text + s.tools).toBe(31_527);
    expect(s.thinking).toBeGreaterThan(31_300);
    expect(s.text).toBeLessThan(60);
    expect(s.tools).toBeLessThan(160);
  });

  it("a call whose thinking is withheld shares the tokens between what is left", () => {
    expect(outputSplit(90, { thinking: 0, text: 100, tools: 200 })).toEqual({ thinking: 0, text: 30, tools: 60 });
  });

  it("is none with no token count recorded, or with no characters at all", () => {
    expect(outputSplit(null, { thinking: 5, text: 5, tools: 5 })).toBeNull();
    expect(outputSplit(100, { thinking: 0, text: 0, tools: 0 })).toBeNull();
  });

  it("a part with no characters gets no tokens", () => {
    expect(outputSplit(10, { thinking: 0, text: 0, tools: 40 })).toEqual({ thinking: 0, text: 0, tools: 10 });
  });
});
