/**
 * Generalised board text editor (story 9, text.editing).
 *
 * A textarea that diffs into Y.Text. Shared by sticky notes (story 2) and
 * free text objects (story 9). Story 8 behaviour is preserved: boundary() on
 * edit start/end and Ctrl/Cmd+Z/Y intercepted so the native textarea undo
 * never diverges from Y.Text.
 *
 * The per-type concerns (font fit, character counter, padding, test ids) are
 * injected as options so sticky notes keep their exact behaviour.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { JSX } from 'react';
import * as Y from 'yjs';
import { clampToLimit, applyTextDiff } from '../../shared/text-edit';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import type { UndoController } from '../board/undo';

interface TextEditorProps {
  ytext: Y.Text;
  /** Maximum characters (clamped on input). */
  maxChars: number;
  /** Rendered font size in world units (px at 100% zoom). */
  fontPx: number;
  /** Text box width in world units, or 'auto' to fill the parent. */
  width: number | 'auto';
  /** Text alignment (shape labels are centred; default left). */
  textAlign?: 'left' | 'center';
  /** Vertical alignment inside the box (shape labels are centred). */
  verticalAlign?: 'top' | 'center';
  /** Padding inside the parent (world units). */
  padding?: number;
  /** Accessible label for the textarea. */
  ariaLabel?: string;
  /** Test id for the textarea. */
  testId?: string;
  /** Called after every committed input (box sync remeasures here). */
  onInput?(): void;
  /** Re-fit the textarea (sticky font fit; text objects ignore). */
  fit?(el: HTMLTextAreaElement): void;
  /** Footer content (sticky character counter). */
  footer?(length: number): JSX.Element | null;
  onEnd(next: 'selected' | 'unselected'): void;
  /** Undo controller for boundary() and Ctrl+Z handling (story 8). */
  undo?: UndoController;
}

export function TextEditor({
  ytext,
  maxChars,
  fontPx,
  width,
  textAlign = 'left',
  verticalAlign = 'top',
  padding = 0,
  ariaLabel = 'Text',
  testId = 'text-editor-textarea',
  onInput,
  fit,
  footer,
  onEnd,
  undo,
}: TextEditorProps): JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const [length, setLength] = useState(0);
  const undoRef = useRef(undo);
  undoRef.current = undo;
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;
  const fitRef = useRef(fit);
  fitRef.current = fit;

  // On mount: set value from Y.Text, focus, caret at end.
  // Story 8: boundary() on edit start.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const text = ytext.toString();
    ta.value = text;
    ta.focus();
    ta.setSelectionRange(text.length, text.length);
    setLength(text.length);
    fitRef.current?.(ta);

    // Story 8: boundary on edit start
    undoRef.current?.boundary();

    return () => {
      // Story 8: boundary on edit end (unmount)
      undoRef.current?.boundary();
    };
  }, [ytext]);

  // Listen for outside pointerdown to end editing
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      const ta = textareaRef.current;
      if (ta && !ta.contains(e.target as Node)) {
        onEndRef.current('unselected');
      }
    };
    // Use capture phase to catch before the object's handler
    document.addEventListener('pointerdown', handler, true);
    return () => document.removeEventListener('pointerdown', handler, true);
  }, []);

  const flushValue = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;

    let value = ta.value;

    // Clamp to limit
    if (value.length > maxChars) {
      value = clampToLimit(value, maxChars);
      ta.value = value;
      // Restore caret to end of kept text
      ta.setSelectionRange(value.length, value.length);
    }

    setLength(value.length);

    // Apply diff to Y.Text
    applyTextDiff(ytext, value, LOCAL_ORIGIN);

    // Re-fit (sticky) and notify (box sync)
    fitRef.current?.(ta);
    onInputRef.current?.();
  }, [ytext, maxChars]);

  const handleInput = useCallback(() => {
    if (composingRef.current) return;
    flushValue();
  }, [flushValue]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onEndRef.current('selected');
        return;
      }

      // Story 8: intercept Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z inside the editor
      // so native textarea undo never diverges from Y.Text.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        const ctrl = undoRef.current;
        if (!ctrl) return;
        if (e.shiftKey) {
          ctrl.redo();
        } else {
          ctrl.undo();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        undoRef.current?.redo();
        return;
      }

      // Enter inserts a newline (default textarea behaviour)
      // Delete/Backspace are handled naturally by the textarea
    },
    [],
  );

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false;
    flushValue();
  }, [flushValue]);

  const handleBlur = useCallback(() => {
    // Defensively flush any pending value
    const ta = textareaRef.current;
    if (!ta) return;
    const value = clampToLimit(ta.value, maxChars);
    if (value !== ytext.toString()) {
      applyTextDiff(ytext, value, LOCAL_ORIGIN);
      setLength(value.length);
    }
  }, [ytext, maxChars]);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: verticalAlign === 'center' ? 'center' : 'flex-start',
        padding,
      }}
    >
      <textarea
        ref={textareaRef}
        data-testid={testId}
        aria-label={ariaLabel}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onBlur={handleBlur}
        style={{
          flex: 1,
          width: '100%',
          resize: 'none',
          border: 'none',
          outline: 'none',
          background: 'transparent',
          fontFamily: 'inherit',
          fontSize: `${fontPx}px`,
          lineHeight: 1.3,
          overflow: 'hidden',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'break-word',
          color: '#333',
          textAlign,
        }}
      />
      {footer?.(length) ?? null}
    </div>
  );
}
