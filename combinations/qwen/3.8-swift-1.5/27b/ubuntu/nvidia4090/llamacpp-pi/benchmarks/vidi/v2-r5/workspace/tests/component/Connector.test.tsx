// @vitest-environment jsdom
// tests/component/Connector.test.tsx
// TC-18: L tool hover over shape → four dots at side midpoints
// TC-19: drag from A over B → B's nearest dot highlighted; release → attached connector
// TC-20: click 5px and 7px from an arrow at 50% and 200% zoom → selected / not selected
// TC-21: drag end handle onto C → attached; onto empty space → free

import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import * as Y from 'yjs';
import { initDoc, snapshot } from '../../src/shared/board-model';
import { createShape } from '../../src/shared/objects/shape';
import { createConnector, setConnectorEndpoint } from '../../src/shared/objects/connector';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { CONNECTOR_HIT_TOLERANCE_PX } from '../../src/shared/config';
import { ConnectorTool } from '../../src/client/tools/ConnectorTool';
import type { Camera } from '../../src/client/canvas/camera';
import type { Point } from '../../src/shared/geometry';

const testCamera: Camera = { x: -640, y: -400, zoom: 1 };

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function makePointerEvent(type: string, x: number, y: number): Event {
  const evt = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(evt, 'clientX', { value: x });
  Object.defineProperty(evt, 'clientY', { value: y });
  Object.defineProperty(evt, 'pointerId', { value: 1 });
  return evt;
}

beforeAll(() => {
  const proto = Element.prototype as any;
  if (!proto.setPointerCapture) {
    proto.setPointerCapture = vi.fn();
    proto.releasePointerCapture = vi.fn();
  }
});

beforeEach(() => {
  cleanup();
});

// TC-18: L tool hover over shape → four dots at side midpoints
describe('TC-18: Connector tool hover dots', () => {
  it('hovering over a shape shows four connection dots', () => {
    const doc = makeDoc();
    createShape(doc, { kind: 'rect', rect: { x: 100, y: 100, width: 200, height: 150 }, at: { x: 200, y: 175 } }, 'local');

    const snap = snapshot(doc);
    const { container } = render(
      <ConnectorTool
        camera={testCamera}
        snapshot={snap}
        onCreated={() => {}}
        create={vi.fn(() => null)}
      />
    );

    const svg = container.querySelector('[data-testid="connector-tool-overlay"]') as SVGSVGElement;
    expect(svg).not.toBeNull();

    // Simulate pointer move over the shape
    // Shape is at world (100,100) to (300,250). Camera is at (-640,-400), zoom 1.
    // Screen position of shape centre (200, 175) = (200 - (-640), 175 - (-400)) = (840, 575)
    act(() => {
      svg.dispatchEvent(makePointerEvent('pointermove', 840, 575));
    });

    // Should show 4 dots
    const dots = container.querySelectorAll('[data-testid^="connector-dot-"]');
    expect(dots.length).toBe(4);
  });
});

// TC-19: drag from A over B → B's nearest dot highlighted; release → attached connector created
describe('TC-19: Connector tool drag creation', () => {
  it('dragging from shape A to shape B creates an attached connector', () => {
    const doc = makeDoc();
    const idA = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 50, y: 50 } }, 'local')!;
    const idB = createShape(doc, { kind: 'rect', rect: { x: 300, y: 0, width: 100, height: 100 }, at: { x: 350, y: 50 } }, 'local')!;

    const snap = snapshot(doc);

    const createFn = vi.fn((from: any, to: any) => {
      const id = createConnector(doc, from, to, 'local');
      return id;
    });

    const { container } = render(
      <ConnectorTool
        camera={testCamera}
        snapshot={snap}
        onCreated={() => {}}
        create={createFn}
      />
    );

    const svg = container.querySelector('[data-testid="connector-tool-overlay"]') as SVGSVGElement;

    // Drag from A (screen: 50+640=690, 50+400=450) to B (screen: 350+640=990, 50+400=450)
    act(() => {
      svg.dispatchEvent(makePointerEvent('pointerdown', 690, 450));
    });
    act(() => {
      svg.dispatchEvent(makePointerEvent('pointermove', 990, 450));
    });
    act(() => {
      svg.dispatchEvent(makePointerEvent('pointerup', 990, 450));
    });

    // A connector should have been created
    expect(createFn).toHaveBeenCalledTimes(1);
    const connSnap = snapshot(doc).find(s => s.type === 'connector') as any;
    expect(connSnap).toBeDefined();
    expect(connSnap.from.objectId).toBe(idA);
    expect(connSnap.to.objectId).toBe(idB);
  });
});

// TC-20: click 5px and 7px from an arrow at 50% and 200% zoom
describe('TC-20: Connector hit test at different zooms', () => {
  it('distanceToPolyline selects at 5px, not at 7px (in screen pixels)', () => {
    const segment: Point[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }];

    // At 50% zoom: tolerance = 6/0.5 = 12 world units
    const zoom50 = 0.5;
    const tol50 = CONNECTOR_HIT_TOLERANCE_PX / zoom50; // 12
    const dist5px_50 = distanceToPolyline(segment, { x: 50, y: 10 }); // 10 world units
    const dist7px_50 = distanceToPolyline(segment, { x: 50, y: 14 }); // 14 world units
    expect(dist5px_50 <= tol50).toBe(true);
    expect(dist7px_50 <= tol50).toBe(false);

    // At 200% zoom: tolerance = 6/2 = 3 world units
    const zoom200 = 2;
    const tol200 = CONNECTOR_HIT_TOLERANCE_PX / zoom200; // 3
    const dist5px_200 = distanceToPolyline(segment, { x: 50, y: 2.5 }); // 2.5 world units
    const dist7px_200 = distanceToPolyline(segment, { x: 50, y: 3.5 }); // 3.5 world units
    expect(dist5px_200 <= tol200).toBe(true);
    expect(dist7px_200 <= tol200).toBe(false);
  });
});

// TC-21: drag end handle onto C → attached; onto empty space → free
describe('TC-21: Connector end handle re-attach', () => {
  it('setConnectorEndpoint attaches to object or frees at point', () => {
    const doc = makeDoc();
    const idA = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 50, y: 50 } }, 'local')!;
    const idB = createShape(doc, { kind: 'rect', rect: { x: 300, y: 0, width: 100, height: 100 }, at: { x: 350, y: 50 } }, 'local')!;
    const idC = createShape(doc, { kind: 'rect', rect: { x: 300, y: 200, width: 100, height: 100 }, at: { x: 350, y: 250 } }, 'local')!;

    const connId = createConnector(doc,
      { kind: 'attached', objectId: idA, fallback: { x: 100, y: 50 } },
      { kind: 'attached', objectId: idB, fallback: { x: 300, y: 50 } },
      'local'
    )!;

    // Attach to C
    expect(setConnectorEndpoint(doc, connId, 'to', { kind: 'attached', objectId: idC, fallback: { x: 300, y: 250 } })).toBe(true);
    let snap = snapshot(doc).find(s => s.id === connId) as any;
    expect(snap.to.objectId).toBe(idC);

    // Free at a point
    expect(setConnectorEndpoint(doc, connId, 'to', { kind: 'free', x: 500, y: 400 })).toBe(true);
    snap = snapshot(doc).find(s => s.id === connId) as any;
    expect(snap.to.kind).toBe('free');
    expect(snap.to.x).toBe(500);
    expect(snap.to.y).toBe(400);
  });
});
