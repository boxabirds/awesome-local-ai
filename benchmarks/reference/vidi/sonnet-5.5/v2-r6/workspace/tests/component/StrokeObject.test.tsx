import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type * as Y from 'yjs';
import { deleteObjects, snapshot, type StrokeSnapshot } from '../../src/shared/board-model';
import { getObjectType } from '../../src/client/objects/registry';
import { PEN_COLORS, STROKE_HIT_TOLERANCE_PX } from '../../src/shared/config';
import { createStroke } from '../../src/shared/objects/stroke';
import { addNote, noteEl, renderBoardAtOrigin } from './board';

function addStroke(doc: Y.Doc, pts: [number, number][], thickness: 'thin' | 'medium' | 'thick' = 'thin'): string {
  let id = '';
  act(() => {
    id = createStroke(doc, { points: pts.map(([x, y]) => ({ x, y })), color: 'red', thickness }, 'g') as string;
  });
  return id;
}
const strokeEl = (id: string) => document.querySelector(`[data-stroke-object][data-object-id="${id}"]`) as HTMLElement;
const strokeOf = (doc: Y.Doc, id: string) => snapshot(doc).find((o) => o.id === id) as StrokeSnapshot;

describe('stroke object', () => {
  it('renders a round-capped smoothed path named Drawing in the stroke colour', async () => {
    const { doc } = await renderBoardAtOrigin();
    const id = addStroke(doc, [[100, 100], [150, 160], [200, 100]], 'thick');
    const el = strokeEl(id);
    expect(el.getAttribute('aria-label')).toBe('Drawing');
    expect(screen.getByRole('img', { name: 'Drawing' })).toBe(el);
    const path = el.querySelector('[data-testid="stroke-path"]')!;
    expect(path.getAttribute('d')).toMatch(/^M.*Q/);
    expect(path.getAttribute('stroke')).toBe(PEN_COLORS.red);
    expect(path.getAttribute('stroke-width')).toBe('8');
    expect(path.getAttribute('stroke-linecap')).toBe('round');
  });

  it('TC-15 hit test selects at 5 px and misses at 7 px from the line, at 50% and 200% zoom', async () => {
    const { doc } = await renderBoardAtOrigin();
    const id = addStroke(doc, [[0, 0], [200, 0]]);
    const s = strokeOf(doc, id);
    const hit = getObjectType('stroke')!.hitTest;
    expect(STROKE_HIT_TOLERANCE_PX).toBe(6);
    for (const zoom of [0.5, 2]) {
      expect(hit(s, { x: 100, y: 5 / zoom }, zoom)).toBe(true);
      expect(hit(s, { x: 100, y: 7 / zoom }, zoom)).toBe(false);
    }
  });

  it('TC-16 clicking inside the stroke bounds away from the line selects the sticky below, not the stroke', async () => {
    const { doc } = await renderBoardAtOrigin();
    const note = addNote(doc, 200, 200);
    const id = addStroke(doc, [[0, 0], [400, 0], [400, 400]]);
    expect(getObjectType('stroke')!.hitTest(strokeOf(doc, id), { x: 200, y: 200 }, 1)).toBe(false);
    fireEvent.pointerDown(noteEl(note), { clientX: 200, clientY: 200, button: 0, pointerId: 1 });
    fireEvent.pointerUp(noteEl(note), { clientX: 200, clientY: 200, pointerId: 1 });
    expect(noteEl(note).dataset.selected).toBe('true');
    expect(strokeEl(id).dataset.selected).toBe('false');
  });

  it('pressing the line selects the stroke', async () => {
    const { doc } = await renderBoardAtOrigin();
    const id = addStroke(doc, [[0, 0], [400, 0]]);
    const hit = strokeEl(id).querySelector('[data-testid="stroke-hit"]')!;
    fireEvent.pointerDown(hit, { clientX: 200, clientY: 0, button: 0, pointerId: 1 });
    fireEvent.pointerUp(hit, { clientX: 200, clientY: 0, pointerId: 1 });
    expect(strokeEl(id).dataset.selected).toBe('true');
  });

  it('TC-21 a stroke deleted remotely while selected clears the selection without error', async () => {
    const { doc } = await renderBoardAtOrigin();
    const id = addStroke(doc, [[0, 0], [400, 0]]);
    const hit = strokeEl(id).querySelector('[data-testid="stroke-hit"]')!;
    fireEvent.pointerDown(hit, { clientX: 200, clientY: 0, button: 0, pointerId: 1 });
    fireEvent.pointerUp(hit, { clientX: 200, clientY: 0, pointerId: 1 });
    expect(screen.getByTestId('selection-box')).toBeTruthy();
    act(() => { deleteObjects(doc, [id]); });
    expect(strokeEl(id)).toBeNull();
    expect(screen.queryByTestId('selection-box')).toBeNull();
    expect(document.querySelectorAll('[data-selected="true"]')).toHaveLength(0);
  });
});
