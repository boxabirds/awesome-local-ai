// The client-side board object type registry (sel.registry).
//
// `registry.tsx` holds the map from an object's `type` to the component that draws
// it, plus the handful of per-type capabilities the generic UI needs: whether it can
// be resized, whether resizing keeps the ratio, whether it has editable text, and
// what its smallest side is. Stories 9–12 add types by calling `declareObjectType`
// and changing nothing else — the selection, marquee, gesture, keyboard commands and
// editing all ask the registry instead of switching on a type string.
//
// Like the board model's registry, this one is filled by a module-side-effect
// (`declareObjectTypes()`), so it is populated before the first render.

import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import type * as Y from 'yjs';
import { isKnownObjectType, objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import type { Point } from '../../shared/geometry';
import { STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD } from '../../shared/config';
import type { Camera } from '../canvas/camera';
import { StickyNote } from './StickyNote';

/** The props every board object component receives (sel.registry): the object, the
 * document, the camera, and the generic selection / gesture / edit callbacks. */
export interface ObjectProps {
  obj: ObjectSnapshot;
  doc: Y.Doc;
  /** The board camera, for the few things an object draws in screen space. The
   * world layer already scales and positions the object itself. */
  camera: Camera;
  selected: boolean;
  /** This object's text is being edited right now. */
  editing: boolean;
  /** The board can be changed (a board that failed to load cannot). */
  editable: boolean;
  /** The ids in the current selection, so a Shift-press can compute the result. */
  selectedIds: ReadonlySet<string>;
  /** A plain click makes this object the only selection. */
  onSelect(id: string): void;
  /** A Shift-click adds this object to the selection, or removes it. */
  onToggle(id: string): void;
  /** Hand the press to the generic transform gesture. `selectionOverride` carries
   * the selection a Shift-toggle just produced, which state has not rendered yet. */
  onObjectPointerDown(e: ReactPointerEvent<Element>, id: string, selectionOverride?: string[]): void;
  /** Text-bearing objects only. */
  onStartEdit?(id: string): void;
  onEndEdit?(next: 'selected' | 'unselected'): void;
}

/** What `ObjectView` receives: the object plus everything the generic layer knows. */
export interface ObjectViewProps extends Omit<ObjectProps, 'onObjectPointerDown'> {
  onObjectPointerDown(e: ReactPointerEvent<Element>, id: string, selectionOverride?: string[]): void;
}

/** Per-type capabilities of the generic UI (the model registry holds the data-side
 * ones: `create`, `snapshot`, `bounds`). */
export interface ClientObjectTypeSpec {
  /** Can be resized (default true). */
  resizable?: boolean;
  /** Resizing keeps the original ratio (default true; shapes may opt out). */
  aspectLocked?: boolean;
  /** Has editable text: Enter opens its editor, and the editor commits on blur. */
  editableText?: boolean;
  /** Smallest world-unit side this type allows (the gesture needs it per frame). */
  minSize?: number;
  /** Draw the object. */
  render(props: ObjectProps): ReactNode;
}

const types = new Map<string, ClientObjectTypeSpec>();

/** Register a board object type. Idempotent (last registration wins). */
export function declareObjectType(type: string, spec: ClientObjectTypeSpec): void {
  types.set(type, spec);
}

/** Look up an object type (undefined for an unknown type: those render nothing). */
export function getObjectType(type: string): ClientObjectTypeSpec | undefined {
  return types.get(type);
}

/** The registered type names (tests, and the "unknown type" guard). */
export function registeredTypes(): string[] {
  return [...types.keys()];
}

export function isObjectTypeRegistered(type: string): boolean {
  return types.has(type);
}

/** The sticky note's type id. */
export const STICKY_TYPE = 'sticky';

/** Where the world size lives on a sticky. Notes written before story 7 have no
 * persisted size, so the default applies (sel.model: no migration). */
export function stickyWorldSize(obj: Pick<ObjectSnapshot, 'width' | 'height'>): { width: number; height: number } {
  return {
    width: typeof obj.width === 'number' && obj.width > 0 ? obj.width : STICKY_SIZE_WORLD,
    height: typeof obj.height === 'number' && obj.height > 0 ? obj.height : STICKY_SIZE_WORLD,
  };
}

/** Hit test in world coordinates: the topmost object whose rect contains the point.
 * (The DOM does the real hit-testing for pointers; this is for tests and tools.) */
export function boundsHitTest(snapshot: readonly ObjectSnapshot[], worldPoint: Point): ObjectSnapshot | undefined {
  let best: ObjectSnapshot | undefined;
  for (const o of snapshot) {
    if (!isKnownObjectType(o.type)) continue;
    const b = objectBounds(o);
    if (worldPoint.x < b.x || worldPoint.y < b.y) continue;
    if (worldPoint.x > b.x + b.width || worldPoint.y > b.y + b.height) continue;
    if (!best || o.z > best.z) best = o;
  }
  return best;
}

/**
 * The generic renderer: look the type up and render its component, or render nothing
 * for a type this build does not know (TC-12 — an unknown object is never rewritten
 * and never drawn). A plain press selects the object and starts the gesture; a Shift
 * press toggles membership instead, handing the gesture the selection the toggle
 * just produced (state has not re-rendered yet).
 */
export function ObjectView(props: ObjectViewProps) {
  const spec = getObjectType(props.obj.type);
  if (!spec) return null;
  const { obj, selectedIds, onSelect, onToggle, onObjectPointerDown } = props;

  const handlePointerDown = (e: ReactPointerEvent<Element>, id: string) => {
    if (e.shiftKey) {
      const rest = [...selectedIds].filter((x) => x !== id);
      onToggle(id);
      onObjectPointerDown(e, id, selectedIds.has(id) ? rest : [...rest, id]);
      return;
    }
    // Dragging an object that is already part of the selection keeps the whole
    // selection (only a press on something OUTSIDE it selects it alone, TC-23).
    if (!selectedIds.has(id)) onSelect(id);
    onObjectPointerDown(e, id);
  };

  return (
    <>
      {spec.render({
        obj,
        doc: props.doc,
        camera: props.camera,
        selected: props.selected,
        editing: props.editing,
        editable: props.editable,
        selectedIds,
        onSelect,
        onToggle,
        onObjectPointerDown: handlePointerDown,
        onStartEdit: props.onStartEdit,
        onEndEdit: props.onEndEdit,
      })}
    </>
  );
}

/** Register the object types this build draws (sticky notes, until stories 9–12
 * add shapes, text and images). */
export function declareObjectTypes(): void {
  // Idempotent: calling it twice (App module + a test) must not hand out a new spec
  // object, or components would see a different spec between renders.
  if (types.has(STICKY_TYPE)) return;
  declareObjectType(STICKY_TYPE, {
    resizable: true,
    aspectLocked: true,
    editableText: true,
    minSize: STICKY_MIN_SIZE_WORLD,
    render: (props) => <StickyNote {...props} />,
  });
}
