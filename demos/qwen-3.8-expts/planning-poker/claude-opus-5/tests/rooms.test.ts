import { describe, expect, it } from "vitest";
import { cleanText } from "../shared/sanitize";
import { generateRoomCode, isValidRoomCode, resolveDeckId } from "../worker/rooms";

const ESC = String.fromCharCode(0x1b);
const NUL = String.fromCharCode(0x00);
const C1 = String.fromCharCode(0x9b);

describe("room codes", () => {
  it("generates codes in the documented shape", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode();
      expect(code).toMatch(/^[a-z0-9]{3}-[a-z0-9]{3}-[a-z0-9]{3}$/);
      expect(isValidRoomCode(code)).toBe(true);
    }
  });

  it("never emits characters that are ambiguous when read aloud", () => {
    const codes = Array.from({ length: 300 }, generateRoomCode).join("");
    expect(codes).not.toMatch(/[01ilo]/);
  });

  it("rejects malformed codes", () => {
    for (const bad of ["", "abc", "abcdefghi", "ABC-DEF-GHI", "ab-def-ghi", "abc-def-ghi-jkl"]) {
      expect(isValidRoomCode(bad)).toBe(false);
    }
  });
});

describe("resolveDeckId", () => {
  it("keeps a known deck and falls back otherwise", () => {
    expect(resolveDeckId("t-shirt")).toBe("t-shirt");
    expect(resolveDeckId("nonsense")).toBe("fibonacci");
    expect(resolveDeckId(undefined)).toBe("fibonacci");
    expect(resolveDeckId(42)).toBe("fibonacci");
  });
});

describe("cleanText", () => {
  it("strips terminal escapes a player might type into their name", () => {
    expect(cleanText(`  Ada${ESC}[31m  `, 32)).toBe("Ada[31m");
  });

  it("strips NUL and C1 control characters", () => {
    expect(cleanText(`a${NUL}b${C1}c`, 32)).toBe("abc");
  });

  it("truncates to the limit", () => {
    expect(cleanText("abcdefghij", 4)).toBe("abcd");
  });

  it("coerces nullish input to an empty string", () => {
    expect(cleanText(null, 10)).toBe("");
    expect(cleanText(undefined, 10)).toBe("");
  });
});
