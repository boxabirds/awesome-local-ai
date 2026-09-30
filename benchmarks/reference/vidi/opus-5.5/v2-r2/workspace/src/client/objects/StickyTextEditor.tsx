import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { STICKY_LINE_HEIGHT, STICKY_PADDING_WORLD, applyTextDiff, clampEdit, counterVisible } from './StickyText';

/**
 * Maps a caret index through a remote change so it stays next to the same
 * characters. A remote insert exactly at the caret goes after the caret.
 */
function shiftIndex(index: number, delta: readonly { retain?: number; insert?: unknown; delete?: number }[]): number {
  let oldPos = 0;
  let result = index;
  for (const op of delta) {
    if (oldPos >= index) break;
    if (op.retain !== undefined) oldPos += op.retain;
    else if (typeof op.insert === 'string') result += op.insert.length;
    else if (op.delete !== undefined) {
      result -= Math.min(op.delete, index - oldPos);
      oldPos += op.delete;
    }
  }
  return result;
}

/** A Y.Text whose note has been deleted must not be written to. */
function isDetached(ytext: Y.Text): boolean {
  return ytext.doc === null || ytext._item?.deleted === true;
}

/**
 * Textarea editor for one sticky note. Every input is written to `ytext`
 * immediately (minimal diff), so ending editing never needs another write.
 */
export function StickyTextEditor(props: {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
}): React.JSX.Element {
  const { ytext } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const [length, setLength] = useState(() => ytext.length);
  const onEndRef = useRef(props.onEnd);
  onEndRef.current = props.onEnd;

  // Edit start: current text, focused, caret at the end.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.value = ytext.toString();
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [ytext]);

  // Other people's typing lands in the textarea at once, so the next local diff
  // (textarea vs Y.Text) never overwrites it; the caret stays with its characters.
  useEffect(() => {
    const onChange = (event: Y.YTextEvent, tx: Y.Transaction) => {
      const el = ref.current;
      if (!el || tx.origin === LOCAL_ORIGIN) return;
      const next = ytext.toString();
      if (el.value === next) return;
      const focused = document.activeElement === el;
      const start = shiftIndex(el.selectionStart, event.delta);
      const end = shiftIndex(el.selectionEnd, event.delta);
      el.value = next;
      if (focused) el.setSelectionRange(start, end);
      setLength(next.length);
    };
    ytext.observe(onChange);
    return () => ytext.unobserve(onChange);
  }, [ytext]);

  // Any pointerdown outside this note ends editing.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const note = ref.current?.closest('[data-sticky-note]') ?? ref.current;
      if (note && e.target instanceof Node && note.contains(e.target)) return;
      onEndRef.current('unselected');
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  const commit = () => {
    const el = ref.current;
    if (!el || composing.current || isDetached(ytext)) return;
    const prev = ytext.toString();
    const { text, caret } = clampEdit(prev, el.value);
    if (text !== el.value) {
      el.value = text;
      if (caret !== null) el.setSelectionRange(caret, caret);
    }
    applyTextDiff(ytext, text, LOCAL_ORIGIN);
    setLength(text.length);
  };

  return (
    <>
      <textarea
        ref={ref}
        className="sticky-editor"
        aria-label="Sticky note text"
        spellCheck
        style={{
          fontSize: `${props.fontPx}px`,
          lineHeight: STICKY_LINE_HEIGHT,
          padding: `0 ${STICKY_PADDING_WORLD}px`,
        }}
        onInput={commit}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
          commit();
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            commit();
            props.onEnd('selected');
          }
        }}
      />
      {counterVisible(length) && (
        <div className="sticky-counter" aria-live="polite">
          {`${length}/${STICKY_TEXT_MAX_CHARS}`}
        </div>
      )}
    </>
  );
}
