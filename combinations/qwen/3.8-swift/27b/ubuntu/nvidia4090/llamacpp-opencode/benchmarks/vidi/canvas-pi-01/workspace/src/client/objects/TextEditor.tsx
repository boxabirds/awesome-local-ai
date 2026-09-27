// Generalised text editor (see spec: text.object, generalised from
// sticky.text).
//
// A transparent textarea. Every `input` event is written to Y.Text
// immediately (minimal diff, clamped to maxChars), so ending editing performs
// no additional write — unmounting the textarea cannot lose characters.
// Enter inserts a newline; Escape ends as 'selected'; a pointer-down outside
// ends as 'unselected'. Ctrl/Cmd+Z is routed to this tab's undo controller
// so the browser's native textarea undo never diverges from the Y.Text.
//
// Sticky notes wrap this with auto-fit + fade/counter; text objects use a
// fixed font size (the size preset) and re-measure their box on input.

import { useCallback, useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import type { UndoController } from '../board/undo';
import { applyTextDiff, clampToLimit } from '../../shared/text-edit';
import { fitFontSize, shiftCaret } from './StickyText';

export interface TextEditorProps {
  ytext: Y.Text;
  maxChars: number;
  /** Initial font size in world units; the live font is `measured.fontPx`. */
  fontPx: number;
  /** 'auto' fills the parent (text object); a number is a fixed width. */
  width: number | 'auto';
  /** Called after each local input (text objects re-measure their box). */
  onInput?(): void;
  onEnd(next: 'selected' | 'unselected'): void;
  /** This tab's undo controller (story 8). */
  undo?: UndoController | null;
  /** When set, the font auto-fits to this box size (sticky notes). */
  autoFitBox?: number;
  ariaLabel: string;
  wrapperTestId?: string;
  wrapperClassName?: string;
  textareaClassName?: string;
  /** Sticky decorations (fade + counter), rendered after the textarea. */
  children?: (state: { value: string; overflow: boolean }) => ReactNode;
}

export function TextEditor({
  ytext,
  maxChars,
  fontPx,
  width,
  onInput,
  onEnd,
  undo,
  autoFitBox,
  ariaLabel,
  wrapperTestId,
  wrapperClassName,
  textareaClassName = 'text-editor-textarea',
  children,
}: TextEditorProps): JSX.Element {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const endedRef = useRef(false);
  const [value, setValue] = useState(() => ytext.toString());
  const [measured, setMeasured] = useState<{ fontPx: number; overflow: boolean }>({
    fontPx,
    overflow: false,
  });

  const finish = useCallback(
    (next: 'selected' | 'unselected') => {
      if (endedRef.current) return;
      endedRef.current = true;
      // Closing the capture window here keeps the typing burst separate from
      // whatever happens after the edit (a delete click, a drag, ...).
      undo?.boundary();
      onEnd(next);
    },
    [onEnd, undo],
  );

  // Start editing: close the capture window (this edit is a fresh step) and
  // focus with the caret at the end of the text.
  useEffect(() => {
    undo?.boundary();
    const ta = taRef.current;
    if (ta === null) return;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }, [undo]);

  // Font measurement: sticky auto-fits on mount and every text change (not
  // on zoom — font is in world units); text objects keep their preset size.
  useEffect(() => {
    const ta = taRef.current;
    if (ta === null || autoFitBox === undefined) return;
    setMeasured(fitFontSize(ta, autoFitBox));
  }, [value, autoFitBox]);

  // Keep the textarea in lockstep with REMOTE Y.Text changes so concurrent
  // typing merges instead of clobbering (spec: text.concurrent). Local edits
  // are skipped (already reflected in the textarea); the caret is preserved
  // by mapping it through the change list.
  useEffect(() => {
    const handler = (event: Y.YTextEvent, transaction: Y.Transaction) => {
      if (transaction.origin === LOCAL_ORIGIN) return;
      const ta = taRef.current;
      if (ta === null) return;
      if (composingRef.current) return; // flushed on compositionend
      const next = shiftCaret(event.changes.delta, ta.selectionStart, ta.selectionEnd);
      ta.value = ytext.toString();
      setValue(ta.value);
      ta.setSelectionRange(next.start, next.end);
    };
    ytext.observe(handler);
    return () => ytext.unobserve(handler);
  }, [ytext]);

  // A pointerdown anywhere outside this wrapper ends editing as 'unselected'.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const wrapper = wrapperRef.current;
      if (wrapper !== null && event.target instanceof Node && !wrapper.contains(event.target)) {
        finish('unselected');
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [finish]);

  const sync = useCallback(
    (raw: string) => {
      const clamped = clampToLimit(raw, maxChars);
      if (clamped !== raw) {
        // Restore the caret to the end of the kept text after truncation.
        const ta = taRef.current;
        if (ta !== null) {
          ta.value = clamped;
          ta.setSelectionRange(clamped.length, clamped.length);
        }
      }
      setValue(clamped);
      applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
      onInput?.();
    },
    [ytext, maxChars, onInput],
  );

  const handleInput = () => {
    if (composingRef.current) return; // IME: sync on compositionend instead.
    const ta = taRef.current;
    if (ta !== null) sync(ta.value);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      finish('selected');
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && undo != null) {
      const key = event.key.toLowerCase();
      if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) undo.redo();
        else undo.undo();
        return;
      }
      if (key === 'y') {
        event.preventDefault();
        undo.redo();
        return;
      }
    }
    // Enter inserts a newline (default textarea behaviour; not intercepted).
  };

  // Defensively flush a pending value on blur (normally a no-op: every input
  // event was already written to Y.Text).
  const handleBlur = () => {
    if (composingRef.current) return;
    const ta = taRef.current;
    if (ta !== null && ta.value !== ytext.toString()) sync(ta.value);
  };

  return (
    <div
      ref={wrapperRef}
      data-testid={wrapperTestId}
      className={wrapperClassName}
      style={{ position: 'absolute', inset: 0 }}
    >
      <textarea
        ref={taRef}
        className={textareaClassName}
        value={value}
        style={{
          position: 'absolute',
          inset: 0,
          width: width === 'auto' ? '100%' : width,
          height: '100%',
          fontSize: measured.fontPx,
          whiteSpace: 'pre-wrap',
          overflowWrap: 'break-word',
        }}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          handleInput();
        }}
        spellCheck={false}
        aria-label={ariaLabel}
      />
      {children?.({ value, overflow: measured.overflow })}
    </div>
  );
}
