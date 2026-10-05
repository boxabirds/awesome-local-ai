/**
 * The textarea a piece of text is typed into — the one editor behind both object types.
 *
 * Story 2 grew this inside a sticky note, and story 9 is the second caller. It is one component rather
 * than two because everything hard about typing into a shared document is here, and none of it is about
 * what the text is drawn on:
 *
 *   - the cursor starts at the end of the text, and every keystroke is written to the `Y.Text` as it
 *     happens, so stopping performs no extra write;
 *   - characters past the limit are dropped as they are typed or pasted, and the caret goes with them;
 *   - Enter adds a line, Escape stops editing with the text kept;
 *   - the textarea is *uncontrolled*: the DOM holds what the user typed. That is what makes input method
 *     editors safe — while a composition is in flight nothing is written to the document, and the finished
 *     word arrives on `compositionend`, so nothing is ever doubled;
 *   - what anybody else typed arrives through an observer and is put in without moving this person's
 *     cursor (see `moveCaretThrough` in `StickyText.ts`);
 *   - Ctrl/Cmd+Z inside the field is answered by this person's undo history rather than by the browser's
 *     textarea history, which would undo the characters on the screen while the document still held them.
 *
 * What differs between the two objects is said in props, and it is a short list: how many characters are
 * accepted, whether the font shrinks to fit (`fitBox`, which a sticky note has and free text does not — a
 * heading is the size it was chosen to be), and what to be told after a local keystroke so the caller can
 * go and measure its box.
 *
 * `input` and `compositionend` are registered as real listeners rather than as React props: React routes
 * them through its change-event plugin, which keeps its own copy of the value and can swallow an event
 * whose value it has already seen — and this component writes the value itself when it clamps a paste.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX, KeyboardEvent, ReactNode, RefObject } from 'react';

import type * as Y from 'yjs';

import { LOCAL_ORIGIN } from '../../shared/board-model';
import { applyTextDiff, clampToLimit, counterVisible } from '../../shared/text-edit';
import type { UndoActions } from '../board/undo';
import { compositionInsertion, fitFontSize, moveCaretThrough } from './StickyText';
import type { Fit, FontBounds } from './StickyText';

export interface TextEditorProps {
  /** The object's text; every keystroke is diffed into it. */
  ytext: Y.Text;
  /** The most this field accepts. Handed in, because two objects have two limits. */
  maxChars: number;
  /** Font size to start at: for a note, the size it was fitted to; for text, the size it was chosen at. */
  fontPx: number;
  /**
   * Called after each *local* write with the text the field now holds.
   *
   * Local, and only local: this is the hook a caller uses to go and measure the box the words need, and a
   * measurement taken because a colleague typed would be a second answer to a question already answered —
   * one sync message per keystroke per client, each overwriting the last. Remote changes deliberately do
   * not call it.
   */
  onInput?(next: string): void;
  /**
   * Editing finished: Escape from the text, or a press outside the object. Either way the object is left
   * selected — the press that means otherwise is a selection action of its own, and says so.
   */
  onEnd(): void;
  /** Reported after each fitting so the caller can show its overflow fade. */
  onFit?(fit: Fit): void;
  /**
   * This person's undo history, in the form an editor may reach for.
   *
   * Two things are done with it, and both are about the fact that an object being typed in is a different
   * thing to undo from an object being moved: the edges of the edit are named, so that a burst of typing is
   * one step and never swallows the move that happened just before it; and Ctrl/Cmd+Z pressed inside this
   * text is answered here rather than left to the browser.
   */
  undo?: UndoActions;
  /**
   * How much room the words have, in CSS pixels, when the font is supposed to shrink to fit it. Left out
   * for a text object, whose font size is a thing the person picked from a toolbar and never a consequence
   * of how much they wrote.
   */
  fitBox?: number;
  /** How much a shrinking font may go down to; a note's by default. */
  fitBounds?: FontBounds;
  /** How close to `maxChars` the counter starts saying the number. */
  counterThreshold: number;
  /** Where the field's `data-testid` comes from, so two editors can be told apart in a test. */
  textareaTestId: string;
  counterTestId: string;
  ariaLabel: string;
  wrapperClassName: string;
  textareaClassName: string;
  counterClassName: string;
  /**
   * The editor's own `data-testid`. Handed in rather than fixed, because two editors on one board have to
   * be told apart by something, and story 2's tests already name the note's.
   */
  editorTestId?: string;
  /**
   * Something the caller wants drawn inside the editor box, next to the field.
   *
   * The editor has no use for it and no opinion about it: it is the hole a type can put its own controls in
   * so they sit with the text they belong to — a piece of text's size buttons are about *this* text, and
   * hanging them off the box they resize is what lets a person see which object they are working on.
   */
  toolbarSlot?: ReactNode;
}

export function TextEditor({
  ytext,
  maxChars,
  fontPx,
  onInput,
  onEnd,
  onFit,
  undo,
  fitBox,
  fitBounds,
  counterThreshold,
  textareaTestId,
  counterTestId,
  ariaLabel,
  wrapperClassName,
  textareaClassName,
  counterClassName,
  editorTestId,
  toolbarSlot,
}: TextEditorProps): JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const [fit, setFit] = useState<Fit>(() => ({ fontPx, overflow: false }));
  const [length, setLength] = useState(() => ytext.toString().length);
  // The object's text as this box last knew it. Every local keystroke is written through as it is typed,
  // so between changes the box and the document hold the same words, and this is what a change from
  // elsewhere is measured against.
  const synced = useRef<string>(ytext.toString());
  // Where the cursor stood when an input-method composition began, in the document's coordinates, and how
  // long its text was then. The box is the input method's while it works, so these two are what says where
  // the finished word belongs.
  const composeAt = useRef(0);
  const composeBase = useRef(0);

  // The undo history and the caller's measurement, read through refs rather than taken as effect
  // dependencies. Both props are new objects on every render of the board — a colleague typing in another
  // note is a render — and an effect that depended on them would close a capture window on every one of
  // those renders, which is precisely the bug that turns each keystroke into its own undo step. What the
  // editor owns is the *edit*, which begins and ends with this `ytext`, so that is what its effects are
  // keyed to.
  const undoRef = useRef<UndoActions | undefined>(undo);
  undoRef.current = undo;
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;

  /** Refit the box to whatever it now holds, or leave the font alone when there is nothing to fit into. */
  const remeasure = useCallback((): void => {
    const element = ref.current;
    if (!element) return;
    if (fitBox === undefined) return; // this object's font size is chosen, not fitted
    const measured = fitFontSize(element, fitBox, fitBounds);
    setFit((previous) =>
      previous.fontPx === measured.fontPx && previous.overflow === measured.overflow ? previous : measured,
    );
    onFit?.(measured);
  }, [fitBox, fitBounds, onFit]);

  /** Write the textarea's content into the object, then tell the caller what it now holds. */
  const commit = useCallback((): void => {
    const element = ref.current;
    if (!element) return;

    const kept = clampToLimit(element.value, maxChars);
    if (kept !== element.value) {
      // Past the limit nothing is added; the caret goes to the end of what was kept, so it never sits in
      // text that no longer exists.
      element.value = kept;
      element.setSelectionRange(kept.length, kept.length);
    }

    applyTextDiff(ytext, kept, LOCAL_ORIGIN);
    synced.current = ytext.toString();
    setLength(kept.length);
    remeasure();
    // After the write, so a caller that measures the text finds the text it is told about.
    onInputRef.current?.(kept);
  }, [ytext, maxChars, remeasure]);

  /**
   * What somebody else did to this text, shown as it happens.
   *
   * This is the half of live collaboration that takes place inside an object: the other person's characters
   * appear while you are typing, and your cursor goes with the text in front of it instead of jumping to
   * the end. Changes this box wrote itself are not seen here at all — they carry this box's own mark. Note
   * that this path never calls `onInput`: a colleague's keystroke is not a reason to go and measure a box
   * that has already been measured by the person who changed it.
   *
   * One thing waits: a change that arrives in the middle of a word being composed is not put into the box
   * until that word is finished, because a box rewritten mid-composition loses the word the input method is
   * building. Where the finished word belongs is worked out from the document, so it still lands where it
   * was started.
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
   * A finished composition, written into the object.
   *
   * Written in as the word on its own, not as a rewrite of the object's whole text: while the word was
   * being composed somebody else may have put their words in the same place, and this box has been showing
   * only this person's. Whatever the document holds stays; the word goes in where it was started.
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
    // The limit applies to a composition the same way it applies to a keystroke: characters past it are
    // dropped, not deferred.
    const insertable = added.slice(0, Math.max(0, maxChars - text.length));
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
    onInputRef.current?.(after);
  }, [ytext, maxChars, commit, remeasure]);

  // Mount: show the text with the cursor at its end and the focus, so an object created by a double-click,
  // the keyboard or the text tool accepts typing with no further click. The value is set here rather than as
  // a prop so the caret can be placed after the text is in the document.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    element.value = ytext.toString();
    synced.current = ytext.toString();
    setLength(element.value.length);
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
    remeasure();
    // Mount and object only: while editing, the textarea is the source of truth for what the person typing
    // has written, and re-running this per keystroke would move the caret out from under them. Changes from
    // elsewhere come in through the observer below, which is the one that knows how to keep a caret.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ytext]);

  // The two edges of an edit, named out loud.
  //
  // Without them, an object moved and then typed into within half a second would be one undo step, and one
  // press of Ctrl+Z would take the typing *and* the move. The end is the cleanup of this effect rather than
  // a call in the Escape handler, because an edit ends in more ways than one: Escape, a press outside the
  // object, the object being deleted from under the caret. They are all the same thing to the history — the
  // typing is over, and it is one step.
  useEffect(() => {
    undoRef.current?.boundary();
    return () => {
      undoRef.current?.boundary();
    };
  }, [ytext]);

  // What somebody else does to this text, as it happens.
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

  // The keyboard rules of the object are the textarea's own; see the header note for why input is not a
  // React prop.
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
    // well, so that after one press the object reads one thing and the history holds another.
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

  /**
   * The size the field is drawn at.
   *
   * Two answers, and which one applies is decided by whether there is a box to fit into. A note's text is
   * fitted to a fixed square, so the size on screen is whatever the fitting settled on and the caller's
   * number is only where the fitting started. A piece of free text is the size the person chose, so its
   * size *is* the prop — and follows it the moment the toolbar changes it, which is why this is not simply
   * the initial value kept in state. A heading moved from M to XL while being typed into has to get bigger
   * under the caret, in the same frame the button was pressed.
   */
  const renderedFontPx = fitBox === undefined ? fontPx : fit.fontPx;

  return (
    <div className={wrapperClassName} data-testid={editorTestId}>
      <textarea
        ref={ref}
        className={textareaClassName}
        data-testid={textareaTestId}
        aria-label={ariaLabel}
        spellCheck={false}
        style={{ fontSize: `${renderedFontPx}px` }}
        onKeyDown={handleKeyDown}
        onCompositionStart={() => {
          const element = ref.current;
          if (!element) return;
          composing.current = true;
          composeAt.current = element.selectionStart; // in the document's coordinates: the box is in step with it here
          composeBase.current = synced.current.length;
        }}
      />
      {counterVisible(length, maxChars, counterThreshold) ? (
        <span className={counterClassName} data-testid={counterTestId}>
          {length}/{maxChars}
        </span>
      ) : null}
      {toolbarSlot}
    </div>
  );
}

/**
 * Listens for typing on the textarea: `input` writes through, except while an input method is composing,
 * when the finished word is written in on `compositionend`. A blur flushes whatever is in the box, which is
 * a no-op in the normal case because every keystroke has already been written.
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
