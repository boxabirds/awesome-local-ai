import * as Y from 'yjs';

/**
 * Editing the text an object holds: the part of story 2's note text that was never about notes.
 *
 * The field a person types in is never the source of truth - the object's `Y.Text` is. Every
 * input event is turned into the *minimal* Yjs operation (common prefix and suffix kept), so
 * when two people type in one object (story 3) their keystrokes merge instead of overwriting each
 * other. A full replace would turn two concurrent keystrokes into two copies of the whole text.
 *
 * This lives in `shared` because both the objects that have text today - sticky notes and free
 * text - write theirs the same way, and because the limit differs by type: a note holds a
 * thousand characters and a piece of text five thousand, so the limit is an argument here and a
 * default in whichever object asks.
 */

/** Keep at most `max` characters.
 *
 * A cut that would land in the middle of an emoji drops the dangling high surrogate instead of
 * storing half a character. A limit of zero or less keeps nothing: an object cannot be given a
 * negative allowance, and an empty text is the honest answer rather than the input.
 */
export function clampToLimit(next: string, max: number): string {
  if (!(max > 0)) {
    return '';
  }
  if (next.length <= max) {
    return next;
  }
  const cut = next.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  const danglingSurrogate = last >= 0xd800 && last <= 0xdbff;
  return danglingSurrogate ? cut.slice(0, -1) : cut;
}

function isHighSurrogateAt(value: string, index: number): boolean {
  const code = value.charCodeAt(index);
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogateAt(value: string, index: number): boolean {
  const code = value.charCodeAt(index);
  return code >= 0xdc00 && code <= 0xdfff;
}

interface DiffRange {
  start: number;
  delete: number;
  insert: string;
}

/**
 * Common prefix and common suffix of two strings, as one delete plus one insert. Both
 * boundaries are moved off surrogate pairs, so an emoji is never deleted or inserted in halves
 * (the delta stays mergeable for the peer that receives it).
 */
function diffRange(current: string, next: string): DiffRange {
  const shared = Math.min(current.length, next.length);
  let prefix = 0;
  while (prefix < shared && current.charCodeAt(prefix) === next.charCodeAt(prefix)) {
    prefix += 1;
  }
  if (prefix > 0 && isHighSurrogateAt(current, prefix - 1)) {
    prefix -= 1;
  }

  let suffix = 0;
  const maxSuffix = shared - prefix;
  while (
    suffix < maxSuffix &&
    current.charCodeAt(current.length - suffix - 1) === next.charCodeAt(next.length - suffix - 1)
  ) {
    suffix += 1;
  }
  if (suffix > 0 && isLowSurrogateAt(current, current.length - suffix)) {
    suffix -= 1;
  }

  return {
    start: prefix,
    delete: current.length - prefix - suffix,
    insert: next.slice(prefix, next.length - suffix),
  };
}

/** One text turned into another: where it starts, how much goes, what comes instead. */
export interface TextEdit {
  start: number;
  removed: number;
  inserted: string;
}

/** The one delete-plus-insert that turns `from` into `to`. */
export function textEdit(from: string, to: string): TextEdit {
  const { start, delete: removed, insert: inserted } = diffRange(from, to);
  return { start, removed, inserted };
}

/**
 * Write `next` into `ytext` with the smallest insert/delete pair, in a single transaction tagged
 * with `origin` (story 8 groups undo by it, story 3 skips echoes). Writing the text it already
 * has emits nothing at all.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  // The whole-value write, which is what a keystroke looks like when nobody else is typing:
  // the baseline is the document, so the change can only be what `next` differs by.
  applyLocalEdit(ytext, ytext.toString(), next, origin);
}

/**
 * Write what this person changed - the difference between `baseline` and `next` - into the
 * object's text, in one transaction tagged with `origin`.
 *
 * `baseline` is the text this editor was looking at when the keystroke was taken. It is not the
 * same question as "what does the document hold now?": with one person typing either way is the
 * same, and with two a whole-value write eats the other person's letters. Two people append to an
 * empty text: the second one's field holds `b` and never saw the `a`, so the difference between
 * the document's `ab` and that value is a deletion of the `a`. The difference between `b` and the
 * empty text the keystroke was taken from can only say "b was added here", which is what this
 * writes, and both letters survive.
 */
export function applyLocalEdit(
  ytext: Y.Text,
  baseline: string,
  next: string,
  origin: unknown,
): void {
  const { start, removed, inserted } = textEdit(baseline, next);
  if (removed === 0 && inserted.length === 0) {
    return;
  }
  const write = (): void => {
    // Only what is actually there can be removed: this person's view and the document are
    // the same text, except for what this person did to it.
    const cut = Math.min(removed, Math.max(0, ytext.length - start));
    if (cut > 0) {
      ytext.delete(start, cut);
    }
    if (inserted.length > 0) {
      ytext.insert(start, inserted);
    }
  };
  const doc = ytext.doc;
  if (doc === null) {
    write();
    return;
  }
  doc.transact(write, origin);
}

/** One operation of a change to a text, as yjs reports it. */
export interface TextDeltaOp {
  retain?: number;
  insert?: string;
  delete?: number;
}

/**
 * The same place in a text, after a change: where a caret that was at `position` ends up once
 * the change has been applied. Text added in front of it pushes it along, text taken out in
 * front of it pulls it back, and a caret inside text that was taken out lands where the
 * replacement went in. Selections are collapsed to a caret, which is the most that can be said
 * about where the cursor belongs in text that grew underneath somebody typing in it.
 */
export function mapCaret(delta: readonly TextDeltaOp[], position: number): number {
  let oldIndex = 0; // characters of the text as it was, counted so far
  let newIndex = 0; // the same stretch, in the text as it is now
  for (const op of delta) {
    if (op.retain !== undefined) {
      if (position <= oldIndex + op.retain) {
        return newIndex + (position - oldIndex);
      }
      oldIndex += op.retain;
      newIndex += op.retain;
    } else if (op.insert !== undefined) {
      newIndex += op.insert.length;
    } else if (op.delete !== undefined) {
      if (position <= oldIndex) {
        return newIndex;
      }
      if (position >= oldIndex + op.delete) {
        oldIndex += op.delete;
        continue;
      }
      // The caret was inside what got taken out: it goes where the replacement went.
      return newIndex;
    }
  }
  return newIndex + (position - oldIndex);
}

/**
 * Put the characters that were added between `baseline` and `next` into the object's text, and
 * take nothing out.
 *
 * This is for text that was being composed - Japanese input, or anything else the browser is
 * still underlining - when somebody else's change arrived underneath it. What the composition
 * *added* is certainly this person's work and belongs in the text; what it looks like it
 * *removed* may perfectly well be text that arrived after the composition started, which this
 * person never had a chance to see, let alone delete.
 */
export function applyAddedText(
  ytext: Y.Text,
  baseline: string,
  next: string,
  origin: unknown,
): void {
  const { start, inserted } = textEdit(baseline, next);
  if (inserted.length === 0) {
    return;
  }
  const write = (): void => {
    ytext.insert(Math.min(start, ytext.length), inserted);
  };
  const doc = ytext.doc;
  if (doc === null) {
    write();
    return;
  }
  doc.transact(write, origin);
}
