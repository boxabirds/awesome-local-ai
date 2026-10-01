/**
 * Registers the `connector` object type. Imported once at application startup.
 */

import { registerObjectType } from './registry';
import { ConnectorObject } from './ConnectorObject';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { Point } from '../../shared/geometry';

registerObjectType('connector', {
  Component: ConnectorObject,
  resizable: false,
  aspectLocked: false,
  minSize: 0,
  editableText: false,
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean {
    // Connectors need special hit-testing based on distance to the line.
    // Use a generous bbox for selection purposes.
    const b = obj;
    return (
      worldPoint.x >= b.x - 20 &&
      worldPoint.x <= b.x + (b.width ?? 0) + 20 &&
      worldPoint.y >= b.y - 20 &&
      worldPoint.y <= b.y + (b.height ?? 0) + 20
    );
  },
});
