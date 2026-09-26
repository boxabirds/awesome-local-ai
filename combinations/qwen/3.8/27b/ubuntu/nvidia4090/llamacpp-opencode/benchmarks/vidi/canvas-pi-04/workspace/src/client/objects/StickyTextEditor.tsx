// Story 2: sticky note text editor (anchor: sticky.text).
//
// A transparent textarea that diffs itself into the shared Y.Text with
// minimal edits (applyTextDiff). Story 3 depends on this behaviour:
//  - every keystroke is written to the doc immediately (nothing is buffered
//    and nothing is lost when editing ends or the note is deleted);
//  - remote updates arriving while this note is edited merge into the
//    textarea, and the caret is remapped with Yjs relative positions so
//    concurrent typing by two people keeps every character (PRD
//    live.concurrent_text).

import { useEffect, useRef, useState } from 'react';
import type { JSX, RefObject } from 'react';
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { applyTextDiff, clampToLimit, counterVisible } from './StickyText';

export function StickyTextEditor(props: {
  ytext: Y.Text;
  /** Attach this to the textarea so the note can measure and fit the font. */
  textRef: RefObject<HTMLElement | null>;
  /** The note root; a pointerdown inside it does not end editing. */
  rootRef: RefObject<HTMLElement | null>;
  onEnd: (next: 'selected' | 'unselected') => void;
}): JSX.Element {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const [value, setValue] = useState(() => props.ytext.toString());
  const caretRel = useRef<Y.RelativePosition | null>(null);
  const composing = useRef(false);
  const ended = useRef(false);

  const end = (next: 'selected' | 'unselected'): void => {
    if (ended.current) return;
    ended.current = true;
    props.onEnd(next);
  };

  // Mount: focus with the caret at the end of the text (PRD sticky.edit_start).
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.focus();
    const len = ta.value.length;
    ta.setSelectionRange(len, len);
    caretRel.current = Y.createRelativePositionFromTypeIndex(props.ytext, len);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Remote (non-local) text changes: merge them into the textarea and remap
  // the caret through the Yjs relative position captured at the last input.
  useEffect(() => {
    const ytext = props.ytext;
    const handler = (_event: Y.YTextEvent, transaction: Y.Transaction): void => {
      if (transaction.origin === LOCAL_ORIGIN) return; // our own echo
      const ta = taRef.current;
      if (!ta) return;
      const newText = ytext.toString();
      setValue(newText);
      if (composing.current) return; // finish on compositionend instead

      let index = newText.length; // caret at the end when we have no marker
      const rel = caretRel.current;
      const doc = ytext.doc;
      if (rel !== null && doc !== null) {
        const abs = Y.createAbsolutePositionFromRelativePosition(rel, doc);
        if (abs !== null && abs.type === ytext) index = abs.index;
      }
      // Apply the selection after React has committed the new value.
      requestAnimationFrame(() => {
        const current = taRef.current;
        if (current !== null && current.value === newText) {
          try {
            current.setSelectionRange(index, index);
          } catch {
            // Selection can be invalid on a detached element; ignore.
          }
        }
      });
    };
    ytext.observe(handler);
    return () => {
      ytext.unobserve(handler);
    };
  }, [props.ytext]);

  // A pointerdown outside the note ends editing (PRD sticky.edit_end).
  useEffect(() => {
    const onPointerDown = (e: PointerEvent): void => {
      const root = props.rootRef.current;
      if (root !== null && e.target instanceof Node && root.contains(e.target)) return;
      end('unselected');
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
    // `end` is stable (guarded by the `ended` ref).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const writeValue = (ta: HTMLTextAreaElement): void => {
    let next = ta.value;
    if (next.length > STICKY_TEXT_MAX_CHARS) {
      next = next.slice(0, STICKY_TEXT_MAX_CHARS);
      ta.value = next;
      ta.setSelectionRange(next.length, next.length);
    }
    caretRel.current = Y.createRelativePositionFromTypeIndex(
      props.ytext,
      ta.selectionStart,
    );
    applyTextDiff(props.ytext, next, LOCAL_ORIGIN);
    setValue(next);
  };

  const onInput = (e: React.FormEvent<HTMLTextAreaElement>): void => {
    if (composing.current) return;
    writeValue(e.currentTarget);
  };

  const onCompositionEnd = (e: React.CompositionEvent<HTMLTextAreaElement>): void => {
    composing.current = false;
    writeValue(e.currentTarget);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      end('selected');
      return;
    }
    // Enter inserts a newline (not intercepted). Delete/Backspace edit text.
  };

  return (
    <div className="sticky-note__editor">
      <textarea
        ref={(el) => {
          taRef.current = el;
          props.textRef.current = el;
        }}
        className="sticky-note__textarea"
        value={value}
        spellCheck={false}
        aria-label="Sticky note text"
        onInput={onInput}
        onKeyDown={onKeyDown}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={onCompositionEnd}
        onSelect={() => {
          const ta = taRef.current;
          if (ta !== null) {
            caretRel.current = Y.createRelativePositionFromTypeIndex(
              props.ytext,
              ta.selectionStart,
            );
          }
        }}
      />
      {counterVisible(value.length) && (
        <div className="sticky-note__counter" aria-hidden="true">
          {value.length}/{STICKY_TEXT_MAX_CHARS}
        </div>
      )}
    </div>
  );
}
