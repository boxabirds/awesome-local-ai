import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createSticky, deleteObjects, snapshot } from '../../src/shared/board-model';
import { getObjectType } from '../../src/client/objects/registry';
import { createStroke } from '../../src/shared/objects/stroke';
import type { StrokeSnap } from '../../src/shared/objects/stroke';
import { Harness, newProbe } from './helpers';
import type { Probe } from './helpers';

afterEach(cleanup);

const hit = () => screen.getByTestId('stroke-hit');
const strokeOf = (probe: Probe) => snapshot(probe.doc).find((o) => o.type === 'stroke') as unknown as StrokeSnap;

function setup(zoom = 1) {
  const probe = newProbe();
  render(<Harness probe={probe} zoom={zoom} />);
  let id = '';
  act(() => {
    id = createStroke(probe.doc, { points: [{ x: 0, y: 0 }, { x: 400, y: 0 }], color: 'black', thickness: 'thin' }, 'u') as string;
  });
  return { probe, id };
}

describe('stroke object', () => {
  it('renders a round-capped path named Drawing in the stored colour', () => {
    setup();
    const path = screen.getByTestId('stroke-path');
    expect(path.getAttribute('d')?.startsWith('M')).toBe(true);
    expect(path.getAttribute('stroke-linecap')).toBe('round');
    expect(path.getAttribute('stroke-linejoin')).toBe('round');
    expect(path.getAttribute('stroke')).toBe('#212121');
    expect(screen.getByRole('img', { name: 'Drawing' })).toBeTruthy();
  });

  it('registers as a proportional, resizable type', () => {
    const spec = getObjectType('stroke');
    expect(spec).toMatchObject({ resizable: true, aspectLocked: true, minSize: 4, editableText: false });
  });

  it('TC-15 hit test: 5 px hits and 7 px misses at 50% and 200% zoom', () => {
    const { probe } = setup();
    const s = strokeOf(probe);
    const spec = getObjectType('stroke')!;
    for (const zoom of [0.5, 2]) {
      expect(spec.hitTest(s, { x: 100, y: 5 / zoom }, zoom)).toBe(true);
      expect(spec.hitTest(s, { x: 100, y: 7 / zoom }, zoom)).toBe(false);
    }
  });

  it('TC-15 a click within 6 screen pixels selects, farther does not (50% and 200%)', () => {
    for (const zoom of [0.5, 2]) {
      const { probe, id } = setup(zoom);
      fireEvent.pointerDown(hit(), { clientX: 100 * zoom, clientY: 7, pointerId: 1, button: 0 });
      expect(probe.ids.size).toBe(0);
      fireEvent.pointerUp(window, { pointerId: 1 });
      fireEvent.pointerDown(hit(), { clientX: 100 * zoom, clientY: 5, pointerId: 1, button: 0 });
      expect(probe.selectedId).toBe(id);
      fireEvent.pointerUp(window, { pointerId: 1 });
      cleanup();
    }
  });

  it('TC-16 a click inside the bounds but far from the line does not select the stroke; the sticky below is selected', () => {
    const probe = newProbe();
    render(<Harness probe={probe} />);
    let sticky: string | false = false;
    act(() => {
      sticky = createSticky(probe.doc, { x: 100, y: 100 });
      createStroke(
        probe.doc,
        { points: [{ x: 0, y: 0 }, { x: 0, y: 400 }, { x: 400, y: 400 }], color: 'red', thickness: 'medium' },
        'u',
      );
    });
    fireEvent.pointerDown(hit(), { clientX: 200, clientY: 200, pointerId: 1, button: 0 });
    expect(probe.ids.size).toBe(0);
    fireEvent.pointerUp(window, { pointerId: 1 });
    fireEvent.pointerDown(screen.getByRole('group', { name: 'Sticky note' }), { clientX: 200, clientY: 200, pointerId: 1, button: 0 });
    expect(probe.selectedId).toBe(sticky);
  });

  it('TC-21 a stroke deleted while selected clears the selection without error', () => {
    const { probe, id } = setup();
    fireEvent.pointerDown(hit(), { clientX: 100, clientY: 0, pointerId: 1, button: 0 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(probe.selectedId).toBe(id);
    act(() => void deleteObjects(probe.doc, [id]));
    expect(probe.ids.size).toBe(0);
    expect(screen.queryByTestId('stroke-path')).toBeNull();
  });
});
