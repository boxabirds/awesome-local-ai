// General-purpose Y.Text editor (story 9): a textarea synced to Y.Text with
// minimal diff. Used by free text objects; StickyTextEditor is a thin
// wrapper of this component for sticky notes.
//
// Behaviour (shared):
// - mount: value from Y.Text, focus, caret at end;
// - local input → clamp to maxChars → applyTextDiff (minimal Y.Text diff);
// - remote changes merge into the textarea with caret re-anchoring;
// - Escape → onEnd (selection kept);
// - outside pointerdown → onEnd;
// - Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z / Ctrl+Y → onUndo / onRedo;
// - IME composition is flushed on compositionend;
// - a character counter appears within `counterThreshold` of maxChars.

import { useCallback, useEffect, useRef } from 'react';
import * as Y from 'yjs';
import { applyTextDiff, clampToLimit } from '../../shared/text-edit';

export interface TextEditorProps {
  ytext: Y.Text;
  /** Hard character limit (text objects: 5 000; stickies: 500). */
  maxChars: number;
  /** Rendered font size in px (world units). */
 fontPx: number;
  /** Show the counter when maxChars - length <= counterThreshold. */
  counterThreshold?: number;
  /** Textarea padding in px (world units). Stickies: 16; text: 2. */
  padding?: number;
  /** Accessible name for the textarea. */
  ariaLabel: string;
  /** CSS class for the textarea element (sticky notes keep their legacy name). */
  textareaClassName?: string;
  /**
   * Transaction origin for local edits. Text objects pass LOCAL_ORIGIN so the
   * box-sync hook and undo capture the typing; sticky notes keep their
   * legacy 'editor' origin.
   */
  origin?: unknown;
  /** End editing. */
  onEnd: () => void;
  /** Undo boundary callback (story 8): called on mount and on end. */
  onBoundary?: () => void;
  /** Undo the last typing step (story 8). */
  onUndo?: () => void;
  /** Redo the last undone typing step (story 8). */
  onRedo?: () => void;
}

export function TextEditor({
  ytext,
  maxChars,
  fontPx,
  counterThreshold = 50,
  padding = 2,
  ariaLabel,
  textareaClassName = 'text-editor__textarea',
  origin = 'editor',
  onEnd,
  onBoundary,
  onUndo,
  onRedo,
}: TextEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);

  // On mount: boundary + set value from Y.Text, focus, caret at end.
  useEffect(() => {
    onBoundary?.();
    const el = ref.current;
    if (!el) return;
    el.value = ytext.toString();
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
    return () => { onBoundary?.(); };
  }, [ytext]); // eslint-disable-line react-hooks/exhaustive-deps

  // Merge remote Y.Text changes into the textarea. Local input is synced to
  // ytext synchronously in handleInput, so a value mismatch here means a
  // remote edit arrived while this editor was open (simultaneous editing).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = () => {
      const next = ytext.toString();
      if (el.value === next) return;
      const prev = el.value;
      const caret = el.selectionStart ?? prev.length;
      // Locate the first divergence to re-anchor the caret: inserts before
      // the caret shift it right; everything else keeps it clamped.
      let prefix = 0;
      while (prefix < Math.min(prev.length, next.length) && prev[prefix] === next[prefix]) {
        prefix++;
      }
      const delta = next.length - prev.length;
      const newCaret = Math.max(
        prefix,
        Math.min(next.length, caret + (caret > prefix ? delta : 0)),
      );
      el.value = next;
      el.setSelectionRange(newCaret, newCaret);
    };
    ytext.observe(observer);
    return () => ytext.unobserve(observer);
  }, [ytext]);

  // Outside pointerdown → end editing.
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      const el = ref.current;
      if (el && !el.contains(e.target as Node)) {
        onEnd();
      }
    };
    // Use capture phase so we get the event before the object's handler.
    window.addEventListener('pointerdown', handler, true);
    return () => window.removeEventListener('pointerdown', handler, true);
  }, [onEnd]);

  const handleInput = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (composingRef.current) return; // handled on compositionend

    let value = el.value;
    const clamped = clampToLimit(value, maxChars);
    if (clamped !== value) {
      // Truncated: restore caret to end of kept text.
      value = clamped;
      el.value = value;
      el.setSelectionRange(value.length, value.length);
    }
    applyTextDiff(ytext, value, origin);
  }, [ytext, maxChars, origin]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onEnd();
        return;
      }
      // Undo: Ctrl/Cmd+Z (intercept so browser native undo doesn't diverge from Y.Text).
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        onUndo?.();
        return;
      }
      // Redo: Ctrl/Cmd+Shift+Z or Ctrl+Y.
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        onRedo?.();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        onRedo?.();
        return;
      }
      // Enter inserts a newline (default textarea behaviour).
    },
    [onEnd, onUndo, onRedo],
  );

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false;
    handleInput();
  }, [handleInput]);

  const handleBlur = useCallback(() => {
    // Defensively flush any pending value.
    const el = ref.current;
    if (!el) return;
    const value = clampToLimit(el.value, maxChars);
    if (value !== ytext.toString()) {
      applyTextDiff(ytext, value, origin);
    }
  }, [ytext, maxChars, origin]);

  const text = ytext.toString();
  const showCounter = maxChars - text.length <= counterThreshold;

  return (
    <div className="text-editor" style={{ position: 'absolute', inset: 0 }}>
      <textarea
        ref={ref}
        className={textareaClassName}
        style={{
          fontSize: `${fontPx}px`,
          width: '100%',
          height: '100%',
          resize: 'none',
          border: 'none',
          outline: 'none',
          background: 'transparent',
          fontFamily: 'inherit',
          lineHeight: 1.3,
          padding: `${padding}px`,
          boxSizing: 'border-box',
          overflow: 'hidden',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onBlur={handleBlur}
        aria-label={ariaLabel}
      />
      {showCounter && (
        <span
          className="text-editor__counter"
          style={{
            position: 'absolute',
            bottom: '2px',
            right: '4px',
            fontSize: '10px',
            color: '#666',
            pointerEvents: 'none',
          }}
        >
          {text.length}/{maxChars}
        </span>
      )}
    </div>
  );
}
