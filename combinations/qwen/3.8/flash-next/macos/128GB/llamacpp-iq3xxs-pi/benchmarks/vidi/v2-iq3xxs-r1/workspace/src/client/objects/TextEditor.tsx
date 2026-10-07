import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { applyRemoteDelta, applyTextDiff, clampToLimit } from '../../shared/text-edit';
import { undoStepFor, type UndoController } from '../board/undo';

export interface TextEditorProps {
  /** The shared text of one board object; every input is written straight to it. */
  ytext: Y.Text;
  /** Characters this kind of object stores at most (PRD text.limit, sticky.limit). */
  maxChars: number;
  /** Font size in board units, so editing and display look identical. */
  fontPx: number;
  /**
   * The width of the box being edited: `'auto'` lets the textarea grow with the line
   * (an automatic-width text object), a number keeps it that wide (a text object whose
   * width was dragged), and `'fill'` fills the object's box (a sticky note, whose text
   * cannot reflow it).
   */
  width: number | 'auto' | 'fill';
  /**
   * Called after every local input, with the text as it now stands. This is where a
   * text object re-measures its box (story 9); sticky notes ignore it.
   */
  onInput?(text: string): void;
  /** Escape keeps the selection, a click outside drops it. */
  onEnd(next: 'selected' | 'unselected'): void;
  /**
   * This tab's undo history (story 8). Editing is one step — the boundary is closed
   * when the caret arrives and when it leaves — and Ctrl/Cmd+Z typed inside the
   * textarea steps that history instead of the textarea's own undo, which would
   * quietly disagree with what the shared text holds.
   */
  undo?: UndoController;
  /** Selector for the object this editor belongs to, used for "click outside". */
  rootSelector?: string;
  /** Identity of the textarea (a11y name and test hook), which differs per object type. */
  inputClassName?: string;
  inputTestId?: string;
  inputAriaLabel?: string;
  /** Extra UI under the textarea, e.g. the sticky note's character counter. */
  renderStatus?(length: number): ReactNode;
}

/** The note element the sticky editor is nested in (used for "click outside"). */
export const NOTE_SELECTOR = '[data-note-root]';
/** The default for any object that marks its own root. */
export const OBJECT_ROOT_SELECTOR = '[data-object-root]';

/**
 * Text editing for one board object: an uncontrolled textarea whose every input is
 * written straight into the shared `Y.Text` with a minimal diff. Because each
 * keystroke is already stored, ending an edit performs no extra write.
 *
 * - mount: value from `Y.Text`, focus, caret at the end of the text
 * - input: clamp to `maxChars`, then `applyTextDiff`, then `onInput`
 * - Escape: end editing and keep the object selected
 * - pointerdown outside the object: end editing and drop the selection
 * - Enter: inserts a new line (the textarea default)
 * - Backspace/Delete: edit characters, they never reach the object-deleting handler
 *
 * Story 2 had this as `StickyTextEditor`; story 9 generalised it so free text gets
 * exactly the same editing behaviour (and the same concurrent-typing safety).
 */
export function TextEditor({
  ytext,
  maxChars,
  fontPx,
  width,
  onInput,
  onEnd,
  undo,
  rootSelector = OBJECT_ROOT_SELECTOR,
  inputClassName = 'board-text-input',
  inputTestId = 'text-object-input',
  inputAriaLabel = 'Text',
  renderStatus,
}: TextEditorProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;
  const maxCharsRef = useRef(maxChars);
  maxCharsRef.current = maxChars;
  const [length, setLength] = useState(() => ytext.toString().length);

  /** Write whatever the textarea holds into the shared text (defensive flush). */
  const flush = (): void => {
    const el = ref.current;
    if (!el || composingRef.current) return;
    const clamped = clampToLimit(el.value, maxCharsRef.current);
    if (clamped !== el.value) {
      el.value = clamped;
      el.setSelectionRange(clamped.length, clamped.length);
    }
    applyTextDiff(ytext, el.value, LOCAL_ORIGIN);
    setLength((prev) => (prev === el.value.length ? prev : el.value.length));
    onInputRef.current?.(el.value);
  };

  // One edit is one undo step: whatever was typed before the caret arrived stays in
  // its own step, and so does whatever comes after this object is left (PRD undo.typing).
  useEffect(() => {
    undo?.boundary();
    return () => undo?.boundary();
  }, [undo]);

  // Cursor at the end of the existing text (sticky.edit_start, text.edit_start).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, []);

  // Somebody else typed in this object while we are typing in it: their change is
  // applied to what we are holding, and the caret stays where we left it (PRD
  // live.concurrent_text). Updates from our own keystrokes are ignored — the textarea
  // is already ahead of the document there. Changes arriving mid-composition are left
  // to the next flush, which diffs rather than replaces.
  useEffect(() => {
    const onText = (event: Y.YTextEvent, transaction: Y.Transaction): void => {
      if (transaction.origin === LOCAL_ORIGIN) return;
      const el = ref.current;
      if (!el || composingRef.current) return;
      const next = applyRemoteDelta(
        el.value,
        { start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 },
        event.delta,
      );
      el.value = next.value;
      el.setSelectionRange(next.selection.start, next.selection.end);
      setLength((prev) => (prev === next.value.length ? prev : next.value.length));
      onInputRef.current?.(next.value);
    };
    ytext.observe(onText);
    return () => ytext.unobserve(onText);
  }, [ytext]);

  // A pointerdown anywhere outside this object ends editing without losing text.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const el = ref.current;
      if (!el) return;
      const root = el.closest(rootSelector);
      const target = event.target;
      if (root && target instanceof Node && root.contains(target)) return;
      flush();
      onEndRef.current('unselected');
    };
    // Capture phase: an object's own pointerdown handler stops propagation, so a
    // bubbling listener would never see clicks on other objects.
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [ytext, rootSelector]);

  return (
    <>
      <textarea
        ref={ref}
        className={inputClassName}
        data-testid={inputTestId}
        aria-label={inputAriaLabel}
        defaultValue={ytext.toString()}
        spellCheck={false}
        style={{
          fontSize: `${fontPx}px`,
          width: width === 'auto' ? 'auto' : width === 'fill' ? '100%' : `${width}px`,
        }}
        onInput={flush}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          flush();
        }}
        onBlur={flush}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            flush();
            onEndRef.current('selected');
            return;
          }
          const step = undo ? undoStepFor(event) : null;
          if (step) {
            // The browser's own textarea undo would rewrite the box without ever
            // touching the shared text, so it is taken away here instead of being
            // followed and then corrected (PRD undo.typing, undo.shortcuts).
            event.preventDefault();
            flush();
            if (step === 'undo') undo?.undo();
            else undo?.redo();
          }
        }}
      />
      {renderStatus?.(length) ?? null}
    </>
  );
}
