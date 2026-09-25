import type { JSX } from 'react';
import * as Y from 'yjs';
import { setStickyColor } from '../../shared/board-model';
import type { ObjectSnapshot } from '../../shared/board-model';
import { DEFAULT_STICKY_COLOR } from '../../shared/config';
import type { StickyColor } from '../../shared/config';
import { NoteToolbar } from '../objects/NoteToolbar';
import { TextToolbar } from '../objects/TextToolbar';

/**
 * The bar above the selection's bounding box (story 7, sel.bar; extended
 * in story 9 for text objects).
 *
 *  - exactly one sticky: the story 2 NoteToolbar (colours + delete);
 *  - exactly one text: the TextToolbar (size buttons + width input);
 *  - two or more objects: "N selected" plus a Delete button.
 */
export interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  /** The board doc (single-sticky swatches write through it). */
  doc: Y.Doc;
  /** persist.client_status: false while the board is locked (view-only). */
  editable: boolean;
  /** Remove every selected object (and clear the selection). */
  onDelete: () => void;
  /** Step boundary (story 8): brackets a single mutation. */
  boundary?: () => void;
}

export function SelectionBar(props: SelectionBarProps): JSX.Element | null {
  const { ids, snapshot, doc, editable, onDelete, boundary } = props;
  if (ids.size === 0) return null;

  const selected = snapshot.filter((o) => ids.has(o.id));
  if (selected.length === 0) return null;

  // Exactly one sticky: story 2's note toolbar takes over.
  if (selected.length === 1 && selected[0]!.type === 'sticky') {
    const note = selected[0]!;
    return (
      <NoteToolbar
        color={(note.color as StickyColor) ?? DEFAULT_STICKY_COLOR}
        disabled={!editable}
        onColor={(c) => {
          if (!editable) return;
          boundary?.();
          setStickyColor(doc, note.id, c);
          boundary?.();
        }}
        onDelete={() => {
          if (editable) onDelete();
        }}
      />
    );
  }

  // Exactly one text: the text toolbar (story 9).
  if (selected.length === 1 && selected[0]!.type === 'text') {
    const text = selected[0]!;
    return (
      <div className="vidi6-selection-bar" data-testid="selection-bar">
        <TextToolbar doc={doc} obj={text} editable={editable} boundary={boundary} />
        <button
          type="button"
          className="vidi6-delete"
          aria-label="Delete text"
          title="Delete text"
          disabled={!editable}
          onClick={onDelete}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9.3a1 1 0 0 0 1 .95h4.6a1 1 0 0 0 1-.95L12 4M6.5 7v4M9.5 7v4"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="vidi6-selection-bar" data-testid="selection-bar">
      <span className="vidi6-selection-bar__count" aria-live="polite">
        {selected.length} selected
      </span>
      <button
        type="button"
        className="vidi6-delete"
        aria-label="Delete selection"
        title="Delete selection"
        disabled={!editable}
        onClick={onDelete}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9.3a1 1 0 0 0 1 .95h4.6a1 1 0 0 0 1-.95L12 4M6.5 7v4M9.5 7v4"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
