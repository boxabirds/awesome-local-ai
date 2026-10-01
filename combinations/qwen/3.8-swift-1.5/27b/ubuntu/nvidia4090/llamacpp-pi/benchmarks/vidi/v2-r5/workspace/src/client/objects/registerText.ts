// src/client/objects/registerText.ts
// Registers the text object type with the registry.

import { registerObjectType, type ObjectTypeSpec } from './registry';
import { TextObject } from './TextObject';
import { TEXT_MIN_WIDTH_WORLD } from '../../shared/config';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { Point } from '../../shared/geometry';

function textHitTest(obj: ObjectSnapshot, worldPoint: Point): boolean {
  const x = obj.x;
  const y = obj.y;
  const width = (obj as any).width ?? 100;
  const height = (obj as any).height ?? 30;
  return (
    worldPoint.x >= x &&
    worldPoint.x <= x + width &&
    worldPoint.y >= y &&
    worldPoint.y <= y + height
  );
}

let registered = false;

export function _registerTextComponent(): void {
  if (registered) return;
  registered = true;

  const spec: ObjectTypeSpec & { handles?: 'all' | 'horizontal' } = {
    Component: TextObject,
    resizable: true,
    aspectLocked: false,
    minSize: TEXT_MIN_WIDTH_WORLD,
    editableText: true,
    handles: 'horizontal',
    hitTest: textHitTest,
  };

  registerObjectType('text', spec);
}

// Auto-register on import
_registerTextComponent();
