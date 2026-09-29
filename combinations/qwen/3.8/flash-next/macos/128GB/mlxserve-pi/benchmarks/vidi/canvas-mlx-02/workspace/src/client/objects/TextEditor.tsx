// The shared text editor (story 9). What story 2 grew for the sticky note,
// generalised: one transparent <textarea> that any text object can mount over
// its own box. Every `input` writes the minimal diff (shared/text-edit.ts)
// into the Y.Text with LOCAL_ORIGIN, so ending an edit performs no extra
// write and can never lose typed characters - and so two people typing in one
// text merge inside the Y.Text instead of overwriting each other.
//
// Why a text field on a board with an undo history needs all of this, story 2
// explained once and it still holds: the browser has its own undo for a
// textarea and the document has this tab's; if the browser's ran, this screen
// would show text the document does not have. So Ctrl/Cmd+Z goes to the
// history here, and the textarea is re-read from the document.
//
// Story 9 adds exactly two things on top: `maxChars` as a parameter (a sticky
// keeps 1,000, a text object 5,000 - the clamp helper always took it), and an
// explicit `width` so a text object's editor is exactly as wide as the box
// whose layout the object stores; `onInput` lets the owner re-measure after
// every committed change.
import { useEffect, useRef } from 'react';
import type React from 'react';
import type * as Y from 'yjs';
import { applyTextDiff, clampToLimit } from '../../shared/text-edit.ts';
import { LOCAL_ORIGIN } from '../../shared/board-model.ts';
import { useUndoController } from '../board/useUndo.ts';
import type { EndMode } from '../board/useSelection.ts';

export interface TextEditorProps {
  ytext: Y.Text;
  /** hard limit on stored characters (sticky: 1,000, text object: 5,000) */
  maxChars: number;
  fontPx: number;
  /**
   * 'auto' fills the owner's box exactly (the sticky note's layout); a number
   * is the text object's stored box width, so the caret wraps where the box
   * wraps and the height follows the text.
   */
  width: number | 'auto';
  /**
   * Called after every committed local change, with the write already in the
   * document - the text object re-measures its box here.
   */
  onInput?(): void;
  onEnd(next: EndMode): void;
  testId: string;
  ariaLabel: string;
  className?: string;
  fontFamily?: string;
  lineHeight?: number;
  paddingPx?: number;
}

export function TextEditor(props: TextEditorProps): React.JSX.Element {
  const { ytext, maxChars, fontPx, width, onInput, onEnd, testId, ariaLabel, className } = props;
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const composing = useRef(false);
  const undo = useUndoController();

  // Mount: seed the textarea from the Y.Text, focus it, place the caret at the
  // end of the existing text.
  //
  // The boundary on the way in and the one on the way out are the edit session:
  // the step that opened this editor (a drag, a click, a creation) is closed
  // before anything is typed, and everything typed here closes when the caret
  // leaves. What happens in between is up to the capture window: a run of
  // typing is one step, and stopping for longer than the window starts another.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    undo?.boundary();
    const initial = ytext.toString();
    ta.value = initial;
    ta.focus();
    const end = ta.value.length;
    ta.setSelectionRange(end, end);
    return () => {
      // Every way out of an edit passes here - Escape, a click away, the
      // object disappearing - and all of them end the step.
      undo?.boundary();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Show the textarea what the document holds, after the document was changed
  // by something other than typing here (an undo, a redo, a colleague).
  const resync = () => {
    const ta = taRef.current;
    if (!ta) return;
    const value = clampToLimit(ytext.toString(), maxChars);
    ta.value = value;
    const end = value.length;
    ta.setSelectionRange(end, end);
  };

  const commit = (raw: string) => {
    const ta = taRef.current;
    const clamped = clampToLimit(raw, maxChars);
    if (ta && clamped !== raw) {
      // Characters beyond the limit are dropped; caret goes to end of kept text.
      ta.value = clamped;
      const end = clamped.length;
      ta.setSelectionRange(end, end);
    }
    applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
    onInput?.();
  };

  const onInputEvent = (e: React.FormEvent<HTMLTextAreaElement>) => {
    if (composing.current) return; // handled on compositionend
    commit((e.target as HTMLTextAreaElement).value);
  };

  const onCompositionEnd = (e: React.CompositionEvent<HTMLTextAreaElement>) => {
    composing.current = false;
    commit((e.target as HTMLTextAreaElement).value);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      // Text typed so far is already in the document; keep it, return to selected.
      onEnd('selected');
      return;
    }
    // Ctrl/Cmd+Z and their opposites belong to this tab's history while the
    // caret is in a text: the browser's own textarea undo is a different
    // memory and would leave this screen disagreeing with everyone else's.
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && (key === 'z' || key === 'y')) {
      e.preventDefault();
      e.stopPropagation();
      if (!undo) return;
      if (key === 'z' && e.shiftKey) undo.redo();
      else if (key === 'y') undo.redo();
      else undo.undo();
      resync();
      return;
    }
    // Enter inserts a newline (default textarea behaviour, not intercepted).
    // Delete/Backspace edit the text here; stop them reaching the board handler.
    if (e.key === 'Enter') {
      e.stopPropagation();
    }
  };

  // A blur caused by a pointerdown outside the object (handled by the object /
  // viewport) tears this editor down; flush any pending uncommitted value first.
  const onBlur = (e: React.FocusEvent<HTMLTextAreaElement>) => {
    if (composing.current) return; // wait for compositionend
    commit((e.target as HTMLTextAreaElement).value);
  };

  // 'auto' fills the owner's box (the sticky note layout, inset 0); a number
  // is the text object's stored box width: the editor is that wide, its height
  // follows the text, and it wraps exactly like the laid-out display.
  const box: React.CSSProperties =
    width === 'auto'
      ? { inset: 0, width: '100%', height: '100%' }
      : { left: 0, top: 0, width: `${width}px`, height: 'auto' };

  return (
    <textarea
      ref={taRef}
      data-testid={testId}
      className={className}
      spellCheck={false}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={onCompositionEnd}
      onInput={onInputEvent}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        ...box,
        border: 'none',
        outline: 'none',
        resize: 'none',
        background: 'transparent',
        color: '#202020',
        font: 'inherit',
        ...(props.fontFamily ? { fontFamily: props.fontFamily } : null),
        fontSize: `${fontPx}px`,
        padding: `${props.paddingPx ?? 0}px`,
        boxSizing: 'border-box',
        overflow: 'hidden',
        caretColor: '#202020',
        lineHeight: props.lineHeight ?? 1.25,
      }}
      aria-label={ariaLabel}
    >
      {/* value is controlled imperatively via the ref to avoid fighting the
          browser's own input handling (IME, caret). */}
    </textarea>
  );
}
