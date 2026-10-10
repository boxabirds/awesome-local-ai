// Selection bar floating above the selection's bounding box: "N selected"
// plus a delete button for multi-selection, or story 2's NoteToolbar when
// exactly one sticky is selected. Counter-scaled against zoom via the world
// layer's --board-zoom variable so it keeps a constant screen size.

import {
  objectBounds,
  type ObjectSnapshot,
  type StickySnapshot,
  type TextSnapshot,
} from '../../shared/board-model';
import { unionRects } from '../../shared/geometry';
import type { TextSize } from '../../shared/config';
import { NoteToolbar } from '../objects/NoteToolbar';
import { TextToolbar } from '../objects/TextToolbar';

export interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  onDelete(): void;
  // True while a gesture is running or text is being edited: the bar and the
  // note toolbar stay hidden (story 2 behaviour preserved).
  suppress?: boolean;
  // Provided by the board so the single-sticky NoteToolbar can recolour.
  onColor?(id: string, color: StickySnapshot['color']): void;
  // Provided by the board so the single-text TextToolbar can resize.
  onTextSize?(id: string, size: TextSize): void;
}

export function SelectionBar({
  ids,
  snapshot,
  onDelete,
  suppress = false,
  onColor,
  onTextSize,
}: SelectionBarProps): React.JSX.Element | null {
  if (ids.size === 0 || suppress) return null;
  const selected = snapshot.filter((o) => ids.has(o.id));
  if (selected.length === 0) return null;
  const box = unionRects(selected.map(objectBounds));
  if (!box) return null;
  const countText = `${ids.size} selected`;
  const singleSticky =
    ids.size === 1 && selected[0].type === 'sticky' ? (selected[0] as StickySnapshot) : null;
  const singleText =
    ids.size === 1 && selected[0].type === 'text' ? (selected[0] as TextSnapshot) : null;
  return (
    <div
      className="selection-bar"
      data-testid="selection-bar"
      role="toolbar"
      aria-label={singleSticky ? undefined : 'Selection'}
      style={{
        position: 'absolute',
        left: box.x + box.width / 2,
        top: box.y,
        transform: 'translate(-50%, -100%) scale(calc(1 / var(--board-zoom, 1)))',
        transformOrigin: 'center bottom',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {singleText && onTextSize ? (
        <TextToolbar size={singleText.size} onSize={(s) => onTextSize(singleText.id, s)} onDelete={onDelete} />
      ) : singleSticky && onColor ? (
        <NoteToolbar color={singleSticky.color} onColor={(c) => onColor(singleSticky.id, c)} onDelete={onDelete} />
      ) : (
        <>
          <span className="selection-count" aria-live="polite">
            {countText}
          </span>
          <button
            type="button"
            className="selection-delete"
            data-testid="delete-selection"
            aria-label="Delete selection"
            onClick={onDelete}
          />
        </>
      )}
    </div>
  );
}
