import {
  type JSX,
  type CompositionEvent as ReactCompositionEvent,
  type FormEvent as ReactFormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  createAbsolutePositionFromRelativePosition,
  createRelativePositionFromTypeIndex,
  type AbsolutePosition,
  type RelativePosition,
} from 'yjs';
import type * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { applyTextDiff, applyTextDelta, clampToLimit, diffText, mergeRemoteText, counterVisible } from './StickyText';
import type { EndEditNext } from '../board/useSelection';

/**
 * The note's text editor: a plain textarea writing into the shared Y.Text on
 * every keystroke.
 *
 * - typing is written immediately, so ending editing performs no extra write;
 * - characters past the 1,000 character limit are never written at all;
 * - Escape keeps the note selected, a click outside (handled by the note) drops
 *   the selection;
 * - Enter inserts a newline instead of leaving the editor.
 *
 * Two people typing into one note at the same time (TC-23) is what shapes the
 * design:
 *
 * - only the *change* this editor made is written, never the whole value, so
 *   whatever someone else typed stays;
 * - the caret is held as a Yjs relative position, so text arriving in front of
 *   it pushes the caret along instead of dropping the caret in the wrong place;
 * - text that arrives while the editor is open is folded into what is being
 *   typed rather than replacing it.
 *
 * The textarea is deliberately uncontrolled: what is being typed lives in the
 * DOM, and React only mirrors its length for the character counter. A controlled
 * textarea re-renders from state, and a remote update landing between a
 * keystroke and the input event that follows it would repaint the box with the
 * value from before that keystroke — losing the character on the floor.
 */

export interface StickyTextEditorProps {
  ytext: Y.Text;
  /** Font size chosen by the note's fit measurement, in board units. */
  fontPx: number;
  onEnd(next: EndEditNext): void;
}

function isComposing(event: ReactFormEvent<HTMLTextAreaElement> | ReactKeyboardEvent<HTMLTextAreaElement>): boolean {
  return (event.nativeEvent as CompositionEvent & KeyboardEvent).isComposing === true;
}

/**
 * Where the caret is now, in the shared text. The anchor leans right, so it
 * names the character the caret sits in front of — and that character travels
 * with the text around it.
 */
function caretIndex(absolute: AbsolutePosition): number {
  return absolute.index;
}

/** Where a Yjs relative position points now, after everything that happened since. */
function absoluteIndex(ytext: Y.Text, anchor: RelativePosition | null): number | null {
  if (anchor === null) {
    return null;
  }
  const doc = ytext.doc;
  if (doc === null) {
    return null;
  }
  const absolute = createAbsolutePositionFromRelativePosition(anchor, doc);
  return absolute === null ? null : caretIndex(absolute);
}

/** A change of one character, which is what a single keystroke makes. */
function isSingleKeystroke(delta: { insertText: string; deleteLength: number }): boolean {
  return (
    (delta.insertText.length <= 1 && delta.deleteLength === 0) ||
    (delta.insertText === '' && delta.deleteLength === 1)
  );
}

function placeCaret(el: HTMLTextAreaElement, at: number | 'end'): void {
  const position = at === 'end' ? el.value.length : Math.min(at, el.value.length);
  try {
    el.setSelectionRange(position, position);
  } catch {
    // Some browsers refuse setSelectionRange on a detached input; harmless.
  }
}

export function StickyTextEditor({ ytext, fontPx, onEnd }: StickyTextEditorProps): JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  /** Only the counter is React state; the text itself belongs to the DOM. */
  const [lengthShown, setLengthShown] = useState<number>(() => ytext.length);
  /**
   * The shared text this editor's value was built on. Remote changes are
   * measured against it, so they can be folded into what is being typed instead
   * of replacing it.
   */
  const baseRef = useRef<string>(ytext.toString());
  /** Text that arrived during an IME composition, folded in when it ends. */
  const pendingRemoteRef = useRef(false);
  /** The caret, anchored in the shared text so remote edits cannot misplace it. */
  const anchorRef = useRef<RelativePosition | null>(null);
  /** What the caret and the value were at the key that is about to change them. */
  const beforeRef = useRef({ value: ytext.toString(), caret: ytext.length });
  /** True while this editor is the one changing the box, so its events are ignored. */
  const selfWriteRef = useRef(false);

  const currentValue = (): string => {
    const el = textareaRef.current;
    return el === null ? baseRef.current : el.value;
  };

  /**
   * Put a new value in the box, with the caret where it should be. Placing the
   * caret fires a `select` event, and that event must not be read as the user
   * having moved the caret: this editor knows exactly where it put it.
   */
  const showValue = (next: string, caret: number | 'end'): void => {
    const el = textareaRef.current;
    if (el !== null) {
      selfWriteRef.current = true;
      try {
        el.value = next;
        placeCaret(el, caret);
      } finally {
        selfWriteRef.current = false;
      }
      const position = caret === 'end' ? next.length : Math.min(caret, next.length);
      beforeRef.current = { value: next, caret: position };
    }
    setLengthShown(next.length);
  };

  const anchorCaret = (index: number): void => {
    try {
      anchorRef.current = createRelativePositionFromTypeIndex(ytext, index, 1);
    } catch {
      // The text disappeared: the next write falls back to a whole-value diff.
      anchorRef.current = null;
    }
  };

  /** Called before the browser gets a chance to change the value. */
  const noteCaret = (): void => {
    const el = textareaRef.current;
    if (import.meta.env.MODE === 'test') {
      console.log(`[editor noteCaret] selfWrite=${selfWriteRef.current} dom=${el === null ? -1 : el.value.length}`);
    }
    if (el === null || selfWriteRef.current) {
      return;
    }
    const caret = el.selectionStart;
    beforeRef.current = { value: el.value, caret };
    // When the value matches the shared text, the caret's index is an index in
    // the shared text, so the anchor moves to it. When it does not — text
    // arrived and the textarea has not caught up — the old anchor is kept: it
    // has already followed that text, and a stale index would not have.
    if (el.value === ytext.toString()) {
      anchorCaret(caret);
    }
  };

  // Edit start: caret at the end of the existing text.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) {
      return;
    }
    el.focus();
    placeCaret(el, 'end');
    anchorCaret(ytext.toString().length);
    setLengthShown(el.value.length);
  }, [ytext]);

  // Another client editing the same note while the editor is open.
  useEffect(() => {
    const handler = (event: Y.YTextEvent): void => {
      // Local writes are already in the box; adopting them again would fight
      // the caret, so only foreign origins are adopted.
      if (event.transaction.origin === LOCAL_ORIGIN) {
        return;
      }
      const remote = ytext.toString();
      if (remote === baseRef.current) {
        return;
      }
      if (composingRef.current) {
        // Never rewrite an in-progress IME composition; it is folded in when
        // the composition ends.
        pendingRemoteRef.current = true;
        return;
      }
      const el = textareaRef.current;
      const local = el === null ? baseRef.current : el.value;
      const merged = mergeRemoteText(local, baseRef.current, remote);
      baseRef.current = remote;
      // The anchor followed the shared text through everything that arrived.
      const anchored = absoluteIndex(ytext, anchorRef.current);
      const caret = anchored ?? Math.max(0, (el === null ? local.length : el.selectionStart) + merged.caretShift);
      showValue(merged.value, caret);
      beforeRef.current = { value: merged.value, caret };
    };
    ytext.observe(handler);
    return () => {
      ytext.unobserve(handler);
    };
  }, [ytext]);

  /** Write the change this editor made, leaving everything else alone. */
  const applyChange = (next: string): void => {
    const before = beforeRef.current;
    // Nothing to write when the value already is the shared text — the same
    // value can arrive twice (an input event followed by the blur that follows
    // it), and writing it a second time would add it a second time.
    if (next === baseRef.current || next === ytext.toString()) {
      return;
    }
    if (import.meta.env.MODE === 'test') {
      console.log(
        `[editor apply] next=${next.length} before=${before.value.length} caret=${before.caret} doc=${ytext.length} base=${baseRef.current.length}`,
      );
    }
    const delta = diffText(before.value, next);
    if (delta.insertText === '' && delta.deleteLength === 0) {
      return;
    }
    try {
      // A keystroke at the caret — typing, backspace, delete — is placed by the
      // caret's anchored position, which has followed the shared text through
      // anything that arrived in the meantime. Anything bigger than one
      // character (a paste, an IME flush, a whole value arriving from a test)
      // is written as a whole-value change instead.
      const atTheCaret = isSingleKeystroke(delta) && Math.abs(delta.prefix - before.caret) <= 1;
      if (atTheCaret) {
        const anchored = absoluteIndex(ytext, anchorRef.current);
        if (anchored !== null) {
          const at = Math.max(0, Math.min(anchored + (delta.prefix - before.caret), ytext.length));
          applyTextDelta(ytext, at, delta.deleteLength, delta.insertText, LOCAL_ORIGIN);
          anchorCaret(Math.min(at + delta.insertText.length, ytext.length));
          baseRef.current = ytext.toString();
          return;
        }
      }
      if (import.meta.env.MODE === 'test') {
        console.log(`[editor fallback write] next=${next.length} doc=${ytext.length}`);
      }
      applyTextDiff(ytext, next, LOCAL_ORIGIN);
      baseRef.current = ytext.toString();
      const el = textareaRef.current;
      anchorCaret(el === null ? next.length : Math.min(el.selectionStart, ytext.length));
    } catch {
      // The note (or its text) disappeared mid-keystroke: drop the edit.
    }
  };

  const commit = (next: string): void => {
    if (pendingRemoteRef.current) {
      // Something arrived while composing: fold it into what was typed before
      // writing anything.
      pendingRemoteRef.current = false;
      const remote = ytext.toString();
      const merged = mergeRemoteText(next, baseRef.current, remote);
      baseRef.current = remote;
      next = merged.value;
      showValue(merged.value, Math.max(0, merged.value.length + merged.caretShift));
    }
    const clamped = clampToLimit(next);
    if (clamped !== next) {
      showValue(clamped, 'end');
    }
    if (clamped !== currentValue()) {
      applyChange(clamped);
    }
    setLengthShown(clamped.length);
  };

  const handleInput = (event: ReactFormEvent<HTMLTextAreaElement>): void => {
    // IME composition is applied on compositionend instead, so partial
    // composition strings never reach the document.
    if (composingRef.current || isComposing(event)) {
      return;
    }
    const el = event.currentTarget;
    const raw = el.value;
    if (import.meta.env.MODE === 'test') {
      console.log(`[editor input] raw=${raw.length} before=${beforeRef.current.value.length} caret=${beforeRef.current.caret} doc=${ytext.length}`);
    }
    const clamped = clampToLimit(raw);
    // Write first: the change is measured against what the text was before this
    // input, and trimming the box would hide the characters that are being cut.
    applyChange(clamped);
    if (clamped !== raw) {
      // Past the limit the extra characters are simply not there.
      showValue(clamped, 'end');
    }
    setLengthShown(clamped.length);
  };

  const handleCompositionStart = (): void => {
    composingRef.current = true;
    noteCaret();
  };

  const handleCompositionEnd = (event: ReactCompositionEvent<HTMLTextAreaElement>): void => {
    composingRef.current = false;
    commit(event.currentTarget.value);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      commit(event.currentTarget.value);
      onEnd('selected');
      return;
    }
    // Enter inside a note adds a new line; it must not bubble to the board's
    // Enter shortcut or reach the delete shortcut.
    if (event.key === 'Enter' || event.key === 'Delete' || event.key === 'Backspace') {
      event.stopPropagation();
    }
    // Every other key is about to move the caret or change the value: note
    // where things stand before the browser does it.
    if (!isComposing(event)) {
      noteCaret();
    }
  };

  const handleBlur = (event: ReactFormEvent<HTMLTextAreaElement>): void => {
    if (import.meta.env.MODE === 'test') {
      console.log(`[editor blur] dom=${event.currentTarget.value.length} doc=${ytext.length}`);
    }
    // Defensive flush: every input event already wrote, so this is a no-op
    // unless a composition was interrupted.
    commit(event.currentTarget.value);
  };

  return (
    <div className="sticky-editor" data-testid="sticky-editor">
      <textarea
        ref={textareaRef}
        className="sticky-textarea"
        data-testid="sticky-textarea"
        defaultValue={baseRef.current}
        style={{ fontSize: `${fontPx}px` }}
        aria-label="Sticky note text"
        spellCheck
        onChange={handleInput}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={handleKeyDown}
        onClick={noteCaret}
        onSelect={noteCaret}
        onKeyUp={noteCaret}
        onBlur={handleBlur}
      />
      {counterVisible(lengthShown) ? (
        <span className="sticky-counter" data-testid="sticky-counter" aria-live="polite">
          {lengthShown}
          /{STICKY_TEXT_MAX_CHARS}
        </span>
      ) : null}
    </div>
  );
}
