/**
 * Pure text logic for sticky notes: the length limit, the minimal diff into a
 * shared `Y.Text`, the character counter and the auto-fit font size.
 *
 * Deliberately free of React and of any DOM assumptions beyond measuring one
 * element, so the rules are unit-testable and reusable.
 */

import * as Y from 'yjs';

import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';
import {
  applyTextDiff as applyTextDiffShared,
  clampToLimit as clampToLimitShared,
} from '../../shared/text-edit';

/** True for UTF-16 high surrogates (the first unit of an emoji pair). */
const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
/** True for UTF-16 low surrogates (the second unit of an emoji pair). */
const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

/**
 * Keeps at most `max` characters (default `STICKY_TEXT_MAX_CHARS`): typing or
 * pasting that would exceed the limit adds nothing beyond the last allowed
 * character.
 *
 * The rule itself lives in `src/shared/text-edit.ts` from story 9, because a text
 * object and a sticky note are held to the same one rule; this is the sticky note's
 * default, and the re-export story 2's callers keep using.
 */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return clampToLimitShared(next, max);
}

/**
 * Writes `next` into `ytext` with the smallest possible change: a common prefix
 * and suffix are kept, everything between them is one delete and/or one insert
 * inside a single transaction. The minimal diff is what lets two people type in
 * the same note without destroying each other's characters (story 3).
 *
 * The implementation is the shared one in `src/shared/text-edit.ts`; sticky notes
 * and text objects cannot drift apart on how a keystroke reaches a shared `Y.Text`.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  applyTextDiffShared(ytext, next, origin);
}

/** A remote change, spliced into what you are typing. */
export interface MergedRemoteText {
  /** What the text box should hold now. */
  text: string;
  /** Where the caret should be. */
  caret: number;
  /** False when the shared text had not changed after all. */
  changed: boolean;
}

/** Length of the characters two strings start with in common. */
function commonPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let length = 0;
  while (length < limit && a[length] === b[length]) length += 1;
  return length;
}

/** Length of the characters two strings end with in common, not reaching `floor`. */
function commonSuffixLength(a: string, b: string, floor: number): number {
  let length = 0;
  while (
    length < a.length - floor &&
    length < b.length - floor &&
    a[a.length - 1 - length] === b[b.length - 1 - length]
  ) {
    length += 1;
  }
  return length;
}

/**
 * Splices somebody else's change into a text box the local person is typing in.
 *
 * `base` is the shared text as the box was last told about it, `theirs` is what it holds
 * now, and `mine` is what the person has typed so far — which holds their own keystrokes
 * and none of the change that just arrived. The three are enough to work out what the
 * other person changed and put exactly that into the box, leaving the local typing where
 * it is.
 *
 * This is what keeps two people's characters in the same note. Without it the box holds
 * only local typing, and the next keystroke — which writes the box back into the shared
 * text — quietly deletes everything the other person put there.
 *
 * When both people have changed the same stretch, nothing is removed: both versions are
 * kept. A duplicated character can be noticed and undone; a lost one is gone. The shared
 * text itself makes the same judgement.
 */
export function mergeRemoteText(
  base: string,
  theirs: string,
  mine: string,
  caret: number,
): MergedRemoteText {
  if (base === theirs) return { text: mine, caret, changed: false };

  // What the other person did, as one replace: base[start..end) becomes `inserted`.
  const sharedPrefix = commonPrefixLength(base, theirs);
  const sharedSuffix = commonSuffixLength(base, theirs, sharedPrefix);
  let start = sharedPrefix;
  let end = base.length - sharedSuffix;
  // Never cut through a surrogate pair: an emoji is two units and only means anything
  // as both of them.
  if (
    start > 0 &&
    start < base.length &&
    isHighSurrogate(base.charCodeAt(start - 1)) &&
    isLowSurrogate(base.charCodeAt(start))
  ) {
    start -= 1;
  }
  if (
    end > start &&
    end < base.length &&
    isLowSurrogate(base.charCodeAt(end)) &&
    isHighSurrogate(base.charCodeAt(end - 1))
  ) {
    end -= 1;
  }
  const suffix = base.length - end;
  const inserted = theirs.slice(start, theirs.length - suffix);
  const shift = inserted.length - (end - start);

  // What I did, in the same shape, so the two changes can be told apart.
  const localPrefix = commonPrefixLength(base, mine);
  const localSuffix = commonSuffixLength(base, mine, localPrefix);
  const localStart = localPrefix;
  const localEnd = base.length - localSuffix;
  const localShift = mine.length - base.length;

  if (end <= localStart) {
    // Their change is behind everything I touched, so it transfers straight across:
    // up to their change my text is the shared text, character for character.
    const text = mine.slice(0, start) + inserted + mine.slice(end);
    return { text, caret: caretAfterChange(caret, start, shift, text.length), changed: true };
  }

  if (start >= localEnd) {
    // Their change is ahead of my typing: move its position across my edit and apply it.
    const at = start + localShift;
    const text = mine.slice(0, at) + inserted + mine.slice(at + (end - start));
    return { text, caret: caretAfterChange(caret, at, shift, text.length), changed: true };
  }

  // We changed the same stretch. Keep everything: put their version in, take nothing out.
  const at = Math.min(start, mine.length);
  const text = mine.slice(0, at) + inserted + mine.slice(at);
  return { text, caret: caretAfterChange(caret, at, inserted.length, text.length), changed: true };
}

/** Where the caret ends up after a change of `shift` characters at `at`. */
function caretAfterChange(caret: number, at: number, shift: number, length: number): number {
  const moved = caret >= at ? caret + shift : caret;
  return Math.max(0, Math.min(length, moved));
}

/**
 * True when the character counter should be shown, i.e. when
 * `STICKY_COUNTER_THRESHOLD_CHARS` or fewer characters remain.
 */
export function counterVisible(length: number): boolean {
  const remaining = STICKY_TEXT_MAX_CHARS - (Number.isFinite(length) ? length : 0);
  return remaining <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Largest integer font size, in `[STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX]`, at
 * which the element's content fits in `box` pixels (`scrollHeight <= box`),
 * found by binary search. When even the smallest size does not fit, `overflow`
 * is true: the caller keeps the font at the minimum, clips the text inside the
 * note and shows a fade at the bottom edge.
 *
 * The element's `font-size` style is left at the returned size.
 */
export function fitFontSize(el: HTMLElement, box: number): { fontPx: number; overflow: boolean } {
  // Each probe forces a layout, so the search does at most log2(range) of them.
  const fits = (size: number): boolean => {
    el.style.fontSize = `${size}px`;
    return el.scrollHeight <= box;
  };

  if (!Number.isFinite(box) || box <= 0) {
    // No layout information (e.g. jsdom): keep the largest size.
    el.style.fontSize = `${STICKY_FONT_MAX_PX}px`;
    return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  }
  if (fits(STICKY_FONT_MAX_PX)) return { fontPx: STICKY_FONT_MAX_PX, overflow: false };
  if (!fits(STICKY_FONT_MIN_PX)) {
    el.style.fontSize = `${STICKY_FONT_MIN_PX}px`;
    return { fontPx: STICKY_FONT_MIN_PX, overflow: true };
  }
  // The minimum fits and the maximum does not: binary-search between them.
  let lo = STICKY_FONT_MIN_PX; // fits
  let hi = STICKY_FONT_MAX_PX; // does not fit
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  el.style.fontSize = `${lo}px`;
  return { fontPx: lo, overflow: false };
}
