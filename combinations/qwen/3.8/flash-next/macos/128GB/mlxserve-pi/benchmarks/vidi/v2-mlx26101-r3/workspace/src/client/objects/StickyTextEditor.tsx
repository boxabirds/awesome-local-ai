import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type {
  CompositionEvent,
  FormEvent,
  JSX,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import * as Y from 'yjs';
import {
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_PADDING_WORLD,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { applyTextDiff, clampToLimit, counterVisible, fitFontSize } from './StickyText';

/** Where the note ends up when editing stops. */
export type EditEnd = 'selected' | 'unselected';

export interface StickyTextEditorProps {
  /** The note's text: the value that survives, written to on every input event. */
  ytext: Y.Text;
  /** Font size the note fitted before editing started; re-fitted as the text grows. */
  fontPx: number;
  /** Escape (stay selected) or a click outside (deselect). */
  onEnd(next: EditEnd): void;
}

/** Height available for text: the note minus its padding (jsdom has no layout at all). */
function textBox(el: HTMLTextAreaElement): number {
  return el.clientHeight > 0 ? el.clientHeight : STICKY_SIZE_WORLD - STICKY_PADDING_WORLD * 2;
}

function clampFont(fontPx: number): number {
  if (!Number.isFinite(fontPx)) {
    return STICKY_FONT_MAX_PX;
  }
  return Math.min(STICKY_FONT_MAX_PX, Math.max(STICKY_FONT_MIN_PX, Math.round(fontPx)));
}

function setCaretToEnd(el: HTMLTextAreaElement): void {
  const end = el.value.length;
  try {
    el.setSelectionRange(end, end);
  } catch {
    // A textarea that cannot take a selection still shows the text.
  }
}

/** The note element this editor is inside of, for "outside the note" hit tests. */
function noteElementOf(el: HTMLElement): HTMLElement | null {
  return el.closest<HTMLElement>('[data-sticky-note]');
}

/**
 * The textarea that appears inside a note while it is being edited.
 *
 * Editing rules: the caret starts at the end of the existing text, every keystroke is
 * written to the note's `Y.Text` immediately (so stopping needs no save), text longer
 * than the product limit is cut off with the caret put back at the end of what was kept,
 * the font shrinks to fit as the text grows and a counter appears near the limit.
 * Escape keeps the note selected, a pointer press outside the note deselects it, and
 * Enter inserts a newline rather than closing the editor.
 */
export function StickyTextEditor({ ytext, fontPx, onEnd }: StickyTextEditorProps): JSX.Element {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [value, setValue] = useState<string>(() => ytext.toString());
  const [font, setFont] = useState<number>(() => clampFont(fontPx));
  const [overflow, setOverflow] = useState(false);
  const composingRef = useRef(false);
  const mountedRef = useRef(false);
  const onEndRef = useRef(onEnd);

  useEffect(() => {
    onEndRef.current = onEnd;
  });

  /** Clamp, remember locally and write the minimal change to the document. */
  const write = (next: string): void => {
    const el = ref.current;
    const clamped = clampToLimit(next);
    if (el !== null && clamped !== next) {
      // Nothing beyond the limit is ever added; the caret lands at the end of the kept text.
      el.value = clamped;
      setCaretToEnd(el);
    }
    setValue(clamped);
    applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
  };

  // Mount: take the focus with the caret at the end of the existing text. Later runs of
  // this effect only re-fit the font, which is what keeps long notes readable.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) {
      return;
    }
    if (!mountedRef.current) {
      mountedRef.current = true;
      el.focus();
      setCaretToEnd(el);
    }
    const fit = fitFontSize(el, textBox(el));
    setFont(fit.fontPx);
    setOverflow(fit.overflow);
  }, [value]);

  // A pointerdown outside the note ends editing (and deselects), whatever element it
  // lands on. Capture phase, so it runs before the board's own pointer handling.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const el = ref.current;
      const target = event.target;
      if (el === null || !(target instanceof Element)) {
        return;
      }
      const note = noteElementOf(el);
      if (note !== null && note.contains(target)) {
        return;
      }
      onEndRef.current('unselected');
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, []);

  const onInput = (event: FormEvent<HTMLTextAreaElement>): void => {
    // Composition (e.g. Japanese input) is written when it finishes, not mid-keystroke.
    if (composingRef.current) {
      return;
    }
    write(event.currentTarget.value);
  };

  const onCompositionEnd = (event: CompositionEvent<HTMLTextAreaElement>): void => {
    composingRef.current = false;
    write(event.currentTarget.value);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape') {
      // The text is already in the document; stopping editing writes nothing more.
      event.preventDefault();
      event.stopPropagation();
      onEndRef.current('selected');
    }
    // Enter is left to the textarea, which inserts a newline.
  };

  const onBlur = (): void => {
    // Defensive: a blur in the middle of a composition would otherwise lose those
    // characters. Normal typing has already been written, so this changes nothing.
    const el = ref.current;
    if (el !== null && composingRef.current) {
      composingRef.current = false;
      write(el.value);
    }
  };

  return (
    <>
      <textarea
        ref={ref}
        className="sticky-note__editor"
        data-testid="sticky-note-editor"
        aria-label="Sticky note text"
        value={value}
        style={{ fontSize: `${font}px` }}
        spellCheck={false}
        onChange={onInput}
        onKeyDown={onKeyDown}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={onCompositionEnd}
        onBlur={onBlur}
        onPointerDown={(event: ReactPointerEvent<HTMLTextAreaElement>) => {
          // Clicking in the text must not start a drag of the note.
          event.stopPropagation();
        }}
        onDoubleClick={(event: ReactMouseEvent<HTMLTextAreaElement>) => {
          event.stopPropagation();
        }}
      />
      {counterVisible(value.length) ? (
        <div
          className="sticky-note__counter"
          data-testid="sticky-note-counter"
          data-length={value.length}
          role="status"
        >
          {`${value.length}/${STICKY_TEXT_MAX_CHARS}`}
        </div>
      ) : null}
      {overflow ? (
        <div
          className="sticky-note__fade"
          data-testid="sticky-note-fade"
          data-overflow="true"
          aria-hidden="true"
        />
      ) : null}
    </>
  );
}
