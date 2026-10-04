import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type * as Y from 'yjs';

import {
  STICKY_PADDING_WORLD,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { applyTextDiff, clampToLimit, counterVisible, fitFontSize } from './StickyText';
import { mapCaretPosition } from './caret';
import { useUndoController } from '../board/useUndo';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  /** Initial font size; the editor re-fits itself after every edit. */
  fontPx: number;
  /** The board is locked (see `canEdit`): the text can be read, not changed. */
  readOnly?: boolean;
  /** Escape → 'selected'; a pointerdown outside the note → 'unselected'. */
  onEnd(next: 'selected' | 'unselected'): void;
}

/**
 * The vertical box (board units) a note's text must fit within. Uses the
 * element's own client height (the display box is inset by the padding, the
 * textarea includes its padding in clientHeight and scrollHeight alike, so
 * "scrollHeight <= clientHeight" is the natural fit test for both). Falls back
 * to the configured inner box where there is no layout (jsdom).
 */
export function stickyContentBox(el: HTMLElement): number {
  if (el.clientHeight > 0) return el.clientHeight;
  return STICKY_SIZE_WORLD - 2 * STICKY_PADDING_WORLD;
}

/**
 * The editing surface of a sticky note: a textarea whose value is diffed into
 * the shared `Y.Text` (minimal change, clamped to the character limit) on every
 * input. Ends editing on Escape (keep selection) or a pointerdown outside the
 * note (drop selection). Every input is already written, so ending editing
 * performs no additional write and all text typed so far is kept.
 */
export function StickyTextEditor({ ytext, fontPx, readOnly = false, onEnd }: StickyTextEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const undoController = useUndoController();
  const [overflow, setOverflow] = useState(false);
  const [length, setLength] = useState(() => ytext.toString().length);

  const ytextRef = useRef(ytext);
  ytextRef.current = ytext;
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  const fit = (el: HTMLTextAreaElement) => {
    const result = fitFontSize(el, stickyContentBox(el));
    setOverflow(result.overflow);
  };

  /**
   * Show text that arrived while you were editing, and put the caret back where
   * it belongs. The textarea cannot simply own its value once other people can
   * edit the same text: every keystroke is diffed against the shared text, so a
   * value that is missing somebody else's typing would delete it.
   */
  const applyRemoteText = () => {
    const el = ref.current;
    if (!el) return;
    const next = ytextRef.current.toString();
    const before = el.value;
    if (next === before) return;
    const selectionStart = el.selectionStart ?? next.length;
    const selectionEnd = el.selectionEnd ?? next.length;
    el.value = next;
    setLength(next.length);
    fit(el);
    try {
      el.setSelectionRange(
        mapCaretPosition(before, next, selectionStart),
        mapCaretPosition(before, next, selectionEnd),
      );
    } catch {
      /* selection range is unsupported on some elements; ignore */
    }
  };
  const applyRemoteTextRef = useRef(applyRemoteText);
  applyRemoteTextRef.current = applyRemoteText;

  // Somebody else's typing, arriving into the note you are typing in.
  const waitingForCompositionToEnd = useRef(false);
  useEffect(() => {
    const ytext = ytextRef.current;
    const observer = () => {
      if (composingRef.current) waitingForCompositionToEnd.current = true;
      else applyRemoteTextRef.current();
    };
    ytext.observe(observer);
    return () => ytext.unobserve(observer);
  }, []);

  // Write the current textarea value into Y.Text, clamped to the limit.
  const flush = () => {
    const el = ref.current;
    if (!el) return;
    const clamped = clampToLimit(el.value);
    if (clamped !== el.value) {
      // Drop the characters past the limit and keep the caret at the end.
      el.value = clamped;
      try {
        el.setSelectionRange(clamped.length, clamped.length);
      } catch {
        /* selection range is unsupported on some elements; ignore */
      }
    }
    applyTextDiff(ytextRef.current, el.value, LOCAL_ORIGIN);
    setLength(el.value.length);
    fit(el);
  };

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Editing this note is its own undo step: close the window on the way in…
    undoController?.boundary();
    // Start editing with the cursor at the end of the text.
    el.value = ytext.toString();
    el.style.fontSize = `${fontPx}px`;
    fit(el);
    el.focus();
    const end = el.value.length;
    try {
      el.setSelectionRange(end, end);
    } catch {
      /* ignore */
    }
    setLength(end);

    // A pointerdown outside this note ends editing and drops the selection.
    const noteEl = el.closest('[data-note-id]');
    const onDocPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (noteEl && target && noteEl.contains(target)) return;
      flush();
      onEndRef.current('unselected');
    };
    document.addEventListener('pointerdown', onDocPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown, true);
      // …and on the way out, so the next action is never merged into this note's
      // typing burst (PRD undo.typing).
      undoController?.boundary();
    };
    // Mount-only: the textarea owns its value after this; further syncs happen
    // through flush() on input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    // Keep note-level keyboard handlers (App) from acting while typing.
    event.stopPropagation();
    // Ctrl/Cmd+Z here undoes the shared text through the board's history, not the
    // browser's native textarea undo — so it reverses exactly this person's typing
    // and syncs to everyone (PRD undo.typing, undo.keyboard).
    const mod = event.ctrlKey || event.metaKey;
    if (undoController && mod && (event.key === 'z' || event.key === 'Z')) {
      event.preventDefault();
      flush();
      if (event.shiftKey) undoController.redo();
      else undoController.undo();
      applyRemoteTextRef.current();
      return;
    }
    if (undoController && mod && (event.key === 'y' || event.key === 'Y')) {
      event.preventDefault();
      flush();
      undoController.redo();
      applyRemoteTextRef.current();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      flush();
      onEndRef.current('selected');
    }
    // Enter inserts a newline (default textarea behaviour).
  };

  return (
    <div className={`sticky-note__edit${overflow ? ' is-overflow' : ''}`}>
      <textarea
        ref={ref}
        className="sticky-note__textarea"
        aria-label="Sticky note text"
        defaultValue=""
        readOnly={readOnly}
        spellCheck={false}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          flush();
          if (waitingForCompositionToEnd.current) {
            waitingForCompositionToEnd.current = false;
            applyRemoteText();
          }
        }}
        onInput={() => {
          // During IME composition the value is provisional; wait for
          // compositionend so characters are never duplicated.
          if (!composingRef.current) flush();
        }}
        onKeyDown={onKeyDown}
        onBlur={flush}
      />
      {counterVisible(length) && (
        <span className="sticky-note__counter" data-testid="sticky-counter">
          {length}/{STICKY_TEXT_MAX_CHARS}
        </span>
      )}
      <div className="sticky-note__fade" data-testid="sticky-fade" aria-hidden="true" />
    </div>
  );
}
