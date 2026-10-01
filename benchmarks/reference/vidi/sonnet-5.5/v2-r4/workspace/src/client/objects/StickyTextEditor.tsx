import { useEffect, useLayoutEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { applyTextDiff, clampToLimit, counterVisible } from './StickyText';

export const STICKY_PADDING_WORLD = 14;
export const STICKY_LINE_HEIGHT = 1.25;

export function StickyTextEditor(props: { ytext: Y.Text; fontPx: number; onEnd(next: 'selected' | 'unselected'): void }) {
  const { ytext, fontPx, onEnd } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  const resize = () => {
    const ta = ref.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  };

  useLayoutEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.value = ytext.toString();
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    resize();
  }, [ytext]);

  useLayoutEffect(resize, [fontPx]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const ta = ref.current;
      if (!ta) return;
      const host = ta.closest('[role="group"]');
      if (host && e.target instanceof Node && host.contains(e.target)) return;
      onEndRef.current('unselected');
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, []);

  const flush = () => {
    const ta = ref.current;
    if (!ta || composing.current) return;
    const value = clampToLimit(ta.value);
    if (value !== ta.value) {
      const caret = Math.min(ta.selectionStart ?? value.length, value.length);
      ta.value = value;
      ta.setSelectionRange(caret, caret);
    }
    applyTextDiff(ytext, value, LOCAL_ORIGIN);
    resize();
  };

  const showCounter = counterVisible(ytext.length);

  return (
    <>
      <textarea
        ref={ref}
        aria-label="Note text"
        spellCheck={false}
        onInput={flush}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
          flush();
        }}
        onBlur={flush}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onEnd('selected');
          }
        }}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          border: 'none',
          outline: 'none',
          resize: 'none',
          background: 'transparent',
          font: 'inherit',
          fontSize: fontPx,
          lineHeight: STICKY_LINE_HEIGHT,
          textAlign: 'center',
          padding: 0,
          margin: 0,
          overflow: 'hidden',
          maxHeight: '100%',
          color: '#222',
        }}
      />
      {showCounter && (
        <span
          data-testid="char-counter"
          style={{ position: 'absolute', right: 6, bottom: 4, fontSize: 12, color: '#555' }}
        >
          {ytext.length}/{STICKY_TEXT_MAX_CHARS}
        </span>
      )}
    </>
  );
}
