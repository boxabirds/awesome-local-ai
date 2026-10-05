/**
 * The textarea a sticky note is typed into.
 *
 * The editing itself lives in `TextEditor`, which free text shares: same diffing, same
 * remote-change handling, same limits, same undo boundary. What is kept here is what
 * belongs to a note: a font that was fitted by the note, its own placeholder and counter,
 * and the fact that a press outside *a note* is what ends the edit.
 */

import type { JSX } from 'react';
import type * as Y from 'yjs';
import { STICKY_COUNTER_THRESHOLD_CHARS, STICKY_LINE_HEIGHT, STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { TextEditor } from './TextEditor';

export interface StickyTextEditorProps {
  /** The shared text of the note being edited. */
  ytext: Y.Text;
  /** Auto-fitted font size, in world units (so it scales with the board zoom). */
  fontPx: number;
  /** Escape keeps the note selected; a click outside does not. */
  onEnd(next: 'selected' | 'unselected'): void;
}

export function StickyTextEditor(props: StickyTextEditorProps): JSX.Element {
  return (
    <TextEditor
      ytext={props.ytext}
      fontPx={props.fontPx}
      lineHeight={STICKY_LINE_HEIGHT}
      maxChars={STICKY_TEXT_MAX_CHARS}
      className="vidi6-sticky-input"
      testId="sticky-input"
      ariaLabel="Sticky note text"
      emptyPlaceholder="Type an idea"
      counterThreshold={STICKY_COUNTER_THRESHOLD_CHARS}
      counterClass="vidi6-sticky-counter"
      counterTestId="sticky-counter"
      outsideSelector='[data-vidi6="sticky"]'
      onEnd={props.onEnd}
    />
  );
}
