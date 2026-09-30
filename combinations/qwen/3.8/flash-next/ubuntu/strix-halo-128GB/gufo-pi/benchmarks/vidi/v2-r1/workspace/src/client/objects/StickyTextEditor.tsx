import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, JSX } from 'react';
import type * as Y from 'yjs';

import { LOCAL_ORIGIN } from '../../shared/board-model';
import {
  STICKY_PADDING_WORLD,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';
import { applyTextDiff, clampToLimit, counterVisible, fitFontSize } from './StickyText';

/** The box note text is laid out in, in world units. */
export const STICKY_TEXT_BOX_WORLD = STICKY_SIZE_WORLD - STICKY_PADDING_WORLD * 2;

export interface StickyTextEditorProps {
  /** The shared text of the note being edited. */
  ytext: Y.Text;
  /** The size the display mode settled on; the starting point while typing. */
  fontPx: number;
  /** Escape ends editing with the note still selected, a click outside does not. */
  onEnd(next: 'selected' | 'unselected'): void;
  /** Called on mount (edit start) and on end to close undo capture windows. */
  undoBoundary?(): void;
  /** Undo controller for Ctrl+Z inside the textarea. */
  undoCtrl?: { undo(): boolean; redo(): boolean };
}

/**
 * The textarea a note shows while it is being edited.
 *
 * - On mount it takes the current text, focuses and puts the caret at the end,
 *   which is what "start editing" means for the user.
 * - Every `input` event is written to the shared text immediately (clamped to
 *   the limit, minimal diff), so ending editing - by Escape or by a click
 *   outside - never has to write anything and cannot lose characters.
 * - IME composition is left alone until `compositionend`, so an input method
 *   that types ahead (Japanese, Chinese) does not get its candidate text
 *   rewritten mid-composition.
 * - Enter inserts a newline; Escape leaves editing with the note selected.
 * - The font auto-fits as the text grows, and the character counter appears
 *   only when the remaining characters run out.
 */
export function StickyTextEditor({
  ytext,
  fontPx: initialFontPx,
  onEnd,
  undoBoundary,
  undoCtrl,
}: StickyTextEditorProps): JSX.Element {
  const elementRef = useRef<HTMLTextAreaElement | null>(null);
  const [fontPx, setFontPx] = useState(initialFontPx);
  const [overflow, setOverflow] = useState(false);
  const [length, setLength] = useState(() => ytext.toString().length);
  /** True between `compositionstart` and `compositionend` (IME input). */
  const composingRef = useRef(false);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  /** Push the textarea's value into the document and re-fit the text. */
  const flush = useCallback((): void => {
    const element = elementRef.current;
    if (!element) return;
    const raw = element.value;
    const kept = clampToLimit(raw);
    if (kept !== raw) {
      // Characters past the limit are not added at all; the caret goes back to
      // the end of what the note kept.
      element.value = kept;
      try {
        element.setSelectionRange(kept.length, kept.length);
      } catch {
        // A browser that will not move the caret does not change what is kept.
      }
    }
    applyTextDiff(ytext, kept, LOCAL_ORIGIN);
    setLength(kept.length);
    const fit = fitFontSize(element, STICKY_TEXT_BOX_WORLD);
    setFontPx(fit.fontPx);
    setOverflow(fit.overflow);
  }, [ytext]);

  // Start editing: value from the document, focus, caret at the end.
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    element.value = ytext.toString();
    setLength(element.value.length);
    element.focus();
    const end = element.value.length;
    try {
      element.setSelectionRange(end, end);
    } catch {
      // jsdom and detached elements can refuse caret work; nothing else depends
      // on it.
    }
    const fit = fitFontSize(element, STICKY_TEXT_BOX_WORLD);
    setFontPx(fit.fontPx);
    setOverflow(fit.overflow);
    // Close capture window at edit start so typing never merges with prior actions.
    undoBoundary?.();
  }, [ytext]);

  const handleInput = (): void => {
    // While an IME is composing, the value is not final yet; `compositionend`
    // flushes it.
    if (composingRef.current) return;
    flush();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    // Ctrl/Cmd+Z inside the textarea: undo via the controller, not the browser's native undo.
    if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      undoCtrl?.undo();
      return;
    }
    // Ctrl/Cmd+Shift+Z or Ctrl+Y: redo inside the textarea.
    if (
      ((event.ctrlKey || event.metaKey) && event.key === 'z' && event.shiftKey) ||
      (event.ctrlKey && event.key === 'y')
    ) {
      event.preventDefault();
      event.stopPropagation();
      undoCtrl?.redo();
      return;
    }
    if (event.key !== 'Escape') return;
    // Escape leaves editing and keeps the note selected; it must not reach the
    // window handler or scroll the page.
    event.preventDefault();
    event.stopPropagation();
    flush();
    // Close capture window at edit end so subsequent actions don't merge with typing.
    undoBoundary?.();
    onEndRef.current('selected');
  };

  return (
    <>
      <textarea
        ref={elementRef}
        className="sticky-note__editor"
        data-testid="sticky-editor"
        data-overflow={overflow ? 'true' : 'false'}
        aria-label="Sticky note text"
        defaultValue={ytext.toString()}
        style={{ fontSize: `${fontPx}px` }}
        onChange={handleInput}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          flush();
        }}
        onKeyDown={handleKeyDown}
        onPointerDown={(event) => {
          // A press inside the note belongs to the note: the board must neither
          // pan nor clear the selection.
          event.stopPropagation();
        }}
        onBlur={() => {
          // Defensive: everything is written on each input already, but a blur
          // that arrives with uncommitted text must not lose it.
          if (!composingRef.current) flush();
        }}
      />
      {counterVisible(length) ? (
        <div className="sticky-note__counter" data-testid="sticky-counter">
          {length}/{STICKY_TEXT_MAX_CHARS}
        </div>
      ) : null}
    </>
  );
}
