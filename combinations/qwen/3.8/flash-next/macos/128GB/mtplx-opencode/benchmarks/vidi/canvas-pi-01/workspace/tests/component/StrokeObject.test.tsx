/**
 * Story 11 · task 17 — the sketch's own footprint (TC-15, TC-16, TC-21).
 *
 * A sketch is a *line* that happens to sit in a rectangular box, and three of the
 * story's promises live in that difference:
 *  - it stays as easy to grab at 50 % as at 200 %, because the tolerance is
 *    measured in screen pixels (`STROKE_HIT_TOLERANCE_PX / zoom`), with half the
 *    ink as a floor (PRD pen.hit);
 *  - a press in the empty middle of a loop is not a press on the sketch, so
 *  whatever
 *    lies there — a sticky note — still takes the click (PRD pen.hit);
 *  - a sketch removed by someone else while it is selected leaves no dangling
 *    selection behind (PRD undo.own / story 7 stale ids).
 *
 * jsdom does no geometry, so a pointer event dispatched at a screen position is
 * not a way of asking "what is under this pixel" — it only shows which element the
 * event was routed through. These tests therefore ask the question the app itself
 * asks (`hitTestAt` over the render snapshot, run back to front in z order), and
 * use the DOM for what the DOM can prove: the painted hit band keeps its width in
 * screen pixels, and an object that is not under the pointer never swallows the
 * press.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';
import { BoardShell } from '../../src/client/App';
import { createSticky, initDoc, snapshot } from '../../src/shared/board-model';
import { createStroke } from '../../src/shared/objects/stroke';
import { getObjectType, hitTestAt } from '../../src/client/objects/registry';
import { STROKE_HIT_TOLERANCE_PX } from '../../src/shared/config';
import { createPeer } from '../unit/peer';
import type { Point } from '../../src/shared/geometry';

const VIEWPORT = { width: 800, height: 600 };

beforeEach(() => {
  cleanup();
});

function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** A pointer event the delegated pointer handlers accept. */
function pointer(
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  x: number,
  y: number,
): MouseEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  Object.defineProperty(event, 'isPrimary', { value: true });
  return event;
}

/** Jump the camera (test hook), re-rendering the board. */
function setCamera(cam: { x: number; y: number; zoom: number }): void {
  act(() => {
    window.__vidi6?.setCamera(cam);
  });
}

/** A straight run along world y = 0, from x = 0 to x = 400. */
function line(): Point[] {
  const points: Point[] = [];
  for (let x = 0; x <= 400; x += 8) points.push({ x, y: 0 });
  return points;
}

describe('the sketch footprint (TC-15)', () => {
  // The tolerance is a screen distance, so the design's 5 px / 7 px pair has to
  // split hit from miss at every zoom the board can be viewed at.
  for (const zoom of [0.5, 1, 2]) {
    it(`is grabbable at 5 screen px and not at 7 px, at ${zoom * 100} % zoom`, async () => {
      const doc = freshDoc();
      const id = createStroke(doc, { points: line(), color: 'black', thickness: 'medium' }, 'me')!;
      const { container } = render(<BoardShell viewport={VIEWPORT} doc={doc} />);
      const hit = container.querySelector('[data-testid="stroke-hit"]') as SVGPathElement;
      setCamera({ x: -400, y: -300, zoom });
      // The camera settles on the next frame; wait for the band to be repainted at
      // the new zoom before measuring anything.
      await waitFor(() => {
        expect(window.__vidi6?.getCamera().zoom).toBe(zoom);
      });

      const stroke = snapshot(doc).find((entry) => entry.id === id)!;
      const spec = getObjectType('stroke')!;
      // Screen pixels, turned into world units by the zoom actually in force.
      const offset = (px: number): Point => ({ x: 200, y: px / zoom });
      expect(spec.hitTest(stroke, offset(0), zoom)).toBe(true);
      expect(spec.hitTest(stroke, offset(5), zoom)).toBe(true);
      expect(spec.hitTest(stroke, offset(7), zoom)).toBe(false);
      // …and the painted hit band is the same width on screen at every zoom: the
      // tolerance lives on the screen, not in the model.
      expect(Number(hit.getAttribute('stroke-width'))).toBeCloseTo(
        (2 * STROKE_HIT_TOLERANCE_PX) / zoom,
        3,
      );
    });
  }

  it('keeps a thick sketch grabbable by half its ink, not only by 5 px', () => {
    const doc = freshDoc();
    const id = createStroke(doc, { points: line(), color: 'black', thickness: 'thick' }, 'me')!;
    const stroke = snapshot(doc).find((entry) => entry.id === id)!;
    const spec = getObjectType('stroke')!;
    // At 200 % the pixel allowance is only 3 world units, but the ink is 8 wide:
    // the press stays catchable 4 units either side of the drawn line (PRD
    // pen.hit), so 3.5 units is a hit and 5 units is not.
    expect(spec.hitTest(stroke, { x: 200, y: 3.5 }, 2)).toBe(true);
    expect(spec.hitTest(stroke, { x: 200, y: 5 }, 2)).toBe(false);
  });

  it('gives a press in the middle of a loop to what lies there (TC-16)', () => {
    const doc = freshDoc();
    // A note centred at (200,180), then a sketch whose box covers it: the sketch is
    // on top, and its box contains the note's centre, but its *line* does not.
    const noteId = createSticky(doc, { x: 200, y: 180 });
    const strokeId = createStroke(
      doc,
      {
        points: [
          { x: 0, y: 0 },
          { x: 400, y: 0 },
          { x: 400, y: 200 },
        ],
        color: 'black',
        thickness: 'medium',
      },
      'me',
    )!;
    const snap = snapshot(doc);
    const stroke = snap.find((entry) => entry.id === strokeId)!;
    expect(stroke.z).toBeGreaterThan(snap.find((entry) => entry.id === noteId)!.z);

    // The point is inside the sketch's box and 180 units from its ink.
    const centre = { x: 200, y: 180 };
    expect(
      hitTestAt(snap, centre, 1)!.id,
      'a press in the empty middle belongs to the note, not to the sketch',
    ).toBe(noteId);
    // …and the same answer with the note on top, for the other reason: the sketch
    // simply is not there.
    expect(hitTestAt([...snap].reverse(), centre, 1)!.id).toBe(noteId);

    render(<BoardShell viewport={VIEWPORT} doc={doc} />);
    // The sketch is not a sheet of glass: only its ink is a target, so a press
    // routed anywhere else reaches the note underneath.
    const strokeHit = screen.getByTestId('stroke-hit');
    expect(strokeHit.style.pointerEvents).toBe('stroke');
    const note = screen.getByTestId(`note-${noteId}`);
    fireEvent(note, pointer('pointerdown', 600, 480));
    expect(note.getAttribute('data-selected')).toBe('true');
    expect(screen.getByTestId('stroke').getAttribute('data-selected')).toBe('false');
  });
});

describe('a sketch removed by someone else while selected (TC-21)', () => {
  it('drops the selection without an error', () => {
    const doc = freshDoc();
    const id = createStroke(doc, { points: line(), color: 'black', thickness: 'medium' }, 'me')!;
    const { container } = render(<BoardShell viewport={VIEWPORT} doc={doc} />);

    // Select it on its ink, so it is genuinely the selected object…
    const hit = container.querySelector('[data-testid="stroke-hit"]') as SVGPathElement;
    fireEvent(hit, pointer('pointerdown', 400, 300));
    expect(screen.getByTestId('stroke').getAttribute('data-selected')).toBe('true');
    expect(container.querySelector('[data-testid="stroke-toolbar"]')).toBeTruthy();

    // …then a colleague deletes it, and the board re-renders without it.
    const peer = createPeer(doc);
    expect(() => {
      act(() => {
        peer.change(doc, (other) => {
          other.getMap<Y.Map<unknown>>('objects').delete(id);
        });
      });
    }).not.toThrow();

    expect(snapshot(doc).find((entry) => entry.id === id)).toBeUndefined();
    expect(container.querySelector('[data-testid="stroke"]')).toBeNull();
    expect(container.querySelector('[data-testid="stroke-toolbar"]')).toBeNull();
    // The board itself is still there and still answering.
    expect(screen.getByTestId('origin-marker')).toBeTruthy();
  });
});
