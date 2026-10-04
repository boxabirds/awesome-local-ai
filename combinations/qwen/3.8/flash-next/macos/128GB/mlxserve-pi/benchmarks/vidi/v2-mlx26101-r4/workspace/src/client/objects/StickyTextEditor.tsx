/**
 * The textarea a sticky note is typed into.
 *
 * Everything the design asks of editing lives here: the cursor starts at the end
 * of the text, every keystroke is written to the note's `Y.Text` as it happens
 * (so stopping performs no extra write), characters past the limit are dropped
 * as they are typed or pasted, Enter adds a line, Escape stops editing with the
 * text kept, and the font shrinks to keep the text inside the note.
 *
 * The textarea is uncontrolled: the DOM holds what the user has typed. That is
 * what makes input method editors (Japanese input, emoji pickers) safe — while a
 * composition is in flight nothing is written to the document, and the finished
 * word arrives on `compositionend`, so nothing is ever doubled.
 *
 * `input` and `compositionend` are registered as real listeners rather than as
 * React props: React routes them through its change-event plugin, which keeps
 * its own copy of the value and can swallow an event whose value it has already
 * seen — and this component writes the value itself when it clamps a paste.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX, KeyboardEvent, RefObject } from 'react';

import type * as Y from 'yjs';

import { LOCAL_ORIGIN } from '../../shared/board-model';
import { STICKY_PADDING_WORLD, STICKY_SIZE_WORLD, STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { applyTextDiff, clampToLimit, counterVisible, fitFontSize } from './StickyText';
import type { Fit } from './StickyText';
import type { EndEditTarget } from '../board/useSelection';

/** Height available to the text inside a note, in board units. */
export const STICKY_TEXT_BOX = STICKY_SIZE_WORLD - STICKY_PADDING_WORLD * 2;

export interface StickyTextEditorProps {
  /** The note's text; every keystroke is diffed into it. */
  ytext: Y.Text;
  /** Font size to start at, measured while the note was not being edited. */
  fontPx: number;
  /** Editing finished: Escape keeps the note selected, a click outside does not. */
  onEnd(next: EndEditTarget): void;
  /** Reported after each measurement so the note can show its overflow fade. */
  onFit?(fit: Fit): void;
}

export function StickyTextEditor({
  ytext,
  fontPx,
  onEnd,
  onFit,
}: StickyTextEditorProps): JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const [fit, setFit] = useState<Fit>(() => ({ fontPx, overflow: false }));
  const [length, setLength] = useState(() => ytext.toString().length);

  /** Write the textarea's content into the note, then measure it again. */
  const commit = useCallback((): void => {
    const element = ref.current;
    if (!element) return;

    const kept = clampToLimit(element.value);
    if (kept !== element.value) {
      // Past the limit nothing is added; the caret goes to the end of what the
      // note kept, so it never sits in text that no longer exists.
      element.value = kept;
      element.setSelectionRange(kept.length, kept.length);
    }

    applyTextDiff(ytext, kept, LOCAL_ORIGIN);
    setLength(kept.length);

    const measured = fitFontSize(element, STICKY_TEXT_BOX);
    setFit((previous) =>
      previous.fontPx === measured.fontPx && previous.overflow === measured.overflow
        ? previous
        : measured,
    );
    onFit?.(measured);
  }, [ytext, onFit]);

  // Mount: show the note's text with the cursor at its end and the focus, so a
  // note created by a double-click or the toolbar accepts typing with no further
  // click. The value is set here rather than as a prop so the caret can be placed
  // after the text is in the document.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    element.value = ytext.toString();
    setLength(element.value.length);
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);

    const measured = fitFontSize(element, STICKY_TEXT_BOX);
    setFit(measured);
    onFit?.(measured);
    // Mount and note only: while editing, the textarea is the source of truth,
    // and re-running this per keystroke would move the caret out from under
    // the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ytext]);

  // The keyboard rules of the note are the textarea's own; see the header note
  // for why input is not a React prop.
  useTyping(ref, commit, composing);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Escape') return; // Enter adds a line: that is the default
    event.preventDefault();
    event.stopPropagation();
    onEnd('selected');
  };

  return (
    <div className="sticky-note__editor">
      <textarea
        ref={ref}
        className="sticky-note__textarea"
        data-testid="sticky-textarea"
        aria-label="Sticky note text"
        spellCheck={false}
        style={{ fontSize: `${fit.fontPx}px` }}
        onKeyDown={handleKeyDown}
        onCompositionStart={() => {
          composing.current = true;
        }}
      />
      {counterVisible(length) ? (
        <span className="sticky-note__counter" data-testid="sticky-counter">
          {length}/{STICKY_TEXT_MAX_CHARS}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Listens for typing on the textarea: `input` writes through, except while an
 * input method is composing, when `compositionend` does. A blur flushes whatever
 * is in the box, which is a no-op in the normal case because every keystroke has
 * already been written.
 */
function useTyping(
  ref: RefObject<HTMLTextAreaElement | null>,
  commit: () => void,
  composing: RefObject<boolean>,
): void {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const onInput = (): void => {
      if (composing.current) return; // the composition is not finished text yet
      commit();
    };
    const onCompositionEnd = (): void => {
      composing.current = false;
      commit();
    };
    const onBlur = (): void => {
      // The composition never survives losing focus; flush it as text.
      if (composing.current) composing.current = false;
      commit();
    };

    element.addEventListener('input', onInput);
    element.addEventListener('compositionend', onCompositionEnd);
    element.addEventListener('blur', onBlur);
    return () => {
      element.removeEventListener('input', onInput);
      element.removeEventListener('compositionend', onCompositionEnd);
      element.removeEventListener('blur', onBlur);
    };
  }, [ref, commit, composing]);
}
