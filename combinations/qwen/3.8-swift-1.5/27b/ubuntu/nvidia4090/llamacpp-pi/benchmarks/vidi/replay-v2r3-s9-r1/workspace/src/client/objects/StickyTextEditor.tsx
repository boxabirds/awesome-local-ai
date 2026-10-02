import { useRef, useEffect, useState } from 'react';
import * as Y from 'yjs';
import { clampToLimit, applyTextDiff, counterVisible } from './StickyText';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import type { UndoController } from '../board/undo';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd: (next: 'selected' | 'unselected') => void;
  /** Per-client undo history (story 8): step boundaries + in-editor shortcuts. */
  undo: UndoController;
}

/**
 * The in-note text editor. A textarea diffed into the note's Y.Text.
 *
 * - On mount: value comes from the Y.Text, focus, caret at the end.
 * - On each `input` (after IME composition ends): clamp to the limit, restore
 *   the caret if truncated, and apply the minimal diff to the Y.Text.
 * - Escape → `onEnd('selected')`; a pointerdown outside the note →
 *   `onEnd('unselected')`. Every input is already written, so ending performs
 *   no extra write; `onBlur` flushes any pending value defensively.
 * - Enter inserts a new line (native textarea behaviour).
 * - A small `n/1000` counter shows when within the threshold of the limit.
 *
 * Story 8 (undo.boundaries, undo.shortcuts): the whole edit session is one
 * undo step (boundary on mount and on end), and Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z
 * / Ctrl/Cmd+Y inside the textarea undo/redo the local history without
 * touching the browser's own undo.
 */
export function StickyTextEditor({ ytext, fontPx, onEnd, undo }: StickyTextEditorProps): React.ReactElement {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState<string>(() => ytext.toString());
  const composingRef = useRef(false);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const undoRef = useRef(undo);
  undoRef.current = undo;

  // Mount: the edit session starts as one undo step (story 8), and focus goes
  // to the caret at the end of the text.
  useEffect(() => {
    undoRef.current.boundary();
    const ta = taRef.current;
    if (ta) {
      ta.focus();
      const len = ta.value.length;
      ta.setSelectionRange(len, len);
    }
  }, []);

  // External Y.Text changes — an in-editor undo/redo or a remote edit —
  // resync the textarea. Our own commits always leave
  // `ta.value === ytext.toString()`, so they are a no-op here.
  useEffect(() => {
    const handler = () => {
      const ta = taRef.current;
      if (!ta) return;
      const docValue = ytext.toString();
      if (docValue !== ta.value) {
        ta.value = docValue;
        setValue(docValue);
        const len = docValue.length;
        ta.setSelectionRange(len, len);
      }
    };
    ytext.observe(handler);
    return () => ytext.unobserve(handler);
  }, [ytext]);

  // A pointerdown anywhere outside the editor ends editing as "unselected".
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      const ta = taRef.current;
      if (!ta) return;
      const target = e.target;
      if (target instanceof Node && ta.contains(target)) return;
      endEditingRef.current('unselected');
    };
    window.addEventListener('pointerdown', handler);
    return () => window.removeEventListener('pointerdown', handler);
  }, []);

  const commit = (next: string): string => {
    const clamped = clampToLimit(next);
    setValue(clamped);
    applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
    return clamped;
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const ta = e.target;
    if (composingRef.current) {
      // Reflect composition in the UI; the real diff happens on compositionend.
      setValue(ta.value);
      return;
    }
    const clamped = commit(ta.value);
    if (clamped.length !== ta.value.length) {
      // Truncated: restore the caret to the end of the kept text.
      const len = clamped.length;
      requestAnimationFrame(() => {
        if (taRef.current) taRef.current.setSelectionRange(len, len);
      });
    }
  };

  const handleCompositionEnd = (e: React.CompositionEvent<HTMLTextAreaElement>) => {
    composingRef.current = false;
    commit((e.target as HTMLTextAreaElement).value);
  };

  // End the edit session: close the undo step (story 8), then hand back.
  const endEditing = (next: 'selected' | 'unselected') => {
    undoRef.current.boundary();
    onEndRef.current(next);
  };
  const endEditingRef = useRef(endEditing);
  endEditingRef.current = endEditing;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Story 8 (undo.shortcuts): the editor owns the undo combos — the
    // browser's own textarea undo never fires.
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) undoRef.current.redo();
      else undoRef.current.undo();
      return;
    }
    if (mod && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      undoRef.current.redo();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      endEditing('selected');
    }
    // Enter intentionally falls through to insert a newline.
  };

  const handleBlur = () => {
    // Defensive flush of any pending (e.g. composed) value.
    const ta = taRef.current;
    if (ta) commit(ta.value);
  };

  const showCounter = counterVisible(value.length);

  return (
    <div
      data-testid="sticky-text-editor"
      style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}
    >
      <textarea
        ref={taRef}
        value={value}
        onChange={handleChange}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        aria-label="Sticky note text"
        spellCheck={false}
        style={{
          flex: 1,
          width: '100%',
          resize: 'none',
          border: 'none',
          outline: 'none',
          background: 'transparent',
          color: 'inherit',
          fontSize: `${fontPx}px`,
          fontFamily: 'inherit',
          lineHeight: 1.2,
          textAlign: 'center',
          padding: '12px',
          boxSizing: 'border-box',
          overflow: 'hidden',
        }}
      />
      {showCounter && (
        <div
          data-testid="sticky-char-counter"
          style={{
            alignSelf: 'center',
            fontSize: '10px',
            lineHeight: 1,
            padding: '0 0 4px 0',
            color: 'rgba(0,0,0,0.55)',
            pointerEvents: 'none',
          }}
        >
          {value.length}/{STICKY_TEXT_MAX_CHARS}
        </div>
      )}
    </div>
  );
}
