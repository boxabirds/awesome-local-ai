/**
 * The shared text editor for anything on the board that holds text (story 9,
 * design anchor `text.edit`).
 *
 * Story 2 grew this inside `StickyTextEditor.tsx`; story 9 needs the same
 * behaviour for a text object - write into the shared `Y.Text` as the characters
 * arrive, never lose what was typed, leave the browser's IME alone, take
 * Ctrl/Cmd+Z for the board's own history - so the rules live here once and
 * `StickyTextEditor` is a thin call into it with the sticky note's settings.
 *
 * What the caller decides, and this component does not care about:
 *
 * - `maxChars`     a note allows 1,000 characters, a text object 5,000
 * - `width`        a note is sized by its own box; a text object is only ever as
 *                  wide as its measured box, which is why the editor has to be
 *                  told - the wrapping the browser does and the wrapping
 *                  `layoutText` computed have to agree
 * - `onInput`      the text object remeasures its box after its own change; a
 *                  note's box never changes, so a note passes nothing
 * - `label`, `testId`, `className`, `ownerAttribute` the names in the interface,
 *                  which story 2's tests and CSS already fixed
 *
 * It is uncontrolled on purpose: the document, not React state, holds the text.
 * Every `input` is applied immediately as a minimal diff, so ending editing
 * performs no write at all and cannot lose text - Escape, a click outside, or the
 * object vanishing mid-edit all keep what the user typed.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { JSX } from 'react';

import * as Y from 'yjs';

import { LOCAL_ORIGIN } from '../../shared/board-model.js';
import type { UndoController } from '../board/undo.js';
import { applyTextDiff, clampToLimit } from '../../shared/text-edit.js';

/** How the editor finds the object it belongs to, for "clicked outside of it". */
export const TEXT_EDITOR_OWNER_ATTRIBUTE = 'data-text-object';

export interface TextEditorProps {
  /** The shared text of the object: every change is written straight into it. */
  ytext: Y.Text;
  /** The character limit of this object type (`STICKY_TEXT_MAX_CHARS`/`TEXT_MAX_CHARS`). */
  maxChars: number;
  /** Font size in board units; the world layer's scale turns it into pixels. */
  fontPx: number;
  /**
   * The width to wrap at, in board units, or `'auto'` to leave the width to the
   * object's own CSS. A text object passes its measured box, because a textarea
   * wider than the box would wrap somewhere the stored height says it does not.
   */
  width?: number | 'auto';
  /**
   * After a change *this tab* made - so the object can remeasure itself
   * (`useTextBoxSync`). Never called for somebody else's change: whose text it
   * is decides whose client measures it.
   */
  onInput?(): void;
  /** Escape (still selected) or a click outside (nothing selected). */
  onEnd(next: 'selected' | 'unselected'): void;
  /**
   * This tab's own undo history (story 8). Typing is the one place where the
   * browser would otherwise undo something the board has never heard of: a native
   * Ctrl/Cmd+Z rewinds the textarea on its own, and the textarea is uncontrolled,
   * so the document and what the person sees would part company. The editor takes
   * the shortcut and asks the board's history instead - which writes the shared
   * text, and the observer below redraws the textarea from it.
   *
   * Optional because a component test can mount an editor on its own; every board
   * has a history to hand.
   */
  undo?: UndoController;
  /** Accessible name of the textarea ('Sticky note text', 'Text'). */
  label: string;
  /** `data-testid`, which the stories' tests already name. */
  testId: string;
  /** Style hook, so the object type's own CSS sizes the textarea. */
  className: string;
  /** The attribute of the enclosing object element (see above). */
  ownerAttribute: string;
  /** Notes show "n/1000" near the limit; a text object's limit is not shown. */
  showCounter?: (length: number) => boolean;
}

/** Clamp, write the difference into the shared text, and redraw the counter. */
export function TextEditor({
  ytext,
  maxChars,
  fontPx,
  width = 'auto',
  onInput,
  onEnd,
  undo,
  label,
  testId,
  className,
  ownerAttribute,
  showCounter,
}: TextEditorProps): JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const ytextRef = useRef(ytext);
  ytextRef.current = ytext;
  const undoRef = useRef(undo);
  undoRef.current = undo;
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;

  const [length, setLength] = useState<number>(() => ytext.toString().length);

  /** Clamp the textarea's own value and write it into the shared text. */
  const commit = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    const kept = clampToLimit(el.value, maxChars);
    if (kept !== el.value) {
      // Characters beyond the limit are dropped and the caret stays at the end
      // of the text that was kept (text.limit).
      const caret = Math.min(kept.length, el.selectionStart);
      el.value = kept;
      el.setSelectionRange(caret, caret);
    }
    const before = ytextRef.current.toString();
    applyTextDiff(ytextRef.current, el.value, LOCAL_ORIGIN);
    setLength((previous) => (previous === el.value.length ? previous : el.value.length));
    // The object is allowed to react to a change of its own text - a text object
    // measures its box here. Only when the text actually moved, so a blur that
    // changed nothing does not cost a measurement and a write.
    if (ytextRef.current.toString() !== before) onInputRef.current?.();
  }, [maxChars]);

  const handleInput = useCallback(() => {
    // During IME composition the textarea holds the in-progress text; the real
    // characters arrive with compositionend.
    if (composingRef.current) return;
    commit();
  }, [commit]);

  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false;
    commit();
  }, [commit]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      // Escape ends editing and keeps the object selected; the text is already in
      // the document, so there is nothing else to do.
      event.preventDefault();
      onEndRef.current('selected');
      return;
    }
    // Enter is left alone: the textarea inserts a new line (PRD behaviour).
    //
    // Ctrl/Cmd+Z and its redo counterparts belong to the board's history here,
    // not to the textarea - the same rule as everywhere else on the board: a
    // pause of half a second or more ends a step (`undo.typing`), which is the
    // capture window this editor opens at its start and closes at its end.
    const mod = event.metaKey || event.ctrlKey;
    if (mod && !event.altKey && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) undoRef.current?.redo();
      else undoRef.current?.undo();
    } else if (
      event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === 'y'
    ) {
      event.preventDefault();
      undoRef.current?.redo();
    }
  }, []);

  // Put the caret at the end of the existing text as soon as the editor is
  // mounted ("the cursor at the end of its text"), and focus so the very next
  // keystroke lands in the object - which is what makes a click-then-type flow
  // work without another click.
  //
  // The same two moments close and open the undo capture window: starting to edit
  // is the start of a step, and stopping - by Escape, by a click outside, by the
  // object vanishing mid-edit - is its end.
  useLayoutEffect(() => {
    undoRef.current?.boundary();
    const el = textareaRef.current;
    if (!el) return () => undoRef.current?.boundary();
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
    return () => undoRef.current?.boundary();
  }, []);

  // A pointerdown anywhere outside the object ends editing and clears the
  // selection. Capture phase, because the board and the objects stop pointer
  // propagation.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const el = textareaRef.current;
      const owner = el?.closest(`[${ownerAttribute}]`);
      const target = event.target as Node | null;
      if (!owner || !target) return;
      if (owner.contains(target)) return;
      onEndRef.current('unselected');
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [ownerAttribute]);

  // Somebody else's change (story 3) arrives in the shared text: show it, unless
  // it is the change we have just written ourselves.
  useEffect(() => {
    const observer = (event: Y.YTextEvent) => {
      if (event.transaction.origin === LOCAL_ORIGIN) return;
      const el = textareaRef.current;
      if (!el) return;
      const next = ytextRef.current.toString();
      if (el.value === next) return;
      // A caret that was at the end of the text stays at the end. Two people
      // typing into the same object both add to the end, each in their own order;
      // leaving the caret where it was would drop the next keystroke *between* the
      // characters this person has already typed and scramble the word.
      const caretWasAtEnd = el.selectionStart >= el.value.length;
      const caret = caretWasAtEnd ? next.length : Math.min(next.length, el.selectionStart);
      el.value = next;
      el.setSelectionRange(caret, caret);
      setLength(next.length);
      // And this client does *not* remeasure: whoever changed the text measured it.
    };
    ytextRef.current.observe(observer);
    return () => ytextRef.current.unobserve(observer);
  }, []);

  const showCounterNow = showCounter?.(length) ?? false;

  return (
    <>
      <textarea
        ref={textareaRef}
        className={className}
        data-testid={testId}
        aria-label={label}
        defaultValue={ytext.toString()}
        style={{
          fontSize: `${fontPx}px`,
          ...(typeof width === 'number' ? { width: `${width}px` } : null),
        }}
        spellCheck={false}
        autoComplete="off"
        onInput={handleInput}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={handleKeyDown}
        // Ending editing writes nothing extra; this only picks up a value the
        // browser changed without an input event we could see.
        onBlur={commit}
        onPointerDown={(event) => event.stopPropagation()}
      />
      {showCounterNow ? (
        <span
          className="sticky-counter"
          data-testid="sticky-counter"
          data-remaining={maxChars - length}
        >{`${length}/${maxChars}`}</span>
      ) : null}
    </>
  );
}
