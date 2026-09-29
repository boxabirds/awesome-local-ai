// Sticky note text editor (story 2), which since story 9 is the shared
// TextEditor specialised to a note: the sticky note's 1,000-character limit
// and its fill-the-box layout (`width="auto"`), with the note's own padding,
// line height and element identity. Every behaviour - minimal-diff writes, the
// edit-session undo boundaries, Ctrl/Cmd+Z steered to the board's history, IME
// composition, the click-away blur - lives in TextEditor.tsx and is unchanged
// here; story 2's suite drives this component exactly as it always did.
import type React from 'react';
import type * as Y from 'yjs';
import { TextEditor } from './TextEditor.tsx';
import { counterVisible } from './StickyText.ts';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config.ts';
import type { EndMode } from '../board/useSelection.ts';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: EndMode): void;
}

export function StickyTextEditor(props: StickyTextEditorProps): React.JSX.Element {
  return (
    <TextEditor
      ytext={props.ytext}
      maxChars={STICKY_TEXT_MAX_CHARS}
      fontPx={props.fontPx}
      width="auto"
      testId="sticky-editor"
      className="sticky-editor"
      ariaLabel="Sticky note text"
      lineHeight={1.25}
      paddingPx={12}
      onEnd={props.onEnd}
    />
  );
}

export function StickyCharCounter({ length }: { length: number }): React.JSX.Element | null {
  if (!counterVisible(length)) return null;
  return (
    <span data-testid="sticky-counter" className="sticky-counter" aria-live="off">
      {length}/{STICKY_TEXT_MAX_CHARS}
    </span>
  );
}
