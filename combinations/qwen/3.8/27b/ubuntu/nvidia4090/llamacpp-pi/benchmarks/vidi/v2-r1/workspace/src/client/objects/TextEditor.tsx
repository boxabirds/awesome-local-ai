// TextEditor (story 9, text.editing): the general in-place textarea used by
// free text objects. Sticky notes keep their story 2 editor behaviour via a
// thin wrapper (StickyTextEditor) around this component.
//
// Behaviour (text.editing):
//   - Every input is written to Y.Text with the minimal diff (applyTextDiff).
//   - Enter inserts a new line (default textarea behaviour).
//   - Escape ends editing, keeping the text selected.
//   - Outside pointerdown ends editing, unselecting.
//   - Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z / Ctrl+Y go through the board undo
//     controller (never the browser's native textarea undo).
//   - Characters beyond maxChars are silently dropped.
//   - Ending editing performs no additional write.
//
// Concurrency (text.concurrent): Y.Text is the source of truth and the
// textarea mirrors it. Local keystrokes are committed immediately (origin
// LOCAL_ORIGIN). When a remote change — or an undo/redo, whose origin is not
// LOCAL_ORIGIN — arrives while editing, the observer re-syncs the textarea from
// Y.Text and moves the caret through the delta (mapCaretThroughDelta). This
// keeps the invariant "textarea content == committed Y.Text" so two clients
// typing into the same text both keep every character.

import { useEffect, useLayoutEffect, useRef, type JSX } from 'react';
import * as Y from 'yjs';
import {
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
} from '../../shared/config';
import { applyTextDiff, clampToLimit } from '../../shared/text-edit';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { mapCaretThroughDelta } from './caret-delta';

/**
 * The undo capabilities the editor needs. The board's UndoController
 * satisfies this structurally; test harnesses can supply a stub.
 */
export interface TextEditorUndo {
  /** Marks an undo boundary (edit start/end). */
  boundary(): void;
  /** Undo one step. Returns true when a step was undone. */
  undo(): boolean;
  /** Redo one step. Returns true when a step was redone. */
  redo(): boolean;
}

export interface TextEditorProps {
  ytext: Y.Text;
  /** Hard character limit; the editor silently drops characters beyond it. */
  maxChars: number;
  /** Font size in world units (the object's size preset, or the note fit). */
  fontPx: number;
  /** Editor width in world units, or 'auto' to fill the parent. */
  width: number | 'auto';
  /** Editor height in world units, or 'auto' to fill the parent. */
  height?: number | 'auto';
  /** Called after every local input (the caller re-measures the box). */
  onInput(): void;
  onEnd(next: 'selected' | 'unselected'): void;
  /** Board undo controller; enables the in-editor undo/redo shortcuts. */
  undo?: TextEditorUndo;
  ariaLabel?: string;
  className?: string;
  /** test id of the underlying textarea ('text-editor' by default). */
  testId?: string;
  spellCheck?: boolean;
  /** Forwards the underlying textarea (story 2's font fit needs it). */
  textareaRef?: { current: HTMLTextAreaElement | null };
  /** Kept in sync with the committed value (story 2's counter needs it). */
  onValueChange?(value: string): void;
}

export function TextEditor(props: TextEditorProps): JSX.Element {
  const {
    ytext,
    maxChars,
    fontPx,
    width,
    height = 'auto',
    onEnd,
    ariaLabel,
    className = 'text-object__textarea',
    testId = 'text-editor',
    spellCheck = true,
    textareaRef,
    onValueChange,
  } = props;

  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const setRefs = (el: HTMLTextAreaElement | null) => {
    taRef.current = el;
    if (textareaRef !== undefined) textareaRef.current = el;
  };
  const composingRef = useRef(false);
  /** The caret (selectionStart) as tracked by this editor, for caret mapping. */
  const caretPosRef = useRef(0);

  // Keep the latest props in refs so the mount-once effects (document-level
  // listeners, the Y.Text observer) never see stale closures.
  const ytextRef = useRef(ytext);
  ytextRef.current = ytext;
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const maxCharsRef = useRef(maxChars);
  maxCharsRef.current = maxChars;
  const onValueChangeRef = useRef(onValueChange);
  onValueChangeRef.current = onValueChange;
  const undoRef = useRef(props.undo);
  undoRef.current = props.undo;
  const onInputRef = useRef(props.onInput);
  onInputRef.current = props.onInput;

  // Edit start: load the text, focus with the caret at the end, and observe
  // Y.Text so remote/undo changes merge into the live textarea. The undo
  // boundaries keep a typing burst one step (story 8); the boundary is
  // harmless when the caller already bracketed the edit.
  //
  // useLayoutEffect (not useEffect) so the textarea is populated *before* a
  // wrapper's useLayoutEffect measures it — StickyTextEditor's font fit reads
  // ta.value synchronously on mount, exactly as the story 2 controlled editor
  // did.
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    undoRef.current?.boundary();
    ta.value = ytextRef.current.toString();
    caretPosRef.current = ta.value.length;
    ta.focus();
    ta.setSelectionRange(caretPosRef.current, caretPosRef.current);
    onValueChangeRef.current?.(ta.value);

    const onTextEvent = (event: Y.YTextEvent, transaction: Y.Transaction) => {
      // Local keystrokes are already in the textarea; only merge changes that
      // did not originate here (remote sync, undo/redo).
      if (transaction.origin === LOCAL_ORIGIN) return;
      const el = taRef.current;
      if (!el) return;
      const oldCaret = caretPosRef.current;
      el.value = ytextRef.current.toString();
      const delta = event.delta.map((d) => ({
        retain: d.retain,
        insert: typeof d.insert === 'string' ? d.insert : undefined,
        delete: d.delete,
      }));
      const newCaret = mapCaretThroughDelta(delta, oldCaret);
      caretPosRef.current = newCaret;
      onValueChangeRef.current?.(el.value);
      el.setSelectionRange(newCaret, newCaret);
    };
    ytextRef.current.observe(onTextEvent);

    return () => {
      ytextRef.current.unobserve(onTextEvent);
      undoRef.current?.boundary();
    };
  }, []);

  // A pointerdown anywhere outside the textarea ends editing (unselected).
  // Capture phase so this runs before other handlers see the event.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const ta = taRef.current;
      if (ta !== null && e.target instanceof Node && ta.contains(e.target)) return;
      onEndRef.current('unselected');
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, []);

  // Write the (clamped) textarea value into Y.Text with the minimal diff,
  // then let the caller re-measure the box.
  const commit = (ta: HTMLTextAreaElement, raw: string): void => {
    const clamped = clampToLimit(raw, maxCharsRef.current);
    if (clamped !== raw) {
      // Characters beyond the limit were dropped: keep the visible value in
      // sync and put the caret at the end of the kept text.
      ta.value = clamped;
      ta.setSelectionRange(clamped.length, clamped.length);
    }
    caretPosRef.current = ta.selectionStart;
    applyTextDiff(ytextRef.current, clamped, LOCAL_ORIGIN);
    onValueChangeRef.current?.(ta.value);
    onInputRef.current();
  };

  const onTextInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    if (composingRef.current) return; // handled on compositionend (IME)
    commit(e.currentTarget, e.currentTarget.value);
  };

  const onCompositionEnd = (e: React.CompositionEvent<HTMLTextAreaElement>) => {
    composingRef.current = false;
    commit(e.currentTarget, e.currentTarget.value);
  };

  // Track the caret so a remote change can be mapped around it.
  const onSelect = () => {
    const ta = taRef.current;
    if (ta) caretPosRef.current = ta.selectionStart;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // In-editor undo/redo goes through the board controller so it never
    // diverges from Y.Text (the browser's native textarea undo would). The
    // controller's transaction has a non-LOCAL_ORIGIN origin, so the Y.Text
    // observer re-syncs the textarea (and caret) after it applies.
    if ((e.ctrlKey || e.metaKey) && !e.altKey && undoRef.current !== undefined) {
      const key = e.key.toLowerCase();
      const isRedo = (key === 'z' && e.shiftKey) || (key === 'y' && !e.shiftKey);
      const isUndo = key === 'z' && !e.shiftKey;
      if (isUndo || isRedo) {
        e.preventDefault();
        if (isRedo) undoRef.current?.redo();
        else undoRef.current?.undo();
        return;
      }
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onEndRef.current('selected');
      return;
    }
    // Enter keeps its default: a new line inside the text.
  };

  // Defensive flush: every input event has already been written, but blur
  // could arrive with a pending value (e.g. a cancelled IME composition).
  const onBlur = (e: React.FocusEvent<HTMLTextAreaElement>) => {
    if (e.currentTarget.value !== ytextRef.current.toString()) {
      commit(e.currentTarget, e.currentTarget.value);
    }
  };

  return (
    <div className="text-object__editor">
      <textarea
        ref={setRefs}
        className={className}
        data-testid={testId}
        wrap="soft"
        spellCheck={spellCheck}
        onInput={onTextInput}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={onCompositionEnd}
        onKeyDown={onKeyDown}
        onSelect={onSelect}
        onBlur={onBlur}
        aria-label={ariaLabel}
        style={{
          width: width === 'auto' ? '100%' : width,
          height: height === 'auto' ? '100%' : height,
          fontSize: fontPx,
          fontFamily: TEXT_FONT_FAMILY,
          lineHeight: TEXT_LINE_HEIGHT,
        }}
      />
    </div>
  );
}
