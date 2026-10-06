/**
 * The box a person types board text into — the same one for every type that has a text body.
 *
 * Story 2 wrote this for sticky notes and only for sticky notes. Story 9 needed the same box for a
 * text object, and the two are the same thing in every way that matters: uncontrolled, focused with
 * the caret at the end when it opens, minimal diff into the shared `Y.Text` on every keystroke, IME
 * composition left alone until it lands, somebody else's characters spliced in around the caret,
 * Escape and a click outside ending it, undo answered from the board's own history rather than the
 * browser's. Two copies of that would be two places to get an edge case wrong, so there is one file
 * and it is parameterised by the few things that differ between a note and a piece of text: how long
 * it may get, how big it is drawn, how wide it is, and what it is called.
 *
 * What stays outside, in the object that owns it: whether an object left empty is kept or thrown away
 * (a note keeps, a text object goes), and anything else that is a rule about the object rather than
 * about typing.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ChangeEvent, CompositionEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import type * as Y from 'yjs';

import { LOCAL_ORIGIN } from '../../shared/board-model';
import { applyTextDiff, clampToLimit, mergeRemoteText } from './StickyText';
import { isRedoChord, isUndoChord } from '../board/undo';
import type { UndoControls } from '../board/useUndo';

/** What the editor says about the object when it closes: is there something left to select? */
export type TextEditorExit = 'selected' | 'unselected';

export interface TextEditorProps {
  /** The shared text every input event is written straight into. */
  ytext: Y.Text;
  /** Longest the text may get, in characters; the extra characters are not added. */
  maxChars: number;
  /** Font size in world units — the size the object is drawn at, measured by its owner. */
  fontPx: number;
  /**
   * Width of the box in world units, or `'auto'` for a box that fills the object it is inside.
   *
   * A fixed-width text object is wrapped at its width, so the box being typed into has to be that
   * width too: typing at one width and watching the text re-wrap at another is a caret that jumps.
   */
  width: number | 'auto';
  /**
   * What to call this box for somebody who cannot see it: the accessible name of the textarea.
   */
  label?: string;
  /** Styles to draw the box with; the owner's class, so the owner stays in charge of how it looks. */
  className?: string;
  /**
   * Prefix of the test ids this box carries: `<testId>-editor` on the textarea, `<testId>-counter` on
   * the counter. The tests of the object being edited find its box by name, and a sticky note and a
   * text object on the same screen are two boxes that need telling apart.
   */
  testId?: string;
  /**
   * Characters remaining at which the counter appears. Left out, no counter is shown: a sticky note
   * says "980 / 1000" because a note that is nearly full looks full; a heading has nothing in the
   * product that counts down towards.
   */
  counterFrom?: number;
  /**
   * Called after every local change that reached the shared text, so the owner can keep whatever it
   * stores about the text up to date — a text object measures its own box here.
   */
  onInput?(): void;
  /**
   * Called exactly once when editing ends, with whether the object has anything left in it.
   *
   * It says nothing about what happens to the selection and does not need to: a press outside the
   * object closes this box and is the same press the board goes on to read as the selection it makes.
   */
  onEnd(next: TextEditorExit): void;
  /**
   * This person's undo history, for the chords pressed with the caret inside the text.
   *
   * A textarea is the one place on the board where Ctrl+Z cannot be answered from outside: the browser
   * undoes what is on screen and does not tell the document it did. So the chord is taken here, from
   * the keystroke, before the browser sees it, and answered from the board's own history.
   */
  undo?: UndoControls;
}

/** True when a key event target is a field the user is typing into. */
export function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT')
  );
}

/** The width of the box, in the one form CSS wants. */
const styleWidth = (width: number | 'auto'): string | undefined =>
  typeof width === 'number' && Number.isFinite(width) && width > 0 ? `${width}px` : undefined;

/**
 * The textarea shown while a text object or a sticky note is being edited.
 *
 * It is uncontrolled: on mount it takes the object's text, focuses itself and puts the caret at the end
 * (the "start editing" contract). Every input event is clamped to `maxChars` and written into the
 * `Y.Text` as a minimal diff, so ending editing performs no further write and all text typed so far is
 * kept. IME composition is skipped and handled on `compositionend`, so input methods never duplicate
 * characters.
 *
 * Two people can edit one object at once, so the box is kept up to date with the shared text as changes
 * arrive: what the box holds is always the shared text plus what has been typed here, which is what
 * makes the minimal diff describe one person's keystroke and nothing else.
 */
export function TextEditor(props: TextEditorProps): React.JSX.Element {
  const {
    ytext,
    maxChars,
    fontPx,
    width,
    label = 'Text',
    className = 'text-editor',
    testId = 'text',
    counterFrom,
    onInput,
    onEnd,
    undo,
  } = props;
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const endedRef = useRef(false);
  const [length, setLength] = useState(() => ytext.toString().length);
  /** The shared text as this box knows it: the base every local diff is taken against. */
  const remoteRef = useRef(ytext.toString());

  const undoRef = useRef(undo);
  undoRef.current = undo;
  const limit = Number.isFinite(maxChars) && maxChars > 0 ? Math.floor(maxChars) : 0;

  // Read from a ref, so a parent that passes a fresh function every render does not rebuild `commit`
  // (and with it the observer below) on every keystroke.
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;

  /**
   * Opening an object is the start of a step, and closing it is the end of one.
   *
   * A burst of typing is one thing a person did — the whole of it goes back under one press of undo —
   * and the pause that ends a burst is the history's own half a second, not something this box has to
   * know about. What it does have to say is where the burst begins and where it ends: the first line
   * below closes whatever step was still open when this object was opened (a drag that ended a moment
   * ago, a note typed into a moment ago), and the second closes this one, so that the next thing this
   * person does to the board is never counted as part of these words.
   *
   * The closing half runs on unmount rather than in `finish`, because there are ways of stopping to
   * edit an object that do not go through `finish` — somebody else deleted it, the board closed the
   * editor because the selection went away — and every one of them is still the end of a step.
   */
  useEffect(() => {
    undoRef.current?.boundary?.();
    return () => {
      undoRef.current?.boundary?.();
    };
  }, []);

  /**
   * Brings the box up to date with the shared text, keeping what was typed into it.
   *
   * The base is what the box was last in step with, so the change in between is the other person's and
   * can be spliced in around the local caret. Doing this before every write is also what keeps the
   * write honest: the diff handed to the shared text is then one person's keystroke, and never
   * somebody else's characters.
   */
  const mergeFromRemote = useCallback(
    (el: HTMLTextAreaElement): string => {
      const theirs = ytext.toString();
      const caret = Number.isFinite(el.selectionStart) ? (el.selectionStart as number) : el.value.length;
      const merged = mergeRemoteText(remoteRef.current, theirs, el.value, caret);
      remoteRef.current = theirs;
      if (!merged.changed) return el.value;
      el.value = merged.text;
      try {
        el.setSelectionRange(merged.caret, merged.caret);
      } catch {
        // jsdom with no selection support: the text alone is what matters.
      }
      setLength(clampToLimit(merged.text, limit).length);
      return merged.text;
    },
    [ytext, limit],
  );

  /**
   * Somebody else's typing shows up in this box while it is open, as it arrives.
   *
   * During an input method composition the box is left alone — replacing text mid-composition would
   * break what is being typed — and the change is merged in when the composition ends.
   */
  useEffect(() => {
    const onTextChange = (_event: unknown, transaction: Y.Transaction): void => {
      if (transaction.origin === LOCAL_ORIGIN) return;
      const el = ref.current;
      if (!el || endedRef.current || composingRef.current) return;
      mergeFromRemote(el);
    };
    ytext.observe(onTextChange);
    return () => ytext.unobserve(onTextChange);
  }, [ytext, mergeFromRemote]);

  /** Focus with the caret at the end of the text, once, on mount. */
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    try {
      el.setSelectionRange(end, end);
    } catch {
      // jsdom with no layout: focus alone is enough.
    }
  }, []);

  /** Writes a value into the shared text, clamped, and remembers its length. */
  const commit = useCallback(
    (raw: string) => {
      const clamped = clampToLimit(raw, limit);
      const el = ref.current;
      if (el && clamped !== raw) {
        // The browser already inserted the too-long characters: take them back and put the caret at
        // the end of the text that was kept.
        el.value = clamped;
        const end = clamped.length;
        try {
          el.setSelectionRange(end, end);
        } catch {
          // ignore: no selection support
        }
      }
      applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
      remoteRef.current = ytext.toString();
      setLength(clamped.length);
      // The owner stores whatever follows from the text being what it is now: a text object measures
      // its box here, in the same capture window as the keystroke, so undo takes both back at once.
      onInputRef.current?.();
      return clamped;
    },
    [ytext, limit],
  );

  /** Ends editing exactly once, flushing anything not written yet. */
  const finish = useCallback(() => {
    if (endedRef.current) return;
    endedRef.current = true;
    const el = ref.current;
    if (el) {
      mergeFromRemote(el);
      applyTextDiff(ytext, clampToLimit(el.value, limit), LOCAL_ORIGIN);
      remoteRef.current = ytext.toString();
    }
    // Empty or not: whether an object left empty stays on the board is its owner's rule, not this
    // box's, but the owner is not on screen when the object has been deleted from under the edit.
    onEnd(ytext.toString().length > 0 ? 'selected' : 'unselected');
  }, [mergeFromRemote, onEnd, ytext, limit]);

  // A pointerdown anywhere outside this object's box closes the editor. Capture phase, so that the
  // text is committed before the board does anything with the same press — and it does not stop that
  // press: the board sees it too, and reads it as the selection it is. That is why this file has no
  // opinion about what the selection becomes.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const el = ref.current;
      if (!el) return;
      // The object this box is inside: the textarea's own container, which is the object's element for
      // every type that opens an editor here.
      const owner = el.parentElement;
      const target = event.target;
      if (owner && target instanceof Node && owner.contains(target)) return;
      finish();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [finish]);

  const onInputEvent = (event: ChangeEvent<HTMLTextAreaElement>) => {
    if (composingRef.current) {
      // While composing, keep the counter honest but leave the text alone.
      setLength(event.target.value.length);
      return;
    }
    commit(event.target.value);
  };

  /** Whatever the box holds, with anybody else's changes folded in. */
  const currentValue = (): string => {
    const el = ref.current;
    return el ? mergeFromRemote(el) : '';
  };

  const onCompositionEnd = (event: CompositionEvent<HTMLTextAreaElement>) => {
    composingRef.current = false;
    // The composition has landed in the box; now the change held back during it can go in.
    if (ref.current) commit(currentValue());
    else if (event.target instanceof HTMLTextAreaElement) commit(event.target.value);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    // Undo and redo, taken out of the browser's hands before anything else is decided: see the note on
    // the prop. `isUndoChord`/`isRedoChord` are the same two questions the board's window listener
    // asks, so the chord means the same thing here as it does everywhere else on this board.
    if (isUndoChord(event) || isRedoChord(event)) {
      const history = undoRef.current;
      // No history of ours to consult (an object rendered outside a board): leave the key to the
      // browser, which is what it has always done with it.
      if (history === undefined) return;
      event.preventDefault();
      // Not `stopPropagation`: `preventDefault` alone is enough to keep the board's own window
      // listener off this chord, because that listener's first question is whether anybody has already
      // answered the key.
      if (isUndoChord(event)) history.undo();
      else history.redo();
      return;
    }
    // Only Escape is handled besides those: Enter inserts a newline, left to the browser.
    if (event.key === 'Escape') {
      // During an IME composition Escape belongs to the input method (it drops the candidate), so it
      // must not end editing.
      if (composingRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      finish();
    }
  };

  const onBlur = () => {
    const el = ref.current;
    if (el && !composingRef.current) commit(el.value);
  };

  const remaining = limit - length;
  const showCounter = counterFrom !== undefined && remaining <= counterFrom;

  return (
    <>
      <textarea
        aria-label={label}
        className={className}
        data-testid={`${testId}-editor`}
        defaultValue={ytext.toString()}
        ref={ref}
        spellCheck={false}
        style={{ fontSize: `${fontPx}px`, width: styleWidth(width) } as React.CSSProperties}
        onChange={onInputEvent}
        onCompositionEnd={onCompositionEnd}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
      />
      {showCounter ? (
        <span className="text-counter" data-testid={`${testId}-counter`}>
          {`${length} / ${limit}`}
        </span>
      ) : null}
    </>
  );
}
