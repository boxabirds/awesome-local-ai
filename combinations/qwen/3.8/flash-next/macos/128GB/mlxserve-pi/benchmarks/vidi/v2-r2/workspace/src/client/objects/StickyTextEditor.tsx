// The caret a sticky note's idea is typed into (story 2).
//
// Everything about editing — the caret at the end on open, Enter for a newline,
// Escape and clicks outside to leave, the minimal diff to the Y.Text, the
// 1,000-character limit, Ctrl/Cmd+Z in place, the undo boundaries around a run of
// typing — is the shared TextEditor's business, and lives there. What is a sticky
// note's own is these settings: its limit, its counter, and the fact that a note
// keeps its box and shrinks its font until the text fits.

import { type JSX } from 'react';
import type * as Y from 'yjs';
import { STICKY_COUNTER_THRESHOLD_CHARS, STICKY_SIZE_WORLD, STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import type { EndEditNext } from '../board/useSelection';
import { useUndoControllerContext } from '../board/useUndo';
import { TextEditor } from './TextEditor';
import { NOTE_PADDING_WORLD } from './StickyText';

/** Height the text may use: the note minus its padding, in world units. */
export const TEXT_BOX_WORLD = STICKY_SIZE_WORLD - NOTE_PADDING_WORLD * 2;

/** Attribute the note root carries, used to tell clicks inside from outside. */
export const NOTE_ATTRIBUTE = 'data-note-id';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  /** Font size the note measured before handing over, as a starting point. */
  fontPx: number;
  /**
   * Height the text may use, world units - the note's height minus its
   * padding. Defaults to the standard note's; a resized note (story 7)
   * passes its own, so the auto-fit answers for the box the user made.
   */
  boxWorld?: number;
  onEnd(next: EndEditNext): void;
}

export function StickyTextEditor({
  ytext,
  fontPx,
  boxWorld = TEXT_BOX_WORLD,
  onEnd,
}: StickyTextEditorProps): JSX.Element {
  const undo = useUndoControllerContext();
  return (
    <TextEditor
      ytext={ytext}
      maxChars={STICKY_TEXT_MAX_CHARS}
      fontPx={fontPx}
      width="auto"
      fit={{ height: boxWorld }}
      onInput={() => {
        // a note's box is its own, whatever the text says: nothing to re-measure
      }}
      onEnd={onEnd}
      undo={undo}
      testId="sticky-text"
      ariaLabel="Sticky note text"
      className="sticky-input"
      counterThreshold={STICKY_COUNTER_THRESHOLD_CHARS}
      insideAttribute={NOTE_ATTRIBUTE}
    />
  );
}
