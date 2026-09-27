// Toolbar shown on the selected note: colour palette, bring to front, delete.

import type * as Y from 'yjs';
import { STICKY_COLORS } from '../../shared/config';
import { bringToFront, deleteObject, setStickyColor, type StickySnapshot } from '../../shared/board-model';

export function NoteToolbar({ doc, note }: { doc: Y.Doc; note: StickySnapshot }) {
  return (
    <div
      className="note-toolbar"
      role="toolbar"
      aria-label="Note actions"
      onPointerDown={(event) => event.stopPropagation()}
    >
      {Object.entries(STICKY_COLORS).map(([name, hex]) => (
        <button
          key={name}
          type="button"
          className={`color-swatch${note.color === name ? ' is-active' : ''}`}
          style={{ background: hex }}
          aria-label={`Colour ${name}`}
          aria-pressed={note.color === name}
          onClick={() => {
            setStickyColor(doc, note.id, name);
          }}
        />
      ))}
      <button
        type="button"
        className="note-front"
        onClick={() => {
          bringToFront(doc, note.id);
        }}
      >
        To front
      </button>
      <button
        type="button"
        className="note-delete"
        aria-label="Delete note"
        onClick={() => {
          deleteObject(doc, note.id);
        }}
      >
        Delete
      </button>
    </div>
  );}
