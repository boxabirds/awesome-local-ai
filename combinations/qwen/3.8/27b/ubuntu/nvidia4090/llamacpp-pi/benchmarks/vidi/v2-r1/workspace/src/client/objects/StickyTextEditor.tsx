// StickyTextEditor (story 2): the textarea used while a note is being edited.
// Every input event is written to Y.Text via the minimal diff; ending editing
// performs no additional write.

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
} from 'react';
import * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import {
  applyTextDiff,
  clampToLimit,
  counterVisible,
  fitFontSize,
  NOTE_TEXT_BOX,
} from './StickyText';
import { LOCAL_ORIGIN } from '../../shared/board-model';

export interface TextFit {
  fontPx: number;
  overflow: boolean;
}

export interface StickyTextEditorProps {
  ytext: Y.Text;
  /** The font size found in display mode; the editor re-measures on mount. */
  fontPx: number;
  /**
   * Height (world units) of the region the text must fit into. Defaults to
   * the standard sticky size (story 7: resized notes pass their own).
   */
  textBox?: number;
  onEnd(next: 'selected' | 'unselected'): void;
  /** Reports the editor's measured fit (font size + overflow flag). */
  onFitChange?(fit: TextFit): void;
}

export function StickyTextEditor(props: StickyTextEditorProps): JSX.Element {
  const { ytext, fontPx, onEnd, onFitChange } = props;
  const box = props.textBox ?? NOTE_TEXT_BOX;
  const taRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const [value, setValue] = useState(() => ytext.toString());
  const [fit, setFit] = useState<TextFit>(() => ({ fontPx, overflow: false }));

  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const onFitChangeRef = useRef(onFitChange);
  onFitChangeRef.current = onFitChange;
  const ytextRef = useRef(ytext);
  ytextRef.current = ytext;

  // Edit start: focus the textarea with the caret at the end of the text.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    const len = ta.value.length;
    ta.focus();
    ta.setSelectionRange(len, len);
  }, []);

  // Font fit: binary search on the real layout, on mount, on text change and
  // when the fit box changes (resized notes, story 7).
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    const next = fitFontSize(ta, box);
    setFit((f) => (f.fontPx === next.fontPx && f.overflow === next.overflow ? f : next));
    onFitChangeRef.current?.(next);
  }, [value, box]);

  // A pointerdown anywhere outside the textarea ends editing (unselected).
  // Capture phase so this runs before other handlers (e.g. pressing another
  // note) see the event.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const ta = taRef.current;
      if (ta && e.target instanceof Node && ta.contains(e.target)) return;
      onEndRef.current('unselected');
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, []);

  // Write the (clamped) textarea value into Y.Text with the minimal diff.
  const commit = (ta: HTMLTextAreaElement, raw: string) => {
    const clamped = clampToLimit(raw);
    if (clamped !== raw) {
      // Characters beyond the limit were dropped: keep the visible value in
      // sync and put the caret at the end of the kept text.
      ta.value = clamped;
      ta.setSelectionRange(clamped.length, clamped.length);
    }
    setValue(clamped);
    applyTextDiff(ytextRef.current, clamped, LOCAL_ORIGIN);
  };

  const onInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    if (composingRef.current) return; // handled on compositionend (IME)
    commit(e.currentTarget, e.currentTarget.value);
  };

  const onCompositionEnd = (e: React.CompositionEvent<HTMLTextAreaElement>) => {
    composingRef.current = false;
    commit(e.currentTarget, e.currentTarget.value);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onEndRef.current('selected');
      return;
    }
    // Enter keeps its default: a new line inside the note.
  };

  // Defensive flush: every input event has already been written, but blur
  // could arrive with a pending value (e.g. a cancelled IME composition).
  const onBlur = (e: React.FocusEvent<HTMLTextAreaElement>) => {
    if (e.currentTarget.value !== ytextRef.current.toString()) {
      commit(e.currentTarget, e.currentTarget.value);
    }
  };

  return (
    <div className="sticky-note__editor">
      <textarea
        ref={taRef}
        className="sticky-note__textarea"
        data-testid="sticky-editor"
        value={value}
        style={{ fontSize: fit.fontPx }}
        wrap="soft"
        spellCheck={false}
        onInput={onInput}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={onCompositionEnd}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        aria-label="Sticky note text"
      />
      {counterVisible(value.length) && (
        <div
          className="sticky-note__counter"
          data-testid="sticky-counter"
          aria-live="polite"
        >
          {value.length}/{STICKY_TEXT_MAX_CHARS}
        </div>
      )}
    </div>
  );
}
