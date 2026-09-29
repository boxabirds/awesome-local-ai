import { ObjectSnapshot } from '@shared/board-model';
import { Point } from '@client/canvas/camera';
import { STICKY_MIN_SIZE_WORLD } from '@shared/config';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ComponentType = (props: any) => any;

export interface ObjectTypeSpec {
  Component: ComponentType;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`Object type '${type}' is already registered`);
  }
  registry.set(type, spec);
}

export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/**
 * Registers the sticky note type. Called at app initialization.
 */
export function registerStickyType(Component: ComponentType): void {
  registerObjectType('sticky', {
    Component,
    resizable: true,
    aspectLocked: true,
    minSize: STICKY_MIN_SIZE_WORLD,
    editableText: true,
    hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean {
      const w = (obj as any).width ?? 200;
      const h = (obj as any).height ?? 200;
      return (
        worldPoint.x >= obj.x &&
        worldPoint.x <= obj.x + w &&
        worldPoint.y >= obj.y &&
        worldPoint.y <= obj.y + h
      );
    },
  });
}
