import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { applyTextDiff, clampToLimit, counterVisible, fitFontSize } from './StickyText';
import type { UndoController } from '../board/undo';

/**
 * The editing layer of a sticky note (design "sticky.text").
 *
 * A transparent textarea is laid exactly over the displayed text: same font
 * size, same padding, same alignment, so switching between reading and editing
 * does not move a single character.
 *
 * Two rules keep the text safe:
 *  - every `input` is written to Y.Text immediately, so ending the edit (by
 *    Escape or by clicking outside) has nothing left to save and cannot lose a
 *    character;
 *  - the write is the minimal diff, not a full replace, so text another person
 *    typed in the same note survives (story 3).
 */
export interface StickyTextEditorProps {
  ytext: Y.Text;
  /** Font size the editor starts from; re-fitted as the text changes. */
  fontPx: number;
  /** Height available to the text, in world units. */
  box: number;
  onEnd(next: 'selected' | 'unselected'): void;
  /**
   * This person's undo history (story 8). Typing writes with `LOCAL_ORIGIN`
   * and lands in it: one editing session is one undo step, so the capture
   * group is closed when the editor opens and again when it ends.
   */
  undo?: UndoController;
}

export function StickyTextEditor(props: StickyTextEditorProps): JSX.Element {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [fit, setFit] = useState<{ fontPx: number; overflow: boolean }>({
    fontPx: props.fontPx,
    overflow: false,
  });
  const [length, setLength] = useState<number>(() => props.ytext.toString().length);
  const composingRef = useRef<boolean>(false);

  /** Shrink the text until it fits and remember what the note has to show. */
  const refit = useCallback((): { fontPx: number; overflow: boolean } => {
    const el = ref.current;
    if (!el) return { fontPx: props.fontPx, overflow: false };
    const fitted = fitFontSize(el, props.box);
    setFit((previous) =>
      previous.fontPx === fitted.fontPx && previous.overflow === fitted.overflow
        ? previous
        : fitted,
    );
    return fitted;
  }, [props.box, props.fontPx]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Start from the document, then put the caret at the end of the text
    // (PRD "Start editing text": the cursor goes after the last character).
    const value = props.ytext.toString();
    el.value = value;
    setLength(value.length);
    el.focus();
    try {
      el.setSelectionRange(value.length, value.length);
    } catch {
      // A textarea without layout can refuse the selection; the caret position
      // is only a nicety there.
    }
    refit();
    // Mount only: the editor is recreated for every editing session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    // The editing session is one undo step: the boundary on open keeps the
    // typing from merging into whatever happened before (the drag that
    // landed the pointer here, the previous burst), and the boundary on the
    // way out — Escape, a click outside, any unmount — keeps it from
    // merging forward.
    const undo = props.undo;
    undo?.boundary();
    return () => {
      undo?.boundary();
    };
    // Mount only: the editor is recreated for every editing session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Write the textarea into Y.Text, cutting anything past the limit. */
  const commit = useCallback(
    (raw: string) => {
      const el = ref.current;
      if (!el) return;
      const clamped = clampToLimit(raw);
      if (clamped !== raw) {
        // Characters past 1,000 are dropped and the caret goes back to the end
        // of what was kept, so a long paste cannot strand the caret in the
        // middle of a truncated string.
        el.value = clamped;
        try {
          el.setSelectionRange(clamped.length, clamped.length);
        } catch {
          // See above.
        }
      }
      const value = el.value;
      setLength(value.length);
      applyTextDiff(props.ytext, value, LOCAL_ORIGIN);
      refit();
    },
    [props.ytext, refit],
  );

  return (
    <>
      <textarea
        ref={ref}
        className="sticky-note__editor"
        data-testid="sticky-note-editor"
        data-note-ui="true"
        defaultValue={props.ytext.toString()}
        style={{ fontSize: `${fit.fontPx}px` }}
        spellCheck={false}
        aria-label="Sticky note text"
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={(event) => {
          composingRef.current = false;
          commit((event.target as HTMLTextAreaElement).value);
        }}
        onChange={(event) => {
          // While an IME session is running the value is not final yet.
          if (composingRef.current) return;
          commit((event.target as HTMLTextAreaElement).value);
        }}
        onKeyDown={(event) => {
          const letter = event.key.toLowerCase();
          if (
            (event.ctrlKey || event.metaKey) &&
            (letter === 'z' || (letter === 'y' && !event.shiftKey))
          ) {
            // Ctrl/Cmd+Z inside a note is undo, not the browser's textarea
            // undo: preventDefault stops the native history, and the textarea
            // is re-read from Y.Text afterwards so the two cannot disagree
            // (design "Text undo inside the editor").
            event.preventDefault();
            event.stopPropagation();
            const undo = props.undo;
            if (undo) {
              if (letter === 'y' || event.shiftKey) undo.redo();
              else undo.undo();
              const value = props.ytext.toString();
              const el = ref.current;
              if (el) {
                el.value = value;
                setLength(value.length);
                refit();
              }
            }
            return;
          }
          if (event.key === 'Escape') {
            // Escape leaves the edit but keeps the note selected; the text is
            // already in the document, so there is nothing to flush.
            event.preventDefault();
            event.stopPropagation();
            props.onEnd('selected');
          }
          // Enter is deliberately not intercepted: inside a note it adds a
          // new line.
        }}
      />
      {fit.overflow ? (
        <div
          className="sticky-note__fade"
          data-testid="sticky-note-fade"
          aria-hidden="true"
        />
      ) : null}
      {counterVisible(length) ? (
        <div className="sticky-note__counter" data-testid="sticky-note-counter">
          {length}/{STICKY_TEXT_MAX_CHARS}
        </div>
      ) : null}
    </>
  );
}
