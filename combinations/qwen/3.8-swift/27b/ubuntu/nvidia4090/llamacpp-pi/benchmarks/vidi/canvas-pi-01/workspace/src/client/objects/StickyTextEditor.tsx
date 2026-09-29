// Text editing inside a sticky note (see spec: sticky.text).
//
// Thin wrapper over the generalised TextEditor (story 9): fixed note-width
// textarea, font auto-fit to the note, and the fade + character counter
// decorations. All the input/undo/remote-merge semantics live in TextEditor.

import type { JSX } from 'react';
import * as Y from 'yjs';
import { STICKY_SIZE_WORLD, STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import type { UndoController } from '../board/undo';
import { counterVisible } from './StickyText';
import { TextEditor } from './TextEditor';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  /** Last known fitted font size; the editor re-fits itself on mount. */
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
  /**
   * This tab's undo controller (story 8). `boundary()` on mount and on end
   * keeps the typing burst as one undo step; Ctrl/Cmd+Z inside the textarea
   * is routed to the controller (with preventDefault) so the browser's
   * native textarea undo never diverges from the Y.Text.
   */
  undo?: UndoController | null;
}

export function StickyTextEditor({ ytext, fontPx, onEnd, undo }: StickyTextEditorProps): JSX.Element {
  return (
    <TextEditor
      ytext={ytext}
      maxChars={STICKY_TEXT_MAX_CHARS}
      fontPx={fontPx}
      width={STICKY_SIZE_WORLD}
      autoFitBox={STICKY_SIZE_WORLD}
      onEnd={onEnd}
      undo={undo}
      ariaLabel="Sticky note text"
      wrapperTestId="sticky-editor"
      wrapperClassName="sticky-editor"
      textareaClassName="sticky-editor-textarea"
    >
      {({ value, overflow }) => (
        <>
          {overflow && <div data-testid="sticky-fade" className="sticky-fade" aria-hidden="true" />}
          {counterVisible(value.length) && (
            <span
              data-testid="sticky-counter"
              className="sticky-counter"
              aria-label={`${value.length} of ${STICKY_TEXT_MAX_CHARS} characters used`}
            >
              {value.length}/{STICKY_TEXT_MAX_CHARS}
            </span>
          )}
        </>
      )}
    </TextEditor>
  );
}
