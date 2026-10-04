import { act, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';
import { flushFrames } from '../helpers';
import {
  moveTo,
  press,
  release,
  type MountedSticky,
  type PointerOptions,
} from './sticky';
import { STROKE_TYPE, snapshot, type ObjectSnapshot } from '../../../src/shared/board-model';
import { asStrokeSnapshot, type StrokeSnapshot } from '../../../src/shared/objects/stroke';
import type { PenColor, PenThickness } from '../../../src/shared/config';
import type { Point } from '../../../src/shared/geometry';

/**
 * The pen, at the level of a screen: the tool's keys, the line it shows while it is down, the stroke it
 * leaves behind.
 *
 * Everything is written the way the browser writes it - a press on the board, moves on the window, a
 * release on the board - because the pen listens in exactly those three places, and a test that pressed
 * on the window would be testing a press nobody can make.
 */

/** Where a stroke element is; the markings drawn over an object are not the object. */
export function strokeElements(board: MountedSticky): HTMLElement[] {
  return [
    ...board.view.container.querySelectorAll<HTMLElement>(
      `[data-object-type="${STROKE_TYPE}"]:not(.selection-outline)`,
    ),
  ];
}

export function strokeElement(board: MountedSticky, id: string): HTMLElement {
  const element = board.view.container.querySelector<HTMLElement>(
    `[data-object-id="${id}"][data-object-type="${STROKE_TYPE}"]`,
  );
  if (element === null) {
    throw new Error(`the board draws no stroke for ${id}`);
  }
  return element;
}

/** The stroke this id holds; throws when the board has no stroke of that name. */
export function strokeOf(board: MountedSticky, id: string): StrokeSnapshot {
  const stroke = asStrokeSnapshot(board.objects().find((object) => object.id === id)!);
  if (stroke === null) {
    throw new Error(`object ${id} is not a stroke the board can read`);
  }
  return stroke;
}

/** Every stroke on the board, in the order they were written. */
export function strokes(board: MountedSticky): StrokeSnapshot[] {
  return board
    .objects()
    .map((object) => asStrokeSnapshot(object))
    .filter((stroke): stroke is StrokeSnapshot => stroke !== null);
}

/** The wide invisible line a stroke is clicked on. */
export function hitPath(board: MountedSticky, id: string): SVGPathElement {
  const path = strokeElement(board, id).querySelector<SVGPathElement>('[data-testid="stroke-hit"]');
  if (path === null) {
    throw new Error(`the stroke ${id} has no clickable line on screen`);
  }
  return path;
}

/** The line a stroke is drawn with. */
export function drawnPath(board: MountedSticky, id: string): SVGPathElement {
  const path = strokeElement(board, id).querySelector<SVGPathElement>('[data-testid="stroke-line"]');
  if (path === null) {
    throw new Error(`the stroke ${id} draws no line`);
  }
  return path;
}

/** The line the pen is showing while the pointer is down, or null when it is showing nothing. */
export function previewPath(board: MountedSticky): SVGPathElement | null {
  return board.view.container.querySelector<SVGPathElement>('[data-testid="pen-preview-path"]');
}

/** The round dot that stands in for the pen. */
export function penCursor(board: MountedSticky): HTMLElement | null {
  return board.view.container.querySelector<HTMLElement>('[data-testid="pen-cursor"]');
}

/** The pen's own bar of colours and widths, or null while some other tool is up. */
export function penToolbarOrNull(board: MountedSticky): HTMLElement | null {
  return board.view.container.querySelector<HTMLElement>('[data-testid="pen-toolbar"]');
}

export function penToolbar(board: MountedSticky): HTMLElement {
  const bar = penToolbarOrNull(board);
  if (bar === null) {
    throw new Error('the pen toolbar is not on screen (is the Pen tool up?)');
  }
  return bar;
}

export function penColorButton(board: MountedSticky, color: PenColor): HTMLElement {
  const button = board.view.container.querySelector<HTMLElement>(
    `[data-testid="pen-color-${color}"]`,
  );
  if (button === null) {
    throw new Error(`the pen toolbar offers no ${color} swatch`);
  }
  return button;
}

export function penThicknessButton(board: MountedSticky, thickness: PenThickness): HTMLElement {
  const button = board.view.container.querySelector<HTMLElement>(
    `[data-testid="pen-thickness-${thickness}"]`,
  );
  if (button === null) {
    throw new Error(`the pen toolbar offers no ${thickness} width`);
  }
  return button;
}

/** Press a colour swatch. */
export async function pickPenColor(board: MountedSticky, color: PenColor): Promise<void> {
  fireEvent.click(penColorButton(board, color));
  await flushFrames();
}

/** Press a width button. */
export async function pickPenThickness(board: MountedSticky, thickness: PenThickness): Promise<void> {
  fireEvent.click(penThicknessButton(board, thickness));
  await flushFrames();
}

/** Put the Pen tool up, and say so loudly if the key did not do it. */
export async function armPen(board: MountedSticky): Promise<void> {
  fireEvent.keyDown(window, { key: 'p', code: 'KeyP' });
  await flushFrames();
  if (board.board.dataset.tool !== 'pen') {
    throw new Error('P did not put the Pen tool up');
  }
}

/** The points a path string was built out of: every `x y` pair in it, in order. */
export function pathPoints(path: string): Point[] {
  const found = path.match(/-?\d+(?:\.\d+)? -?\d+(?:\.\d+)?/g) ?? [];
  return found.map((pair) => {
    const [x, y] = pair.split(' ').map(Number) as [number, number];
    return { x, y };
  });
}

/** The preview's points, screen units; throws when nothing is being drawn. */
export function previewPoints(board: MountedSticky): Point[] {
  const path = previewPath(board);
  if (path === null) {
    throw new Error('the pen is showing no line (is the pointer down?)');
  }
  return pathPoints(path.getAttribute('d') ?? '');
}

export interface PenMoveOptions extends PointerOptions {
  /**
   * The positions the browser folded into this one move.
   *
   * `getCoalescedEvents()` is the only way a 240 Hz stylus ever reaches the tool, and jsdom has no
   * coalescing to speak of, so a test that means to prove the pen reads the batch has to hand it over
   * by hand. Given, the event reports exactly these positions and no others - including none, which is
   * what a browser that coalesced nothing reports.
   */
  coalesced?: readonly Point[];
}

/** One pointer move, at a place on the screen. */
export function moveToScreen(target: Element | Window, at: Point, options: PenMoveOptions = {}): void {
  if (options.coalesced === undefined) {
    moveTo(target, at, options);
    return;
  }
  const event = new PointerEvent('pointermove', {
    bubbles: true,
    cancelable: true,
    pointerId: options.pointerId ?? 1,
    pointerType: options.pointerType ?? 'mouse',
    buttons: options.buttons ?? 1,
    clientX: at.x,
    clientY: at.y,
  });
  const batch = options.coalesced.map((point) => ({ clientX: point.x, clientY: point.y }));
  Object.defineProperty(event, 'getCoalescedEvents', { value: () => batch });
  fireEvent(target, event);
}

export interface DragPenOptions {
  /** The element the press lands on: the board, or a thing already on it. */
  on?: HTMLElement;
  /** What to pass to `getCoalescedEvents()` on the last move. */
  coalesced?: readonly Point[];
  /** Called after the last move and before the release - to press a swatch mid-drag, say. */
  beforeRelease?: () => void | Promise<void>;
  /** Let go somewhere other than the last point of the path. */
  upAt?: Point;
  /** Cancel instead of releasing: the browser taking the pointer back. */
  cancel?: boolean;
  /** How many moves to put between the ends of the path. */
  frames?: boolean;
  /** Show the preview after every move rather than at the end. */
  everyMove?: boolean;
  /**
   * Throw the whole path at the tool in one go, without an animation frame in between.
   *
   * A five-thousand-point drag is what a stylus at 240 Hz writes for a line drawn at speed, and a test
   * of it that waited for a frame per point would be a test that took a minute. The points still arrive
   * as five thousand separate events, which is the only thing the tool reads; what is skipped is the
   * picture in between, which nobody is looking at.
   */
  batched?: boolean;
}

/**
 * Press, draw, let go: a stroke.
 *
 * `path` is in world units and is converted through the camera the app is using, so these tests hold at
 * any zoom. The moves go to the window, because a stroke drawn towards the edge of the window leaves the
 * edge of the window and stays one stroke.
 *
 * @returns the ids of the objects the drag added, oldest first - which is one id for a normal stroke and
 * two for one that had to be committed in parts.
 */
export async function dragPen(
  board: MountedSticky,
  path: readonly Point[],
  options: DragPenOptions = {},
): Promise<string[]> {
  const before = new Set(board.objects().map((object) => object.id));
  const target = options.on ?? board.board;
  const screen = path.map((point) => board.screenOf(point));
  const first = screen[0];
  const last = screen[screen.length - 1];
  if (first === undefined || last === undefined) {
    throw new Error('dragPen needs a path with at least one point');
  }

  // The drag's own options are not pointer options - there is nothing in them for `press` to read - so the
  // press goes out with the defaults, as every other pen drag in these tests has had it.
  press(target, first);
  if (options.everyMove === true) {
    await flushFrames();
  }
  const step = (at: Point, final: boolean): void => {
    moveToScreen(window, at, {
      coalesced: final && options.coalesced !== undefined ? options.coalesced : undefined,
    });
  };
  if (options.batched === true) {
    await act(async () => {
      for (let index = 1; index < screen.length; index += 1) {
        const at = screen[index];
        if (at !== undefined) {
          step(at, index === screen.length - 1);
        }
      }
    });
  } else {
    for (let index = 1; index < screen.length; index += 1) {
      const at = screen[index];
      if (at === undefined) {
        continue;
      }
      step(at, index === screen.length - 1);
      if (options.everyMove === true) {
        await flushFrames();
      }
    }
  }
  // If the path was a single point there were no moves at all; the press is still a press, and the
  // release below is what turns it into a dot.
  if (options.beforeRelease !== undefined) {
    await options.beforeRelease();
  }
  const up = options.upAt === undefined ? last : board.screenOf(options.upAt);
  if (options.cancel === true) {
    fireEvent.pointerCancel(window, {
      pointerId: 1,
      pointerType: 'mouse',
      buttons: 0,
      clientX: up.x,
      clientY: up.y,
    });
  } else {
    release(target, up);
  }
  await flushFrames();
  return board.objects().filter((object) => !before.has(object.id)).map((object) => object.id);
}

/** A press and a release in the same place: a dot. */
export async function clickPen(board: MountedSticky, world: Point): Promise<string[]> {
  return dragPen(board, [world]);
}

/**
 * Put a stroke on the board without drawing it, straight through the model.
 *
 * The object the pen writes is the thing most of these tests are about, and a test that had to draw it
 * first would be a test of the pen as well - which is fine, and is what the pen's own file is for.
 */
export async function addStroke(
  board: MountedSticky,
  points: readonly Point[],
  options: { color?: PenColor; thickness?: PenThickness; by?: string } = {},
): Promise<string> {
  const { createStroke } = await import('../../../src/shared/objects/stroke');
  const id = createStroke(board.doc, {
    points,
    color: options.color ?? 'black',
    thickness: options.thickness ?? 'medium',
  }, options.by ?? 'tester');
  if (id === null) {
    throw new Error('the test wrote a stroke the model refused');
  }
  await flushFrames();
  return id;
}

/** The stroke `board.objects()` has that is a stroke, or the first one; throws when there is none. */
export function onlyStroke(board: MountedSticky): StrokeSnapshot {
  const found = board.objects().map(asStrokeSnapshot).find((stroke) => stroke !== null);
  if (found === undefined) {
    throw new Error('the board has no stroke on it');
  }
  return found;
}

/** A stroke read out of a document that was not written by this client. */
export function strokeIn(doc: Y.Doc, id: string): StrokeSnapshot | undefined {
  return asStrokeSnapshot(snapshot(doc).find((object: ObjectSnapshot) => object.id === id)!) ?? undefined;
}
