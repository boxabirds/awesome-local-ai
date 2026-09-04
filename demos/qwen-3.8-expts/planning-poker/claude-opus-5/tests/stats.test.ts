import { describe, expect, it } from "vitest";
import { computeStats } from "../worker/stats";

const FIB = ["0", "1", "2", "3", "5", "8", "13", "?", "☕"];
const META = ["?", "☕"];

describe("computeStats", () => {
  it("returns null when nobody voted", () => {
    expect(computeStats([], FIB, META)).toBeNull();
  });

  it("averages only numeric cards", () => {
    const stats = computeStats(["2", "3", "?", "☕"], FIB, META)!;
    expect(stats.average).toBe(2.5);
    expect(stats.numericVoteCount).toBe(2);
    expect(stats.totalVoteCount).toBe(4);
  });

  it("counts symbolic cards in the distribution", () => {
    const stats = computeStats(["5", "?", "?"], FIB, META)!;
    expect(stats.distribution).toEqual([
      { card: "5", count: 1 },
      { card: "?", count: 2 },
    ]);
  });

  it("flags unanimity only when more than one person voted", () => {
    expect(computeStats(["5", "5", "5"], FIB, META)!.consensus).toBe(true);
    expect(computeStats(["5"], FIB, META)!.consensus).toBe(false);
    expect(computeStats(["5", "8"], FIB, META)!.consensus).toBe(false);
  });

  it("reports the spread between the lowest and highest numeric cards", () => {
    const stats = computeStats(["1", "8", "3"], FIB, META)!;
    expect(stats.spread).toEqual({ low: "1", high: "8" });
    expect(stats.median).toBe(3);
  });

  it("has no spread when every numeric card matches", () => {
    expect(computeStats(["3", "3", "?"], FIB, META)!.spread).toBeNull();
  });

  it("takes the midpoint of an even number of votes", () => {
    expect(computeStats(["1", "2", "3", "8"], FIB, META)!.median).toBe(2.5);
  });

  it("keeps cards that are no longer in the deck", () => {
    const stats = computeStats(["99"], FIB, META)!;
    expect(stats.distribution).toEqual([{ card: "99", count: 1 }]);
    expect(stats.average).toBe(99);
  });

  it("handles a deck with no numeric cards at all", () => {
    const shirts = ["S", "M", "L"];
    const stats = computeStats(["S", "M"], shirts, [])!;
    expect(stats.average).toBeNull();
    expect(stats.median).toBeNull();
    expect(stats.totalVoteCount).toBe(2);
  });
});
