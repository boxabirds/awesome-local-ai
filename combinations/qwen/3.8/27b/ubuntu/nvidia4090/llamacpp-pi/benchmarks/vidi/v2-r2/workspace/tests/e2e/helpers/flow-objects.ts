import type { Page } from '@playwright/test';

/**
 * Story 10 e2e helpers: the object states the test hook exposes for shapes
 * and connectors (a superset of the sticky-centric ObjectState in
 * participants.ts).
 */

export interface EndpointState {
  kind: string;
  objectId?: string;
  x?: number;
  y?: number;
}

export interface FlowObject {
  id: string;
  x: number;
  y: number;
  z: number;
  text: string;
  width?: number;
  height?: number;
  /** Object colour (sticky notes and pen strokes). */
  color?: string;
  /** Shape (story 10). */
  kind?: string;
  fill?: string;
  stroke?: string;
  label?: string;
  /** Connector (story 10): endpoint descriptors and resolved points. */
  from?: EndpointState;
  to?: EndpointState;
  fromPoint?: { x: number; y: number };
  toPoint?: { x: number; y: number };
  /** The object's type name (story 11). */
  type?: string;
  /** Stroke (story 11): flattened path, creation-time base size, thickness. */
  points?: number[];
  baseWidth?: number;
  baseHeight?: number;
  thickness?: string;
}

/** Every object's current state (shapes + connectors included). */
export async function allObjects(page: Page): Promise<FlowObject[]> {
  return page.evaluate(
    () => (window.__vidi6?.getObjects() ?? []) as unknown as FlowObject[],
  );
}

/** The connector attached to both `a` and `b` (either direction), or null. */
export function connectorBetween(
  objs: readonly FlowObject[],
  a: string,
  b: string,
): FlowObject | null {
  return (
    objs.find((o) => {
      if (o.from === undefined || o.to === undefined) {
        return false;
      }
      const f = o.from.objectId;
      const t = o.to.objectId;
      return (
        (f === a && t === b) || (f === b && t === a)
      );
    }) ?? null
  );
}
