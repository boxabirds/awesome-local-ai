/**
 * Story 9: the generalised board text editor (text.object).
 *
 * Generalised from story 2's StickyTextEditor: `maxChars` (sticky notes keep
 * STICKY_TEXT_MAX_CHARS, text objects use TEXT_MAX_CHARS), `fontPx` (the
 * preset's world-unit size), `width` (the box width in world units, or 'auto'
 * to fill the object box), and `onInput()` — called after every local write
 * so text objects can remeasure their box (text.layout).
 *
 * The textarea is uncontrolled and every committed `input`/`paste` is written
 * to the Y.Text immediately via a minimal diff, so ending editing (Escape,
 * outside click, unmount) performs no additional write and can never lose
 * typed characters. Remote changes merge in real time with caret stability
 * (story 3 / text.concurrent).
 */
import { useEffect, useRef, useState, type JSX } from 'react';
import * as Y from 'yjs';
import { STICKY_COUNTER_THRESHOLD_CHARS } from 'src/shared/config';
import { clampToLimit, applyTextDiff, adjustCaret } from 'src/shared/text-edit';
import { LOCAL_ORIGIN } from 'src/shared/board-model';
import type { UndoController } from '../board/undo';

export interface TextEditorProps {
  ytext: Y.Text;
  /** Per-object character limit (sticky: 1,000; text: TEXT_MAX_CHARS). */
  maxChars: number;
  /** Font size in board/world units (the object's preset). */
  fontPx: number;
  /** Box width in world units, or 'auto' to fill the object's box. */
  width: number | 'auto';
  /** Called after every local write (text objects remeasure their box). */
  onInput(): void;
  onEnd(next: 'selected' | 'unselected'): void;
  /** Story 8: the board's per-user undo controller. */
  undo: UndoController;
  /** Style/test hooks so the sticky wrapper keeps story 2's look and IDs. */
  padding?: number;
  align?: 'left' | 'center';
  ariaLabel?: string;
  editorTestId?: string;
  textareaTestId?: string;
  counterTestId?: string;
}

/** True when the remaining character budget is within the counter threshold. */
function counterVisible(length: number, maxChars: number): boolean {
  return maxChars - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

export function TextEditor(props: TextEditorProps): JSX.Element {
  const { ytext, maxChars, fontPx, width, onInput, onEnd, undo } = props;
  const padding = props.padding ?? 0;
  // 'auto' fills the object's box; a number pins the editor width (world
  // units) — the box itself is measured by text.layout, so both render at
  // the stored width.
  const wrapperStyle: React.CSSProperties =
    width === 'auto'
      ? { position: 'absolute', inset: 0 }
      : { position: 'absolute', left: 0, top: 0, width, height: '100%' };
  const align = props.align ?? 'left';
  const ref = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const endedRef = useRef(false);
  const undoRef = useRef(undo);
  undoRef.current = undo;
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;
  const [length, setLength] = useState(() => ytext.length);

  // Story 8: an edit session starts its own undo step — the boundary closes
  // the capture window so typing never merges with the action that started
  // the edit (undo.boundaries).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    undoRef.current.boundary();
  }, []);
  // Reflect REMOTE Y.Text changes into the (uncontrolled) textarea in real
  // time, keeping the local caret stable. Without this, a subsequent local
  // diff would be computed against a value that lacks the remote characters
  // and would delete them — concurrent typing would lose characters.
  useEffect(() => {
    const onRemoteUpdate = (event: Y.YTextEvent, transaction: Y.Transaction) => {
      if (transaction.origin === LOCAL_ORIGIN) return; // local changes are already in the DOM
      const el = ref.current;
      if (!el || endedRef.current) return;
      const prevCaret = el.selectionStart ?? el.value.length;
      const nextCaret = adjustCaret(prevCaret, event.delta);
      el.value = ytext.toString();
      el.setSelectionRange(nextCaret, nextCaret);
      setLength(el.value.length);
    };
    ytext.observe(onRemoteUpdate);
    return () => ytext.unobserve(onRemoteUpdate);
  }, [ytext]);

  // A pointerdown anywhere outside the object ends editing as unselected.
  // Capture phase so this fires before the viewport/note handlers act.
  useEffect(() => {
    const onPointerDown = (e: Event) => {
      const el = ref.current;
      if (!el || endedRef.current) return;
      if (el.contains(e.target as Node)) return;
      end('unselected');
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const end = (next: 'selected' | 'unselected') => {
    if (endedRef.current) return;
    endedRef.current = true;
    // Story 8: ending the edit closes the capture window, so the burst of
    // typing is one finished step and the next action starts a new one.
    undoRef.current.boundary();
    onEnd(next);
  };

  const commit = (value: string, caret: number) => {
    const kept = clampToLimit(value, maxChars);
    const el = ref.current!;
    el.value = kept;
    const safeCaret = Math.max(0, Math.min(caret, kept.length));
    el.setSelectionRange(safeCaret, safeCaret);
    setLength(kept.length);
    if (kept !== ytext.toString()) {
      applyTextDiff(ytext, kept, LOCAL_ORIGIN);
      onInputRef.current();
    }
  };

  const handleInput = () => {
    const el = ref.current;
    if (!el || composingRef.current) return;
    const caret = el.selectionStart ?? el.value.length;
    commit(el.value, Math.min(caret, el.value.length));
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    const el = ref.current!;
    const text = e.clipboardData.getData('text/plain');
    if (text === '') return;
    const start = el.selectionStart ?? el.value.length;
    const endSel = el.selectionEnd ?? start;
    const next = el.value.slice(0, start) + text + el.value.slice(endSel);
    commit(next, start + text.length);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      // Keep all text typed so far (already in the doc); empty texts are
      // removed by the object on edit end (text.empty_removed).
      e.preventDefault();
      end('selected');
      return;
    }
    // Story 8: Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z / Ctrl+Y inside the editor are
    // routed to the board's controller with preventDefault, so the browser's
    // native textarea undo can never diverge from the Y.Text (and
    // useBoardKeys ignores the event while text is being edited).
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        if (e.shiftKey) undoRef.current.redo();
        else undoRef.current.undo();
        return;
      }
      if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault();
        undoRef.current.redo();
        return;
      }
    }
    // Enter is NOT intercepted: it inserts a newline.
  };

  const handleCompositionStart = () => {
    composingRef.current = true;
  };

  const handleCompositionEnd = () => {
    composingRef.current = false;
    handleInput();
  };

  // Defensively flush any pending value on blur (IME guard: not mid-composition).
  const handleBlur = () => {
    const el = ref.current;
    if (!el || composingRef.current) return;
    if (el.value !== ytext.toString()) {
      applyTextDiff(ytext, el.value, LOCAL_ORIGIN);
      onInputRef.current();
    }
  };

  const showCounter = counterVisible(length, maxChars);

  return (
    <div
      data-testid={props.editorTestId ?? 'text-editor'}
      style={wrapperStyle}
    >
      <textarea
        ref={ref}
        defaultValue={ytext.toString()}
        aria-label={props.ariaLabel ?? 'Free text'}
        data-testid={props.textareaTestId ?? 'text-textarea'}
        spellCheck={false}
        wrap="soft"
        onInput={handleInput}
        onPaste={handlePaste}
        onKeyDown={handleKeyDown}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onBlur={handleBlur}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          boxSizing: 'border-box',
          padding,
          margin: 0,
          border: 'none',
          outline: 'none',
          resize: 'none',
          overflow: 'hidden',
          background: 'transparent',
          color: 'inherit',
          textAlign: align,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontFamily: 'inherit',
          lineHeight: 1.3,
          fontSize: fontPx,
          cursor: 'text',
        }}
      />
      {showCounter && (
        <span
          data-testid={props.counterTestId ?? 'text-char-counter'}
          style={{
            position: 'absolute',
            right: 6,
            bottom: 2,
            fontSize: 10,
            color: 'rgba(0,0,0,0.55)',
            pointerEvents: 'none',
          }}
        >
          {length}/{maxChars}
        </span>
      )}
    </div>
  );
}
