import { describe, expect, it } from 'vitest';
import { snapshot } from '../../src/shared/board-model';
import { checkoutFlow } from '../fixtures/checkout-flow';

describe('checkout-flow fixture', () => {
  it('has 4 labelled shapes, 3 attached arrows and 1 free-ended arrow', () => {
    const { doc } = checkoutFlow();
    const snap = snapshot(doc);
    const shapes = snap.filter((o) => o.type === 'shape');
    expect(shapes.map((s) => s.kind).sort()).toEqual(['diamond', 'ellipse', 'rect', 'rect']);
    expect(shapes.every((s) => (s.label ?? '').length > 0)).toBe(true);
    const arrows = snap.filter((o) => o.type === 'connector');
    expect(arrows).toHaveLength(4);
    expect(arrows.filter((a) => a.from?.kind === 'attached' && a.to?.kind === 'attached')).toHaveLength(3);
    expect(arrows.filter((a) => a.to?.kind === 'free')).toHaveLength(1);
  });
});
