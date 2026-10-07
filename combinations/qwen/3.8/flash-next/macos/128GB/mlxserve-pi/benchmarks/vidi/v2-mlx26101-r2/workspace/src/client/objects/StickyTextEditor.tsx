/**
 * The sticky note's text editor (story 2, design anchor `sticky.edit`).
 *
 * Story 9 moved the editing rules into `TextEditor.tsx` - a text object needs
 * exactly the same behaviour, with a different character limit - and this is what
 * is left: the sticky note's settings handed to that editor. The names story 2's
 * tests and `StickyNote.tsx` use are unchanged.
 */

import type { JSX } from 'react';

import * as Y from 'yjs';

import { STICKY_TEXT_MAX_CHARS } from '../../shared/config.js';
import type { UndoController } from '../board/undo.js';
import { counterVisible } from './StickyText.js';
import { TextEditor } from './TextEditor.js';

/** How the editor finds the note it belongs to (for "clicked outside the note"). */
export const STICKY_NOTE_ATTRIBUTE = 'data-sticky-note';

export interface StickyTextEditorProps {
  /** The shared text of the note: every change is written straight into it. */
  ytext: Y.Text;
  /** Font size chosen by the note's auto-fit, in board units. */
  fontPx: number;
  /** Escape (still selected) or a click outside (nothing selected). */
  onEnd(next: 'selected' | 'unselected'): void;
  /** This tab's own undo history (story 8); see `TextEditor`'s prop of the same name. */
  undo?: UndoController;
}

/** The editor's accessible name. */
export const STICKY_EDITOR_LABEL = 'Sticky note text';

/**
 * A note's editor at the note's settings: 1,000 characters, a box the note itself
 * decides (so no width is passed), the "n/1000" counter near the limit, and no
 * remeasuring - a note's box never follows its text.
 */
export function StickyTextEditor({ ytext, fontPx, onEnd, undo }: StickyTextEditorProps): JSX.Element {
  return (
    <TextEditor
      ytext={ytext}
      maxChars={STICKY_TEXT_MAX_CHARS}
      fontPx={fontPx}
      onEnd={onEnd}
      undo={undo}
      label={STICKY_EDITOR_LABEL}
      testId="sticky-editor"
      className="sticky-editor"
      ownerAttribute={STICKY_NOTE_ATTRIBUTE}
      showCounter={counterVisible}
    />
  );
}
