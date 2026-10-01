import { useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { applyTextDiff, clampToLimit, counterVisible } from './StickyText';

interface Props {
  ytext: Y.Text;
  fontPx: number;
  /** Top padding in board units, used to keep the text vertically centred. */
  padTop?: number;
  onEnd(next: 'selected' | 'unselected'): void;
}

export const NOTE_PADDING = 12;

export function StickyTextEditor({ ytext, fontPx, padTop = NOTE_PADDING, onEnd }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const [length, setLength] = useState(() => ytext.length);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  useEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.value = ytext.toString();
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    const note = ta.closest('[data-sticky-note]');
    const onDown = (e: PointerEvent) => {
      if (note && e.target instanceof Node && note.contains(e.target)) return;
      onEndRef.current('unselected');
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [ytext]);

  // Remote or programmatic changes to the text while editing.
  useEffect(() => {
    const onChange = () => {
      const ta = ref.current;
      setLength(ytext.length);
      if (ta && !composing.current && ta.value !== ytext.toString()) ta.value = ytext.toString();
    };
    ytext.observe(onChange);
    return () => ytext.unobserve(onChange);
  }, [ytext]);

  const flush = () => {
    const ta = ref.current;
    if (!ta || composing.current) return;
    // The note may have been deleted meanwhile; never write into a removed text.
    if ((ytext as unknown as { _item: { deleted: boolean } | null })._item?.deleted) return;
    const clamped = clampToLimit(ta.value);
    if (clamped !== ta.value) {
      ta.value = clamped;
      ta.setSelectionRange(clamped.length, clamped.length);
    }
    applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
    setLength(clamped.length);
  };

  return (
    <>
      <textarea
        ref={ref}
        aria-label="Note text"
        onInput={flush}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => { composing.current = false; flush(); }}
        onBlur={flush}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onEnd('selected');
          }
        }}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          boxSizing: 'border-box',
          padding: `${padTop}px ${NOTE_PADDING}px ${NOTE_PADDING}px`,
          border: 'none',
          outline: 'none',
          resize: 'none',
          overflow: 'hidden',
          background: 'transparent',
          color: 'inherit',
          font: `${fontPx}px/1.25 system-ui, sans-serif`,
          textAlign: 'center',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
        }}
      />
      {counterVisible(length) && (
        <span
          data-testid="note-counter"
          style={{ position: 'absolute', right: 6, bottom: 4, font: '11px system-ui, sans-serif', opacity: 0.7, pointerEvents: 'none' }}
        >
          {`${length}/${STICKY_TEXT_MAX_CHARS}`}
        </span>
      )}
    </>
  );
}
