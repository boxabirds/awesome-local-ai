/**
 * Text editor for text objects (story 9): a borderless textarea over the
 * text box. Local state buffer; each change is a minimal Y.Text diff with
 * LOCAL_ORIGIN (one undo step per editing session — story 8).
 *
 * - input is clamped to TEXT_MAX_CHARS
 * - Delete on empty text deletes the object and ends editing WITHOUT an
 *   undo boundary, so creation + delete collapse into one undo step
 * - Escape / blur end editing (boundary when non-empty)
 * - Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z / Ctrl+Y forward to the board undo
 */
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import * as Y from 'yjs';
import { TEXT_MAX_CHARS, type TextSize } from '../../shared/config';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { applyTextDiff, clampToLimit } from '../../shared/text-edit';
import { deleteIfEmpty, isEmptyText } from '../../shared/objects/text';

export interface TextEditorProps {
  doc: Y.Doc;
  id: string;
  ytext: Y.Text;
  size: TextSize;
  onEndEdit: (id: string) => void;
  onBoundary: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

/**
 * Move a caret position from `oldText` to `newText` after a remote change:
 * - change entirely after the caret → caret unchanged
 * - change entirely before the caret → caret shifts by the net delta
 * - caret inside the changed region → clamped into the new region
 */
function adjustCaretForRemote(oldText: string, newText: string, caret: number): number {
  let prefix = 0;
  const minLen = Math.min(oldText.length, newText.length);
  while (prefix < minLen && oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)) prefix++;
  if (caret <= prefix) return caret;
  let suffix = 0;
  while (suffix < minLen - prefix &&
         oldText.charCodeAt(oldText.length - 1 - suffix) === newText.charCodeAt(newText.length - 1 - suffix)) suffix++;
  if (caret >= oldText.length - suffix) {
    return Math.max(prefix, Math.min(newText.length, caret + (newText.length - oldText.length)));
  }
  return Math.max(prefix, Math.min(newText.length, prefix + (caret - prefix)));
}

export function TextEditor(props: TextEditorProps): JSX.Element {
  const { doc, id, ytext, size, onEndEdit, onBoundary, onUndo, onRedo } = props;
  const [value, setValue] = useState(() => ytext.toString());
  const taRef = useRef<HTMLTextAreaElement>(null);
  const endedRef = useRef(false);
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.focus();
    // Caret at the end on mount (TC-19): continue after existing content.
    const len = el.value.length;
    el.setSelectionRange(len, len);
  }, []);

  // Keep the local buffer in sync with REMOTE Y.Text updates so concurrent
  // typing merges instead of clobbering: the next local input must diff
  // against the merged text, not a stale buffer. The caret is preserved.
  useEffect(() => {
    const handler = (_event: Y.YTextEvent, transaction: Y.Transaction) => {
      if (transaction.origin === LOCAL_ORIGIN) return;
      const el = taRef.current;
      const oldText = valueRef.current;
      const newText = ytext.toString();
      if (newText === oldText) return;
      const caret = el ? (el.selectionStart ?? oldText.length) : oldText.length;
      const nextCaret = adjustCaretForRemote(oldText, newText, caret);
      valueRef.current = newText;
      setValue(newText);
      // Update the DOM value synchronously (not on the next render): the
      // next local input must diff against the merged text, and an input
      // event can land before React re-renders.
      if (el) {
        el.value = newText;
        el.setSelectionRange(nextCaret, nextCaret);
      }
    };
    ytext.observe(handler);
    return () => ytext.unobserve(handler);
  }, [ytext]);

  const endEditing = useCallback(() => {
    if (endedRef.current) return;
    endedRef.current = true;
    // Empty text: the delete merges into the creation undo step (no boundary)
    if (isEmptyText(doc, id)) {
      deleteIfEmpty(doc, id);
    } else {
      onBoundary();
    }
    onEndEdit(id);
  }, [doc, id, onBoundary, onEndEdit]);

  const handleChange = useCallback(
    (next: string) => {
      const clamped = clampToLimit(next, TEXT_MAX_CHARS);
      setValue(clamped);
      applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
    },
    [ytext],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Delete on empty text with no selection: delete the object
      if (e.key === 'Delete' && !e.shiftKey && e.currentTarget.value === '' &&
          e.currentTarget.selectionStart === e.currentTarget.selectionEnd) {
        e.preventDefault();
        endEditing();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        endEditing();
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        onUndo();
        return;
      }
      if ((mod && e.key.toLowerCase() === 'z' && e.shiftKey) || (mod && e.key.toLowerCase() === 'y')) {
        e.preventDefault();
        onRedo();
        return;
      }
    },
    [endEditing, onUndo, onRedo],
  );

  return (
    <textarea
      ref={taRef}
      className={`text-editor text-size-${size}`}
      data-vidi6="text-editor"
      value={value}
      spellCheck={false}
      onChange={(e) => handleChange(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={endEditing}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}
