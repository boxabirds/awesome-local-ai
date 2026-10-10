// Text editing for one sticky note. Story 9 generalised the editor into
// TextEditor.tsx; this wrapper pins the sticky-specific settings: the sticky
// character limit and counter, the font auto-fit box, and the class names
// story 2 established. Behaviour and markup are unchanged from story 2.

import { STICKY_COUNTER_THRESHOLD_CHARS, STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import type * as Y from 'yjs';
import type { UndoController } from '../board/undo';
import { STICKY_TEXT_BOX_WORLD } from './StickyText';
import { TextEditor } from './TextEditor';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  undo?: UndoController;
  onEnd(next: 'selected' | 'unselected'): void;
}

export function StickyTextEditor({
  ytext,
  fontPx,
  undo,
  onEnd,
}: StickyTextEditorProps): React.JSX.Element {
  return (
    <TextEditor
      ytext={ytext}
      maxChars={STICKY_TEXT_MAX_CHARS}
      fontPx={fontPx}
      width={STICKY_TEXT_BOX_WORLD}
      onInput={() => undefined}
      onEnd={onEnd}
      undo={undo}
      counterThreshold={STICKY_COUNTER_THRESHOLD_CHARS}
      fitBox={STICKY_TEXT_BOX_WORLD}
      wrapClassName="sticky-editor"
      textareaClassName="sticky-textarea"
      textareaTestId="sticky-textarea"
      counterTestId="sticky-counter"
      ariaLabel="Sticky note text"
    />
  );
}
