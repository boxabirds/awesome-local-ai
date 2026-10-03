/**
 * Text editor for sticky notes. A textarea that diffs into Y.Text.
 * Story 8: calls boundary() on edit start/end and intercepts Ctrl/Cmd+Z
 * so the browser's native textarea undo never diverges from Y.Text.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { JSX } from 'react';
import * as Y from 'yjs';
import {
  clampToLimit,
  applyTextDiff,
  counterVisible,
  fitFontSize,
} from './StickyText';
import { STICKY_TEXT_MAX_CHARS, STICKY_FONT_MAX_PX, STICKY_FONT_MIN_PX } from '../../shared/config';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import type { UndoController } from '../board/undo';

interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  /** Text box width in world units (note width minus padding). */
  boxWidth?: number;
  /** Text box height in world units (note height minus padding). */
  boxHeight?: number;
  onEnd(next: 'selected' | 'unselected'): void;
  /** Undo controller for boundary() and Ctrl+Z handling (story 8). */
  undo?: UndoController;
}

/** Padding inside the note for text (world units). */
const PADDING = 16;

export function StickyTextEditor({ ytext, fontPx, boxWidth, boxHeight, onEnd, undo }: StickyTextEditorProps): JSX.Element {
  // Story 7: the note may be resized; the text box follows its size.
  const textBox = boxWidth ?? 168;
  const textBoxHeight = boxHeight ?? 168;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const [showCounter, setShowCounter] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const undoRef = useRef(undo);
  undoRef.current = undo;
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  // On mount: set value from Y.Text, focus, caret at end.
  // Story 8: boundary() on edit start.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const text = ytext.toString();
    ta.value = text;
    ta.focus();
    ta.setSelectionRange(text.length, text.length);
    setShowCounter(counterVisible(text.length));

    // Fit font on mount
    const { overflow: ovf } = fitFontSize(ta, textBoxHeight);
    setOverflow(ovf);

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
    // Use capture phase to catch before the note's handler
    document.addEventListener('pointerdown', handler, true);
    return () => document.removeEventListener('pointerdown', handler, true);
  }, []);

  const handleInput = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta || composingRef.current) return;

    let value = ta.value;

    // Clamp to limit
    if (value.length > STICKY_TEXT_MAX_CHARS) {
      value = clampToLimit(value);
      ta.value = value;
      // Restore caret to end of kept text
      ta.setSelectionRange(value.length, value.length);
    }

    setShowCounter(counterVisible(value.length));

    // Apply diff to Y.Text
    applyTextDiff(ytext, value, LOCAL_ORIGIN);

    // Re-fit font
    const { overflow: ovf } = fitFontSize(ta, textBoxHeight);
    setOverflow(ovf);
  }, [ytext]);

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
    handleInput();
  }, [handleInput]);

  const handleBlur = useCallback(() => {
    // Defensively flush any pending value
    const ta = textareaRef.current;
    if (!ta) return;
    const value = clampToLimit(ta.value);
    if (value !== ytext.toString()) {
      applyTextDiff(ytext, value, LOCAL_ORIGIN);
    }
  }, [ytext]);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        padding: PADDING,
      }}
    >
      <textarea
        ref={textareaRef}
        data-testid="sticky-textarea"
        aria-label="Sticky note text"
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
          wordBreak: 'break-word',
          color: '#333',
        }}
      />
      {showCounter && (
        <div
          data-testid="char-counter"
          style={{
            position: 'absolute',
            bottom: 4,
            right: 8,
            fontSize: 10,
            color: '#666',
            pointerEvents: 'none',
          }}
        >
          {STICKY_TEXT_MAX_CHARS}/{STICKY_TEXT_MAX_CHARS}
        </div>
      )}
    </div>
  );
}
