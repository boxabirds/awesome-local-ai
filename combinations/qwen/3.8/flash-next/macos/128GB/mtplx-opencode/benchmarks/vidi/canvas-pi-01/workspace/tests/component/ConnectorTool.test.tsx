/**
 * Story 10 · task 14 — connector tool / connector object component tests
 * (TC-18 to TC-21).
 *
 * Same harness as the shape tests: a real `Y.Doc`, the real `BoardShell`, the
 * default camera (`{-400,-300}` at zoom 1) and jsdom's empty `getBoundingClientRect`,
 * so a screen point maps to `screen + (-400,-300)` in world units. Where a test
 * needs a *distance* rather than an element (TC-20's 5 px vs 7 px), it asks the
 * same production function the component asks — the registry hit test — because
 * jsdom resolves no geometry of its own.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';
import { BoardShell } from '../../src/client/App';
import { createSticky, initDoc, snapshot } from '../../src/shared/board-model';
import { createShape } from '../../src/shared/objects/shape';
import { createConnector } from '../../src/shared/objects/connector';
import { getObjectType } from '../../src/client/objects/registry';
import { CONNECTOR_HIT_TOLERANCE_PX } from '../../src/shared/config';

const VIEWPORT = { width: 800, height: 600 };

beforeEach(() => {
  cleanup();
});

function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

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
function setCamera(cam: { x: number; y: number; zoom: number }) {
  act(() => {
    window.__vidi6?.setCamera(cam);
  });
}

function seedShape(
  doc: Y.Doc,
  x: number,
  y: number,
  width = 100,
  height = 100,
  kind = 'rect',
): string {
  const id = createShape(
    doc,
    { kind: kind as never, rect: { x, y, width, height }, at: { x, y } },
    'tester',
  );
  if (id === null) throw new Error('seed shape failed');
  return id;
}

/** Activate the Connector tool and return its overlay. */
function connectorTool(doc: Y.Doc): HTMLElement {
  render(<BoardShell viewport={VIEWPORT} doc={doc} />);
  act(() => {
    fireEvent(window, new KeyboardEvent('keydown', { key: 'l', bubbles: true }));
  });
  const tool = screen.getByTestId('connector-tool');
  expect(tool).toBeTruthy();
  return tool as HTMLElement;
}

describe('Connector tool hover (TC-18)', () => {
  // TC-18: hovering a shape lights four dots, one per side midpoint; hovering
  // empty space lights none.
  it('TC-18 — a hovered shape shows four side-midpoint dots, empty space shows none', () => {
    const doc = freshDoc();
    seedShape(doc, 0, 0);
    const tool = connectorTool(doc);

    // Empty space: screen (450,350) is world (50,50), inside the shape.
    fireEvent(tool, pointer('pointermove', 700, 500));
    expect(screen.queryAllByTestId('connector-dot')).toHaveLength(0);

    fireEvent(tool, pointer('pointermove', 450, 350));
    const dots = screen.getAllByTestId('connector-dot');
    expect(dots).toHaveLength(4);
    expect(dots.map((dot) => (dot as HTMLElement).dataset.side).sort()).toEqual([
      'bottom',
      'left',
      'right',
      'top',
    ]);
    expect(dots.every((dot) => (dot as HTMLElement).dataset.highlighted === 'false')).toBe(true);
  });

  // Text and sticky notes are anchors too; another arrow is not.
  it('TC-18b — a sticky offers dots as well, a connector never does', () => {
    const doc = freshDoc();
    seedShape(doc, 0, 0, 100, 100, 'rect');
    const stickyId = createSticky(doc, { x: 250, y: 0 });
    const arrowId = createConnector(
      doc,
      { kind: 'free', x: -200, y: -200 },
      { kind: 'free', x: -150, y: -200 },
      'tester',
    );
    expect(arrowId).not.toBeNull();
    const tool = connectorTool(doc);

    // Over the sticky (world 250..350, 0..100 → screen 650..750, 300..400).
    fireEvent(tool, pointer('pointermove', 700, 350));
    expect(screen.getAllByTestId('connector-dot')).toHaveLength(4);
    expect(screen.getAllByTestId('connector-dot')[0]!.closest('[data-testid]')).toBeTruthy();

    // Over the free arrow: it draws, but it is not something to connect to.
    fireEvent(tool, pointer('pointermove', 100, 100));
    expect(screen.queryAllByTestId('connector-dot')).toHaveLength(0);
    expect(stickyId).toBeTruthy();
  });
});

describe('Connector creation (TC-19)', () => {
  // TC-19: a drag that starts on A and ends over B writes one connector,
  // attached at both ends, and lights B's nearest dot while dragging.
  it('TC-19 — a drag from A to B makes one arrow attached at both ends', () => {
    const doc = freshDoc();
    const a = seedShape(doc, 0, 0);
    const b = seedShape(doc, 200, 0);
    const tool = connectorTool(doc);

    // A's centre → B's centre (both at world y 50).
    fireEvent(tool, pointer('pointerdown', 450, 350));
    fireEvent(tool, pointer('pointermove', 600, 350));

    // Mid-drag the target shows its dots, with the side facing A highlighted.
    const lit = screen
      .getAllByTestId('connector-dot')
      .filter((dot) => (dot as HTMLElement).dataset.highlighted === 'true');
    expect(lit).toHaveLength(1);
    expect(lit[0]!.getAttribute('data-side')).toBe('left');
    expect(screen.getByTestId('connector-preview')).toBeTruthy();

    fireEvent(tool, pointer('pointerup', 650, 350));

    const arrows = snapshot(doc).filter((obj) => obj.type === 'connector');
    expect(arrows).toHaveLength(1);
    const arrow = screen.getByTestId(`connector-${arrows[0]!.id}`) as HTMLElement;
    expect(arrow.getAttribute('data-from')).toBe(`attached:${a}`);
    expect(arrow.getAttribute('data-to')).toBe(`attached:${b}`);
    // Both ends resolved onto the facing sides: A's right-middle, B's left-middle.
    expect(arrows[0]!.ends).toEqual({
      from: { x: 100, y: 50 },
      to: { x: 200, y: 50 },
    });
    // The tool handed the board back to Select.
    expect(
      (screen.getByTestId('tool-connector') as HTMLButtonElement).getAttribute('aria-pressed'),
    ).toBe('false');
  });

  // A drag that starts over nothing makes a free arrow; the tool still returns
  // to Select (PRD connector.create_free).
  it('TC-19b — a drag over empty space makes a free-to-free arrow', () => {
    const doc = freshDoc();
    const tool = connectorTool(doc);
    fireEvent(tool, pointer('pointerdown', 200, 200));
    fireEvent(tool, pointer('pointermove', 400, 320));
    fireEvent(tool, pointer('pointerup', 400, 320));

    const arrows = snapshot(doc).filter((obj) => obj.type === 'connector');
    expect(arrows).toHaveLength(1);
    expect((screen.getByTestId(`connector-${arrows[0]!.id}`) as HTMLElement).getAttribute('data-to')).toBe(
      'free',
    );
  });

  // TC-19 negatives: a drag that ends on the object it started on, and a span
  // under the minimum length, are refused and keep the tool active.
  it('TC-19c — a same-object or too-short drag writes nothing', () => {
    const doc = freshDoc();
    seedShape(doc, 0, 0);
    const tool = connectorTool(doc);

    // Inside one shape the whole way: refused, and the tool stays a Connector.
    fireEvent(tool, pointer('pointerdown', 430, 340));
    fireEvent(tool, pointer('pointermove', 460, 355));
    fireEvent(tool, pointer('pointerup', 460, 355));
    expect(snapshot(doc).filter((obj) => obj.type === 'connector')).toHaveLength(0);
    expect((screen.getByTestId('tool-connector') as HTMLButtonElement).getAttribute('aria-pressed')).toBe(
      'true',
    );

    // A six-unit span in empty space clears the drag threshold but not the
    // minimum arrow length: refused, still no arrow.
    fireEvent(tool, pointer('pointerdown', 600, 200));
    fireEvent(tool, pointer('pointermove', 605, 204));
    fireEvent(tool, pointer('pointerup', 605, 204));
    expect(snapshot(doc).filter((obj) => obj.type === 'connector')).toHaveLength(0);
    expect((screen.getByTestId('tool-connector') as HTMLButtonElement).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });
});

describe('Connector selection (TC-20)', () => {
  // The arrow's own hit band is 6 screen pixels on each side at every zoom:
  // 5 px selects, 7 px does not, and the drawn stroke keeps that width.
  it.each([0.5, 2])(
    'TC-20 — at %s zoom a press 5 px off the line selects and 7 px does not',
    async (zoom) => {
      const doc = freshDoc();
      seedShape(doc, 0, 0);
      seedShape(doc, 200, 0);
      const arrowId = createConnector(
        doc,
        { kind: 'attached', objectId: snapshot(doc)[0]!.id, fallback: { x: 100, y: 50 } },
        { kind: 'attached', objectId: snapshot(doc)[1]!.id, fallback: { x: 200, y: 50 } },
        'tester',
      );
      expect(arrowId).not.toBeNull();
      render(<BoardShell viewport={VIEWPORT} doc={doc} />);
      const hit = screen.getByTestId('connector-hit') as unknown as SVGLineElement;
      setCamera({ x: -400, y: -300, zoom });
      // Wait for the camera to be *applied* and the arrow to be redrawn at it:
      // the measurements below are screen-pixel offsets, so a stale zoom makes
      // them mean nothing. Watching only the stroke width let this pass while the
      // camera was still at 1, which is the failure, not the fix.
      await waitFor(async () => {
        expect(window.__vidi6?.getCamera().zoom).toBe(zoom);
        expect(Number(hit.getAttribute('stroke-width'))).not.toBe(12);
      });
      expect(window.__vidi6?.getCamera().zoom).toBe(zoom);

      const spec = getObjectType('connector')!;
      const arrow = snapshot(doc).find((obj) => obj.id === arrowId)!;
      // The line runs along world y = 50; offset perpendicular to it.
      const offset = (px: number) => px / zoom;
      expect(spec.hitTest!(arrow, { x: 150, y: 50 + offset(5) }, zoom)).toBe(true);
      expect(spec.hitTest!(arrow, { x: 150, y: 50 + offset(7) }, zoom)).toBe(false);

      // The drawn hit stroke is that tolerance in world units, i.e. a constant
      // 12 px band on screen.
      expect(Number(hit.getAttribute('stroke-width'))).toBeCloseTo(
        (CONNECTOR_HIT_TOLERANCE_PX * 2) / zoom,
        6,
      );
    },
  );

  // A press inside the band selects the arrow; the wrapper around it is not a
  // target, so the board's own gestures stay reachable.
  it('TC-20b — pressing the hit stroke selects the arrow', () => {
    const doc = freshDoc();
    seedShape(doc, 0, 0);
    seedShape(doc, 200, 0);
    const arrowId = createConnector(
      doc,
      { kind: 'attached', objectId: snapshot(doc)[0]!.id, fallback: { x: 100, y: 50 } },
      { kind: 'attached', objectId: snapshot(doc)[1]!.id, fallback: { x: 200, y: 50 } },
      'tester',
    )!;
    render(<BoardShell viewport={VIEWPORT} doc={doc} />);

    const arrow = screen.getByTestId(`connector-${arrowId}`) as HTMLElement;
    expect(arrow.getAttribute('data-selected')).toBe('false');
    const hit = screen.getByTestId('connector-hit');
    fireEvent(hit, pointer('pointerdown', 500, 350));
    fireEvent(hit, pointer('pointerup', 500, 350));
    expect(
      (screen.getByTestId(`connector-${arrowId}`) as HTMLElement).getAttribute('data-selected'),
    ).toBe('true');
  });
});

describe('Connector re-attach (TC-21)', () => {
  // TC-21a: dragging the arrow's tail onto a third shape re-attaches it.
  it('TC-21 — dragging an end handle onto another shape re-attaches it', () => {
    const doc = freshDoc();
    const a = seedShape(doc, 0, 0);
    const b = seedShape(doc, 200, 0);
    const c = seedShape(doc, 0, 200);
    const arrowId = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } },
      { kind: 'attached', objectId: b, fallback: { x: 200, y: 50 } },
      'tester',
    )!;
    render(<BoardShell viewport={VIEWPORT} doc={doc} />);

    // Select the arrow so its handles exist.
    const hit = screen.getByTestId('connector-hit');
    fireEvent(hit, pointer('pointerdown', 500, 350));
    fireEvent(hit, pointer('pointerup', 500, 350));
    const handle = screen.getByTestId('connector-handle-to');
    expect(handle).toBeTruthy();

    // jsdom gives the SVG an empty rect, so the component maps a client point as
    // `bbox origin + client / zoom`. Origin is (76, 26) for this arrow; aim at
    // the middle of C (world 50, 250).
    const origin = { x: 76, y: 26 };
    const target = { x: 50, y: 250 };
    const at = { x: target.x - origin.x, y: target.y - origin.y };
    fireEvent(handle, pointer('pointerdown', 500, 350));
    fireEvent(handle, pointer('pointermove', at.x, at.y));
    fireEvent(handle, pointer('pointerup', at.x, at.y));

    const arrow = (screen.getByTestId(`connector-${arrowId}`) as HTMLElement)
      .dataset as DOMStringMap;
    expect(arrow.to).toBe(`attached:${c}`);
    expect(arrow.from).toBe(`attached:${a}`);
  });

  // TC-21b: the same drag released over empty space leaves a free end at the
  // point where the pointer was let go.
  it('TC-21b — releasing an end handle over empty space leaves a free end', () => {
    const doc = freshDoc();
    const a = seedShape(doc, 0, 0);
    const b = seedShape(doc, 200, 0);
    const arrowId = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } },
      { kind: 'attached', objectId: b, fallback: { x: 200, y: 50 } },
      'tester',
    )!;
    render(<BoardShell viewport={VIEWPORT} doc={doc} />);

    const hit = screen.getByTestId('connector-hit');
    fireEvent(hit, pointer('pointerdown', 500, 350));
    fireEvent(hit, pointer('pointerup', 500, 350));
    const handle = screen.getByTestId('connector-handle-from');

    // Origin (76, 26) again; release at world (300, -100), which is empty.
    const release = { x: 300, y: -100 };
    const at = { x: release.x - 76, y: release.y - 26 };
    fireEvent(handle, pointer('pointerdown', 100, 100));
    fireEvent(handle, pointer('pointermove', at.x, at.y));
    fireEvent(handle, pointer('pointerup', at.x, at.y));

    const snap = snapshot(doc).find((obj) => obj.id === arrowId)!;
    expect(snap.from).toEqual({ kind: 'free', x: release.x, y: release.y });
    expect(snap.to).toEqual({ kind: 'attached', objectId: b, fallback: { x: 200, y: 50 } });
  });

  // A release on the object the end already points at is refused, and a
  // cancelled drag writes nothing at all.
  it('TC-21c — a handle released on its own target, or cancelled, changes nothing', () => {
    const doc = freshDoc();
    const a = seedShape(doc, 0, 0);
    const b = seedShape(doc, 200, 0);
    const arrowId = createConnector(
      doc,
      { kind: 'attached', objectId: a, fallback: { x: 100, y: 50 } },
      { kind: 'attached', objectId: b, fallback: { x: 200, y: 50 } },
      'tester',
    )!;
    render(<BoardShell viewport={VIEWPORT} doc={doc} />);
    const before = JSON.stringify(snapshot(doc).find((obj) => obj.id === arrowId)!);

    const hit = screen.getByTestId('connector-hit');
    fireEvent(hit, pointer('pointerdown', 500, 350));
    fireEvent(hit, pointer('pointerup', 500, 350));

    // Released on B (world 250,50 → client 174,24): snapped back, unchanged.
    const handle = screen.getByTestId('connector-handle-to');
    fireEvent(handle, pointer('pointerdown', 500, 350));
    fireEvent(handle, pointer('pointermove', 174, 24));
    fireEvent(handle, pointer('pointerup', 174, 24));
    expect(JSON.stringify(snapshot(doc).find((obj) => obj.id === arrowId)!)).toBe(before);

    // A cancelled drag never writes either.
    fireEvent(handle, pointer('pointerdown', 500, 350));
    fireEvent(handle, pointer('pointermove', 10, 300));
    fireEvent(handle, pointer('pointercancel', 10, 300));
    expect(JSON.stringify(snapshot(doc).find((obj) => obj.id === arrowId)!)).toBe(before);
  });
});
