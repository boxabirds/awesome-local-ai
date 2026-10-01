// src/client/objects/registerSticky.ts
// Registers the sticky note type in the object registry.

import { registerObjectType, getObjectType } from './registry';
import { objectBounds } from '../../shared/board-model';
import { STICKY_MIN_SIZE_WORLD } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import type { ObjectSnapshot as BoardObjectSnapshot } from '../../shared/board-model';

// We cannot import StickyNote directly here due to potential circular deps.
// Instead, we use a deferred component reference.
import React from 'react';

let _StickyNoteComponent: React.ComponentType<any> | undefined;

/** Called by StickyNote module on load to register itself. */
export function _registerStickyComponent(comp: React.ComponentType<any>): void {
  _StickyNoteComponent = comp;
}

if (!getObjectType('sticky')) {
  registerObjectType('sticky', {
    Component: (props: any) => {
      if (!_StickyNoteComponent) return null;
      return React.createElement(_StickyNoteComponent, props);
    },
    resizable: true,
    aspectLocked: true,
    minSize: STICKY_MIN_SIZE_WORLD,
    editableText: true,
    hitTest(obj: BoardObjectSnapshot, worldPoint: Point): boolean {
      const bounds = objectBounds(obj);
      return (
        worldPoint.x >= bounds.x &&
        worldPoint.x <= bounds.x + bounds.width &&
        worldPoint.y >= bounds.y &&
        worldPoint.y <= bounds.y + bounds.height
      );
    },
  });
}
