import { fireEvent } from '@testing-library/react';
import * as Y from 'yjs';
import { screenToWorld, type Point } from '../../../src/client/canvas/camera';
import { LOCAL_ORIGIN, OBJECTS_MAP, snapshot, type TextSnapshot } from '../../../src/shared/board-model';
import { TEXT_TYPE, getTextContent } from '../../../src/shared/objects/text';
import type { TextSize } from '../../../src/shared/config';
import { flushFrames } from '../helpers';
import { clickAt, press, release, type MountedSticky } from './sticky';

/**
 * Free text (story 9), at component level.
 *
 * Everything here is a question about what the app does with a tool and a document: which tool is
 * up, what a click on the board writes, what a size button writes, how big the box around the words
 * is. As elsewhere in the component suite, the assertions are made against the document, because a
 * component that drew something it never wrote would look exactly the same on screen.
 */

/** Somewhere on the board, in world units, that nothing else is. */
export const TEXT_AT: Point = { x: 120, y: 60 };

/** The tool that is up, read off the board surface rather than off a button. */
export function toolState(board: MountedSticky): 'select' | 'text' | undefined {
  const tool = board.board.dataset.tool;
  return tool === 'text' || tool === 'select' ? tool : undefined;
}

/** The toolbar's tool button, by tool. */
export function toolButton(board: MountedSticky, tool: 'select' | 'text'): HTMLElement {
  const button = board.view.container.querySelector<HTMLElement>(
    `[data-testid="tool-${tool}"]`,
  );
  if (button === null) {
    throw new Error(`the toolbar has no ${tool} button`);
  }
  return button;
}

/** Press the tool button, and let the app settle. */
export async function chooseTool(
  board: MountedSticky,
  tool: 'select' | 'text',
): Promise<void> {
  fireEvent.click(toolButton(board, tool));
  await flushFrames();
}

/** Whether the toolbar says this tool is the one that is up. */
export function toolPressed(board: MountedSticky, tool: 'select' | 'text'): boolean {
  return toolButton(board, tool).getAttribute('aria-pressed') === 'true';
}

/** The text objects on the board - the objects themselves, not the markings drawn over them. */
export function textElements(board: MountedSticky): HTMLElement[] {
  return [
    ...board.view.container.querySelectorAll<HTMLElement>(
      `[data-object-type="${TEXT_TYPE}"]:not(.selection-outline)`,
    ),
  ];
}

/** One text object's element, by id. */
export function textElement(board: MountedSticky, id: string): HTMLElement {
  const element = textElements(board).find((candidate) => candidate.dataset.objectId === id);
  if (element === undefined) {
    throw new Error(`no text object with id ${id} is on the board`);
  }
  return element;
}

/** The words as the board draws them (not as the document holds them). */
export function drawnText(board: MountedSticky, index = 0): string {
  const elements = board.view.container.querySelectorAll<HTMLElement>('.text-object__text');
  const element = elements[index];
  if (element === undefined) {
    throw new Error(`no drawn text on the board at index ${index} (found ${elements.length})`);
  }
  return element.textContent ?? '';
}

/** The textarea of the text object being typed into, if there is one. */
export function textEditorOrNull(board: MountedSticky): HTMLTextAreaElement | null {
  return board.view.container.querySelector<HTMLTextAreaElement>('[data-testid="text-editor"]');
}

/** The textarea of the text object being typed into. */
export function textEditor(board: MountedSticky): HTMLTextAreaElement {
  const editor = textEditorOrNull(board);
  if (editor === null) {
    throw new Error('no text object is being typed into');
  }
  return editor;
}

/**
 * Put a text object on the board the way a person does: the Text tool up, a press and a release on
 * empty board space, no travel between them.
 *
 * Returns the id of the object the app made - which is found by asking the document what is new, so
 * a test can never be told about an object the document does not hold.
 */
export async function placeText(board: MountedSticky, at: Point = TEXT_AT): Promise<string> {
  const before = new Set(snapshot(board.doc).map((object) => object.id));
  clickAt(board.board, board.screenOf(at));
  await flushFrames();
  const added = snapshot(board.doc).find((object) => !before.has(object.id));
  if (added === undefined) {
    throw new Error('a click with the Text tool up added nothing to the board');
  }
  return added.id;
}

/** The text object the app made, read out of the document as a text object. */
export function textOf(board: MountedSticky, id: string): TextSnapshot {
  const found = snapshot(board.doc).find((object) => object.id === id);
  if (found === undefined) {
    throw new Error(`object ${id} is not on the board`);
  }
  if (found.type !== TEXT_TYPE || found.size === undefined || found.widthMode === undefined) {
    throw new Error(`object ${id} is not a text object the board can read (${found.type})`);
  }
  return { ...found, type: 'text', size: found.size, widthMode: found.widthMode } as TextSnapshot;
}

/** Press on an object where it is drawn, and let go in the same place. */
export async function pressOn(board: MountedSticky, id: string): Promise<void> {
  // A press on an object that is *already* part of the selection leaves the selection alone - that is
  // what makes a group of objects draggable by any one of them - so getting to this object on its own
  // goes by way of the empty corner of the board first.
  if (board.outlinedIds().length > 1) {
    clickAt(board.board, board.screenOf(CORNER));
    await flushFrames();
  }
  const object = board.object(id);
  clickAt(board.element(id), board.screenOf({ x: object.x + 4, y: object.y + 4 }));
  await flushFrames();
}

/** A corner of the board nothing is ever put in, for clicking when the selection has to be emptied. */
const CORNER = { x: -600, y: 350 };

/**
 * Press and release on an object with Shift held: it joins the selection, or leaves it.
 *
 * Written out rather than built on `clickAt`, because the pointer helpers in `helpers/sticky` do not
 * pass a modifier through to the event and a shift-click whose Shift went missing is a plain click
 * that quietly empties the selection instead of filling it.
 */
export async function shiftClickOn(board: MountedSticky, id: string): Promise<void> {
  const object = board.object(id);
  const point = board.screenOf({ x: object.x + 4, y: object.y + 4 });
  const element = board.element(id);
  fireEvent.pointerDown(element, {
    pointerId: 1,
    pointerType: 'mouse',
    buttons: 1,
    button: 0,
    shiftKey: true,
    clientX: point.x,
    clientY: point.y,
  });
  fireEvent.pointerUp(element, {
    pointerId: 1,
    pointerType: 'mouse',
    buttons: 0,
    button: 0,
    shiftKey: true,
    clientX: point.x,
    clientY: point.y,
  });
  await flushFrames();
}

/** The bar a single selected text object is offered, or `null` when there is none. */
export function textToolbarOrNull(board: MountedSticky): HTMLElement | null {
  return board.view.container.querySelector<HTMLElement>('[data-testid="text-toolbar"]');
}

/** The bar a single selected text object is offered. */
export function textToolbar(board: MountedSticky): HTMLElement {
  const bar = textToolbarOrNull(board);
  if (bar === null) {
    throw new Error('no text toolbar is shown (is exactly one text object selected?)');
  }
  return bar;
}

/** The four size buttons, in the order the bar shows them. */
export function sizeButtons(board: MountedSticky): HTMLElement[] {
  return [...textToolbar(board).querySelectorAll<HTMLElement>('[data-testid="text-size"]')];
}

/** Which size the bar says the text is at. */
export function pressedSize(board: MountedSticky): TextSize | null {
  const pressed = sizeButtons(board).find((button) => button.getAttribute('aria-pressed') === 'true');
  return (pressed?.dataset.size as TextSize | undefined) ?? null;
}

/** Press a size button in the text bar. */
export async function chooseTextSize(board: MountedSticky, size: TextSize): Promise<void> {
  const button = sizeButtons(board).find((candidate) => candidate.dataset.size === size);
  if (button === undefined) {
    throw new Error(`the text bar has no ${size} button`);
  }
  fireEvent.click(button);
  await flushFrames();
}

/** Press the text bar's Delete button. */
export async function deleteTextViaBar(board: MountedSticky): Promise<void> {
  const button = textToolbar(board).querySelector<HTMLElement>('[data-testid="text-delete"]');
  if (button === null) {
    throw new Error('the text bar has no delete button');
  }
  fireEvent.click(button);
  await flushFrames();
}

/** End the spell of typing, the way Escape does: the text stays, the object stays selected. */
export async function endEditing(board: MountedSticky): Promise<void> {
  const editor = textEditorOrNull(board) ?? board.editorOrNull();
  if (editor === null) {
    throw new Error('nothing is being typed into');
  }
  fireEvent.keyDown(editor, { key: 'Escape' });
  await flushFrames();
}

/** Type into the open text editor, one change event per call, as a burst of keystrokes. */
export function typeText(board: MountedSticky, text: string): void {
  const editor = textEditor(board);
  fireEvent.change(editor, { target: { value: `${editor.value}${text}` } });
}

/** Replace everything in the open text editor, which is what a paste does. */
export function pasteText(board: MountedSticky, text: string): void {
  fireEvent.change(textEditor(board), { target: { value: text } });
}

/**
 * The boxes a text object has been given, in the order the document was asked to write them.
 *
 * This counts writes, not drawings: the object's `Y.Map` is watched, and every set of its `width`
 * or `height` is remembered with the value it was set to. A client that wrote the box the object
 * already had would be invisible on screen and unmistakable here, which is the point - the story
 * says only the client that changed the text measures it, and a claim like that is only worth
 * testing at the place where a redundant write would show up.
 */
export interface BoxWrites {
  /** `width=90`, `height=26`, ... in the order they were written. */
  keys(): string[];
  /** How many transactions changed the box. */
  transactions(): number;
  /** Forget what has been written so far. */
  reset(): void;
  /** Stop watching. */
  stop(): void;
}

export function watchBoxWrites(board: MountedSticky, id: string): BoxWrites {
  const objects = board.doc.getMap<Y.Map<unknown>>(OBJECTS_MAP);
  const object = objects.get(id);
  if (object === undefined) {
    throw new Error(`object ${id} is not on the board to watch`);
  }
  let written: string[] = [];
  let changes = 0;
  const observer = (event: Y.YMapEvent<unknown>): void => {
    // One observer callback per transaction that touched this object, whatever keys it touched.
    changes += 1;
    for (const [key, change] of event.changes.keys) {
      if ((key === 'width' || key === 'height') && change.action !== 'delete') {
        written.push(`${key}=${String(object.get(key))}`);
      }
    }
  };
  object.observe(observer);
  return {
    keys: () => [...written],
    transactions: () => changes,
    reset: () => {
      written = [];
      changes = 0;
    },
    stop: () => {
      object.unobserve(observer);
    },
  };
}

/**
 * How many updates *this client* has written since it was asked for.
 *
 * The unit of "did anything happen" that a screen cannot see. An update is what goes over the wire to
 * everybody else; yjs makes one for a write even when the value written is the value that was already
 * there, so a client that re-measured a box and stored the box it already had would pass every visual
 * test and be measured here. Updates that came in from another screen are not counted: relaying
 * somebody else's write is not this client having done something, and a test that counted it would
 * pass for the wrong reason either way.
 */
export function countUpdates(board: MountedSticky): {
  count(): number;
  reset(): void;
  stop(): void;
} {
  let updates = 0;
  const listener = (_update: unknown, origin: unknown): void => {
    if (origin === LOCAL_ORIGIN) {
      updates += 1;
    }
  };
  board.doc.on('update', listener);
  return {
    count: () => updates,
    reset: () => {
      updates = 0;
    },
    stop: () => {
      board.doc.off('update', listener);
    },
  };
}

/**
 * A change from another screen, applied to this document.
 *
 * A real peer's update arrives with the provider as the transaction's origin; anything that is not
 * this client's own `LOCAL_ORIGIN` is how the code has to see it, and that is exactly what this is:
 * a write to the same document that did not come from this client.
 */
export function remoteChange<T>(board: MountedSticky, write: () => T): T {
  let result: T | undefined;
  board.doc.transact(() => {
    result = write();
  }, 'a-peer-far-away');
  return result as T;
}

/** Put words into a text object without typing them, as the object's creator would have. */
export function fillText(board: MountedSticky, id: string, text: string): void {
  const ytext = getTextContent(board.doc, id);
  if (ytext === undefined) {
    throw new Error(`object ${id} has no text to write into`);
  }
  if (text !== '') {
    ytext.insert(0, text);
  }
}

/** The world point a screen point falls on, given the camera the app is using. */
export function worldAt(board: MountedSticky, screen: Point): Point {
  // The board fills the emulated window, so a screen point and a board point are the same thing;
  // this is the same arithmetic the app does with a click.
  return screenToWorld(board.camera(), screen);
}

/** A press and a release a long way apart: a drag that is not a placement. */
export async function dragOnBoard(
  board: MountedSticky,
  from: Point,
  to: Point,
): Promise<void> {
  press(board.board, from);
  fireEvent.pointerMove(board.board, { pointerId: 1, buttons: 1, clientX: to.x, clientY: to.y });
  release(board.board, to);
  await flushFrames();
}
