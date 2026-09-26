import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactElement } from 'react';
import * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '@/shared/config';
import { LOCAL_ORIGIN } from '@/shared/board-model';
import { NOTE_PADDING, applyTextDiff, clampToLimit, counterVisible } from './StickyText';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  /** Current fitted font size in world px (shared with the display mode). */
  fontPx: number;
  /** Ends editing: 'selected' (Escape) or 'unselected' (click outside). */
  onEnd(next: 'selected' | 'unselected'): void;
  /** Story 8: close the capture window (edit start and edit end). */
  onBoundary?: () => void;
  /** Story 8: undo this tab's own step (Ctrl/Cmd+Z inside the editor). */
  onUndo?: () => void;
  /** Story 8: redo this tab's own step (Ctrl/Cmd+Shift+Z inside the editor). */
  onRedo?: () => void;
}

/**
 * Text editing mode for a sticky note. The textarea is the only input surface;
 * every committed value is written to the Y.Text via applyTextDiff (minimal
 * diff) immediately, so ending editing never loses typed characters.
 *
 * - Mount: focus, caret at the end of the text (sticky.edit_start).
 * - input: clamp to STICKY_TEXT_MAX_CHARS (caret restored to end when the
 *   input was truncated), then apply the minimal diff.
 * - IME: input during composition is skipped; compositionend commits.
 * - Escape: preventDefault, onEnd('selected') (sticky.edit_end).
 * - pointerdown outside the note: onEnd('unselected').
 * - Enter inserts a newline (never intercepted).
 */
export function StickyTextEditor(props: StickyTextEditorProps): ReactElement {
  const { ytext, fontPx, onEnd } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const valueRef = useRef<string>(ytext.toString());
  const composingRef = useRef(false);
  const endedRef = useRef(false);
  // Story 8: read the (stable) undo callbacks through refs so the window /
  // key handlers stay stable and never capture a stale controller.
  const boundaryRef = useRef(props.onBoundary);
  boundaryRef.current = props.onBoundary;
  const undoRef = useRef(props.onUndo);
  undoRef.current = props.onUndo;
  const redoRef = useRef(props.onRedo);
  redoRef.current = props.onRedo;
  const [length, setLength] = useState(valueRef.current.length);

  // Edit start: focus with the caret at the end of the text.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    // Story 8: start a fresh capture window for this editing session.
    boundaryRef.current?.();
  }, []);

  // Keep the editor in sync with changes made outside of it (future: other
  // clients once story 3 ships).
  useEffect(() => {
    const handler = () => {
      const next = ytext.toString();
      if (next !== valueRef.current) {
        valueRef.current = next;
        setLength(next.length);
        const el = textareaRef.current;
        if (el) el.value = next;
      }
    };
    ytext.observe(handler);
    return () => {
      ytext.unobserve(handler);
    };
  }, [ytext]);

  // A pointerdown anywhere outside the note ends editing (captured on window
  // so it fires before focus moves).
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (endedRef.current) return;
      const target = e.target as Node | null;
      if (target !== null && containerRef.current !== null && !containerRef.current.contains(target)) {
        endedRef.current = true;
        boundaryRef.current?.(); // Story 8: close the capture window.
        onEnd('unselected');
      }
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [onEnd]);

  const commit = useCallback(
    (raw: string) => {
      const next = clampToLimit(raw);
      if (next !== valueRef.current) {
        applyTextDiff(ytext, next, LOCAL_ORIGIN);
        valueRef.current = next;
        setLength(next.length);
      }
      const el = textareaRef.current;
      if (el && raw.length > next.length) {
        // Input was truncated: restore the kept text and the caret.
        el.value = next;
        el.setSelectionRange(next.length, next.length);
      }
    },
    [ytext],
  );

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el || composingRef.current) return;
    commit(el.value);
  }, [commit]);

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false;
    const el = textareaRef.current;
    if (el) commit(el.value);
  }, [commit]);

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        endedRef.current = true;
        boundaryRef.current?.(); // Story 8: close the capture window.
        onEnd('selected');
        return;
      }
      // Story 8: in-editor undo/redo. Intercepted here (preventDefault) so the
      // native textarea undo never diverges from the shared Y.Text that drives
      // the per-user controller.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redoRef.current?.();
        else undoRef.current?.();
        return;
      }
      if (e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        redoRef.current?.();
      }
    },
    [onEnd],
  );

  const handleBlur = useCallback(() => {
    // Defensive: every input event already committed, so this is normally a
    // no-op. Flushes any pending value if focus moves before an input event.
    const el = textareaRef.current;
    if (el && !endedRef.current && el.value !== valueRef.current) {
      commit(el.value);
    }
  }, [commit]);

  return (
    <div
      ref={containerRef}
      data-testid="sticky-text-editor"
      style={{ position: 'absolute', inset: NOTE_PADDING }}
    >
      <textarea
        ref={textareaRef}
        data-testid="sticky-textarea"
        defaultValue={valueRef.current}
        onChange={handleInput}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        spellCheck={false}
        style={{
          width: '100%',
          height: '100%',
          resize: 'none',
          border: 'none',
          outline: 'none',
          background: 'transparent',
          padding: 0,
          margin: 0,
          overflow: 'hidden',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontFamily: 'inherit',
          fontSize: `${fontPx}px`,
          lineHeight: 1.25,
          textAlign: 'center',
          color: 'rgba(0, 0, 0, 0.8)',
          caretColor: 'rgba(0, 0, 0, 0.8)',
        }}
      />
      {counterVisible(length) && (
        <div
          data-testid="char-counter"
          style={{
            position: 'absolute',
            right: 4,
            bottom: 2,
            fontSize: 12,
            lineHeight: 1,
            color: 'rgba(0, 0, 0, 0.5)',
            pointerEvents: 'none',
          }}
        >
          {length}/{STICKY_TEXT_MAX_CHARS}
        </div>
      )}
    </div>
  );
}
