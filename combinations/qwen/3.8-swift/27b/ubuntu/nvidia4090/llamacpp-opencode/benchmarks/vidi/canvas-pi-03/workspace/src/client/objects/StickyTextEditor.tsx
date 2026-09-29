/**
 * Story 2 sticky-note text editor — a thin wrapper over the story 9
 * generalised TextEditor (text.object): the sticky's 1,000-character limit,
 * 12 world units of padding, centred alignment and story 2 test IDs.
 */
import type { JSX } from 'react';
import * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from 'src/shared/config';
import type { UndoController } from '../board/undo';
import { TextEditor } from './TextEditor';
import { STICKY_NOTE_PADDING } from './StickyNote';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd: (next: 'selected' | 'unselected') => void;
  /** Story 8: the board's per-user undo controller. */
  undo: UndoController;
}

export function StickyTextEditor(props: StickyTextEditorProps): JSX.Element {
  return (
    <TextEditor
      ytext={props.ytext}
      maxChars={STICKY_TEXT_MAX_CHARS}
      fontPx={props.fontPx}
      width="auto"
      onInput={() => {
        /* sticky notes keep their size; only text objects remeasure */
      }}
      onEnd={props.onEnd}
      undo={props.undo}
      padding={STICKY_NOTE_PADDING}
      align="center"
      ariaLabel="Sticky note text"
      editorTestId="sticky-text-editor"
      textareaTestId="sticky-note-textarea"
      counterTestId="sticky-char-counter"
    />
  );
}
