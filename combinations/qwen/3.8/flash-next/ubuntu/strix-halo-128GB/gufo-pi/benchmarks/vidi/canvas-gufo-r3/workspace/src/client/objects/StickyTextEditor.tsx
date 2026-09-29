import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import * as Y from 'yjs';
import { clampToLimit, applyTextDiff } from './StickyText';
import { LOCAL_ORIGIN } from '@shared/board-model';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  padding: number;
  onEnd(next: 'selected' | 'unselected'): void;
}

/**
 * Transparent textarea overlaid on the note text while editing.
 * Every input event is written to the Y.Text immediately (minimal diff), so ending
 * editing needs no extra write and characters cannot be lost on unmount.
 */
export function StickyTextEditor({ ytext, fontPx, padding, onEnd }: StickyTextEditorProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const endedRef = useRef(false);
  const unmountedRef = useRef(false);
  const composingRef = useRef(false);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  // Mount: seed the value, focus, caret at the end of the text.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.value = ytext.toString();
    el.focus();
    const len = el.value.length;
    try {
      el.setSelectionRange(len, len);
    } catch {
      // jsdom edge cases; caret placement is best-effort there
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reflect REMOTE changes (another client editing this note live) into the textarea.
  // Without this, a local commit's minimal diff would recompute against a value that
  // is missing the remote characters and erase them — concurrent typing would lose
  // text. Local commits use LOCAL_ORIGIN and are ignored here. Caret goes to the end,
  // which is the right behaviour for a short shared sticky.
  useEffect(() => {
    const handler = (_event: Y.YTextEvent, origin: unknown) => {
      if (origin === LOCAL_ORIGIN) return;
      const el = ref.current;
      if (!el || composingRef.current) return;
      const next = ytext.toString();
      if (el.value !== next) {
        el.value = next;
        const len = next.length;
        try {
          el.setSelectionRange(len, len);
        } catch {
          /* caret placement is best-effort */
        }
      }
    };
    ytext.observe(handler);
    return () => ytext.unobserve(handler);
  }, [ytext]);

  // Runs before the DOM node is removed: a blur caused by unmounting must not
  // change selection (the caller has already moved selection elsewhere).
  useLayoutEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  const commit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const clamped = clampToLimit(el.value);
    if (clamped !== el.value) {
      el.value = clamped;
      const len = clamped.length;
      try {
        el.setSelectionRange(len, len);
      } catch {
        /* noop */
      }
    }
    applyTextDiff(ytext, el.value, LOCAL_ORIGIN);
  }, [ytext]);

  const handleInput = useCallback(() => {
    if (composingRef.current) return;
    commit();
  }, [commit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        endedRef.current = true;
        commit();
        onEndRef.current('selected');
      }
      // Enter is not intercepted: it inserts a newline.
      e.stopPropagation();
    },
    [commit],
  );

  const handleBlur = useCallback(() => {
    commit();
    if (endedRef.current || unmountedRef.current) return;
    endedRef.current = true;
    onEndRef.current('unselected');
  }, [commit]);

  return (
    <textarea
      ref={ref}
      data-testid="sticky-textarea"
      spellCheck={false}
      onChange={handleInput}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onCompositionEnd={() => {
        composingRef.current = false;
        commit();
      }}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        border: 'none',
        outline: 'none',
        resize: 'none',
        background: 'transparent',
        padding: `${padding}px`,
        font: 'inherit',
        fontSize: `${fontPx}px`,
        lineHeight: 1.3,
        color: '#222',
        textAlign: 'center',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        overflow: 'hidden',
        boxSizing: 'border-box',
        caretColor: '#222',
      }}
    />
  );
}
