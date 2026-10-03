// The live text editor shared by every board object that carries a `Y.Text` — the
// sticky note (story 2, via `StickyTextEditor`) and free text (story 9). It is
// story 2's editor with the type-specific numbers pulled out into props:
//
//  - `maxChars` — the character budget (sticky 2 000, text 5 000);
//  - `fontPx` / `width` — the box the caret sits in;
//  - `autoFit` — shrink the font to the available height and fade overflow (only a
//    sticky note has a fixed box to fit; a text object's box grows with its content);
//  - `showCounter` — the "n / max" hint near the limit (sticky only);
//  - `onInput()` — called after every committed local change, which is what lets a
//    text object re-measure and store its box (text.layout);
//  - `onEnd('selected' | 'unselected')` — Escape keeps the object selected, a click
//    outside deselects it (sticky.edit_end / text.object).
//
// Behaviour, unchanged from story 2: the box is seeded from the shared text and
// focused with the caret at the end; every change is written as the *delta* since this
// box last wrote (`applyTextDelta`), so a colleague typing at the same time keeps
// every character; IME composition is deferred to `compositionend`; a remote change is
// adopted and the caret stepped around it; Ctrl/Cmd+Z (and Shift / Ctrl+Y) go to this
// tab's undo controller instead of the browser's textarea history; entering and leaving
// an edit closes an undo boundary so one edit is one undo step.
//
// `Y.Text`'s observer fires for local writes too, so the remote path ignores changes
// whose transaction origin is `LOCAL_ORIGIN` (this tab's own writes).

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import {
  applyTextDelta,
  caretAfterRemoteEdit,
  clampToLimit,
  counterVisible,
  fitFontSize,
  textDelta,
  type TextOp,
} from './StickyText';
import type { UndoController } from '../board/undo';

export interface TextEditorProps {
  ytext: Y.Text;
  /** Character budget for this object type (sticky 2000, text 5000). */
  maxChars: number;
  /** Font size to start at; only changed by `autoFit`. */
  fontPx: number;
  /** Width of the box in px, or 'auto' to hug the content. */
  width: number | 'auto';
  /** After every committed local change (a text object re-measures its box here). */
  onInput(): void;
  /** Leave the editor: 'selected' keeps the object selected, 'unselected' clears. */
  onEnd(next: 'selected' | 'unselected'): void;
  /** This tab's undo controller (null on a board that cannot be edited). */
  undo: UndoController | null;
  /** Fit the text into the available height and fade what still does not fit. */
  autoFit?: boolean;
  /** Show the remaining-characters counter as the text nears `maxChars`. */
  showCounter?: boolean;
  /** data-testid of the textarea. */
  testId: string;
  /** Accessible name of the textarea. */
  ariaLabel: string;
  /** Extra class names on the textarea (the sticky note's own look). */
  className: string;
  /** data-testid of the overflow fade, when `autoFit` renders one. */
  fadeTestId?: string;
  /** data-testid / label of the character counter, when `showCounter` renders one. */
  counterTestId?: string;
}

/** The nearest board-object ancestor of an element (both types use role=group). */
function objectAncestor(el: Element | null): Element | null {
  return el?.closest('[role="group"]') ?? null;
}

export function TextEditor(props: TextEditorProps) {
  const {
    ytext,
    maxChars,
    fontPx,
    width,
    onInput,
    onEnd,
    undo,
    autoFit = false,
    showCounter = false,
    testId,
    ariaLabel,
    className = '',
    fadeTestId,
    counterTestId,
  } = props;

  const ref = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  /** What this box last wrote to (or read from) the shared text. */
  const baseRef = useRef<string>(ytext.toString());
  // A pending value written to the DOM directly but not yet committed (only used
  // to satisfy the uncontrolled/controlled edge when clamping truncates).
  const [length, setLength] = useState(() => ytext.toString().length);
  const [fit, setFit] = useState({ fontPx, overflow: false });

  // Re-measure the textarea and update font size / overflow from real layout.
  const remeasure = () => {
    if (!autoFit) return;
    const el = ref.current;
    if (!el) return;
    const box = el.clientHeight || el.offsetHeight;
    const result = fitFontSize(el, box);
    setFit((prev) =>
      prev.fontPx === result.fontPx && prev.overflow === result.overflow
        ? prev
        : result,
    );
  };

  /**
   * Show `value` in the box with the caret at `caret`, and remember it as the
   * basis of the next local change.
   */
  const adopt = (value: string, caret: number): void => {
    baseRef.current = value;
    const el = ref.current;
    if (!el) return;
    if (el.value !== value) el.value = value;
    const at = Math.min(Math.max(caret, 0), value.length);
    el.setSelectionRange(at, at);
    setLength(value.length);
    remeasure();
  };

  const commit = () => {
    const el = ref.current;
    if (!el) return;
    const next = clampToLimit(el.value, maxChars);
    const delta = textDelta(baseRef.current, next);
    if (delta.deleteCount === 0 && delta.insert.length === 0) {
      // Nothing changed here; just pick up whatever the other person typed.
      adopt(ytext.toString(), next.length);
      return;
    }
    // Only this box's own change goes to the shared text, wherever that text has
    // got to in the meantime — characters typed by someone else survive.
    const merged = applyTextDelta(ytext, delta, LOCAL_ORIGIN);
    adopt(merged, delta.start + delta.insert.length);
    // The object's content changed locally, so whoever owns the box recomputes it
    // (text.layout: only the client that changed the text measures it).
    onInput();
  };

  // Mount: seed the textarea, focus it and place the caret at the end of the text.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.value = ytext.toString();
    baseRef.current = el.value;
    setLength(el.value.length);
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
    remeasure();
    // Opening an edit ends any in-progress capture so this edit is its own undo
    // step, never merged with a prior move or another object's edit
    // (undo.boundaries: boundary at edit start).
    undo?.boundary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ytext]);

  // The other person's typing on this object appears while we are editing it too:
  // their change is adopted into the box and the caret is stepped around it.
  useEffect(() => {
    const onRemote = (
      event: Y.YTextEvent,
      transaction: Y.Transaction,
    ): void => {
      if (transaction.origin === LOCAL_ORIGIN) return; // our own write, already adopted
      if (composingRef.current) return; // never disturb an in-flight composition
      const value = ytext.toString();
      const el = ref.current;
      if (el && el.value === value) {
        baseRef.current = value;
        return;
      }
      const caret = el
        ? caretAfterRemoteEdit(
            el.selectionStart ?? value.length,
            event.delta as unknown as readonly TextOp[],
          )
        : value.length;
      adopt(value, caret);
    };
    ytext.observe(onRemote);
    return () => ytext.unobserve(onRemote);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ytext]);

  // A pointerdown outside this object ends editing and deselects (sticky.edit_end /
  // text.object). Registered synchronously: editing is always entered by an event
  // (dblclick, Enter or the Text tool click) whose dispatch has already finished by
  // the time this effect runs, so the effect never observes its own triggering event.
  useEffect(() => {
    const object = objectAncestor(ref.current);
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (object && target && object.contains(target)) return; // inside: keep editing
      commit();
      // Leave first, then close the undo capture: an object that ends up empty is
      // deleted by `onEnd`, and that delete has to be part of *this* edit's undo step
      // (undo.step), not a step of its own.
      onEnd('unselected');
      undo?.boundary();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onEnd]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl/Cmd+Z (and Ctrl/Cmd+Shift+Z, Ctrl+Y) undo/redo *this tab's* work while the
    // caret is in the object, instead of the browser's own textarea history
    // (undo.typing error path). The inverse arrives with a non-local origin, so the
    // `onRemote` observer above re-adopts the undone text into the box automatically.
    const mod = e.metaKey || e.ctrlKey;
    if (undo && mod && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) undo.redo();
      else undo.undo();
      return;
    }
    if (undo && e.ctrlKey && !e.metaKey && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      e.stopPropagation();
      undo.redo();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      commit();
      onEnd('selected');
      undo?.boundary(); // leaving the edit closes this object's typing step
    }
    // Enter inserts a newline (default textarea behaviour); Delete/Backspace edit
    // characters and never reach the App-level delete handler.
  };

  const onInputEvent = () => {
    if (composingRef.current) return; // wait for compositionend
    commit();
  };

  const onPointerDownSelf = (e: ReactPointerEvent<HTMLTextAreaElement>) => {
    // Clicking inside the object must neither pan the board nor start an object drag.
    e.stopPropagation();
  };

  const counter =
    showCounter && counterVisible(length) ? (
      <span data-testid={counterTestId} className="sticky-counter">
        {length}/{maxChars}
      </span>
    ) : null;

  return (
    <>
      <textarea
        ref={ref}
        data-testid={testId}
        className={className}
        spellCheck={false}
        onInput={onInputEvent}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDownSelf}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          commit();
        }}
        onBlur={commit}
        // Only the font size (and, for a text object, the box width) is set inline:
        // each type's own class styles the rest, exactly as before this editor was
        // shared — a sticky note keeps `.sticky-text / .sticky-editing`.
        style={width === 'auto' ? { fontSize: fit.fontPx } : { fontSize: fit.fontPx, width }}
        aria-label={ariaLabel}
      />
      {autoFit && fit.overflow ? (
        <div
          className="sticky-fade"
          data-testid={fadeTestId}
          aria-hidden="true"
        />
      ) : null}
      {counter}
    </>
  );
}
