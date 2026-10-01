// Small pieces of the story page: how each measure reads, a missing number with why, and a link that
// keeps the page's own state in its address.
import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { Story, Usage } from "../../../shared/types.ts";
import { GLOSSARY, type TermId } from "../../../shared/glossary.ts";
import { whyMissing } from "../../../shared/runView.ts";
import type { StoryMeasureKey } from "../../../shared/storyView.ts";
import { duration } from "../../format.ts";
import { short } from "../UsageCells.tsx";

const SECONDS_PER_MINUTE = 60;
const PERCENT = 100;
const SPEED_DECIMALS = 1;

const whole = (n: number) => Math.round(n).toLocaleString("en-GB");

/** How a value on each measure reads: minutes as a duration, tokens short, speeds to a tenth, held-out as a share. */
export const SHOW: Record<StoryMeasureKey, (v: number) => string> = {
  minutes: (v) => duration(v * SECONDS_PER_MINUTE),
  outTokens: (v) => short(Math.round(v)),
  calls: whole,
  heldOut: (v) => `${Math.round(v * PERCENT)}%`,
  readTokens: (v) => short(Math.round(v)),
  tokS: (v) => v.toFixed(SPEED_DECIMALS),
  decodeTokS: (v) => v.toFixed(SPEED_DECIMALS),
  compactions: whole,
  nudges: whole,
};

/** Why a recorded story run has no value on a measure. */
export function whyNoValue(story: Story, key: StoryMeasureKey): string {
  if (key === "heldOut") return "Its own held-out tests weren't recorded with the story.";
  const u: Usage | null = story.usage ?? null;
  return whyMissing(u, key === "decodeTokS" ? "decode" : "story");
}

export const termName = (id: TermId) => GLOSSARY[id].name;
export const termTip = (id: TermId) => GLOSSARY[id].what;

/** A heading or label from the glossary, with its definition on hover. */
export function Term({ id, children }: { id: TermId; children?: ReactNode }) {
  return <span className="term" data-tip={GLOSSARY[id].what}>{children ?? GLOSSARY[id].name}</span>;
}

/** "—" for a number that isn't there, with why on hover and on keyboard focus. Never a 0. */
export function Missing({ why }: { why: string }) {
  return <span className="missing" tabIndex={0} data-tip={why} aria-label={`not available: ${why}`}>—</span>;
}

/** An entity link (from EntityLinks, which builds the plain address) whose address also carries this page's state, so
 * moving along keeps it: a plain click, a middle-click or a copied link all go to the address with the state.
 * EntityLinks sets the address once; this sets it again after every render, and React leaves it alone after that
 * because its own href prop doesn't change. */
export function KeepState({ href, children }: { href: string; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const a = ref.current?.querySelector("a");
    if (a && a.getAttribute("href") !== href) a.setAttribute("href", href);
  });
  return <span ref={ref} className="keep-state">{children}</span>;
}
