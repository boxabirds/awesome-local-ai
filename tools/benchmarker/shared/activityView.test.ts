import { describe, expect, it } from "vitest";
import { activityReport, type ActivityData } from "./activityView.ts";

// Thinking by activity class, compared between combinations on the stories they both ran. The story is held fixed, so a
// class that is about the task's subject (zoom, notes) cannot drive the comparison: both sides face the same subject.
const THEMES = [{ id: 0, name: "Weighing", definition: "d" }, { id: 1, name: "Reading", definition: "d" }];
const row = (stack: string, run: string, story: number, theme: number, chars: number) =>
  ({ rel: `${stack}/${run}/${story}`, stack, run, story, theme, chars, paragraphs: 1 });

describe("the activity report", () => {
  it("compares two stacks on the stories both ran, per class, by the median story run", () => {
    const data: ActivityData = { version: 1, themes: THEMES, rows: [
      row("A", "r1", 1, 0, 100), row("A", "r1", 1, 1, 50),
      row("B", "r1", 1, 0, 400), row("B", "r1", 1, 1, 100),
    ] };
    const r = activityReport(data, "A", "B")!;
    expect(r.stories).toEqual([1]);
    expect(r.classes.map((c) => [c.name, c.left, c.right, c.ratio])).toEqual([
      ["Weighing", 100, 400, 4], ["Reading", 50, 100, 2],
    ]);
    expect(r.total).toEqual({ left: 150, right: 500, ratio: 500 / 150 });
  });

  it("uses only the stories both stacks ran, so one side's extra story cannot tilt it", () => {
    const data: ActivityData = { version: 1, themes: THEMES, rows: [
      row("A", "r1", 1, 0, 100), row("B", "r1", 1, 0, 200),
      row("A", "r1", 7, 0, 9999),
    ] };
    const r = activityReport(data, "A", "B")!;
    expect(r.stories).toEqual([1]);
    expect(r.total.left).toBe(100);
  });

  it("takes the median over a stack's runs of a story, not the sum, so run count cannot tilt it", () => {
    const data: ActivityData = { version: 1, themes: THEMES, rows: [
      row("A", "r1", 1, 0, 100), row("A", "r2", 1, 0, 300), row("A", "r3", 1, 0, 200),
      row("B", "r1", 1, 0, 100),
    ] };
    expect(activityReport(data, "A", "B")!.classes[0].left).toBe(200);
  });

  it("orders classes by how much the two sides spend between them, largest first", () => {
    const data: ActivityData = { version: 1, themes: THEMES, rows: [
      row("A", "r1", 1, 0, 10), row("B", "r1", 1, 0, 10),
      row("A", "r1", 1, 1, 500), row("B", "r1", 1, 1, 500),
    ] };
    expect(activityReport(data, "A", "B")!.classes.map((c) => c.name)).toEqual(["Reading", "Weighing"]);
  });

  it("a class neither side spent anything on is left out", () => {
    const data: ActivityData = { version: 1, themes: THEMES, rows: [row("A", "r1", 1, 0, 100), row("B", "r1", 1, 0, 100)] };
    expect(activityReport(data, "A", "B")!.classes.map((c) => c.name)).toEqual(["Weighing"]);
  });

  it("a ratio against zero is not a number, and says so rather than dividing", () => {
    const data: ActivityData = { version: 1, themes: THEMES, rows: [row("A", "r1", 1, 0, 0), row("B", "r1", 1, 0, 100)] };
    expect(activityReport(data, "A", "B")!.classes[0].ratio).toBeNull();
  });

  it("two stacks with no story in common give nothing, not an empty table", () => {
    const data: ActivityData = { version: 1, themes: THEMES, rows: [row("A", "r1", 1, 0, 100), row("B", "r1", 7, 0, 100)] };
    expect(activityReport(data, "A", "B")).toBeNull();
    expect(activityReport({ version: 1, themes: THEMES, rows: [] }, "A", "B")).toBeNull();
  });

  it("the stacks it can compare are those with at least one story in common", () => {
    const data: ActivityData = { version: 1, themes: THEMES, rows: [
      row("A", "r1", 1, 0, 1), row("B", "r1", 1, 0, 1), row("C", "r1", 9, 0, 1),
    ] };
    expect(activityReport(data, "A", "C")).toBeNull();
    expect(activityReport(data, "A", "B")).not.toBeNull();
  });
});
