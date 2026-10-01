import { useRef, useEffect, useState, type JSX } from 'react';
import type * as Y from 'yjs';
import { clampToLimit, applyTextDiff } from '../../shared/text-edit';
import { TEXT_LINE_HEIGHT, TEXT_FONT_FAMILY } from '../../shared/config';
import type { UndoController } from '../board/undo';

export interface TextEditorProps {
  ytext: Y.Text;
  /** Character limit applied on input (text.limit). */
  maxChars: number;
  /** Font size in world units (the parent layer applies the zoom scale). */
  fontPx: number;
  /** Textarea width: 'auto' fills the object box, or a fixed world width. */
  width: number | 'auto';
  /** Called after every local change (drives the box remeasure, text.sync). */
  onInput(): void;
  /** Escape → 'selected'; outside click / empty-delete → 'unselected'. */
  onEnd(next: 'selected' | 'unselected'): void;
  /** Per-user undo controller (story 8). */
  undo?: Pick<UndoController, 'boundary' | 'undo' | 'redo'>;
  /**
   * When set, a remaining-chars counter is shown within this threshold of
   * maxChars (story 2 sticky behaviour). Omit to hide it.
   */
  counterThreshold?: number;
  /** Horizontal padding in world units (matches the layout padding). */
  padding?: number;
  /** Vertical padding in world units (sticky notes keep story 2's 12px). */
  paddingVertical?: number;
  dataTestId?: string;
}

/**
 * Generalised from StickyTextEditor (story 2): a textarea bound to a Y.Text
 * with minimal diffs, clamping, IME composition support and per-user undo
 * shortcuts. The parent decides what ending the edit means (story 9: an
 * empty text object is removed, an empty sticky note is kept).
 */
export function TextEditor(props: TextEditorProps): JSX.Element {
  const { ytext, maxChars, fontPx, width, onInput, onEnd, undo, counterThreshold, padding = 0, paddingVertical = 0, dataTestId = 'text-editor' } = props;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(() => ytext.toString());
  const composingRef = useRef(false);

  // Ending the edit (any path) defers to the parent: the parent decides what
  // ending means (story 9 removes an empty text object INSIDE the typing
  // burst window so one undo restores the text) and then closes the capture
  // window with undo.boundary().
  const endEditing = (next: 'selected' | 'unselected') => {
    onEnd(next);
  };

  // On mount (edit start): close the current capture window so this typing
  // burst is its own undo step, then focus and set caret to end.
  useEffect(() => {
    undo?.boundary();
    const ta = textareaRef.current;
    if (ta) {
      ta.focus();
      const len = ta.value.length;
      ta.setSelectionRange(len, len);
    }
    // The editor remounts for every edit session, so a mount-only effect is
    // correct here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for outside pointerdown to end editing (closes the capture window)
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      const ta = textareaRef.current;
      if (ta && !ta.contains(e.target as Node)) {
        endEditing('unselected');
      }
    };
    window.addEventListener('pointerdown', handler);
    return () => window.removeEventListener('pointerdown', handler);
    // The editor remounts per edit session, so mount-time props are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleInput = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (composingRef.current) return;

    let next = ta.value;
    const clamped = clampToLimit(next, maxChars);
    if (clamped !== next) {
      next = clamped;
      ta.value = next;
      ta.setSelectionRange(next.length, next.length);
    }
    setValue(next);
    applyTextDiff(ytext, next, 'editor');
    onInput();
  };

  const insertAtCaret = (insert: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? value.length;
    const end = ta.selectionEnd ?? value.length;
    const next = value.slice(0, start) + insert + value.slice(end);
    const clamped = clampToLimit(next, maxChars);
    setValue(clamped);
    ta.value = clamped;
    const pos = Math.min(start + insert.length, clamped.length);
    ta.setSelectionRange(pos, pos);
    applyTextDiff(ytext, clamped, 'editor');
    onInput();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      endEditing('selected');
      return;
    }
    // Tab indents (story 9: Tab indents inside text objects)
    if (e.key === 'Tab') {
      e.preventDefault();
      insertAtCaret('  ');
      return;
    }
    // Delete/Backspace on empty content ends the edit; the parent removes an
    // empty text object (text.empty). Sticky notes keep their empty text.
    if ((e.key === 'Backspace' || e.key === 'Delete') && value === '') {
      e.preventDefault();
      endEditing('unselected');
      return;
    }
    // Story 8: Ctrl/Cmd+Z (and the redo variants) inside the editor drive the
    // per-user controller, not the browser's native textarea undo, so the two
    // can never diverge from the shared Y.Text.
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'z' || e.key === 'Z' || e.key === 'y' || e.key === 'Y')) {
      if (!undo) return;
      e.preventDefault();
      if (e.shiftKey) {
        undo.redo();
      } else {
        undo.undo();
      }
    }
  };

  const handleCompositionStart = () => {
    composingRef.current = true;
  };

  const handleCompositionEnd = () => {
    composingRef.current = false;
    handleInput();
  };

  const showCounter =
    counterThreshold != null && maxChars - value.length <= counterThreshold;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <textarea
        ref={textareaRef}
        data-testid={dataTestId}
        value={value}
        spellCheck={false}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        style={{
          width: width === 'auto' ? '100%' : `${width}px`,
          height: '100%',
          border: 'none',
          outline: 'none',
          resize: 'none',
          backgroundColor: 'transparent',
          fontSize: `${fontPx}px`,
          fontFamily: TEXT_FONT_FAMILY,
          lineHeight: TEXT_LINE_HEIGHT,
          padding: `${paddingVertical}px ${padding}px`,
          boxSizing: 'border-box',
          overflow: 'hidden',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      />
      {showCounter && (
        <div
          data-testid="char-counter"
          style={{
            position: 'absolute',
            bottom: 2,
            right: 4,
            fontSize: 10,
            color: '#666',
            pointerEvents: 'none',
          }}
        >
          {value.length}/{maxChars}
        </div>
      )}
    </div>
  );
}
