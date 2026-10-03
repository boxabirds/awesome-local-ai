// Who owns the keyboard: a text field, or the board (stories 7-10).
//
// Two window-level listeners sit on the board — the selection commands (story 7) and
// the tool shortcuts (stories 9 and 10). Both have to answer the same question before
// they act, and they have to answer it the same way: *is this keystroke somebody's
// text?* If one hook guessed yes and the other guessed no, typing the word "save"
// into a shape label would colour a shape, switch a tool and delete a note, one
// letter at a time. So the answer lives here, once, with the memory that makes it
// right.
//
// Two rules, both learned the hard way:
//
//  * A focused field owns the keyboard. A key that falls on an `<input>`, a
//    `<textarea>` or a contenteditable — including the shape label editor — is a
//    character, not a command.
//  * A burst of typing keeps owning the letters for a moment after the field goes
//    away. That happens for real: someone else deletes the note this person is
//    typing into (story 2), the browser hands the rest of the keystrokes to a board
//    with focus on nothing, and those characters are still this person's text. The
//    timestamp is module state on purpose — the two hooks must never disagree about
//    it, and one browser tab is one copy of this module.
//
// The window is short — a quarter of a second — because it is a hedge, not a lock. A
// person who leaves an editor and presses a tool letter 300ms later gets their tool;
// one who is still mid-word, with the field gone from under their hands, does not have
// their sentence turned into commands.
//
// Chords are deliberately not text: Ctrl/Cmd+Z, Ctrl/Cmd+A and Ctrl/Cmd+D are this
// app's own shortcuts, and a person presses them the moment after they stop typing.

import { useLayoutEffect, useRef } from 'react';

/** How long a burst of typing keeps owning the letter keys. */
export const TYPING_BURST_MS = 250;

/** When a text field last swallowed a character keystroke (see `typingOwnsKeys`). */
let lastCharacterInField = 0;

/** True when focus is in a field that owns the keyboard. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable === true;
}

/** A key that writes a character (as opposed to Escape, an arrow, a chord, ...). */
export function isCharacterKey(key: string): boolean {
  return key.length === 1;
}

/**
 * A key that *inserts* text: a character key pressed without Ctrl/Cmd/Alt. Chords are
 * not text entry — Ctrl/Cmd+Z, Ctrl/Cmd+A and Ctrl/Cmd+D are this app's own shortcuts
 * (story 8's undo, select all, duplicate) and a person presses them the moment after
 * they stop typing, so they must keep working.
 */
export function isTypedCharacter(e: KeyboardEvent): boolean {
  return isCharacterKey(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey;
}

/**
 * Should this keystroke be left to the person's text? True when it lands on a field,
 * and for a short while afterwards when it is another character — the tail of a burst
 * whose field has gone. Calling it is also how the burst is remembered, so every
 * listener that asks the question keeps the answer up to date.
 */
export function typingOwnsKeys(e: KeyboardEvent): boolean {
  if (isEditableTarget(e.target)) {
    if (isTypedCharacter(e)) lastCharacterInField = Date.now();
    return true;
  }
  return (
    isTypedCharacter(e) && Date.now() - lastCharacterInField < TYPING_BURST_MS
  );
}

/**
 * The burst is over: whoever was typing is back on the board.
 *
 * Called by an editor when it is left *on purpose* — Escape pressed inside it, or a click
 * somewhere else — which is the difference between a person finishing an edit and a field
 * being deleted out from under their hands. The second case is what the burst is for, and
 * a field that is removed without a blur keeps its burst alive; the first case is a person
 * reaching for a tool, and making them wait a quarter of a second for the letter to work
 * would be a tax nobody asked for.
 */
export function endTypingBurst(): void {
  lastCharacterInField = 0;
}

/**
 * Forget the burst. Only for tests: a test that means to press a tool letter should
 * not be at the mercy of a character another test typed 100ms ago.
 */
export function resetTypingBurst(): void {
  endTypingBurst();
}

/**
 * A window keydown listener that never goes stale: `live.current` is reassigned on every
 * render, so the listener is bound once per mount and still reads the current tool,
 * selection and document. Both keyboard hooks are built with it.
 *
 * The listener is attached in a layout effect, before the board is painted, and not in a
 * plain effect after it. A board whose keyboard arrives some time after its picture is a
 * board that loses the first letter a person reaches for — they can see the toolbar, they
 * press S, and nothing happens, because the thing that answers letters has not been
 * listening yet. Nobody can win that race on purpose, least of all a test.
 */
export function useWindowKeyDown(
  handler: (e: KeyboardEvent) => void,
): { current: (e: KeyboardEvent) => void } {
  const live = useRef(handler);
  live.current = handler;

  useLayoutEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      live.current(e);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return live;
}