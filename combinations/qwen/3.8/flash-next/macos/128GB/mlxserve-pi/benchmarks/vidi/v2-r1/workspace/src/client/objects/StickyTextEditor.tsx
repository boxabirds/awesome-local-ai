// The sticky note's editor: story 2's component, which since story 9 is the board's
// shared `TextEditor` with a note's numbers in it (`text.editing`).
//
// Everything hard about typing into a shared object — a remote insert landing in the
// middle of what you are typing, composition, the character limit, the undo that
// belongs to the board and not to the textarea — lives in `TextEditor.tsx`, and story
// 2's tests are what prove it still works. What is only ever a note's own: a limit of
// its own, a line height of its own, the padding its text sits in, the class the
// overflow fade goes on, characters shrunk until they fit the note, and the counter
// that says how close the limit is.
//
// Spec: spec/stories/002-capture-ideas-on-sticky-notes-and-rearrange-them/design.md
import { useState, type CSSProperties, type ReactNode } from 'react';
import type * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import type { UndoController } from '../board/undo';
import { TextEditor, type EditorEndReason } from './TextEditor';
import {
  counterVisible,
  fitFontSize,
  stickyTextContentBox,
  STICKY_TEXT_PADDING_WORLD,
} from './StickyText';

/** How typing stopped. Story 2's name for it, kept for its callers. */
export type StickyEditorEndReason = EditorEndReason;

export interface StickyTextEditorProps {
  ytext: Y.Text;
  /** Font size the note's display had when editing started; re-fit from here. */
  fontPx: number;
  /** The note's height in board units; the box the text has to fit (story 7). */
  height?: number;
  /** Escape -> 'selected'; pointerdown outside the note -> 'unselected'. */
  onEnd(next: 'selected' | 'unselected'): void;
  /**
   * This tab's undo history (story 8). Opening and closing the editor closes a step
   * so a typing burst is one undo, and Ctrl/Cmd+Z inside the note is routed through it
   * instead of the browser's own textarea undo, which would silently diverge from the
   * shared `Y.Text`. Absent: the board is not undoable.
   */
  undo?: UndoController;
}

/**
 * A sticky note's textarea: the shared editor, fitted to the note and counted against
 * the note's limit.
 */
export function StickyTextEditor({
  ytext,
  fontPx,
  height,
  onEnd,
  undo,
}: StickyTextEditorProps): ReactNode {
  // The counter is the note's business, so the length comes out of the editor as a
  // callback rather than the editor deciding to show anything.
  const [length, setLength] = useState(() => ytext.toString().length);

  return (
    <>
      <TextEditor
        ytext={ytext}
        fontPx={fontPx}
        // A note shrinks its characters until they fit; this is the box they have to
        // fit, and this is the only thing about the editor a note decides differently
        // from a piece of free text.
        fit={(element) => fitFontSize(element, stickyTextContentBox(height))}
        maxChars={STICKY_TEXT_MAX_CHARS}
        lineHeight={1.25}
        fontFamily="var(--vidi6-font)"
        paddingPx={STICKY_TEXT_PADDING_WORLD}
        className="sticky-note__text"
        overflowClass="sticky-note__text--overflow"
        testId="sticky-note-text"
        containerSelector='[data-testid="sticky-note"]'
        ariaLabel="Sticky note text"
        onLength={setLength}
        onEnd={onEnd}
        undo={undo}
      />
      {counterVisible(length) ? (
        <span data-testid="sticky-note-counter" style={counterStyle}>
          {`${length}/${STICKY_TEXT_MAX_CHARS}`}
        </span>
      ) : null}
    </>
  );
}

const counterStyle: CSSProperties = {
  position: 'absolute',
  right: 6,
  bottom: 4,
  fontSize: 11,
  lineHeight: 1,
  color: 'rgba(31, 35, 40, 0.6)',
  fontVariantNumeric: 'tabular-nums',
  pointerEvents: 'none',
};
