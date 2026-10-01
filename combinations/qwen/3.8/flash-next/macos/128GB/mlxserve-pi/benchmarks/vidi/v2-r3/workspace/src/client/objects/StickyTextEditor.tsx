import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CompositionEvent,
  type FormEvent,
  type JSX,
  type KeyboardEvent,
} from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { applyTextDiff, clampToLimit, counterVisible } from './StickyText';
import type { EndEditNext } from '../board/useSelection';

export interface StickyTextEditorProps {
  /** The note's shared text; every input event is written to it directly. */
  ytext: Y.Text;
  /** Font size (board units) measured by the note, so typing keeps its size. */
  fontPx: number;
  /** Escape -> 'selected'; a pointerdown outside the note -> 'unselected'. */
  onEnd(next: EndEditNext): void;
}

/** Is `node` inside the same sticky note as `inside`? */
function sameNote(inside: HTMLElement, node: EventTarget | null): boolean {
  const note = inside.closest<HTMLElement>('[data-note-id]');
  if (note === null || node === null || !(node instanceof Element)) return false;
  return note.contains(node);
}

/**
 * The note's textarea. Every `input` event is applied to the Y.Text
 * immediately (minimal diff, clamped to 1,000 characters), so finishing
 * editing performs no extra write and nothing typed is ever lost.
 */
export function StickyTextEditor(props: StickyTextEditorProps): JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const propsRef = useRef(props);
  const composingRef = useRef(false);
  const endedRef = useRef(false);
  const [length, setLength] = useState(() => props.ytext.toString().length);

  useEffect(() => {
    propsRef.current = props;
  });

  /** Write the textarea's current value into the document (clamped). */
  const flush = useCallback(() => {
    const el = textareaRef.current;
    if (el === null || composingRef.current) return;
    const clamped = clampToLimit(el.value);
    if (clamped !== el.value) {
      // The characters past the limit are dropped, and the caret goes back to
      // the end of the text that was kept.
      el.value = clamped;
      try {
        el.setSelectionRange(clamped.length, clamped.length);
      } catch {
        /* element not focusable in this environment */
      }
    }
    applyTextDiff(propsRef.current.ytext, clamped, LOCAL_ORIGIN);
    setLength(clamped.length);
  }, []);

  // Edit start: value from the document, focus, caret at the end of the text.
  useEffect(() => {
    const el = textareaRef.current;
    if (el === null) return;
    const initial = clampToLimit(propsRef.current.ytext.toString());
    el.value = initial;
    setLength(initial.length);
    el.focus();
    try {
      el.setSelectionRange(initial.length, initial.length);
    } catch {
      /* jsdom: selection ranges are supported, but never fail the edit */
    }
  }, []);

  const end = useCallback((next: EndEditNext) => {
    if (endedRef.current) return;
    endedRef.current = true;
    propsRef.current.onEnd(next);
  }, []);

  // A pointerdown anywhere outside the note finishes editing (sticky.edit_end).
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const el = textareaRef.current;
      if (el === null || sameNote(el, e.target)) return;
      end('unselected');
    };
    // Capture phase: the note and the toolbars stop propagation, but this
    // still sees every pointerdown made outside them.
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [end]);

  const onInput = (_e: FormEvent<HTMLTextAreaElement>) => {
    flush();
  };

  const onCompositionStart = (_e: CompositionEvent<HTMLTextAreaElement>) => {
    composingRef.current = true;
  };

  const onCompositionEnd = (_e: CompositionEvent<HTMLTextAreaElement>) => {
    composingRef.current = false;
    flush(); // IME text lands here, never twice
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // While an IME composition is open the textarea owns every key: Escape
    // cancels the composition, it does not finish editing.
    if (e.nativeEvent.isComposing || composingRef.current) return;
    if (e.key === 'Escape') {
      // Escape finishes editing and keeps the note selected. Enter is left to
      // the textarea so it inserts a new line; Delete/Backspace edit text.
      e.preventDefault();
      e.stopPropagation();
      end('selected');
    }
  };

  return (
    <div className="sticky-editor" data-testid="sticky-editor">
      <textarea
        ref={textareaRef}
        className="sticky-textarea"
        data-testid="sticky-textarea"
        aria-label="Sticky note text"
        defaultValue=""
        style={{ fontSize: `${props.fontPx}px` }}
        onInput={onInput}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
        onBlur={flush}
        onKeyDown={onKeyDown}
        spellCheck={false}
      />
      {counterVisible(length) ? (
        <span className="sticky-counter" data-testid="sticky-counter" aria-live="polite">
          {length}/{STICKY_TEXT_MAX_CHARS}
        </span>
      ) : null}
    </div>
  );
}
