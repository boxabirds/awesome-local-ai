import * as Y from 'yjs';
import { counterVisible } from './StickyText';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { TextEditor } from './TextEditor';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  /** Text padding on each side of the note (world units). */
  padding: number;
  /** Ends editing. 'selected' keeps the note selected, 'unselected' clears it. */
  onEnd(next: 'selected' | 'unselected'): void;
}

/**
 * The textarea shown while a note is being edited. Story 9 lifted the whole
 * editing mechanism into `TextEditor` (caret at end, minimal `applyTextDiff`,
 * remote-echo adoption, IME safety); this is now only the sticky note's binding
 * to it — its character limit, its font size and its padding.
 */
export function StickyTextEditor({ ytext, fontPx, padding, onEnd }: StickyTextEditorProps) {
  return (
    <TextEditor
      ytext={ytext}
      maxChars={STICKY_TEXT_MAX_CHARS}
      fontPx={fontPx}
      lineHeight={1.25}
      padding={`${padding}px`}
      testId="sticky-textarea"
      ariaLabel="Sticky note text"
      onEnd={onEnd}
    />
  );
}

/** A small bottom-right counter, shown only near the character limit. */
export function CharCounter({ length }: { length: number }) {
  if (!counterVisible(length)) return null;
  return (
    <div
      data-testid="char-counter"
      style={{
        position: 'absolute',
        right: 6,
        bottom: 4,
        fontSize: 11,
        color: 'rgba(17,17,17,0.7)',
        background: 'rgba(255,255,255,0.7)',
        borderRadius: 4,
        padding: '0 4px',
        pointerEvents: 'none',
      }}
    >
      {length}/{STICKY_TEXT_MAX_CHARS}
    </div>
  );
}
