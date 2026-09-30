// The text editor: a `<textarea>` that is never allowed to be the truth
// (`text.editing`, and story 2's `text_editing` before it).
//
// A sticky note and a piece of free text are different objects with one problem in
// common: the box you type in is a dumb DOM node whose value is not the shared
// `Y.Text`, and everything that goes wrong with collaborative typing goes wrong in
// the gap between the two. So there is one set of rules, and — since story 9 — one
// component that holds them. Story 2's `StickyTextEditor` is now a few lines that say
// what a note's values are.
//
// The rules that are load-bearing, each one the reason the code looks like this:
//
//   - every keystroke is committed at once, as the *smallest* change to the shared
//     text (common prefix and suffix), so two people typing in one object keep both
//     sets of characters instead of the later one winning;
//   - a change that arrives from elsewhere is written into the box, with the caret
//     kept where it can be — writing the stale local value back would erase what
//     somebody else just typed;
//   - composition (IME, accented characters) is never written through: the box holds
//     it, and the commit at `compositionend` carries it;
//   - Ctrl/Cmd+Z inside the box belongs to this tab's undo history, not to the
//     textarea's own, which knows nothing about the shared text and would put
//     characters in the box that the document does not have;
//   - Enter inserts a newline. It is not a commit key here: a newline is what the
//     object is allowed to contain;
//   - Escape ends editing with the object still selected; a pointerdown outside it
//     ends editing and lets that press decide the selection;
//   - every write is clamped at the object's character limit on the way in.
//
// What story 9 needed was not new behaviour but the same behaviour at two sizes: the
// limit, the font, the padding and the fitting are the object's, so they are props,
// and the box owner is told after each local keystroke (a text object re-measures
// itself; a note re-fits its font) and once more before the editor closes (a text
// object with no characters in it is thrown away there).
//
// Specs: spec/stories/002-capture-ideas-on-sticky-notes-and-rearrange-them/design.md
//        spec/stories/009-write-free-text-anywhere-on-the-board/design.md
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { TEXT_LINE_HEIGHT, TEXT_MAX_CHARS } from '../../shared/config';
import { applyTextDiff, clampToLimit } from '../../shared/text-edit';
import type { UndoController } from '../board/undo';

/**
 * Escape -> the object keeps the selection; a pointerdown somewhere else -> that press
 * decides the selection. Same two answers for a note and for a line of text.
 */
export type EditorEndReason = 'selected' | 'unselected';

export interface TextEditorProps {
  ytext: Y.Text;
  /** Font size to start at, in CSS pixels. */
  fontPx: number;
  /**
   * How this object's text sits in its box. A note shrinks its characters until they
   * fit the note; a piece of free text keeps the size it was given and answers to
   * nothing. Absent: the size is the size.
   */
  fit?: (element: HTMLTextAreaElement) => { fontPx: number; overflow: boolean };
  /** Characters this object may hold: a note's own limit, or the board's. */
  maxChars?: number;
  lineHeight?: number;
  fontFamily?: string;
  /** Inner padding in CSS pixels. A note has one; free text has none. */
  paddingPx?: number;
  /** Applied always, and the one added when the text no longer fits. */
  className?: string;
  overflowClass?: string;
  /** `data-testid` for this editor, so two objects open at once stay tellable apart. */
  testId: string;
  /**
   * The object's own element. A pointerdown inside it is a press on the object, not a
   * press somewhere else, and must not end editing.
   */
  containerSelector: string;
  ariaLabel?: string;
  /** After every local write. The owner of the box re-measures it here. */
  onInput?(): void;
  /** Once, just before `onEnd`, however the editor closed. */
  onClosing?(): void;
  /** The shared text's length, after anything that could have changed it. */
  onLength?(length: number): void;
  onEnd(reason: EditorEndReason): void;
  /** This tab's undo history; absent leaves Ctrl/Cmd+Z to the textarea. */
  undo?: UndoController;
}

/** How tall one line is, in CSS pixels, at this font size and line height. */
const MAX_FONT_START_PX = 4096;

const baseStyle = (
  fontPx: number,
  lineHeight: number,
  fontFamily: string,
  paddingPx: number,
): CSSProperties => ({
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  margin: 0,
  border: 'none',
  outline: 'none',
  resize: 'none',
  background: 'transparent',
  color: '#1f2328',
  fontFamily,
  lineHeight,
  padding: `${paddingPx}px`,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'break-word',
  wordBreak: 'break-word',
  fontSize: `${Math.min(fontPx, MAX_FONT_START_PX)}px`,
  overflow: 'hidden',
  boxSizing: 'border-box',
});

/** Put the caret at the end of the box, if this environment has a caret. */
function caretToEnd(element: HTMLTextAreaElement, at?: number): void {
  const length = element.value.length;
  const end = at === undefined ? length : Math.min(at, length);
  try {
    element.setSelectionRange(end, end);
  } catch {
    // A box with no selectable text (no layout, detached); nothing to put right.
  }
}

/**
 * A textarea bound to a shared `Y.Text`: committed as you type, re-derived from the
 * document on every render, and never the owner of the box around it.
 */
export function TextEditor(props: TextEditorProps): ReactNode {
  const {
    ytext,
    fontPx,
    lineHeight = TEXT_LINE_HEIGHT,
    fontFamily = 'var(--vidi6-font)',
    paddingPx = 0,
    className,
    overflowClass,
    testId,
    ariaLabel,
  } = props;
  // `maxChars`, `containerSelector` and `undo` are deliberately not pulled out here:
  // the document-level listeners are hung up once and read the current values of those
  // three through `liveRef` below.

  const ref = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const [font, setFont] = useState(fontPx);
  const [overflow, setOverflow] = useState(false);

  // Read through refs: the handlers below are installed on the document once and must
  // never act on an old render's values, and must not be torn down and re-added in the
  // middle of somebody typing.
  const liveRef = useRef(props);
  liveRef.current = props;

  /** Re-measure the box and update the size / overflow state (idempotent). */
  const measure = useCallback((): void => {
    const element = ref.current;
    if (!element) return;
    const fit = liveRef.current.fit;
    const fitted = fit ? fit(element) : { fontPx, overflow: false };
    if (fit) {
      setFont((prev) => (prev === fitted.fontPx ? prev : fitted.fontPx));
      setOverflow((prev) => (prev === fitted.overflow ? prev : fitted.overflow));
      return;
    }
    // With nothing to fit to, "does it fit" is still worth knowing: the box is drawn
    // with what the text needed, so it normally does — and when it does not, the box
    // is the object's own business, told through `onInput`.
    setOverflow(element.scrollHeight > element.clientHeight + 1);
  }, [fontPx]);

  /** Clamp, write the smallest change into the shared text, then re-measure. */
  const writeValue = useCallback(
    (raw: string): void => {
      const element = ref.current;
      if (!element) return;
      const limit = liveRef.current.maxChars ?? TEXT_MAX_CHARS;
      const clamped = clampToLimit(raw, limit);
      if (clamped !== raw) {
        // The box has characters in it that are not allowed: take them out and put the
        // caret where the text now ends, or the next keystroke goes in after them.
        element.value = clamped;
        caretToEnd(element);
      }
      applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
      liveRef.current.onLength?.(clamped.length);
      measure();
      liveRef.current.onInput?.();
    },
    [ytext, measure],
  );

  /** Pull the shared text back into the box (after an undo, redo or remote edit). */
  const resync = useCallback((): void => {
    const element = ref.current;
    if (!element || !ytext.doc) return;
    const next = ytext.toString();
    element.value = next;
    caretToEnd(element);
    liveRef.current.onLength?.(next.length);
    measure();
  }, [ytext, measure]);

  /** End editing: close the typing step, then tell the board. */
  const close = useCallback((reason: EditorEndReason): void => {
    const live = liveRef.current;
    live.undo?.boundary();
    live.onClosing?.();
    live.onEnd(reason);
  }, []);

  // Mount: start a fresh undo step for this editing session, seed the box from the
  // shared text, take the keyboard, put the caret at the end.
  useLayoutEffect(() => {
    liveRef.current.undo?.boundary();
    const element = ref.current;
    if (!element) return;
    element.value = ytext.toString();
    liveRef.current.onLength?.(element.value.length);
    measure();
    element.focus();
    caretToEnd(element);
  }, [ytext, measure]);

  // A change from elsewhere — the other person typing in this very object while we are
  // sitting in it. The box holds its own value, so it has to be brought in line with
  // the document, not the other way round.
  useEffect(() => {
    const onRemoteText = (_event: Y.YTextEvent, transaction: Y.Transaction): void => {
      if (transaction.local) return; // our own write: the box is already ahead of it
      const element = ref.current;
      if (!element) return;
      const next = ytext.toString();
      const start = element.selectionStart ?? next.length;
      const end = element.selectionEnd ?? next.length;
      element.value = next;
      const from = Math.min(start, next.length);
      const to = Math.min(Math.max(end, from), next.length);
      try {
        element.setSelectionRange(from, to);
      } catch {
        // no selectable text here; nothing to put right
      }
      liveRef.current.onLength?.(next.length);
      measure();
    };
    ytext.observe(onRemoteText);
    return () => {
      ytext.unobserve(onRemoteText);
    };
  }, [ytext, measure]);

  // A pointerdown outside the object ends editing, and that press goes on to do what
  // it was going to do — including deciding the selection.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const element = ref.current;
      if (!element) return;
      const container = element.closest(liveRef.current.containerSelector);
      if (container && event.target instanceof Node && container.contains(event.target)) return;
      close('unselected');
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [close]);

  const onInput = (): void => {
    if (composingRef.current) return; // wait for compositionend (IME)
    const element = ref.current;
    if (element) writeValue(element.value);
  };

  const onCompositionEnd = (): void => {
    composingRef.current = false;
    const element = ref.current;
    if (element) writeValue(element.value);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape') {
      // Not the board's Escape: the object keeps the selection, and the keystroke
      // stops here rather than clearing the whole selection behind the editor.
      event.preventDefault();
      event.stopPropagation();
      close('selected');
      return;
    }
    // Enter is left to the textarea, which inserts the newline the object allows.
    //
    // Ctrl/Cmd+Z and its redo partners are taken from the browser: the textarea keeps
    // an undo history of its own that knows nothing about the shared text, and letting
    // it fire would put characters in the box that the document does not have.
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (mod && !event.altKey && key === 'z') {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) liveRef.current.undo?.redo();
      else liveRef.current.undo?.undo();
      resync();
      return;
    }
    if (event.ctrlKey && !event.metaKey && !event.altKey && key === 'y') {
      event.preventDefault();
      event.stopPropagation();
      liveRef.current.undo?.redo();
      resync();
    }
  };

  const onBlur = (): void => {
    // Defensive flush; every keystroke is already committed. Guarded so an object that
    // vanished mid-edit (deleted elsewhere) is not written to.
    const element = ref.current;
    if (!element || !ytext.doc) return;
    const clamped = clampToLimit(element.value, liveRef.current.maxChars ?? TEXT_MAX_CHARS);
    if (clamped !== ytext.toString()) applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
    liveRef.current.undo?.boundary();
    // Leaving the box is also the second chance to throw away an object that came to
    // nothing: a click elsewhere must not leave an empty object behind, any more than
    // Escape does.
    liveRef.current.onClosing?.();
  };

  return (
    <textarea
      ref={ref}
      data-testid={testId}
      data-overflow={overflow ? 'true' : 'false'}
      className={
        overflow && overflowClass
          ? [className, overflowClass].filter(Boolean).join(' ')
          : className
      }
      style={baseStyle(font, lineHeight, fontFamily, paddingPx)}
      spellCheck={false}
      aria-label={ariaLabel}
      aria-multiline="true"
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onCompositionEnd={onCompositionEnd}
      onInput={onInput}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      // A press inside the box is typing, not selecting and not dragging; it must not
      // reach the object behind it, which would start a move of the very object the
      // caret is in.
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    />
  );
}
