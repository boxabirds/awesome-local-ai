import {
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

export interface StickyTextEditorProps {
  ytext: Y.Text;
  /** Initial font size; the editor re-fits itself after every edit. */
  fontPx: number;
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
export function StickyTextEditor({ ytext, fontPx, onEnd }: StickyTextEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
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
    return () => document.removeEventListener('pointerdown', onDocPointerDown, true);
    // Mount-only: the textarea owns its value after this; further syncs happen
    // through flush() on input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    // Keep note-level keyboard handlers (App) from acting while typing.
    event.stopPropagation();
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
        spellCheck={false}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          flush();
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
