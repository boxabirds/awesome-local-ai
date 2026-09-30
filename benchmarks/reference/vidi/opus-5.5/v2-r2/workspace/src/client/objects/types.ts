import type { PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';

/** Props every registered object component receives (sel.all_types). */
export interface ObjectProps {
  object: ObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** False while the board cannot be edited (story 4). */
  editable: boolean;
  /** True while this object is being moved or resized by the local user. */
  transforming: boolean;
  /** Every press on the object goes to the generic transform gesture. */
  onPointerDown(e: ReactPointerEvent<HTMLElement>, id: string): void;
  /** Keyboard focus selects the object. */
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}
