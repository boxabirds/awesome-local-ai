import React, { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { clampToLimit, applyTextDiff, counterVisible } from './StickyText';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { LOCAL_ORIGIN, OBJECTS_MAP_NAME } from '../../shared/board-model';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
}

export const STICKY_PADDING = 12;

const TEXT_STYLE_BASE: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  padding: STICKY_PADDING,
  boxSizing: 'border-box',
  margin: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  resize: 'none',
  overflow: 'hidden',
  color: '#1f2933',
  fontFamily: 'inherit',
  lineHeight: 1.25,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  textAlign: 'center',
  userSelect: 'text',
  WebkitUserSelect: 'text',
  caretColor: '#1976d2',
};

/**
 * True while this Y.Text still belongs to an object in the board document.
 * A note deleted mid-interaction leaves an orphaned Y.Text behind (writing to it
 * is harmless but pointless), so pending edits are dropped instead.
 */
function isTextAttached(ytext: Y.Text): boolean {
  const doc = ytext.doc;
  const parent = ytext.parent as Y.Map<unknown> | null;
  if (!doc || !parent) return false;
  let attached = false;
  doc.getMap(OBJECTS_MAP_NAME).forEach((value) => {
    if (value === parent) attached = true;
  });
  return attached;
}

/**
 * Plain-text editor for one sticky note. Every `input` event is written to the
 * note's Y.Text immediately (clamped to the length limit), so ending editing
 * performs no additional write. Escape returns to Selected; a pointerdown
 * outside the note returns to Unselected.
 */
export function StickyTextEditor({ ytext, fontPx, onEnd }: StickyTextEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState<string>(() => ytext.toString());
  const composingRef = useRef(false);
  /** Latest text seen from the field, including in-progress composition text. */
  const latestRef = useRef<string>(ytext.toString());
  const endedRef = useRef(false);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  /** Write one text value into the shared Y.Text, clamped to the limit. */
  const writeText = useCallback(
    (next: string) => {
      const clamped = clampToLimit(next);
      latestRef.current = clamped;
      setValue(clamped);
      const el = ref.current;
      if (el && el.value !== clamped) {
        // Characters beyond the limit are not added; caret goes to the end of the kept text
        el.value = clamped;
        try {
          el.setSelectionRange(clamped.length, clamped.length);
        } catch {
          /* jsdom or detached element */
        }
      }
      if (isTextAttached(ytext)) applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
    },
    [ytext],
  );

  /** Write whatever the textarea currently holds. */
  const flush = useCallback(() => {
    const el = ref.current;
    if (el) writeText(el.value);
  }, [writeText]);

  const finish = useCallback((next: 'selected' | 'unselected') => {
    if (endedRef.current) return;
    endedRef.current = true;
    onEndRef.current(next);
  }, []);

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const next = event.currentTarget.value;
      latestRef.current = next;
      if (composingRef.current) {
        // Keep React's value in step so it does not restore the DOM mid-composition,
        // but write nothing to the shared text until compositionend.
        setValue(clampToLimit(next));
        return;
      }
      writeText(next);
    },
    [writeText],
  );

  // Mount: caret at the end of the existing text, ready for typing.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    try {
      el.setSelectionRange(end, end);
    } catch {
      /* jsdom or detached element */
    }
  }, []);

  // A pointerdown outside the note ends editing. Clicks inside the note stop
  // propagation, so they never reach this document listener.
  useEffect(() => {
    const handleDocPointerDown = () => finish('unselected');
    document.addEventListener('pointerdown', handleDocPointerDown);
    return () => {
      document.removeEventListener('pointerdown', handleDocPointerDown);
      // Flush any pending value defensively (blur, unmount); never recreate a deleted note
      try {
        if (!composingRef.current && isTextAttached(ytext)) {
          const el = ref.current;
          if (el) applyTextDiff(ytext, clampToLimit(el.value), LOCAL_ORIGIN);
        }
      } catch {
        /* the note disappeared mid-edit: drop the pending edit, never recreate it */
      }
    };
  }, [finish, ytext]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish('selected');
      }
      // Enter is left to the textarea: it inserts a new line.
    },
    [finish],
  );

  const showCounter = counterVisible(value.length);

  return (
    <>
      <textarea
        ref={ref}
        data-testid="sticky-textarea"
        aria-label="Sticky note text"
        value={value}
        onChange={handleChange}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          // The value comes from the last change event: a controlled textarea can
          // be put back to its previous value while the IME was composing.
          writeText(latestRef.current);
        }}
        onBlur={flush}
        onKeyDown={handleKeyDown}
        style={{ ...TEXT_STYLE_BASE, fontSize: fontPx }}
      />
      {showCounter && (
        <span
          data-testid="sticky-counter"
          aria-live="polite"
          style={{
            position: 'absolute',
            right: 6,
            bottom: 4,
            fontSize: 11,
            lineHeight: '14px',
            color: 'rgba(31,41,51,0.7)',
            backgroundColor: 'rgba(255,255,255,0.75)',
            borderRadius: 4,
            padding: '0 4px',
            pointerEvents: 'none',
          }}
        >
          {value.length}/{STICKY_TEXT_MAX_CHARS}
        </span>
      )}
    </>
  );
}
