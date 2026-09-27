// Story 7: the floating selection bar (anchor: sel.state).
//
// For a single selected sticky it renders the (existing) NoteToolbar so the
// colour swatches and per-note delete behave exactly as before (the e2e
// selectors target .note-toolbar). For a multi-selection it renders "N
// selected" and a Delete button (the exact PRD text/aria-labels). It floats
// above the group bounding box, in screen space, and tracks the board via the
// camera.

import type { JSX } from 'react';
import type * as Y from 'yjs';
import {
  objectBounds,
  setStickyColor,
  type ObjectSnapshot,
  type StickySnapshot,
} from '../../shared/board-model';
import { unionRects } from '../../shared/geometry';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS, type StickyColor } from '../../shared/config';
import { worldToScreen, type Camera } from '../canvas/camera';
import { NoteToolbar } from '../objects/NoteToolbar';

function pickSelected(snapshot: readonly ObjectSnapshot[], ids: ReadonlySet<string>): ObjectSnapshot[] {
  const byId = new Map(snapshot.map((o) => [o.id, o]));
  const out: ObjectSnapshot[] = [];
  for (const id of ids) {
    const o = byId.get(id);
    if (o !== undefined) out.push(o);
  }
  return out;
}

export interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  doc: Y.Doc;
  canEdit: boolean;
  /** Delete the current selection (a single note or the whole group). */
  onDelete: () => void;
}

export function SelectionBar(props: SelectionBarProps): JSX.Element | null {
  const { ids, snapshot, camera, doc, canEdit, onDelete } = props;
  if (ids.size === 0) return null;
  const selected = pickSelected(snapshot, ids);
  if (selected.length === 0) return null;
  const box = unionRects(selected.map((o) => objectBounds(o)));
  if (box === null) return null;

  const anchor = worldToScreen(camera, { x: box.x + box.width / 2, y: box.y });

  const content =
    selected.length === 1 && selected[0].type === 'sticky' ? (
      <SingleStickyToolbar
        note={selected[0] as StickySnapshot}
        doc={doc}
        canEdit={canEdit}
        onDelete={onDelete}
      />
    ) : (
      <div className="selection-bar" role="toolbar" aria-label="Selection tools">
        <span className="selection-bar__count" aria-live="polite">
          {selected.length} selected
        </span>
        <button
          type="button"
          className="selection-bar__delete"
          aria-label="Delete selection"
          disabled={!canEdit}
          onClick={onDelete}
        >
          Delete
        </button>
      </div>
    );

  return (
    <div className="selection-bar-anchor" style={{ left: anchor.x, top: anchor.y }}>
      <div className="selection-bar-scaled">{content}</div>
    </div>
  );
}

function SingleStickyToolbar(props: {
  note: StickySnapshot;
  doc: Y.Doc;
  canEdit: boolean;
  onDelete: () => void;
}): JSX.Element {
  const { note, doc, canEdit, onDelete } = props;
  const color: StickyColor = note.color in STICKY_COLORS ? note.color : DEFAULT_STICKY_COLOR;
  return (
    <NoteToolbar
      color={color}
      onColor={(c) => {
        if (canEdit) setStickyColor(doc, note.id, c);
      }}
      onDelete={onDelete}
      disabled={!canEdit}
    />
  );
}
