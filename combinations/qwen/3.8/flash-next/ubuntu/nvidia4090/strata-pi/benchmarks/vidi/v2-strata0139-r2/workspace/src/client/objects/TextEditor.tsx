import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CompositionEvent,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type * as Y from "yjs";
import { LOCAL_ORIGIN } from "../../shared/board-model";
import { applyLocalEdit, clampToLimit, commonPrefixLength } from "../../shared/text-edit";
import { useUndoBoundary } from "../board/useUndo";
import type { UndoController } from "../board/undo";

/**
 * The textarea that edits an object's `Y.Text` (`text.object`).
 *
 * Story 2 built this for sticky notes; story 9 generalises it, so a text object
 * and a note edit their text the same way and only disagree about the limit, the
 * font and what happens after a keystroke. `StickyTextEditor` is now a thin
 * wrapper over this file.
 *
 * - Uncontrolled: the DOM holds the caret, every `input` is written straight
 *   into Y.Text with a minimal diff, so ending editing needs no extra write and
 *   everything typed so far is already kept.
 * - Remote typing lands in the field too (story 3): every keystroke is already
 *   in Y.Text, so when somebody else's text arrives the field is re-synced from
 *   the shared text and the caret follows the change. Without this, the next
 *   keystroke would diff a stale value against the shared text and delete what
 *   the other person typed.
 * - Escape ends editing (the text stays); a pointerdown outside the object is
 *   handled by the object itself, which unmounts this editor.
 * - Story 8: opening and leaving an object closes an undo step, so what is typed
 *   in one editing session groups into steps by the capture timeout alone.
 *   Ctrl/Cmd+Z inside the field is answered here rather than by the browser,
 *   because the browser's own textarea undo would leave the DOM and the shared
 *   `Y.Text` disagreeing about what the object says.
 * - Enter inserts a newline (it never leaves the object).
 * - IME composition is committed on `compositionend`, never mid-composition; a
 *   remote change never overwrites text that is still being composed.
 * - `onInput` is the type's chance to react to what was just written — a text
 *   object re-measures its box there.
 */
export interface TextEditorProps {
  ytext: Y.Text;
  /** Characters this type keeps (story 2's notes and story 9's text differ). */
  maxChars: number;
  /** Font size the object is currently displaying; refined by `fitFont`. */
  fontPx: number;
  /** Field width in board units, or `auto` to fill whatever contains it. */
  width: number | "auto";
  /** Called after every write to the shared text. */
  onInput(): void;
  onEnd(next: "selected" | "unselected"): void;
  /** This tab's history, for the undo keys inside the field. */
  undo: UndoController | null;
  className?: string;
  testId?: string;
  ariaLabel?: string;
  /** Base inline style; the editor adds the font size it settled on. */
  fieldStyle?: CSSProperties;
  /** Type-specific auto-fit: a sticky note shrinks its font to stay inside its box. */
  fitFont?: (el: HTMLTextAreaElement) => { fontPx: number; overflow: boolean };
  /** Extra markup driven by the current text length (a note's character counter). */
  renderExtra?: (length: number) => ReactNode;
}

export function TextEditor({
  ytext,
  maxChars,
  fontPx,
  width,
  onInput,
  onEnd,
  undo,
  className = "board-text-editor",
  testId = "text-editor",
  ariaLabel = "Text",
  fieldStyle,
  fitFont,
  renderExtra,
}: TextEditorProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const boundary = useUndoBoundary();
  const composingRef = useRef(false);
  // Held in a ref so a caller that passes a fresh closure on every render cannot
  // re-run the effects below (which would re-focus the field mid-editing).
  const fitFontRef = useRef(fitFont);
  fitFontRef.current = fitFont;
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;
  const [size, setSize] = useState<number>(() => (Number.isFinite(fontPx) && fontPx > 0 ? fontPx : 16));
  const [overflow, setOverflow] = useState(false);
  const [length, setLength] = useState(() => ytext.toString().length);
  // The text this field last wrote, which is what a keystroke is a change *from*.
  // It is not the same as the shared text whenever an update from somebody else
  // is still on its way, and that difference is exactly what `applyLocalEdit`
  // needs so a keystroke here never overwrites their typing.
  const lastValueRef = useRef(ytext.toString());

  const measure = useCallback(() => {
    const el = ref.current;
    const fitFontNow = fitFontRef.current;
    if (!el || !fitFontNow) return;
    const fit = fitFontNow(el);
    setSize((previous: number) => (previous === fit.fontPx ? previous : fit.fontPx));
    setOverflow((previous: boolean) => (previous === fit.overflow ? previous : fit.overflow));
  }, []);

  const commit = useCallback(
    (raw: string) => {
      const el = ref.current;
      const next = clampToLimit(raw, maxChars);
      if (el && next !== raw) {
        // Characters beyond the limit are dropped and the caret goes back to
        // the end of the kept text.
        el.value = next;
        setSelectionEnd(el, next.length);
      }
      setLength(next.length);
      const previous = lastValueRef.current;
      lastValueRef.current = next;
      applyLocalEdit(ytext, previous, next, LOCAL_ORIGIN, maxChars);
      measure();
      onInputRef.current();
    },
    [ytext, maxChars, measure],
  );

  // Edit start: focus the field and put the caret at the end of its text.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    setSelectionEnd(el, el.value.length);
    measure();
  }, [measure]);

  // Edit start and edit end each close a capture window (`undo.boundaries`), so a
  // drag or a colour change before or after this editing session is never merged
  // into it. A boundary of its own changes nothing on the board.
  useEffect(() => {
    boundary();
    return boundary;
  }, [boundary]);

  const onTextField = (event: ChangeEvent<HTMLTextAreaElement>) => {
    // Mid-composition keystrokes are not real text yet (IME, e.g. Japanese).
    if (composingRef.current) return;
    commit(event.target.value);
  };

  const onCompositionEnd = (event: CompositionEvent<HTMLTextAreaElement>) => {
    composingRef.current = false;
    commit(event.currentTarget.value);
  };

  // Someone else typed into this object: pull the shared text into the field.
  // Every local keystroke is already in Y.Text, so nothing typed here is lost;
  // the caret is shifted across the change instead of jumping to the end.
  useEffect(() => {
    const handler = (_event: Y.YTextEvent, transaction: Y.Transaction) => {
      if (transaction.origin === LOCAL_ORIGIN) return;
      if (composingRef.current) return;
      const el = ref.current;
      if (!el) return;
      adoptRemoteText(el, ytext.toString());
      lastValueRef.current = el.value;
      setLength(el.value.length);
      measure();
    };
    ytext.observe(handler);
    return () => ytext.unobserve(handler);
  }, [ytext, measure]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onEnd("selected");
      return;
    }

    const mod = event.ctrlKey || event.metaKey;
    if (mod && (event.key === "z" || event.key === "Z")) {
      // The browser's native undo would change the field without changing
      // Y.Text — and the next keystroke's diff would then write that divergence
      // into the shared document. So the board's own history answers here.
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) undo?.redo();
      else undo?.undo();
      return;
    }
    if (event.ctrlKey && !event.metaKey && (event.key === "y" || event.key === "Y")) {
      event.preventDefault();
      event.stopPropagation();
      undo?.redo();
      return;
    }

    // Enter adds a line break inside the object.
  };

  const onBlur = () => {
    // Defensive flush: whatever the user typed is already in Y.Text unless an
    // unclosed composition is pending.
    if (composingRef.current) {
      composingRef.current = false;
      const el = ref.current;
      if (el) commit(el.value);
    }
  };

  const style: CSSProperties = {
    ...fieldStyle,
    ...(Number.isFinite(width) && (width as number) > 0 ? { width: `${width}px` } : null),
    fontSize: `${size}px`,
  };

  return (
    <>
      <textarea
        ref={ref}
        className={`${className}${overflow ? " is-overflow" : ""}`}
        data-testid={testId}
        data-overflow={overflow ? "true" : "false"}
        aria-label={ariaLabel}
        defaultValue={ytext.toString()}
        style={style}
        onChange={onTextField}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={onCompositionEnd}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      />
      {renderExtra ? renderExtra(length) : null}
    </>
  );
}

function setSelectionEnd(el: HTMLTextAreaElement, end: number): void {
  try {
    el.setSelectionRange(end, end);
  } catch {
    // Some browsers refuse setSelectionRange before the field is rendered.
  }
}

/**
 * Replaces the field's value with the shared text and moves the caret across
 * the change: a caret after the inserted text stays after it, a caret before it
 * stays before it.
 */
function adoptRemoteText(el: HTMLTextAreaElement, next: string): void {
  const previous = el.value;
  if (previous === next) return;

  const selectionStart = el.selectionStart ?? previous.length;
  const selectionEnd = el.selectionEnd ?? previous.length;
  const prefix = commonPrefixLength(previous, next);
  const shift = next.length - previous.length;

  el.value = next;

  const movedStart = selectionStart <= prefix ? selectionStart : Math.max(prefix, selectionStart + shift);
  const movedEnd = selectionEnd <= prefix ? selectionEnd : Math.max(prefix, selectionEnd + shift);
  try {
    el.setSelectionRange(Math.min(movedStart, next.length), Math.min(movedEnd, next.length));
  } catch {
    // Some browsers refuse setSelectionRange while the field is being rewritten.
  }
}
