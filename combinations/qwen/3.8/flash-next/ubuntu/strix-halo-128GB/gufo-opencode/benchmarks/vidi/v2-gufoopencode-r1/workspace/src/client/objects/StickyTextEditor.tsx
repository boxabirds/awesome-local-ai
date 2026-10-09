import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, FormEvent as ReactFormEvent, JSX } from 'react';
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { applyTextDiff, clampToLimit, counterVisible, fitFontSize } from './StickyText';
import { editorStyle, STICKY_TEXT_BOX_WORLD } from './stickyStyles';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
}

export function StickyTextEditor(props: StickyTextEditorProps): JSX.Element {
  const { ytext, onEnd } = props;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const [fontPx, setFontPx] = useState(props.fontPx);
  const [length, setLength] = useState(() => ytext.toString().length);

  const fit = (): void => {
    const el = textareaRef.current;
    if (el === null) return;
    setFontPx(fitFontSize(el, STICKY_TEXT_BOX_WORLD).fontPx);
  };

  useLayoutEffect(() => {
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Focus and place the caret at the end of the existing text on mount.
  useEffect(() => {
    const el = textareaRef.current;
    if (el === null) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, []);

  const commit = (raw: string): void => {
    const clamped = clampToLimit(raw);
    const el = textareaRef.current;
    if (el !== null && el.value !== clamped) {
      el.value = clamped;
      el.setSelectionRange(clamped.length, clamped.length);
    }
    setLength(clamped.length);
    applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
    fit();
  };

  const onInput = (event: ReactFormEvent<HTMLTextAreaElement>): void => {
    if (composingRef.current) return;
    commit(event.currentTarget.value);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onEnd('selected');
    }
    // Enter inserts a newline (default textarea behaviour); other keys pass
    // through to edit text.
  };

  const onBlur = (): void => {
    if (composingRef.current) return;
    const el = textareaRef.current;
    if (el === null || ytext.doc === null) return;
    const clamped = clampToLimit(el.value);
    if (clamped !== ytext.toString()) applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
  };

  return (
    <>
      <textarea
        ref={textareaRef}
        data-testid="sticky-editor"
        aria-label="Sticky note text"
        defaultValue={ytext.toString()}
        style={{ ...editorStyle, fontSize: fontPx }}
        onInput={onInput}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={(event) => {
          composingRef.current = false;
          commit(event.currentTarget.value);
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
      />
      {counterVisible(length) ? (
        <output
          data-testid="sticky-counter"
          aria-live="polite"
          style={{
            position: 'absolute',
            right: 6,
            bottom: 4,
            fontSize: 11,
            color: '#6b7280',
            pointerEvents: 'none'
          }}
        >
          {length}/{STICKY_TEXT_MAX_CHARS}
        </output>
      ) : null}
    </>
  );
}
