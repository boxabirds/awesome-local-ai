/**
 * Component tests for connector tool and connector object (story 10).
 * TC-18 to TC-21.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Y from 'yjs';
import { render, act } from '@testing-library/react';
import { ConnectorTool } from '../../src/client/tools/ConnectorTool';
import { createShape } from '../../src/shared/objects/shape';
import { createConnector, setConnectorEndpoint } from '../../src/shared/objects/connector';
import { initDoc, objectSnapshot } from '../../src/shared/board-model';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { CONNECTOR_HIT_TOLERANCE_PX } from '../../src/shared/config';
import type { Camera } from '../../src/client/canvas/camera';
import type { Point } from '../../src/shared/geometry';
import { createPointerEvent } from './helpers';

const cam: Camera = { x: -640, y: -400, zoom: 1 };

describe('ConnectorTool (TC-18, TC-19)', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  it('TC-18: L tool hover over shape → four dots at side midpoints', () => {
    // Create a shape at world (0,0,100,100)
    createShape(doc, {
      kind: 'rect',
      rect: { x: 0, y: 0, width: 100, height: 100 },
      at: { x: 0, y: 0 },
    }, 'u1');

    const snapshot = objectSnapshot(doc);
    const onCreated = vi.fn();
    const onBoundary = vi.fn();

    const { container } = render(
      <ConnectorTool camera={cam} doc={doc} snapshot={snapshot} createdBy="u1" onCreated={onCreated} onBoundary={onBoundary} />
    );

    const tool = container.querySelector('[data-testid="connector-tool"]') as HTMLElement;

    // Hover over the shape center: world (50,50) → screen (50-(-640))*1=690, (50-(-400))*1=450
    act(() => {
      tool.dispatchEvent(createPointerEvent('pointermove', { clientX: 690, clientY: 450, pointerId: 1 }));
    });

    // Four dots should be visible
    const dots = container.querySelectorAll('[data-testid="connector-dot"]');
    expect(dots.length).toBe(4);
  });

  it('TC-19: drag from A over B → release → attached connector created', () => {
    // Create two shapes: A at (0,0,100,100), B at (300,0,100,100)
    createShape(doc, {
      kind: 'rect',
      rect: { x: 0, y: 0, width: 100, height: 100 },
      at: { x: 0, y: 0 },
    }, 'u1');
    createShape(doc, {
      kind: 'rect',
      rect: { x: 300, y: 0, width: 100, height: 100 },
      at: { x: 300, y: 0 },
    }, 'u1');

    const snapshot = objectSnapshot(doc);
    const onCreated = vi.fn();
    const onBoundary = vi.fn();

    const { container } = render(
      <ConnectorTool camera={cam} doc={doc} snapshot={snapshot} createdBy="u1" onCreated={onCreated} onBoundary={onBoundary} />
    );

    const tool = container.querySelector('[data-testid="connector-tool"]') as HTMLElement;

    // Drag from A center (world 50,50 → screen 690,450) to B center (world 350,50 → screen 990,450)
    act(() => {
      tool.dispatchEvent(createPointerEvent('pointerdown', { clientX: 690, clientY: 450, pointerId: 1, button: 0 }));
    });

    act(() => {
      tool.dispatchEvent(createPointerEvent('pointermove', { clientX: 990, clientY: 450, pointerId: 1 }));
    });

    act(() => {
      tool.dispatchEvent(createPointerEvent('pointerup', { clientX: 990, clientY: 450, pointerId: 1 }));
    });

    // Connector should be created
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onBoundary).toHaveBeenCalledTimes(1);

    const snap = objectSnapshot(doc);
    const conn = snap.find((s) => s.type === 'connector');
    expect(conn).toBeDefined();
  });
});

describe('ConnectorObject hit test (TC-20)', () => {
  it('TC-20: click 5px and 7px from an arrow at 50% and 200% zoom → selected / not selected', () => {
    const pts: Point[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }];

    // At 50% zoom: tolerance in world units = 6/0.5 = 12
    const tol50 = CONNECTOR_HIT_TOLERANCE_PX / 0.5;
    // 5 screen px at 50% zoom = 10 world units → within 12
    expect(distanceToPolyline(pts, { x: 50, y: 10 })).toBeLessThanOrEqual(tol50);
    // 7 screen px at 50% zoom = 14 world units → outside 12
    expect(distanceToPolyline(pts, { x: 50, y: 14 })).toBeGreaterThan(tol50);

    // At 200% zoom: tolerance in world units = 6/2.0 = 3
    const tol200 = CONNECTOR_HIT_TOLERANCE_PX / 2.0;
    // 5 screen px at 200% zoom = 2.5 world units → within 3
    expect(distanceToPolyline(pts, { x: 50, y: 2.5 })).toBeLessThanOrEqual(tol200);
    // 7 screen px at 200% zoom = 3.5 world units → outside 3
    expect(distanceToPolyline(pts, { x: 50, y: 3.5 })).toBeGreaterThan(tol200);
  });
});

describe('ConnectorObject re-attach (TC-21)', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  it('TC-21: drag end handle onto C → attached to C; onto empty space → free at release point', () => {
    // Create shapes A, B, C
    const aId = createShape(doc, {
      kind: 'rect',
      rect: { x: 0, y: 0, width: 100, height: 100 },
      at: { x: 0, y: 0 },
    }, 'u1')!;
    const bId = createShape(doc, {
      kind: 'rect',
      rect: { x: 300, y: 0, width: 100, height: 100 },
      at: { x: 300, y: 0 },
    }, 'u1')!;
    const cId = createShape(doc, {
      kind: 'rect',
      rect: { x: 0, y: 300, width: 100, height: 100 },
      at: { x: 0, y: 300 },
    }, 'u1')!;

    // Create connector A→B
    const connId = createConnector(doc,
      { kind: 'attached', objectId: aId, fallback: { x: 100, y: 50 } },
      { kind: 'attached', objectId: bId, fallback: { x: 300, y: 50 } },
      'u1'
    )!;

    // Test re-attach: set 'to' endpoint to C
    const ok1 = setConnectorEndpoint(doc, connId, 'to', { kind: 'attached', objectId: cId, fallback: { x: 50, y: 300 } });
    expect(ok1).toBe(true);

    // Verify
    const obj = doc.getMap('objects').get(connId) as Y.Map<unknown>;
    const to = obj.get('to') as Record<string, unknown>;
    expect(to.kind).toBe('attached');
    expect(to.objectId).toBe(cId);

    // Test detach: set 'to' endpoint to free
    const ok2 = setConnectorEndpoint(doc, connId, 'to', { kind: 'free', x: 500, y: 500 });
    expect(ok2).toBe(true);

    const to2 = (doc.getMap('objects').get(connId) as Y.Map<unknown>).get('to') as Record<string, unknown>;
    expect(to2.kind).toBe('free');
    expect(to2.x).toBe(500);
    expect(to2.y).toBe(500);
  });
});
