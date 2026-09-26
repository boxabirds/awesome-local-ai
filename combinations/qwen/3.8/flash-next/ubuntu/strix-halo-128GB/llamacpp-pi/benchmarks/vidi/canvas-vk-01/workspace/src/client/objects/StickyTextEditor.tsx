import { type JSX } from 'react';
import type * as Y from 'yjs';
import { STICKY_COUNTER_THRESHOLD_CHARS, STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { TextEditor } from './TextEditor';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
}

/**
 * Sticky-note view of the shared board text editor (story 9): sticky limits,
 * sticky counter, sticky styling — same editing behaviour as text objects.
 */
export function StickyTextEditor({ ytext, fontPx, onEnd }: StickyTextEditorProps): JSX.Element {
  return (
    <TextEditor
      ytext={ytext}
      maxChars={STICKY_TEXT_MAX_CHARS}
      fontPx={fontPx}
      onEnd={onEnd}
      counterThreshold={STICKY_COUNTER_THRESHOLD_CHARS}
      counterMax={STICKY_TEXT_MAX_CHARS}
    />
  );
}
