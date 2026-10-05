/**
 * The textarea a sticky note is typed into.
 *
 * Everything the design asks of editing lives here: the cursor starts at the end
 * of the text, every keystroke is written to the note's `Y.Text` as it happens
 * (so stopping performs no extra write), characters past the limit are dropped
 * as they are typed or pasted, Enter adds a line, Escape stops editing with the
 * text kept, and the font shrinks to keep the text inside the note.
 *
 * The textarea is uncontrolled: the DOM holds what the user has typed. That is
 * what makes input method editors (Japanese input, emoji pickers) safe — while a
 * composition is in flight nothing is written to the document, and the finished
 * word arrives on `compositionend`, so nothing is ever doubled. Because the box
 * owns only what this person typed, what anybody else typed arrives through an
 * observer on the note's text and is put in without moving this person's cursor:
 * see `moveCaretThrough` for the cursor and `compositionInsertion` for a word
 * finished while somebody else was writing in the same note.
 *
 * `input` and `compositionend` are registered as real listeners rather than as
 * React props: React routes them through its change-event plugin, which keeps
 * its own copy of the value and can swallow an event whose value it has already
 * seen — and this component writes the value itself when it clamps a paste.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX, KeyboardEvent, RefObject } from 'react';

import type * as Y from 'yjs';

import { LOCAL_ORIGIN } from '../../shared/board-model';
import { STICKY_PADDING_WORLD, STICKY_SIZE_WORLD, STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import type { UndoActions } from '../board/undo';
import {
  applyTextDiff,
  clampToLimit,
  compositionInsertion,
  counterVisible,
  fitFontSize,
  moveCaretThrough,
} from './StickyText';
import type { Fit } from './StickyText';

/** Height available to the text inside a note, in board units. */
export const STICKY_TEXT_BOX = STICKY_SIZE_WORLD - STICKY_PADDING_WORLD * 2;

export interface StickyTextEditorProps {
  /** The note's text; every keystroke is diffed into it. */
  ytext: Y.Text;
  /** Font size to start at, measured while the note was not being edited. */
  fontPx: number;
  /**
   * Editing finished: Escape from the text, or a press outside the note. Either way the note is left
   * selected — the press that means otherwise is a selection action of its own, and says so.
   */
  onEnd(): void;
  /** Reported after each measurement so the note can show its overflow fade. */
  onFit?(fit: Fit): void;
  /**
   * This person's undo history, in the form a note may reach for.
   *
   * Two things are done with it, and both are about the fact that a note being typed in is a different
   * thing to undo from a note being moved: the edges of the edit are named, so that a burst of typing is
   * one step and never swallows the move that happened just before it; and Ctrl/Cmd+Z pressed inside this
   * text is answered here rather than left to the browser, whose own textarea history would undo the
   * characters on the screen while the document still held them — after which the note and the undo
   * button are disagreeing about what the board looks like.
   */
  undo?: UndoActions;
}

export function StickyTextEditor({
  ytext,
  fontPx,
  onEnd,
  onFit,
  undo,
}: StickyTextEditorProps): JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const [fit, setFit] = useState<Fit>(() => ({ fontPx, overflow: false }));
  const [length, setLength] = useState(() => ytext.toString().length);
  // The note's text as this box last knew it. Every local keystroke is written through
  // as it is typed, so between changes the box and the document hold the same words, and
  // this is what a change from elsewhere is measured against.
  const synced = useRef<string>(ytext.toString());
  // Where the cursor stood when an input-method composition began, in the document's
  // coordinates, and how long its text was then. The box is the input method's while it
  // works, so these two are what says where the finished word belongs.
  const composeAt = useRef(0);
  const composeBase = useRef(0);

  // The undo history, read through a ref rather than taken as an effect dependency. The prop is a new
  // object on every render of the board — a colleague typing in another note is a render — and an effect
  // that depended on it would close a capture window on every one of those renders, which is precisely
  // the bug that turns each keystroke into its own undo step. What the editor owns is the *edit*, which
  // begins and ends with this `ytext`, so that is what its effects are keyed to.
  const undoRef = useRef<UndoActions | undefined>(undo);
  undoRef.current = undo;

  /** Refits the box to whatever it now holds, and tells the note about the overflow. */
  const remeasure = useCallback((): void => {
    const element = ref.current;
    if (!element) return;
    const measured = fitFontSize(element, STICKY_TEXT_BOX);
    setFit((previous) =>
      previous.fontPx === measured.fontPx && previous.overflow === measured.overflow
        ? previous
        : measured,
    );
    onFit?.(measured);
  }, [onFit]);

  /** Write the textarea's content into the note, then measure it again. */
  const commit = useCallback((): void => {
    const element = ref.current;
    if (!element) return;

    const kept = clampToLimit(element.value);
    if (kept !== element.value) {
      // Past the limit nothing is added; the caret goes to the end of what the
      // note kept, so it never sits in text that no longer exists.
      element.value = kept;
      element.setSelectionRange(kept.length, kept.length);
    }

    applyTextDiff(ytext, kept, LOCAL_ORIGIN);
    synced.current = ytext.toString();
    setLength(kept.length);
    remeasure();
  }, [ytext, remeasure]);

  /**
   * What somebody else did to this note's text, shown as it happens.
   *
   * This is the half of live collaboration that takes place inside a note: the other
   * person's characters appear while you are typing, and your cursor goes with the text
   * in front of it instead of jumping to the end. Changes this box wrote itself are not
   * seen here at all — they carry this box's own mark.
   *
   * One thing waits: a change that arrives in the middle of a word being composed is not
   * put into the box until that word is finished, because a box rewritten mid-composition
   * loses the word the input method is building. The note is not readable while it is
   * being typed in anyway, so those are a few tenths of a second of not watching somebody
   * else's cursor; where the finished word belongs is worked out from the document, so it
   * still lands where it was started.
   */
  const showRemoteText = useCallback((): void => {
    const after = ytext.toString();
    const before = synced.current;
    if (before === after) return;
    synced.current = after;

    if (composing.current) {
      composeAt.current = moveCaretThrough(before, after, {
        start: composeAt.current,
        end: composeAt.current,
      }).start;
      return;
    }

    const element = ref.current;
    if (!element || element.value === after) return;

    const caret = moveCaretThrough(before, after, {
      start: element.selectionStart,
      end: element.selectionEnd,
    });
    element.value = after;
    element.setSelectionRange(caret.start, caret.end);
    setLength(after.length);
    remeasure();
  }, [ytext, remeasure]);

  /**
   * A finished composition, written into the note.
   *
   * Written in as the word on its own, not as a rewrite of the note's whole text: while
   * the word was being composed somebody else may have put their words in the same note,
   * and this box has been showing only this person's. Whatever the document holds stays;
   * the word goes in where it was started.
   */
  const flushComposition = useCallback((): void => {
    const element = ref.current;
    if (!element) return;
    composing.current = false;

    const added = compositionInsertion(element.value, composeBase.current, composeAt.current);
    if (added === null) {
      commit(); // the composition replaced text rather than adding any: nothing else to do
      return;
    }

    const text = synced.current;
    const at = Math.min(composeAt.current, text.length);
    // The limit applies to a composition the same way it applies to a keystroke:
    // characters past it are dropped, not deferred.
    const insertable = added.slice(0, Math.max(0, STICKY_TEXT_MAX_CHARS - text.length));
    const ydoc = ytext.doc;
    if (insertable !== '' && ydoc) {
      ydoc.transact(() => {
        ytext.insert(at, insertable);
      }, LOCAL_ORIGIN);
    }

    const after = ytext.toString();
    synced.current = after;
    element.value = after;
    const caret = at + insertable.length;
    element.setSelectionRange(caret, caret);
    setLength(after.length);
    remeasure();
  }, [ytext, commit, remeasure]);

  // Mount: show the note's text with the cursor at its end and the focus, so a
  // note created by a double-click or the toolbar accepts typing with no further
  // click. The value is set here rather than as a prop so the caret can be placed
  // after the text is in the document.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    element.value = ytext.toString();
    synced.current = ytext.toString();
    setLength(element.value.length);
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
    remeasure();
    // Mount and note only: while editing, the textarea is the source of truth for
    // what the person typing has written, and re-running this per keystroke would
    // move the caret out from under them. Changes from elsewhere come in through the
    // observer below, which is the one that knows how to keep a caret.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ytext]);

  // The two edges of an edit, named out loud.
  //
  // Without them, a note moved and then typed into within half a second would be one undo step, and one
  // press of Ctrl+Z would take the typing *and* the move — which is the failure this story is about, seen
  // from the inside of a note. The end is the cleanup of this effect rather than a call in the Escape
  // handler, because an edit ends in more ways than one: Escape, a press outside the note, the note
  // being deleted from under the caret. They are all the same thing to the history — the typing is over,
  // and it is one step.
  useEffect(() => {
    undoRef.current?.boundary();
    return () => {
      undoRef.current?.boundary();
    };
  }, [ytext]);

  // What somebody else does to this note's text, as it happens.
  useEffect(() => {
    const onRemote = (_event: unknown, transaction: Y.Transaction): void => {
      if (transaction.origin === LOCAL_ORIGIN) return; // this box wrote it; it is already shown
      showRemoteText();
    };
    ytext.observe(onRemote);
    return () => {
      ytext.unobserve(onRemote);
    };
  }, [ytext, showRemoteText]);

  // The keyboard rules of the note are the textarea's own; see the header note
  // for why input is not a React prop.
  useTyping(ref, commit, flushComposition, composing);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    // While an input method is at work the keys are its, not ours: a composition is one write when it is
    // finished, and an undo in the middle of one would be an undo of a word that does not exist yet.
    if (composing.current) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onEnd();
      return; // Enter adds a line: that is the default
    }

    // Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y inside this text are answered here, and the keystroke stops
    // with the answer. Left to travel, the window's own handler would undo the last step of *anything* —
    // usually the same one — and the browser's textarea history would undo the characters on the screen as
    // well, so that after one press the note reads one thing and the history holds another. Typing is
    // undone one burst at a time here, exactly as it is anywhere else on the board.
    const key = event.key.toLowerCase();
    const command = event.metaKey || event.ctrlKey;
    if (!command || event.altKey) return;
    if (key === 'y' && event.metaKey) return; // on macOS, Cmd+Y is a browser command, not redo
    if (key !== 'z' && key !== 'y') return;

    const redo = key === 'y' || event.shiftKey;
    event.preventDefault();
    event.stopPropagation();
    if (redo) undoRef.current?.redo();
    else undoRef.current?.undo();
  };

  return (
    <div className="sticky-note__editor">
      <textarea
        ref={ref}
        className="sticky-note__textarea"
        data-testid="sticky-textarea"
        aria-label="Sticky note text"
        spellCheck={false}
        style={{ fontSize: `${fit.fontPx}px` }}
        onKeyDown={handleKeyDown}
        onCompositionStart={() => {
          const element = ref.current;
          if (!element) return;
          composing.current = true;
          composeAt.current = element.selectionStart; // in the document's coordinates: the box is in step with it here
          composeBase.current = synced.current.length;
        }}
      />
      {counterVisible(length) ? (
        <span className="sticky-note__counter" data-testid="sticky-counter">
          {length}/{STICKY_TEXT_MAX_CHARS}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Listens for typing on the textarea: `input` writes through, except while an
 * input method is composing, when the finished word is written in on `compositionend`.
 * A blur flushes whatever is in the box, which is a no-op in the normal case because
 * every keystroke has already been written.
 */
function useTyping(
  ref: RefObject<HTMLTextAreaElement | null>,
  commit: () => void,
  flushComposition: () => void,
  composing: RefObject<boolean>,
): void {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const onInput = (): void => {
      if (composing.current) return; // the composition is not finished text yet
      commit();
    };
    const onCompositionEnd = (): void => {
      flushComposition();
    };
    const onBlur = (): void => {
      // The composition never survives losing focus either; flush it as text.
      if (composing.current) flushComposition();
      else commit();
    };

    element.addEventListener('input', onInput);
    element.addEventListener('compositionend', onCompositionEnd);
    element.addEventListener('blur', onBlur);
    return () => {
      element.removeEventListener('input', onInput);
      element.removeEventListener('compositionend', onCompositionEnd);
      element.removeEventListener('blur', onBlur);
    };
  }, [ref, commit, flushComposition, composing]);
}
