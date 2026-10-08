import * as React from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/geometry';
import { STICKY_MIN_SIZE_WORLD, DEFAULT_STICKY_COLOR, STICKY_COLORS } from '../../shared/config';
import {
  SHAPE_MIN_SIZE_WORLD,
  CONNECTOR_HIT_TOLERANCE_PX,
} from '../../shared/config';

export interface Point {
  x: number;
  y: number;
}

// Type definition used by all object types
export interface ObjectTypeSpec<T = any> {
  Component: React.ComponentType<any>;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  handles?: 'all' | 'horizontal';
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
}

const registryMap = new Map<string, ObjectTypeSpec>();

/** Register an object type. Throws on duplicate registration. */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registryMap.has(type)) {
    throw new Error(`Object type '${type}' is already registered`);
  }
  registryMap.set(type, spec);
}

/** Get a registered object type spec. Returns undefined for unknown types. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registryMap.get(type);
}

/** Check if a type is registered */
export function isTypeRegistered(type: string): boolean {
  return registryMap.has(type);
}

/** Get all registered types */
export function getAllRegisteredTypes(): readonly string[] {
  return Array.from(registryMap.keys());
}
