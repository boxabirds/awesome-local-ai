import { STICKY_FONT_MAX_PX, STICKY_TEXT_MAX_CHARS } from '../../shared/config';

import { TextEditor } from './TextEditor';

export { stickyContentBox } from './TextEditor';

/**
 * The editing surface of a sticky note (story 2).
 *
 * Story 9 generalised the editing itself into `TextEditor`, because a text object
 * edits its shared `Y.Text` in exactly the same way — same minimal diff, same
 * character limit rule, same Escape and outside-click behaviour — so this is the
 * sticky note's particular answer to that: the note's own limit, its auto-fit
 * starting font size, its counter and fade, and the label its tests and screen
 * readers already know.
 */
export interface StickyTextEditorProps {
  ytext: import('yjs').Text;
  /** Initial font size; the editor re-fits itself after every edit. */
  fontPx: number;
  /** The board is locked (see `canEdit`): the text can be read, not changed. */
  readOnly?: boolean;
  /** Escape → 'selected'; a pointerdown outside the note → 'unselected'. */
  onEnd(next: 'selected' | 'unselected'): void;
}

export function StickyTextEditor({
  ytext,
  fontPx = STICKY_FONT_MAX_PX,
  readOnly = false,
  onEnd,
}: StickyTextEditorProps) {
  return (
    <TextEditor
      ytext={ytext}
      maxChars={STICKY_TEXT_MAX_CHARS}
      fontPx={fontPx}
      onEnd={onEnd}
      readOnly={readOnly}
      label="Sticky note text"
      variant="sticky"
    />
  );
}
