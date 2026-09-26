import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from 'react';
import * as Y from 'yjs';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
} from '@/shared/config';
import { LOCAL_ORIGIN } from '@/shared/board-model';
import { applyTextDiff, clampToLimit } from '@/shared/text-edit';
import type { UndoController } from '../board/undo';

export interface TextEditorProps {
  ytext: Y.Text;
  /** Hard character limit (text.limit); extras are never added. */
  maxChars: number;
  /** Font size in world px. */
  fontPx: number;
  /**
   * Editing box width in world units, or 'auto' (grows with the content,
   * capped at TEXT_MAX_AUTO_WIDTH_WORLD).
   */
  width: number | 'auto';
  /**
   * Editing box height in world units, or 'fill' (fill the parent — the
   * sticky-note layout). Defaults to the parent's height.
   */
  height?: number | 'fill';
  /** Inset of the box from the parent's edges (sticky notes: NOTE_PADDING). */
  inset?: number;
  /** Called after every local text commit (drives the stored-box remeasure). */
  onInput?(): void;
  /** Ends editing: 'selected' (Escape) or 'unselected' (click outside). */
  onEnd(next: 'selected' | 'unselected'): void;
  /** Story 8: the board's per-user undo controller. */
  undo: UndoController;
  /** Text alignment (sticky notes centre their text). */
  align?: 'left' | 'center';
  /** Line-height multiplier (sticky notes keep their 1.25). */
  lineHeight?: number;
  /** Browser spell-check (text objects keep the browser default). */
  spellCheck?: boolean;
  /** Shows the character counter near the limit (sticky notes only). */
  counter?: boolean;
  /** data-testid of the editor container (default 'text-editor'). */
  testId?: string;
  /** data-testid of the textarea (default 'text-textarea'). */
  textareaTestId?: string;
}

/**
 * Plain-text editing mode, generalised from story 2's StickyTextEditor
 * (story 9, text.editing). The textarea is the only input surface; every
 * committed value is written to the Y.Text via applyTextDiff (minimal diff)
 * immediately, so ending editing never loses typed characters.
 *
 * - Mount: focus, caret at the end of the text (text.edit).
 * - input: clamp to `maxChars` (caret restored to end when truncated),
 *   minimal diff, then onInput (stored-box remeasure).
 * - IME: input during composition is skipped; compositionend commits.
 * - Enter inserts a newline (never intercepted, text.edit).
 * - Escape: onEnd('selected'); pointerdown outside: onEnd('unselected').
 * - Undo/redo: the board's per-user controller (story 8), intercepted so the
 *   native textarea undo never diverges from the shared Y.Text.
 */
export function TextEditor(props: TextEditorProps): ReactElement {
  const {
    ytext,
    maxChars,
    fontPx,
    width,
    height = 'fill',
    inset = 0,
    onInput,
    onEnd,
    undo,
    align = 'left',
    lineHeight = TEXT_LINE_HEIGHT,
    spellCheck = true,
    counter = false,
    testId = 'text-editor',
    textareaTestId = 'text-textarea',
  } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const valueRef = useRef<string>(ytext.toString());
  const composingRef = useRef(false);
  const endedRef = useRef(false);
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;
  const undoRef = useRef(undo);
  undoRef.current = undo;
  const [length, setLength] = useState(valueRef.current.length);

  // Edit start: focus with the caret at the end of the text; open a fresh
  // undo capture window for this editing session (story 8).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    undoRef.current.boundary();
  }, []);

  // Keep the editor in sync with changes made outside of it (other clients).
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

  // A pointerdown anywhere outside the object ends editing (captured on
  // window so it fires before focus moves).
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (endedRef.current) return;
      const target = e.target as Node | null;
      if (target !== null && containerRef.current !== null && !containerRef.current.contains(target)) {
        endedRef.current = true;
        undoRef.current.boundary(); // story 8: close the capture window.
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
      const next = clampToLimit(raw, maxChars);
      if (next !== valueRef.current) {
        applyTextDiff(ytext, next, LOCAL_ORIGIN);
        valueRef.current = next;
        setLength(next.length);
        onInputRef.current?.(); // remeasure the stored box (story 9).
      }
      const el = textareaRef.current;
      if (el && raw.length > next.length) {
        // Input was truncated: restore the kept text and the caret.
        el.value = next;
        el.setSelectionRange(next.length, next.length);
      }
    },
    [ytext, maxChars],
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
        undoRef.current.boundary(); // story 8: close the capture window.
        onEnd('selected');
        return;
      }
      // In-editor undo/redo (story 8): intercepted here (preventDefault) so
      // the native textarea undo never diverges from the shared Y.Text.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) undoRef.current.redo();
        else undoRef.current.undo();
        return;
      }
      if (e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        undoRef.current.redo();
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

  const isAuto = width === 'auto';
  const containerStyle: React.CSSProperties = isAuto
    ? {
        position: 'absolute',
        left: 0,
        top: 0,
        width: 'max-content',
        maxWidth: TEXT_MAX_AUTO_WIDTH_WORLD,
        minWidth: TEXT_MIN_WIDTH_WORLD,
        minHeight: fontPx * lineHeight,
      }
    : height === 'fill'
      ? { position: 'absolute', inset }
      : {
          position: 'absolute',
          left: inset,
          top: inset,
          width,
          height: Math.max(height, fontPx * lineHeight),
        };

  return (
    <div ref={containerRef} data-testid={testId} style={containerStyle}>
      <textarea
        ref={textareaRef}
        data-testid={textareaTestId}
        defaultValue={valueRef.current}
        onChange={handleInput}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        spellCheck={spellCheck}
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
          lineHeight,
          textAlign: align,
          color: 'rgba(0, 0, 0, 0.8)',
          caretColor: 'rgba(0, 0, 0, 0.8)',
        }}
      />
      {counter && maxChars - length <= STICKY_COUNTER_THRESHOLD_CHARS && (
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
          {length}/{maxChars}
        </div>
      )}
    </div>
  );
}

// The character counter is a sticky-note feature (its 1,000 limit shows a
// counter near the end); the text object's 5,000 limit has no counter
// (text.limit: extras are simply not added).
