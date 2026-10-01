import { useRef, useEffect, useState, type JSX } from 'react';
import type * as Y from 'yjs';
import { clampToLimit, applyTextDiff, counterVisible } from './StickyText';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import type { UndoController } from '../board/undo';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
  /** Per-user undo controller (story 8). */
  undo?: Pick<UndoController, 'boundary' | 'undo' | 'redo'>;
}

export function StickyTextEditor(props: StickyTextEditorProps): JSX.Element {
  const { ytext, fontPx, onEnd, undo } = props;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(() => ytext.toString());
  const composingRef = useRef(false);

  // Closing the editor (any path) closes the capture window so the typing
  // burst never merges with the next gesture (undo.boundary).
  const endEditing = (next: 'selected' | 'unselected') => {
    undo?.boundary();
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
    const clamped = clampToLimit(next);
    if (clamped !== next) {
      next = clamped;
      ta.value = next;
      ta.setSelectionRange(next.length, next.length);
    }
    setValue(next);
    applyTextDiff(ytext, next, 'editor');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      endEditing('selected');
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

  const showCounter = counterVisible(value.length);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <textarea
        ref={textareaRef}
        data-testid="sticky-text-editor"
        value={value}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          outline: 'none',
          resize: 'none',
          backgroundColor: 'transparent',
          fontSize: `${fontPx}px`,
          fontFamily: 'inherit',
          lineHeight: 1.3,
          padding: '12px',
          boxSizing: 'border-box',
          overflow: 'hidden',
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
          {value.length}/{STICKY_TEXT_MAX_CHARS}
        </div>
      )}
    </div>
  );
}
