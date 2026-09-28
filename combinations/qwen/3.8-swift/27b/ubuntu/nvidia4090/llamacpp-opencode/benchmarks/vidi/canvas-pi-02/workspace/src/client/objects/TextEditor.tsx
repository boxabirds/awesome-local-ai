// The board text editor (story 9, text.editor): a transparent textarea
// diffed minimally into a Y.Text (shared text-edit helpers). Every input
// event is committed immediately, so ending editing never writes anything
// extra — text typed so far is already in the document.
//
// Generalised from the sticky note editor: the character limit, the
// caret/merge behaviour, the in-editor personal undo and the end semantics
// are parameterised. The sticky note keeps its exact behaviour through a
// thin wrapper (StickyTextEditor).

import {
  useCallback,
  useEffect,
  useRef,
  type ReactElement,
  type ReactNode,
} from 'react';
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { applyTextDiff, clampToLimit } from '../../shared/text-edit';
import type { UndoController } from '../board/undo';

/** How the editor ended: 'selected' (Escape — keep the object selected) or
 *  'unselected' (blur / click outside — clear the selection). */
export type TextEditorEnd = 'selected' | 'unselected';

export interface TextEditorProps {
  ytext: Y.Text;
  /** Maximum characters (text.limit); longer input is truncated. */
  maxChars: number;
  /** Font size (world px); the box already carries font family/line-height. */
  fontPx: number;
  /** Called after every committed LOCAL text change so the caller can
   *  re-measure the stored box (text.box_sync). No-op-safe. */
  onInput(): void;
  /** The editor has ended (Escape or blur). */
  onEnd(next: TextEditorEnd): void;
  /** Personal undo history (story 8, undo.boundaries). */
  undo?: UndoController;
  /** Optional character counter renderer (sticky notes). */
  renderCounter?(length: number): ReactNode;
  /** Root class (the sticky wrapper adds 'sticky-editor' to keep its
   *  story 2 geometry). */
  className?: string;
  /** Test ids (the sticky wrapper keeps its story 2 ids). */
  containerTestId?: string;
  inputTestId?: string;
}

export function TextEditor(props: TextEditorProps): ReactElement {
  const { ytext, maxChars, fontPx } = props;
  const taRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const endedRef = useRef(false);
  const lastRef = useRef('');
  const undoRef = useRef(props.undo);
  undoRef.current = props.undo;
  const onInputRef = useRef(props.onInput);
  onInputRef.current = props.onInput;
  const onEndRef = useRef(props.onEnd);
  onEndRef.current = props.onEnd;
  const renderCounterRef = useRef(props.renderCounter);
  renderCounterRef.current = props.renderCounter;

  // On mount: value from Y.Text, focused, caret at the end of the text
  // (text.caret). While editing, remote changes are merged into the
  // textarea (caret moved to the end) so a concurrent editor's characters
  // are never deleted by this editor's next commit (text.merge_remote).
  // Own commits (LOCAL_ORIGIN) are skipped: they are already in the
  // textarea.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    const initial = ytext.toString();
    lastRef.current = initial;
    ta.value = initial;
    ta.focus();
    ta.setSelectionRange(initial.length, initial.length);

    const onRemoteChange = (_event: unknown, transaction: Y.Transaction): void => {
      if (composingRef.current) return;
      if (transaction.origin === LOCAL_ORIGIN) return;
      ta.value = ytext.toString();
      lastRef.current = ta.value;
      ta.setSelectionRange(ta.value.length, ta.value.length);
    };
    ytext.observe(onRemoteChange);
    // Edit start closes any in-flight capture window (undo.boundaries):
    // typing is one step, distinct from earlier actions.
    undoRef.current?.boundary();
    return () => ytext.unobserve(onRemoteChange);
  }, [ytext]);

  const commit = useCallback(
    (value: string) => {
      const kept = clampToLimit(value, maxChars);
      if (kept !== lastRef.current) {
        applyTextDiff(ytext, kept, LOCAL_ORIGIN);
        lastRef.current = kept;
        // The local text changed: the box may need re-measuring
        // (text.box_sync — local changes only).
        onInputRef.current();
      }
      // If the value was truncated to the limit, restore the caret to the
      // end of the kept text.
      const ta = taRef.current;
      if (ta && ta.value.length > kept.length) {
        ta.setSelectionRange(kept.length, kept.length);
      }
    },
    [ytext, maxChars],
  );

  const finish = useCallback(
    (next: TextEditorEnd) => {
      if (endedRef.current) return;
      endedRef.current = true;
      // Defensive flush: every input event already committed, so this is a
      // no-op in practice (guards an uncommitted value, e.g. IME).
      const ta = taRef.current;
      if (ta && ta.value !== lastRef.current) commit(ta.value);
      // The caller may react to the END itself (story 9: an empty text
      // object is deleted) — that must happen inside the typing capture
      // window, so onEnd() runs BEFORE the boundary that closes it
      // (undo.boundaries): one undo restores the text.
      onEndRef.current(next);
      undoRef.current?.boundary();
    },
    [commit],
  );

  const length = ytext.toString().length;

  return (
    <div
      className={props.className ?? 'text-editor'}
      data-testid={props.containerTestId ?? 'text-editor'}
    >
      <textarea
        ref={taRef}
        data-testid={props.inputTestId ?? 'text-editor-input'}
        aria-label="Text"
        spellCheck={false}
        style={{ fontSize: fontPx }}
        onChange={(e) => {
          if (composingRef.current) return; // handled on compositionend
          commit(e.currentTarget.value);
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={(e) => {
          composingRef.current = false;
          commit(e.currentTarget.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            finish('selected');
            return;
          }
          // Ctrl/Cmd+Z (and redo variants) undo/redo via the personal
          // history (undo.boundaries): preventDefault keeps the browser's
          // native textarea undo from diverging from the Y.Text.
          if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
            e.preventDefault();
            if (e.shiftKey) undoRef.current?.redo();
            else undoRef.current?.undo();
            return;
          }
          if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
            e.preventDefault();
            undoRef.current?.redo();
            return;
          }
          // Enter intentionally not intercepted: it inserts a new line.
        }}
        onBlur={() => finish('unselected')}
      />
      {renderCounterRef.current?.(length)}
    </div>
  );
}
