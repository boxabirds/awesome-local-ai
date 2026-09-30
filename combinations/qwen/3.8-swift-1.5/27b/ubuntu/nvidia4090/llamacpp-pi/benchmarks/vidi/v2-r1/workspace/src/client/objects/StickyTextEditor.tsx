import { useRef, useEffect, useCallback } from 'react';
import * as Y from 'yjs';
import { clampToLimit, applyTextDiff, counterVisible } from './StickyText';
import { STICKY_TEXT_MAX_CHARS } from '@shared/config';

interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd: (next: 'selected' | 'unselected') => void;
  onBoundary?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
}

export function StickyTextEditor({ ytext, fontPx, onEnd, onBoundary, onUndo, onRedo }: StickyTextEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const onBoundaryRef = useRef(onBoundary);
  onBoundaryRef.current = onBoundary;
  const onUndoRef = useRef(onUndo);
  onUndoRef.current = onUndo;
  const onRedoRef = useRef(onRedo);
  onRedoRef.current = onRedo;

  // On mount: set value, focus, caret at end; call boundary (edit start)
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const text = ytext.toString();
    el.value = text;
    el.focus();
    el.setSelectionRange(text.length, text.length);
    onBoundaryRef.current?.();
    // Call boundary on unmount (edit end)
    return () => {
      onBoundaryRef.current?.();
    };
  }, [ytext]);

  // Handle outside pointerdown to end editing.
  // Story 7: if the pointer lands on ANOTHER object (div[data-note-id]),
  // the selection of that object is kept ('selected'); on empty space the
  // selection clears ('unselected').
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      const el = textareaRef.current;
      const target = e.target as Element | null;
      if (el && !el.contains(target)) {
        const onObject = !!(target && target.closest && target.closest('[data-note-id]'));
        onEnd(onObject ? 'selected' : 'unselected');
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [onEnd]);

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el || composingRef.current) return;
    let value = el.value;
    const clamped = clampToLimit(value);
    if (clamped !== value) {
      value = clamped;
      el.value = value;
      el.setSelectionRange(value.length, value.length);
    }
    applyTextDiff(ytext, value, 'editor');
  }, [ytext]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) {
        onRedoRef.current?.();
      } else {
        onUndoRef.current?.();
      }
      return;
    }
    if (mod && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      e.stopPropagation();
      onRedoRef.current?.();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onEnd('selected');
    }
  }, [onEnd]);

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false;
    const el = textareaRef.current;
    if (!el) return;
    let value = el.value;
    const clamped = clampToLimit(value);
    if (clamped !== value) {
      value = clamped;
      el.value = value;
      el.setSelectionRange(value.length, value.length);
    }
    applyTextDiff(ytext, value, 'editor');
  }, [ytext]);

  const text = ytext.toString();
  const showCounter = counterVisible(text.length);

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
      <textarea
        ref={textareaRef}
        data-testid="sticky-text-editor"
        aria-label="Sticky note text"
        value={text}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        style={{
          flex: 1,
          width: '100%',
          height: '100%',
          border: 'none',
          outline: 'none',
          resize: 'none',
          background: 'transparent',
          fontSize: `${fontPx}px`,
          fontFamily: 'system-ui, sans-serif',
          textAlign: 'center',
          padding: 16,
          overflow: 'hidden',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          cursor: 'text',
        }}
      />
      {showCounter && (
        <div
          data-testid="char-counter"
          style={{
            position: 'absolute',
            bottom: 2,
            right: 4,
            fontSize: '9px',
            color: 'rgba(0,0,0,0.5)',
            pointerEvents: 'none',
          }}
        >
          {text.length}/{STICKY_TEXT_MAX_CHARS}
        </div>
      )}
    </div>
  );
}
