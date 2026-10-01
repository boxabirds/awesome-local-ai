// src/client/objects/registry.tsx
// Object type registry: each type declares its component, resize rules, and hit test.

import type React from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { Point } from '../../shared/geometry';

export interface ObjectProps {
  obj: ObjectSnapshot;
  selected: boolean;
  editing: boolean;
  onPointerDown: (e: React.PointerEvent, id: string) => void;
  onDblClick: (e: React.MouseEvent, id: string) => void;
  // type-specific props can be added via intersection types
}

export interface ObjectTypeSpec {
  Component: React.ComponentType<any>;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`Duplicate registration of object type: ${type}`);
  }
  registry.set(type, spec);
}

export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/**
 * Tests-only: reset the registry (used between test files).
 */
export function _resetRegistry(): void {
  registry.clear();
}
