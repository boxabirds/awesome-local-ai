import { describe, expect, it } from 'vitest';
import { snapshotAll } from '../../src/shared/board-model';
import { collectConnectorViews } from '../../src/shared/objects/connector';
import { collectShapeSnapshots, getShapeLabel } from '../../src/shared/objects/shape';
import { buildCheckoutBoard } from '../fixtures/shapes-board';

describe('checkout board fixture', () => {
  it('builds 4 labelled shapes, 3 attached connectors and 1 free-ended one', () => {
    const { doc, shapeIds, connectorIds } = buildCheckoutBoard();
    const shapes = collectShapeSnapshots(doc);
    expect(shapes).toHaveLength(4);
    expect([...shapes].map((s) => s.kind).sort()).toEqual(['diamond', 'ellipse', 'rect', 'rect']);
    expect(getShapeLabel(doc, shapeIds.start)?.toString()).toBe('Start');
    expect(getShapeLabel(doc, shapeIds.paid)?.toString()).toBe('Paid?');
    expect(getShapeLabel(doc, shapeIds.process)?.toString()).toBe('Process order');
    expect(getShapeLabel(doc, shapeIds.done)?.toString()).toBe('Done');

    const views = collectConnectorViews(doc);
    expect(views).toHaveLength(4);
    expect(views.filter((v) => !v.orphaned.from && !v.orphaned.to)).toHaveLength(4);
    expect(views.filter((v) => v.from.kind === 'attached' && v.to.kind === 'attached')).toHaveLength(3);
    expect(new Set(connectorIds).size).toBe(4);
    const freeOne = views.find((v) => v.from.kind === 'free');
    expect(freeOne?.to).toMatchObject({ kind: 'attached', objectId: shapeIds.done });

    const snaps = snapshotAll(doc);
    expect(snaps.filter((s) => s.type === 'shape')).toHaveLength(4);
    expect(snaps.filter((s) => s.type === 'connector')).toHaveLength(4);
    let total = 0;
    for (const s of snaps.filter((s) => s.type === 'connector')) {
      expect(s.width).toBeGreaterThanOrEqual(0);
      expect(s.height).toBeGreaterThanOrEqual(0);
      total += (s.width ?? 0) + (s.height ?? 0);
    }
    expect(total).toBeGreaterThan(0);
    doc.destroy();
  });
});
