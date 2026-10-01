// src/client/objects/registerConnector.ts
// Registers the connector type in the object registry.

import { registerObjectType, type ObjectTypeSpec } from './registry';
import { ConnectorObject } from './ConnectorObject';

import type { ObjectSnapshot } from '../../shared/board-model';
import type { Point } from '../../shared/geometry';

function connectorHitTest(_obj: ObjectSnapshot, _worldPoint: Point): boolean {
  // The actual hit test is done by the parent using distanceToPolyline.
  // This is a fallback that returns false (connectors use a custom hit test).
  return false;
}

let registered = false;

export function _registerConnectorComponent(): void {
  if (registered) return;
  registered = true;

  const spec: ObjectTypeSpec = {
    Component: ConnectorObject,
    resizable: false,
    aspectLocked: false,
    minSize: 0,
    editableText: false,
    hitTest: connectorHitTest,
  };

  registerObjectType('connector', spec);
}

// Auto-register on import
_registerConnectorComponent();
