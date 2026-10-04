import { useEffect, useRef, useCallback, type JSX } from 'react';
import * as Y from 'yjs';
import { clampToLimit, applyTextDiff, counterVisible } from './StickyText';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import type { UndoController } from '../board/undo';

interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd: (next: 'selected' | 'unselected') => void;
  /** Per-user undo controller (story 8). */
  undo?: UndoController | null;
}

/**
 * Text editing component for a sticky note. Renders a textarea that syncs
 * with a Y.Text using minimal diffs.
 */
export function StickyTextEditor(props: StickyTextEditorProps): JSX.Element {
  const { ytext, fontPx, onEnd, undo } = props;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);

  // On mount: start a fresh undo step for the editing session (story 8),
  // set value from Y.Text, focus, caret at end.
  useEffect(() => {
    undo?.boundary();
    const ta = textareaRef.current;
    if (!ta) return;
    ta.value = ytext.toString();
    ta.focus();
    const len = ta.value.length;
    ta.setSelectionRange(len, len);
  }, [ytext, undo]);

  // Remote Y.Text changes → textarea, preserving the caret. Without this,
  // a peer's insert lands in Y.Text but not in the textarea; the next local
  // input would diff textarea-vs-Y.Text and delete the peer's characters.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const handler = (_ev: Y.YEvent<Y.Text>, tr: Y.Transaction) => {
      if (tr.origin === 'editor') return; // we already wrote this to the textarea
      const oldValue = ta.value;
      const newValue = ytext.toString();
      if (oldValue === newValue) return;
      const selStart = ta.selectionStart ?? oldValue.length;
      const selEnd = ta.selectionEnd ?? oldValue.length;
      // Map the caret across the change: keep a trailing caret at the end;
      // otherwise anchor on the common prefix and shift by the length delta.
      let prefix = 0;
      while (
        prefix < oldValue.length &&
        prefix < newValue.length &&
        oldValue[prefix] === newValue[prefix]
      ) {
        prefix++;
      }
      const delta = newValue.length - oldValue.length;
      const adj = (pos: number) =>
        pos <= prefix ? pos : Math.max(prefix, Math.min(newValue.length, pos + delta));
      ta.value = newValue;
      ta.setSelectionRange(adj(selStart), adj(selEnd));
    };
    ytext.observe(handler);
    return () => ytext.unobserve(handler);
  }, [ytext]);

  // End editing, closing the typing step first (story 8).
  const endEditing = useCallback(
    (next: 'selected' | 'unselected') => {
      undo?.boundary();
      onEnd(next);
    },
    [undo, onEnd],
  );

  // Handle pointerdown outside → end editing as unselected
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      const ta = textareaRef.current;
      if (ta && !ta.contains(e.target as Node)) {
        endEditing('unselected');
      }
    };
    document.addEventListener('pointerdown', handler, true);
    return () => document.removeEventListener('pointerdown', handler, true);
  }, [endEditing]);

  const handleInput = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (composingRef.current) return;

    let value = ta.value;
    const clamped = clampToLimit(value);
    if (clamped !== value) {
      // Truncated: restore caret to end of kept text
      ta.value = clamped;
      ta.setSelectionRange(clamped.length, clamped.length);
    }
    applyTextDiff(ytext, ta.value);
  }, [ytext]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Ctrl/Cmd+Z / Ctrl+Shift+Z / Ctrl+Y: undo/redo my changes (story 8).
      // Handled here while editing so typing steps are undone, not the
      // browser's native textarea undo.
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === 'z' || e.key === 'Z' || e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        e.stopPropagation();
        if (undo) {
          if (e.shiftKey || e.key === 'y' || e.key === 'Y') {
            undo.redo();
          } else {
            undo.undo();
          }
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        endEditing('selected');
      }
      // Enter inserts a newline (default textarea behaviour)
      // Delete/Backspace edit text (default textarea behaviour)
    },
    [undo, endEditing],
  );

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false;
    const ta = textareaRef.current;
    if (!ta) return;
    let value = ta.value;
    const clamped = clampToLimit(value);
    if (clamped !== value) {
      ta.value = clamped;
      ta.setSelectionRange(clamped.length, clamped.length);
    }
    applyTextDiff(ytext, ta.value);
  }, [ytext]);

  const handleBlur = useCallback(() => {
    // Defensively flush any pending value
    const ta = textareaRef.current;
    if (!ta) return;
    const current = ytext.toString();
    if (ta.value !== current) {
      const clamped = clampToLimit(ta.value);
      applyTextDiff(ytext, clamped);
    }
  }, [ytext]);

  const showCounter = counterVisible(ytext.length);

  return (
    <div style={editorContainerStyle} data-testid="sticky-text-editor">
      <textarea
        ref={textareaRef}
        data-testid="sticky-textarea"
        style={{
          ...editorTextareaStyle,
          fontSize: `${fontPx}px`,
        }}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onBlur={handleBlur}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />
      {showCounter && (
        <div
          data-testid="char-counter"
          style={{
            position: 'absolute',
            bottom: 2,
            right: 4,
            fontSize: '10px',
            color: 'rgba(0,0,0,0.5)',
            pointerEvents: 'none',
          }}
        >
          {ytext.length}/{STICKY_TEXT_MAX_CHARS}
        </div>
      )}
    </div>
  );
}

const editorContainerStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '12px',
};

const editorTextareaStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  border: 'none',
  outline: 'none',
  resize: 'none',
  background: 'transparent',
  textAlign: 'center',
  fontFamily: 'inherit',
  lineHeight: 1.3,
  overflow: 'hidden',
};
