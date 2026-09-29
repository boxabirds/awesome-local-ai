// Story 9: the shared text editor (anchor: text.object, generalised from
// story 2's StickyTextEditor).
//
// A transparent textarea that diffs itself into the shared Y.Text with
// minimal edits (applyTextDiff). Story 3's behaviour is unchanged:
//  - every keystroke is written to the doc immediately (nothing is buffered
//    and nothing is lost when editing ends or the object is deleted);
//  - remote updates arriving while this object is edited merge into the
//    textarea, and the caret is remapped with Yjs relative positions so
//    concurrent typing by two people keeps every character (text.concurrent).
//
// Story 9 additions:
//  - the character limit is a parameter (TEXT_MAX_CHARS for text objects,
//    STICKY_TEXT_MAX_CHARS for sticky notes);
//  - onInput fires after every local write (useTextBoxSync remeasures the box
//    in the same undo capture window);
//  - when editing ends on EMPTY text the end-boundary is skipped (design key
//    decision 3): the caller then removes the object in the same capture
//    window as the last edit, so one undo restores the typed text.
//
// Sticky-note-only extras (font-fit ref, note-root click boundary, the char
// counter) are optional props so StickyTextEditor stays a thin wrapper.

import { useEffect, useRef, useState } from 'react';
import type { JSX, RefObject } from 'react';
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import type { UndoController } from '../board/undo';
import { useUndoController } from '../board/useUndo';
import { applyTextDiff, clampToLimit } from '../../shared/text-edit';

export interface TextEditorProps {
  /** The shared Y.Text bound to the object. */
  ytext: Y.Text;
  /** Hard character limit: input beyond it is not added (text.limit). */
  maxChars: number;
  /** Render font size in world px (omitted: the element inherits the font). */
  fontPx?: number;
  /** Explicit box width in world px, or 'auto' to fill the container. */
  width: number | 'auto';
  /** Called after every local write (box remeasure for text objects). */
  onInput?(): void;
  /** End editing: 'selected' (Escape) or 'unselected' (outside click). */
  onEnd(next: 'selected' | 'unselected'): void;
  /** The per-board undo controller (story 8 boundaries/shortcuts). */
  undo: UndoController | null;
  /** Attach to the textarea (sticky: the note measures it to fit the font). */
  textRef?: RefObject<HTMLElement | null>;
  /** A pointerdown inside this element does not end editing (sticky: the note root). */
  rootRef?: RefObject<HTMLElement | null>;
  /** Extra chrome rendered beside the textarea (sticky: the char counter). */
  renderExtras?(value: string): JSX.Element | null;
  ariaLabel?: string;
  /** Class for the wrapper div (sticky: sticky-note__editor). */
  wrapperClassName?: string;
  /** Class for the textarea (sticky: sticky-note__textarea). */
  textareaClassName?: string;
}

export function TextEditor(props: TextEditorProps): JSX.Element {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const [value, setValue] = useState(() => props.ytext.toString());
  const caretRel = useRef<Y.RelativePosition | null>(null);
  const composing = useRef(false);
  const ended = useRef(false);

  // Story 8: the per-board undo controller. Read through a ref so handlers
  // created once (mount effect, document pointerdown) still see the current
  // value.
  const undoFromContext = useUndoController();
  const undoRef = useRef(props.undo ?? undoFromContext);
  undoRef.current = props.undo ?? undoFromContext;

  const end = (next: 'selected' | 'unselected'): void => {
    if (ended.current) return;
    ended.current = true;
    // Step boundary at edit end (typing burst is its own undo step) — except
    // when the text is EMPTY: then the caller removes the object in the SAME
    // capture window as the last edit, so one undo restores the text (design
    // key decision 3, text.empty_removed).
    if (props.ytext.length !== 0) undoRef.current?.boundary();
    props.onEnd(next);
  };
  const endRef = useRef(end);
  endRef.current = end;

  // Mount: focus with the caret at the end of the text (text.edit); step
  // boundary at edit start (typing burst starts fresh, story 8).
  useEffect(() => {
    const ta = taRef.current;
    if (ta === null) return;
    undoRef.current?.boundary();
    ta.focus();
    const len = ta.value.length;
    ta.setSelectionRange(len, len);
    caretRel.current = Y.createRelativePositionFromTypeIndex(props.ytext, len);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Remote (non-local) text changes: merge them into the textarea and remap
  // the caret through the Yjs relative position captured at the last input.
  // Remote changes NEVER trigger a box write (useTextBoxSync is only called
  // from local handlers — text.layout, key decision 1).
  useEffect(() => {
    const ytext = props.ytext;
    const handler = (_event: Y.YTextEvent, transaction: Y.Transaction): void => {
      if (transaction.origin === LOCAL_ORIGIN) return; // our own echo
      const ta = taRef.current;
      if (ta === null) return;
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

  // A pointerdown outside the editor's root ends editing (text.edit). The
  // root defaults to the editor's own wrapper.
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onPointerDown = (e: PointerEvent): void => {
      const root = props.rootRef?.current ?? wrapperRef.current;
      if (root !== null && root !== undefined && e.target instanceof Node && root.contains(e.target)) {
        return;
      }
      endRef.current('unselected');
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const writeValue = (ta: HTMLTextAreaElement): void => {
    let next = clampToLimit(ta.value, props.maxChars);
    if (next !== ta.value) {
      ta.value = next;
      ta.setSelectionRange(next.length, next.length);
    }
    caretRel.current = Y.createRelativePositionFromTypeIndex(props.ytext, ta.selectionStart);
    applyTextDiff(props.ytext, next, LOCAL_ORIGIN);
    setValue(next);
    props.onInput?.();
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
    // Story 8: personal undo/redo inside the editor (undo.typing). The
    // textarea's native undo must not run: it would desynchronise the
    // textarea from the Y.Text, so Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z are
    // handled here against the UndoController and the default is prevented.
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) undoRef.current?.redo();
      else undoRef.current?.undo();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      end('selected');
      return;
    }
    // Enter inserts a newline (text.edit); Delete/Backspace edit text.
  };

  return (
    <div
      ref={wrapperRef}
      className={props.wrapperClassName ?? 'text-editor'}
    >
      <textarea
        ref={(el) => {
          taRef.current = el;
          if (props.textRef !== undefined) props.textRef.current = el;
        }}
        className={props.textareaClassName ?? 'text-editor__textarea'}
        value={value}
        spellCheck={false}
        aria-label={props.ariaLabel ?? 'Text'}
        style={{
          fontSize: props.fontPx,
          width: typeof props.width === 'number' ? `${props.width}px` : undefined,
        }}
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
      {props.renderExtras?.(value)}
    </div>
  );
}
