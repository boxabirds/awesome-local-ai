// The sticky note's text editor (story 2, sticky.text): a thin wrapper
// around the shared TextEditor (story 9) that keeps the sticky behaviour
// exactly as story 7/8 left it: 1,000-char limit, centred font auto-fit
// size, the character counter, and onEnd semantics (the caller decides the
// next selection state).

import type { ReactElement } from 'react';
import * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import type { UndoController } from '../board/undo';
import { counterVisible } from './StickyText';
import { TextEditor } from './TextEditor';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  /** The editor has ended (Escape or blur); the caller decides the next
   *  selection/editing state (story 7 keeps the selection on Escape). */
  onEnd(): void;
  /** Personal undo history (story 8, undo.boundaries). */
  undo?: UndoController;
}

export function StickyTextEditor(props: StickyTextEditorProps): ReactElement {
  return (
    <TextEditor
      ytext={props.ytext}
      maxChars={STICKY_TEXT_MAX_CHARS}
      fontPx={props.fontPx}
      onInput={() => {}}
      onEnd={() => props.onEnd()}
      className="text-editor sticky-editor"
      undo={props.undo}
      renderCounter={(length) =>
        counterVisible(length) ? (
          <span className="sticky-counter" data-testid="sticky-char-counter">
            {length}/{STICKY_TEXT_MAX_CHARS}
          </span>
        ) : null
      }
      containerTestId="sticky-editor"
      inputTestId="sticky-editor-input"
    />
  );
}
