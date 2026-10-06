/**
 * The props every board object component is given (story 7's registry contract).
 *
 * Selection, moving, resizing and editing are the board's business and are handed to the object
 * as callbacks; the object's own concern is what its type looks like and what its type can be
 * changed into. Keeping the shared half in one place is what lets `Board` render any registered
 * type without knowing which ones exist.
 */
import type { PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import type { EndEditNext } from '../board/useSelection';
import type { UndoController } from '../board/undo';

export interface ObjectProps {
  doc: Y.Doc;
  /** Current board zoom, so anything measured in world units can account for it. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  dragging: boolean;
  /**
   * Whether this object may be changed (story 4). False while the room could not load the board:
   * the object can still be selected and read, but it cannot be dragged, typed in or deleted.
   */
  canEdit?: boolean;
  onSelect(id: string): void;
  onToggle(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next?: EndEditNext): void;
  /** The generic transform gesture handler for move and shift-click toggle. */
  onObjectPointerDown(e: ReactPointerEvent, id: string): void;
  /** Story 8: this person's history, for the object's own commands and its text editor. */
  undo?: UndoController | null;
}
