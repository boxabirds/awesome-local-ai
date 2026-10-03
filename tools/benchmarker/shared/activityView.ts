// What the model's thinking was spent on, compared between two combinations. The classes come from the analytics layer
// (benchmarks/docs/insights/thinking): an unsupervised reading of the thinking text, so they are a description and not a
// measurement of quality. The comparison is made on the stories both combinations ran, which holds the task's subject
// fixed: a class that is about the subject (notes, zoom) then cannot drive the difference, because both sides face it.
import { median } from "./stats.ts";

export interface ActivityTheme { id: number; name: string; definition: string }
export interface ActivityRow { rel: string; stack: string | null; run: string | null; story: number | null; theme: number; chars: number; paragraphs: number | null }
export interface ActivityData { version: number; themes: ActivityTheme[]; rows: ActivityRow[] }

export interface ActivityClass { id: number; name: string; definition: string; left: number; right: number; ratio: number | null }
export interface ActivityComparison {
  /** The stories both ran, in order. */
  stories: number[];
  classes: ActivityClass[];
  total: { left: number; right: number; ratio: number | null };
}

/** `right` over `left`, or null where left is zero: a ratio against nothing is not a number. */
const ratioOf = (left: number, right: number): number | null => (left > 0 ? right / left : null);

/** stack -> story -> theme -> the median characters over that stack's runs of that story. */
function byStory(rows: ActivityRow[]): Map<string, Map<number, Map<number, number>>> {
  const runs = new Map<string, Map<number, Map<number, number[]>>>();
  for (const r of rows) {
    if (r.stack === null || r.story === null) continue;
    const forStack = runs.get(r.stack) ?? new Map();
    runs.set(r.stack, forStack);
    const forStory = forStack.get(r.story) ?? new Map();
    forStack.set(r.story, forStory);
    forStory.set(r.theme, [...(forStory.get(r.theme) ?? []), r.chars]);
  }
  const out = new Map<string, Map<number, Map<number, number>>>();
  for (const [stack, stories] of runs) {
    const s = new Map<number, Map<number, number>>();
    for (const [story, themes] of stories) {
      s.set(story, new Map([...themes].map(([t, xs]) => [t, median(xs) ?? 0])));
    }
    out.set(stack, s);
  }
  return out;
}

/** The comparison of two combinations, or null when they share no story (nothing to compare is not an empty table). */
export function activityReport(data: ActivityData, leftStack: string, rightStack: string): ActivityComparison | null {
  const byStack = byStory(data.rows);
  const l = byStack.get(leftStack);
  const r = byStack.get(rightStack);
  if (!l || !r) return null;
  const stories = [...l.keys()].filter((s) => r.has(s)).toSorted((a, b) => a - b);
  if (stories.length === 0) return null;
  const sum = (side: Map<number, Map<number, number>>, theme: number) =>
    stories.reduce((n, s) => n + (side.get(s)?.get(theme) ?? 0), 0);
  const classes = data.themes
    .map((t): ActivityClass => {
      const left = sum(l, t.id);
      const right = sum(r, t.id);
      return { id: t.id, name: t.name, definition: t.definition, left, right, ratio: ratioOf(left, right) };
    })
    .filter((c) => c.left > 0 || c.right > 0)
    .toSorted((a, b) => b.left + b.right - (a.left + a.right));
  const left = classes.reduce((n, c) => n + c.left, 0);
  const right = classes.reduce((n, c) => n + c.right, 0);
  return { stories, classes, total: { left, right, ratio: ratioOf(left, right) } };
}

/** Every combination the data has an activity figure for, in order. */
export function activityStacks(data: ActivityData): string[] {
  return [...new Set(data.rows.map((r) => r.stack).filter((s): s is string => s !== null))].toSorted();
}
