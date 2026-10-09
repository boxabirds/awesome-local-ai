import type { ReactElement } from 'react';
import * as Y from 'yjs';
import {
  objectBounds,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { unionRects } from '../../shared/geometry';
import { DEFAULT_TEXT_SIZE, TEXT_SIZES, type TextSize } from '../../shared/config';
import { TextToolbar } from '../objects/TextToolbar';

/**
 * Story 7 (sel.interaction): the multi-selection bar. Shown when two or more
 * objects are selected: "N selected" plus a Delete button. Rendered in the
 * world layer just above the selection's bounding box.
 *
 * Story 9 (text.object): a single selected text object shows the TextToolbar
 * (size presets + delete) above its box instead. A single selected sticky
 * shows its own NoteToolbar (rendered by the note), so the bar returns null
 * for other single selections.
 *
 * The count is announced to screen readers via an aria-live="polite" region.
 */
export function SelectionBar(props: {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  doc: Y.Doc;
  onDelete(): void;
  onTextSize(size: TextSize): void;
}): ReactElement | null {
  const { ids, snapshot, doc, onDelete, onTextSize } = props;
  if (ids.size === 0) return null;

  const selected = snapshot.filter((o) => ids.has(o.id));

  // Single selected text object: its own toolbar (sizes + delete).
  if (ids.size === 1 && selected.length === 1 && selected[0].type === 'text') {
    const o = selected[0];
    const box = objectBounds(o);
    const item = doc.getMap('objects').get(o.id) as Y.Map<any> | undefined;
    const rawSize = item?.get('size');
    const size: TextSize =
      typeof rawSize === 'string' && rawSize in TEXT_SIZES ? (rawSize as TextSize) : DEFAULT_TEXT_SIZE;
    return (
      <div
        data-selection-bar="true"
        data-text-toolbar-bar="true"
        style={{
          position: 'absolute',
          left: box.x,
          top: box.y - 38,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 10px',
          background: '#ffffff',
          border: '1px solid #d5d9e0',
          borderRadius: 8,
          boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
          whiteSpace: 'nowrap',
          pointerEvents: 'auto',
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <TextToolbar size={size} onSize={onTextSize} onDelete={onDelete} />
      </div>
    );
  }

  if (ids.size < 2) return null;

  const box = unionRects(selected.map(objectBounds));
  if (!box) return null;

  const BAR_H = 30;
  const GAP = 8;

  return (
    <div
      data-selection-bar="true"
      style={{
        position: 'absolute',
        left: box.x,
        top: box.y - BAR_H - GAP,
        height: BAR_H,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 10px',
        background: '#ffffff',
        border: '1px solid #d5d9e0',
        borderRadius: 8,
        boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
        whiteSpace: 'nowrap',
        pointerEvents: 'auto',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <span aria-live="polite" data-selection-count={ids.size} style={{ fontSize: 13, color: '#23272e' }}>
        {ids.size} selected
      </span>
      <button
        type="button"
        aria-label="Delete selection"
        title="Delete selection"
        onClick={onDelete}
        style={{
          border: '1px solid #d5d9e0',
          borderRadius: 5,
          background: '#fff',
          color: '#b3261e',
          cursor: 'pointer',
          fontSize: 12,
          padding: '3px 8px',
        }}
      >
        Delete
      </button>
    </div>
  );
}
