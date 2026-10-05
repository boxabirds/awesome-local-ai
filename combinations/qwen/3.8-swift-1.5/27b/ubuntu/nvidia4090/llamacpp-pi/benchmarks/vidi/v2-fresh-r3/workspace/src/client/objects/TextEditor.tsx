import { useEffect, useRef, type CSSProperties, type MutableRefObject } from 'react';
import type { JSX } from 'react';
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { clampToLimit, applyTextDiff } from '../../shared/text-edit';
import type { UndoController } from '../board/undo';

export interface TextEditorProps {
  /** The shared text the editor diffs into (story 2's sticky and story 9's free text). */
  ytext: Y.Text;
  /** Hard character limit for this editor. */
  maxChars: number;
  /** Font size (board units) the textarea renders at. */
  fontPx: number;
  /** Textarea width: 'auto' fills the parent, otherwise a fixed width in board units. */
  width: number | 'auto';
  /** Called after every local write (the box-sync hook remeasures from the Y.Text itself). */
  onInput(): void;
  onEnd(next: 'selected' | 'unselected'): void;
  /** Story 8: the undo controller for this board. */
  undo?: UndoController;
  /** Test id for the editor container. */
  testId: string;
  /** Test id for the textarea. */
  textareaTestId: string;
  /** Extra textarea styles (padding, font family, line height…). */
  textareaStyle?: CSSProperties;
  /** Forwarded ref to the textarea (sticky auto-fit, char counter…). */
  textareaRef?: MutableRefObject<HTMLTextAreaElement | null>;
  /** Called after each local write AND after each merged remote change, with the value. */
  onValue?(value: string): void;
}

type DeltaOp = { retain: number } | { insert: unknown } | { delete: number };

/** Applies a Yjs delta (retain/insert/delete) to a plain string. */
function applyDeltaToValue(value: string, delta: DeltaOp[]): string {
  let out = '';
  let i = 0;
  for (const op of delta) {
    if ('retain' in op) {
      out += value.slice(i, i + op.retain);
      i += op.retain;
    } else if ('insert' in op) {
      out += typeof op.insert === 'string' ? op.insert : String(op.insert);
    } else if ('delete' in op) {
      i += op.delete;
    }
  }
  out += value.slice(i);
  return out;
}

/**
 * Moves a caret position through a Yjs delta. Inserts strictly before the
 * caret shift it right; deletes clamp it. An insert exactly at the caret
 * stays before it (the local caret keeps its relative position).
 */
function adjustCaret(caret: number, delta: DeltaOp[]): number {
  let pos = 0;
  let newCaret = caret;
  for (const op of delta) {
    if ('retain' in op) {
      pos += op.retain;
    } else if ('insert' in op) {
      if (pos < newCaret) newCaret += (typeof op.insert === 'string' ? op.insert : String(op.insert)).length;
    } else if ('delete' in op) {
      if (pos < newCaret) {
        if (pos + op.delete <= newCaret) newCaret -= op.delete;
        else newCaret = pos;
      }
      pos += op.delete;
    }
  }
  return newCaret;
}

/**
 * The shared text editor (story 9, text.editor): mounts a textarea seeded
 * with the current text, focuses it with the caret at the end, and diffs
 * every local input into the Y.Text (minimal change via `applyTextDiff`,
 * clamped to `maxChars`).
 *
 * The textarea is **uncontrolled**: React never rewrites its value from
 * state, so fast typing can never lose a character to a re-render race.
 * Remote changes (other clients, and this client's own undo/redo) are merged
 * into the textarea value and caret as they arrive (text.concurrent), so a
 * local keystroke always diffs against the up-to-date text and concurrent
 * typing is never destroyed.
 *
 * Escape ends editing keeping the object selected; a pointerdown outside the
 * editor ends it unselected. Every input is written as it happens, so ending
 * editing performs no additional write. Enter inserts a newline (the
 * textarea default). Ctrl/Cmd+Z / Shift+Z / Y route to the board's undo
 * controller (story 8).
 *
 * Story 2's `StickyTextEditor` is a thin wrapper over this component with
 * sticky defaults (limit, auto-fit, char counter).
 */
export function TextEditor(props: TextEditorProps): JSX.Element {
  const {
    ytext, maxChars, fontPx, width, onInput, onEnd, undo,
    testId, textareaTestId, textareaStyle, textareaRef, onValue,
  } = props;
  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  const setRef = (el: HTMLTextAreaElement | null) => {
    innerRef.current = el;
    if (textareaRef) textareaRef.current = el;
  };
  const composingRef = useRef(false);
  const endedRef = useRef(false);
  const onValueRef = useRef(onValue);
  onValueRef.current = onValue;

  // Mount: seed the value, focus with the caret at the end (edit start).
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    el.value = ytext.toString();
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    // Story 8: boundary at edit start so typing doesn't merge with prior actions.
    undo?.boundary();
    onValueRef.current?.(el.value);
  }, []);

  // Story 8: boundary at edit end (unmount).
  useEffect(() => {
    return () => {
      undo?.boundary();
    };
  }, [undo]);

  // Merge remote changes into the textarea (concurrent editors, undo/redo).
  // Local writes (origin LOCAL_ORIGIN) already reflect in the textarea.
  useEffect(() => {
    const observer = (event: Y.YTextEvent) => {
      if (event.transaction.origin === LOCAL_ORIGIN) return;
      const el = innerRef.current;
      if (!el) return;
      const caret = el.selectionStart ?? el.value.length;
      el.value = applyDeltaToValue(el.value, event.changes.delta as DeltaOp[]);
      const nextCaret = adjustCaret(caret, event.changes.delta as DeltaOp[]);
      try {
        el.setSelectionRange(nextCaret, nextCaret);
      } catch {
        // ignore (e.g. selection collapsed while unfocused)
      }
      onValueRef.current?.(el.value);
    };
    ytext.observe(observer);
    return () => {
      ytext.unobserve(observer);
    };
  });

  // Pointerdown anywhere outside the editor ends editing (unselected).
  useEffect(() => {
    const onPointerDown = (e: PointerEvent | MouseEvent) => {
      if (endedRef.current) return;
      const el = innerRef.current;
      if (el && e.target instanceof Node && el.contains(e.target)) return;
      endedRef.current = true;
      onEnd('unselected');
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  });

  const writeValue = (raw: string) => {
    const clamped = clampToLimit(raw, maxChars);
    applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
    onValueRef.current?.(clamped);
    onInput();
    return clamped;
  };

  const handleInput = () => {
    const el = innerRef.current;
    if (!el || composingRef.current) return;
    const clamped = writeValue(el.value);
    if (clamped.length !== el.value.length) {
      // Truncated at the limit: restore the caret to the end of kept text.
      el.value = clamped;
      el.setSelectionRange(clamped.length, clamped.length);
    }
  };

  const handleCompositionEnd = () => {
    composingRef.current = false;
    // The input event after compositionend is skipped while composing;
    // write the composed text now so IME text is not lost or duplicated.
    handleInput();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      endedRef.current = true;
      onEnd('selected');
      return;
    }
    // Story 8: intercept Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z / Ctrl+Y inside the
    // editor so native textarea undo never diverges from the Y.Text.
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey && undo) {
        e.preventDefault();
        undo.undo();
        return;
      }
      if (((key === 'z' && e.shiftKey) || key === 'y') && undo) {
        e.preventDefault();
        undo.redo();
        return;
      }
    }
    // Enter inserts a newline (the textarea default).
  };

  // Defensive flush: if the textarea blurs for any reason, make sure the
  // Y.Text matches what is shown (normally a no-op — every input is already
  // written, and ending editing performs no additional write).
  const handleBlur = () => {
    const el = innerRef.current;
    if (!el) return;
    const clamped = clampToLimit(el.value, maxChars);
    if (clamped !== ytext.toString()) {
      applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
      onInput();
    }
  };

  return (
    <div data-testid={testId} style={{ position: 'absolute', inset: 0 }}>
      <textarea
        ref={setRef}
        data-testid={textareaTestId}
        onInput={handleInput}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        spellCheck={false}
        style={{
          width: width === 'auto' ? '100%' : width,
          height: '100%',
          boxSizing: 'border-box',
          border: 'none',
          outline: 'none',
          resize: 'none',
          background: 'transparent',
          color: '#222',
          fontSize: fontPx,
          whiteSpace: 'pre-wrap',
          overflowWrap: 'break-word',
          overflow: 'hidden',
          display: 'block',
          ...textareaStyle,
        }}
      />
    </div>
  );
}
