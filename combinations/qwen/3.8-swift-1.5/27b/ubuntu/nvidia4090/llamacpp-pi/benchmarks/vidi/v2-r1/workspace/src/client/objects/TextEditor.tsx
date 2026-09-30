import { useRef, useEffect, useCallback } from 'react';
import type { JSX } from 'react';
import * as Y from 'yjs';
import { applyTextDiff, clampToLimit } from '@shared/text-edit';
import { TEXT_FONT_FAMILY } from '@shared/config';
import type { UndoController } from '@client/board/undo';

interface TextEditorProps {
  ytext: Y.Text;
  /** Character limit enforced on every input (PRD text.limit). */
  maxChars: number;
  /** Font size in world units for the textarea. */
  fontPx: number;
  /** Width of the textarea in world units, or 'auto' for 100%. */
  width: number | 'auto';
  /** Called after a local edit has been applied (for box re-measure). */
  onInput(): void;
  /** Called when editing ends. */
  onEnd(next: 'selected' | 'unselected'): void;
  /** Undo controller: boundary() on mount/unmount, undo()/redo() for keys. */
  undo: UndoController;
  /** aria-label for the textarea (accessibility, PRD text.a11y). */
  ariaLabel: string;
  /** data-testid for the textarea. */
  testId?: string;
  textAlign?: 'left' | 'center';
  /** Inner padding in world units. */
  padding?: number;
  /** Yjs origin for text diffs (undo tracking). */
  origin?: unknown;
}

/**
 * Story 9: the shared text editing surface.
 *
 * Generalised from the story 2 sticky editor (which wraps this component):
 *  - value is doc-driven (ytext.toString()), so concurrent remote typing
 *    is visible live (story 3) and the merged text is what gets re-measured.
 *  - Enter inserts a newline (no commit-on-Enter; PRD text.edit).
 *  - Escape ends editing, object stays selected.
 *  - Click outside ends editing; selection follows the click.
 *  - Minimal Y.Text diff (applyTextDiff) on every input, clamped to
 *    maxChars (PRD text.limit).
 *  - undo.boundary() on mount and unmount (story 8).
 */
export function TextEditor({
  ytext,
  maxChars,
  fontPx,
  width,
  onInput,
  onEnd,
  undo,
  ariaLabel,
  testId = 'text-editor',
  textAlign = 'left',
  padding = 0,
  origin = Symbol('text-editor'),
}: TextEditorProps): JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const undoRef = useRef(undo);
  undoRef.current = undo;
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;

  const value = ytext.toString();

  // Focus and place caret at end on mount; undo boundary (story 8).
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }
    undoRef.current.boundary();
    return () => {
      undoRef.current.boundary();
    };
  }, []);

  // Click outside the editor ends editing.
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      const target = e.target as Element | null;
      const onObject = !!(target && target.closest && target.closest('[data-note-id]'));
      onEndRef.current(onObject ? 'selected' : 'unselected');
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, []);

  const commit = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    let next = el.value;
    const clamped = clampToLimit(next, maxChars);
    if (clamped !== next) {
      next = clamped;
      el.value = next;
      el.setSelectionRange(next.length, next.length);
    }
    applyTextDiff(ytext, next, origin);
    onInputRef.current();
  }, [ytext, maxChars, origin]);

  const handleInput = useCallback(() => {
    if (composingRef.current) return;
    commit();
  }, [commit]);

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false;
    commit();
  }, [commit]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onEndRef.current('selected');
      return;
    }
    // Ctrl/Cmd+Z / Ctrl+Shift+Z / Ctrl+Y: undo/redo (story 8)
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) {
        undoRef.current.redo();
      } else {
        undoRef.current.undo();
      }
      return;
    }
    if (mod && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      e.stopPropagation();
      undoRef.current.redo();
    }
  }, []);

  const pad = padding ?? 0;
  const widthStyle = width === 'auto' ? '100%' : `${Math.max(width, 24)}px`;

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <textarea
        ref={textareaRef}
        data-testid={testId}
        aria-label={ariaLabel}
        value={value}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        spellCheck={false}
        style={{
          width: widthStyle,
          height: '100%',
          boxSizing: 'border-box',
          resize: 'none',
          border: 'none',
          outline: 'none',
          overflow: 'hidden',
          background: 'transparent',
          display: 'block',
          textAlign,
          fontSize: `${fontPx}px`,
          fontFamily: TEXT_FONT_FAMILY,
          lineHeight: 1.3,
          padding: `${pad}px`,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          color: '#333',
          cursor: 'text',
        }}
      />
    </div>
  );
}
