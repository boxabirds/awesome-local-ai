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
 * - Escape keeps the selection; a pointerdown outside the note drops it.
 * - Enter inserts a newline (the textarea's own behaviour).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';

import { LOCAL_ORIGIN } from '../../shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { applyTextDiff, clampToLimit, counterVisible, fitFontSize } from './StickyText';
import type { EndEditNext } from '../board/useSelection';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  /** Font size the note is rendered at, in world units. */
  fontPx: number;
  onEnd(next: EndEditNext): void;
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

export function StickyTextEditor({ ytext, fontPx, onEnd }: StickyTextEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [length, setLength] = useState(() => ytext.toString().length);
  const [size, setSize] = useState(fontPx);
  const [overflow, setOverflow] = useState(false);
  const composingRef = useRef(false);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  /** Write a textarea value into the document, keeping the caret in place. */
  const commit = useCallback((raw: string) => {
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
    setLength(value.length);
    if (element) {
      const fitted = fitFontSize(element, element.clientHeight);
      setSize(fitted.fontPx);
      setOverflow(fitted.overflow);
    }
  }, [ytext]);

  // Mount: the note's current text, focused, caret at the end (sticky.edit_start).
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    const value = ytext.toString();
    element.value = value;
    setLength(value.length);
    element.focus();
    placeCaret(element, value.length);
    const fitted = fitFontSize(element, element.clientHeight);
    setSize(fitted.fontPx);
    setOverflow(fitted.overflow);
  }, [ytext]);

  // A pointerdown outside the note ends editing; it never writes again.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const element = textareaRef.current;
      if (!element) return;
      if (noteAround(event.target) === noteAround(element)) return; // inside this note
      onEndRef.current('unselected');
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
          if (event.key !== 'Escape') return; // Enter belongs to the textarea
          event.preventDefault(); // the board must not react to it either
          event.stopPropagation();
          onEndRef.current('selected');
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
