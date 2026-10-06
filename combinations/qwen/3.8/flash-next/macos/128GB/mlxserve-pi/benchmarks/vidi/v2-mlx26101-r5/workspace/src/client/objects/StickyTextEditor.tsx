import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ChangeEvent, CompositionEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import type * as Y from 'yjs';

import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { applyTextDiff, clampToLimit, counterVisible, mergeRemoteText } from './StickyText';
import { isRedoChord, isUndoChord } from '../board/undo';
import type { UndoControls } from '../board/useUndo';

export interface StickyTextEditorProps {
  /** The note's shared text; every input event is written straight into it. */
  ytext: Y.Text;
  /** Current auto-fit font size, in world units (the parent measures it). */
  fontPx: number;
  /**
   * Called exactly once when editing ends. It says nothing about what happens to the selection, and
   * it does not need to: a press outside the note closes this editor and is the same press the board
   * goes on to read as "nothing is selected", and Escape is a key, which is not a press at all.
   */
  onEnd(): void;
  /**
   * This person's undo history, for the chords pressed with the caret inside the text.
   *
   * A textarea is the one place on the board where Ctrl+Z cannot be answered from outside: the
   * browser will undo what is on screen — the words this person has typed since they opened the note,
   * which are on screen and in the document at the same time — and it will not tell the document that
   * it did. So the chord is taken here, from the keystroke, before the browser sees it, and answered
   * from the board's own history, which is the only one that knows where this note was before the
   * typing started.
   *
   * Left out, Ctrl+Z in this box is the browser's own — which is the right answer for a note that was
   * opened empty and has had nothing typed into it since, and the wrong one everywhere else, which is
   * why a board that has a history always passes one down.
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

/**
 * The textarea shown while a sticky note is being edited.
 *
 * It is uncontrolled: on mount it takes the note's text, focuses itself and puts
 * the caret at the end (the "start editing" contract). Every `input` event is
 * clamped to `STICKY_TEXT_MAX_CHARS` and written into the `Y.Text` as a minimal
 * diff, so ending editing performs no further write and all text typed so far is
 * kept. IME composition is skipped and handled on `compositionend`, so input
 * methods never duplicate characters.
 *
 * Two people can edit one note at once, so the box is kept up to date with the
 * shared text as changes arrive (see `mergeFromRemote`): what the box holds is
 * always the shared text plus what has been typed here, which is what makes the
 * minimal diff above describe one person's keystroke and nothing else.
 */
export function StickyTextEditor({ ytext, fontPx, onEnd, undo }: StickyTextEditorProps): React.JSX.Element {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const endedRef = useRef(false);
  const [length, setLength] = useState(() => ytext.toString().length);
  /** The shared text as this box knows it: the base every local diff is taken against. */
  const remoteRef = useRef(ytext.toString());

  const undoRef = useRef(undo);
  undoRef.current = undo;

  /**
   * Opening a note is the start of a step, and closing it is the end of one.
   *
   * A burst of typing is one thing a person did — the whole of it goes back under one press of undo —
   * and the pause that ends a burst is the history's own half a second, not something this box has to
   * know about. What it does have to say is where the burst begins and where it ends: the first line
   * below closes whatever step was still open when this note was opened (a drag that ended a moment
   * ago, a note typed into a moment ago), and the second closes this one, so that the next thing this
   * person does to the board is never counted as part of these words.
   *
   * The closing half runs on unmount rather than in `finish`, because there are ways of stopping to
   * edit a note that do not go through `finish` — somebody else deleted the note, the board closed the
   * editor because the selection went away — and every one of them is still the end of a step.
   */
  useEffect(() => {
    undoRef.current?.boundary();
    return () => {
      undoRef.current?.boundary();
    };
  }, []);

  /**
   * Brings the box up to date with the shared text, keeping what was typed into it.
   *
   * The base is what the box was last in step with, so the change in between is the other
   * person's and can be spliced in around the local caret (`mergeRemoteText`). Doing this
   * before every write is also what keeps the write honest: the diff handed to the shared
   * text is then one person's keystroke, and never somebody else's characters.
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
      setLength(clampToLimit(merged.text).length);
      return merged.text;
    },
    [ytext],
  );

  /**
   * Somebody else's typing shows up in this box while it is open, as it arrives.
   *
   * During an input method composition the box is left alone — replacing text mid-composition
   * would break what is being typed — and the change is merged in when the composition ends.
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
      const clamped = clampToLimit(raw);
      const el = ref.current;
      if (el && clamped !== raw) {
        // The browser already inserted the too-long characters: take them back
        // and put the caret at the end of the text that was kept.
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
      return clamped;
    },
    [ytext],
  );

  /** Ends editing exactly once, flushing anything not written yet. */
  const finish = useCallback(
    () => {
      if (endedRef.current) return;
      endedRef.current = true;
      const el = ref.current;
      if (el) {
        mergeFromRemote(el);
        applyTextDiff(ytext, clampToLimit(el.value), LOCAL_ORIGIN);
        remoteRef.current = ytext.toString();
      }
      onEnd();
    },
    [mergeFromRemote, onEnd, ytext],
  );

  // A pointerdown anywhere outside this note's box closes the editor. Capture phase, so that the
  // text is committed before the board does anything with the same press — and it does not stop that
  // press: the board sees it too, and reads it as the selection it is. That is why this file has no
  // opinion about what the selection becomes.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const el = ref.current;
      if (!el) return;
      const note = el.closest('.sticky-note');
      const target = event.target;
      if (note && target instanceof Node && note.contains(target)) return;
      finish();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [finish]);

  const onInput = (event: ChangeEvent<HTMLTextAreaElement>) => {
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
    // Undo and redo, taken out of the browser's hands before anything else is decided: see the note
    // on the prop. `isUndoChord`/`isRedoChord` are the same two questions the board's window listener
    // asks, so the chord means the same thing here as it does everywhere else on this board.
    if (isUndoChord(event) || isRedoChord(event)) {
      const history = undoRef.current;
      // No history of ours to consult (a note rendered outside a board): leave the key to the browser,
      // which is what it has always done with it.
      if (history === undefined) return;
      event.preventDefault();
      // Not `stopPropagation`: `preventDefault` alone is enough to keep the board's own window
      // listener off this chord, because that listener's first question is whether anybody has already
      // answered the key. Stopping the propagation as well would take the keystroke away from anything
      // else on this note that might want it, which is a thing this file has no business deciding.
      if (isUndoChord(event)) history.undo();
      else history.redo();
      return;
    }
    // Only Escape is handled besides those: Enter inserts a newline, left to the browser.
    if (event.key === 'Escape') {
      // During an IME composition Escape belongs to the input method (it drops
      // the candidate), so it must not end editing.
      if (composingRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      finish();
    }
  };

  const onBlur = () => {
    const el = ref.current;
    if (el && !composingRef.current) {
      commit(el.value);
    }
  };

  return (
    <>
      <textarea
        aria-label="Sticky note text"
        className="sticky-editor"
        data-testid="sticky-editor"
        defaultValue={ytext.toString()}
        ref={ref}
        spellCheck={false}
        style={{ fontSize: `${fontPx}px` }}
        onChange={onInput}
        onCompositionEnd={onCompositionEnd}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
      />
      {counterVisible(length) ? (
        <span className="sticky-counter" data-testid="sticky-counter">
          {length} / {STICKY_TEXT_MAX_CHARS}
        </span>
      ) : null}
    </>
  );
}
