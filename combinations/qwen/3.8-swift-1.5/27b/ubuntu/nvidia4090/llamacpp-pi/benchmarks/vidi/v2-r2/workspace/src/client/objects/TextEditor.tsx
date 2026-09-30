import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { applyTextDiff, clampToLimit } from '../../shared/text-edit';
import {
  TEXT_MAX_CHARS,
  STICKY_COUNTER_THRESHOLD_CHARS,
  TEXT_FONT_FAMILY,
} from '../../shared/config';

interface TextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  /** Hard character limit (default TEXT_MAX_CHARS). */
  maxChars?: number;
  /** Horizontal padding (world units) inside the editor. */
  padding?: number;
  lineHeight?: number;
  textAlign?: 'left' | 'center';
  fontFamily?: string;
  color?: string;
  testId?: string;
  ariaLabel?: string;
  /** Show the n/max counter near the limit. */
  showCounter?: boolean;
  /** Called after every local input is synced (drives box remeasure). */
  onInput(): void;
  onEnd(next: 'selected' | 'unselected'): void;
  /** Called on edit start and end to close the undo capture window. */
  boundary?: () => void;
  /** Undo controller for handling Ctrl/Cmd+Z inside the editor. */
  undoController?: { undo(): boolean };
}

/**
 * Generalized in-object text editor (story 9). Used by free text objects and
 * (via a thin wrapper) by sticky notes.
 *
 * - On mount: value from Y.Text, focused, caret at the end; boundary() closes
 *   any prior undo capture window (edit start = new step boundary).
 * - On `input` (skipped during IME composition; handled on `compositionend`):
 *   clamp to maxChars, restore the caret if truncated, apply the minimal diff
 *   to Y.Text, then call onInput() (which drives a box remeasure for text).
 * - Escape → onEnd('selected'). Pointerdown outside → onEnd('unselected').
 * - Enter inserts a new line (default textarea behaviour).
 */
export function TextEditor({
  ytext,
  fontPx,
  maxChars = TEXT_MAX_CHARS,
  padding = 0,
  lineHeight = 1.3,
  textAlign = 'left',
  fontFamily = TEXT_FONT_FAMILY,
  color = '#111827',
  testId = 'text-editor',
  ariaLabel = 'Text',
  showCounter = false,
  onInput,
  onEnd,
  boundary,
  undoController,
}: TextEditorProps): ReactElement {
  const ref = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;
  const boundaryRef = useRef(boundary);
  boundaryRef.current = boundary;
  const undoControllerRef = useRef(undoController);
  undoControllerRef.current = undoController;

  // Mount: focus, put the caret at the end of the text, and call boundary()
  // to close any prior capture window.
  useEffect(() => {
    boundaryRef.current?.();
    const el = ref.current;
    if (!el) return;
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
  }, []);

  // Merge remote updates into the textarea while editing (concurrent typing).
  useEffect(() => {
    const handler = (_event: unknown, transaction: { origin: unknown }) => {
      if (transaction.origin === LOCAL_ORIGIN) return;
      const el = ref.current;
      if (!el) return;
      const next = ytext.toString();
      if (el.value === next) return;
      const focused = document.activeElement === el;
      const oldLen = el.value.length;
      const caret = focused ? el.selectionStart : 0;
      const atEnd = focused && caret === oldLen;
      el.value = next;
      if (focused) {
        const target = atEnd
          ? next.length
          : Math.max(0, Math.min(next.length, next.length - (oldLen - caret)));
        el.setSelectionRange(target, target);
      }
    };
    ytext.observe(handler);
    return () => {
      ytext.unobserve(handler);
    };
  }, [ytext]);

  // A pointerdown anywhere outside the editor ends editing as unselected.
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      const el = ref.current;
      if (el && e.target instanceof Node && el.contains(e.target)) return;
      boundaryRef.current?.();
      onEndRef.current('unselected');
    };
    window.addEventListener('pointerdown', handler, true);
    return () => window.removeEventListener('pointerdown', handler, true);
  }, []);

  const syncToDoc = (el: HTMLTextAreaElement) => {
    let value = el.value;
    const clamped = clampToLimit(value, maxChars);
    if (clamped !== value) {
      value = clamped;
      el.value = value;
      el.setSelectionRange(value.length, value.length);
    }
    applyTextDiff(ytext, value, LOCAL_ORIGIN);
    onInputRef.current();
  };

  const handleInput = () => {
    const el = ref.current;
    if (!el || composingRef.current) return;
    syncToDoc(el);
  };

  const handleCompositionStart = () => {
    composingRef.current = true;
  };

  const handleCompositionEnd = () => {
    composingRef.current = false;
    const el = ref.current;
    if (!el) return;
    syncToDoc(el);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      boundaryRef.current?.();
      onEndRef.current('selected');
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
      e.preventDefault();
      undoControllerRef.current?.undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Z') {
      e.preventDefault();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
      e.preventDefault();
      return;
    }
  };

  const handleBlur = () => {
    const el = ref.current;
    if (el && !composingRef.current && el.value !== ytext.toString()) {
      syncToDoc(el);
    }
    boundaryRef.current?.();
  };

  const length = ytext.length;
  const counter = showCounter && maxChars - length <= STICKY_COUNTER_THRESHOLD_CHARS;

  return (
    <div style={{ position: 'absolute', inset: 0, userSelect: 'text' }}>
      <textarea
        ref={ref}
        data-testid={testId}
        aria-label={ariaLabel}
        defaultValue={ytext.toString()}
        spellCheck={false}
        onInput={handleInput}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          boxSizing: 'border-box',
          padding: `0 ${padding}px`,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          resize: 'none',
          overflow: 'hidden',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontFamily,
          fontSize: `${fontPx}px`,
          lineHeight,
          textAlign,
          color,
          cursor: 'text',
        }}
      />
      {counter && (
        <span
          data-testid={`${testId}-counter`}
          style={{
            position: 'absolute',
            right: 4,
            bottom: 2,
            fontSize: 10,
            color: 'rgba(0,0,0,0.55)',
            pointerEvents: 'none',
          }}
        >
          {length}/{maxChars}
        </span>
      )}
    </div>
  );
}
