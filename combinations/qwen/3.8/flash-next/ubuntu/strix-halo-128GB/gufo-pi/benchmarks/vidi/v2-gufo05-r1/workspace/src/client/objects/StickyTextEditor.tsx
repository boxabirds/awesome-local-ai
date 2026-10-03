/**
 * The text editor of a sticky note: a textarea whose contents are diffed into
 * the note's `Y.Text` on every keystroke.
 *
 * - The value lives in the DOM, not in React state, so an IME composition is
 *   never interrupted by a re-render; the change is applied on `input` (and on
 *   `compositionend`, where the composed text is finally complete).
 * - Each accepted change is clamped to STICKY_TEXT_MAX_CHARS: characters past
 *   the limit are dropped and the caret is restored to the end of the kept text.
 * - Each accepted change is one small transaction on the shared document
 *   (`applyTextDiff`), which is why leaving the editor writes nothing.
 * - Text that arrives while the note is open is written into the field, with the
 *   caret moved along rather than dropped at the start. Two people typing in one
 *   note needs this: the field always holds the text the document has plus whatever
 *   was typed into it since, so a commit describes a local edit instead of
 *   overwriting somebody else's characters.
 * - Escape keeps the selection; a pointerdown outside the note drops it.
 * - Enter inserts a newline (the textarea's own behaviour).
 * - Undo and redo are the board's, not the field's (`undo.typing`): the browser's own
 *   history lives in the field and knows nothing about the shared document, so letting it
 *   answer Ctrl+Z would show this person a text that nobody else has. The keys are taken
 *   over and handed to the controller instead.
 * - Opening a note and leaving it are step boundaries, so typing into a note is never
 *   merged with the gesture before it, and consecutive keystrokes stay one step until the
 *   person pauses for UNDO_CAPTURE_TIMEOUT_MS.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';

import { LOCAL_ORIGIN } from '../../shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { undoGesture, type UndoController } from '../board/undo';
import { applyTextDiff, clampToLimit, counterVisible, fitFontSize, shiftCaret } from './StickyText';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  /** Font size the note is rendered at, in world units. */
  fontPx: number;
  /**
   * Leave editing. The selection is left alone: Escape keeps the note selected
   * (`sticky.text`), and clicking away is the board's own click, which clears it
   * (`sel.clear`).
   */
  onEnd(): void;
  /** This person's history: step boundaries around the edit, and Ctrl+Z inside it. */
  undo?: UndoController;
}

/** The note element this node sits inside, for the "clicked outside" test. */
function noteAround(node: EventTarget | null): Element | null {
  if (!(node instanceof Element)) return null;
  return node.closest('[data-sticky-note]');
}

/** Place the caret, where the engine allows it. */
function placeCaret(element: HTMLTextAreaElement, offset: number): void {
  try {
    element.setSelectionRange(offset, offset);
  } catch {
    // Engines without selection support keep the caret where it is.
  }
}

export function StickyTextEditor({ ytext, fontPx, onEnd, undo }: StickyTextEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [length, setLength] = useState(() => ytext.toString().length);
  const [size, setSize] = useState(fontPx);
  const [overflow, setOverflow] = useState(false);
  const composingRef = useRef(false);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const undoRef = useRef(undo);
  undoRef.current = undo;

  /**
   * The text this field and the document last agreed on.
   *
   * Keeping it is what makes two people typing in one note safe. Every keystroke
   * is committed straight away, so between keystrokes the field, the document and
   * this value all hold the same string; when somebody else's text arrives, it is
   * written into the field and this value moves with it. A commit is then always a
   * diff against the text it started from — a local edit — and never a diff
   * against a stale copy, which is how the other person's characters would go away.
   */
  const sharedValueRef = useRef<string>(ytext.toString());

  /** Write a textarea value into the document, keeping the caret in place. */
  const commit = useCallback(
    (raw: string) => {
      const element = textareaRef.current;
      const value = clampToLimit(raw);
      if (element && value !== raw) {
        // The characters past the limit never existed; keep the caret at the end
        // of what is really in the note.
        const caret = Math.min(element.selectionStart ?? value.length, value.length);
        element.value = value;
        placeCaret(element, caret);
      }
      applyTextDiff(ytext, value, LOCAL_ORIGIN);
      sharedValueRef.current = value;
      setLength(value.length);
      if (element) {
        const fitted = fitFontSize(element, element.clientHeight);
        setSize(fitted.fontPx);
        setOverflow(fitted.overflow);
      }
    },
    [ytext],
  );

  // Somebody else's typing, arriving in the note being edited: it goes into the
  // field, because a note that shows one thing to each person is not a shared note.
  //
  // While an IME composition is running the field is left alone — replacing text a
  // person is in the middle of composing is worse than a short delay — and the
  // incoming text lands on the next commit instead.
  useEffect(() => {
    const onRemoteChange = (_event: Y.YEvent<Y.Text>, origin: unknown) => {
      if (origin === LOCAL_ORIGIN) return; // this field wrote it; it already has it
      const element = textareaRef.current;
      if (!element || composingRef.current) return;
      const next = ytext.toString();
      const previous = sharedValueRef.current;
      if (previous === next) return;
      const focused = document.activeElement === element;
      const caret = element.selectionStart ?? next.length;
      sharedValueRef.current = next;
      element.value = next;
      setLength(next.length);
      if (focused) placeCaret(element, shiftCaret(caret, previous, next));
      const fitted = fitFontSize(element, element.clientHeight);
      setSize(fitted.fontPx);
      setOverflow(fitted.overflow);
    };
    ytext.observe(onRemoteChange);
    return () => {
      ytext.unobserve(onRemoteChange);
    };
  }, [ytext]);

  // Mount: the note's current text, focused, caret at the end (sticky.edit_start).
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    const value = ytext.toString();
    sharedValueRef.current = value;
    element.value = value;
    setLength(value.length);
    element.focus();
    placeCaret(element, value.length);
    const fitted = fitFontSize(element, element.clientHeight);
    setSize(fitted.fontPx);
    setOverflow(fitted.overflow);
  }, [ytext]);

  // Edit start and edit end are step boundaries (`undo.steps`): the first keystroke in a
  // note never merges into whatever was done before it was opened, and nothing typed here
  // merges into what is done after. Leaving is caught on unmount rather than in `onEnd`,
  // because a note can stop being edited in more ways than the ones that call `onEnd` —
  // for one, the person next door can delete the note being typed into.
  useEffect(() => {
    undoRef.current?.boundary();
    return () => {
      undoRef.current?.boundary();
    };
  }, []);

  // A pointerdown outside the note ends editing; it never writes again.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const element = textareaRef.current;
      if (!element) return;
      if (noteAround(event.target) === noteAround(element)) return; // inside this note
      onEndRef.current();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  return (
    <div className="sticky-note__editor" data-testid="sticky-note-editor">
      <textarea
        ref={textareaRef}
        className="sticky-note__textarea"
        data-testid="sticky-note-textarea"
        aria-label="Sticky note text"
        defaultValue=""
        spellCheck={false}
        style={{ fontSize: `${size}px` }}
        onChange={(event) => {
          if (composingRef.current) return; // applied on compositionend instead
          commit(event.currentTarget.value);
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={(event) => {
          composingRef.current = false;
          commit(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          const gesture = undoGesture(event);
          if (gesture !== null && undoRef.current) {
            // The field's own undo would change what this screen shows and nothing else,
            // and the next keystroke would then diff the document against a text the
            // field no longer holds. The controller's undo changes the document, and the
            // observer above writes the result back into this field.
            event.preventDefault();
            event.stopPropagation();
            if (gesture === 'redo') undoRef.current.redo();
            else undoRef.current.undo();
            return;
          }
          if (event.key !== 'Escape') return; // Enter belongs to the textarea
          event.preventDefault(); // the board must not react to it either
          event.stopPropagation();
          onEndRef.current();
        }}
        onBlur={() => {
          const element = textareaRef.current;
          if (element && !composingRef.current) commit(element.value);
        }}
      />
      {overflow ? (
        <div className="sticky-note__fade" data-testid="sticky-note-fade" aria-hidden="true" />
      ) : null}
      {counterVisible(length) ? (
        <div className="sticky-note__counter" data-testid="sticky-note-counter" aria-live="polite">
          {`${length}/${STICKY_TEXT_MAX_CHARS}`}
        </div>
      ) : null}
    </div>
  );
}
