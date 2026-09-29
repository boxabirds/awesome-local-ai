import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { seedCheckoutFlow } from '../fixtures/checkout-flow';
import { snapshotShape } from '@shared/objects/shape';
import { snapshotConnector } from '@shared/objects/connector';

describe('checkout-flow fixture', () => {
  it('seeds 4 labelled shapes, 3 attached connectors and 1 free-ended connector', () => {
    const doc = new Y.Doc();
    const { shapes, connectors } = seedCheckoutFlow(doc);
    expect(shapes.length).toBe(4);
    expect(connectors.length).toBe(4);

    const shapeSnaps = snapshotShape(doc);
    expect(shapeSnaps.length).toBe(4);
    expect(shapeSnaps.map((s) => s.kind).sort()).toEqual(['diamond', 'ellipse', 'rect', 'rect']);
    for (const s of shapeSnaps) expect(s.label.length).toBeGreaterThan(0);

    const connSnaps = snapshotConnector(doc);
    expect(connSnaps.length).toBe(4);
    const attachedCount = connSnaps.filter(
      (c) => c.from.kind === 'attached' && c.to.kind === 'attached',
    ).length;
    const freeEndCount = connSnaps.filter((c) => c.to.kind === 'free').length;
    expect(attachedCount).toBe(3);
    expect(freeEndCount).toBe(1);
  });

  it('attached connectors all reference seeded shape ids', () => {
    const doc = new Y.Doc();
    const { shapes } = seedCheckoutFlow(doc);
    const idSet = new Set(shapes);
    for (const c of snapshotConnector(doc)) {
      if (c.from.kind === 'attached') expect(idSet.has(c.from.objectId)).toBe(true);
      if (c.to.kind === 'attached') expect(idSet.has(c.to.objectId)).toBe(true);
    }
  });
});
