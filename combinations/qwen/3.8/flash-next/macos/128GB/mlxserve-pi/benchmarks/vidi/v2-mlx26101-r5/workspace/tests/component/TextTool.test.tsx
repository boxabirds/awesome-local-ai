/**
 * TC-14 to TC-18 — the tool the pointer is in, and the click that belongs to it.
 *
 * Until this story the board had one tool and never mentioned it: the pointer selected, dragged and
 * panned, and there was nothing else it could be asked to do. A text tool is the first request to make
 * the same pointer *write* where it is pointing, and that request cannot be guessed at — a click on an
 * empty board is either "start a marquee" or "put some text here", and the only way to know which is for
 * somebody to have said. So there is a tool, one at a time, and these tests are about the three things a
 * tool has to get right:
 *
 * — it is entered and left by three keys and two buttons, and the screen always says which one is lit;
 * — while it is lit, the pointer stops belonging to everything it used to belong to: not to the pan, not
 *   to the marquee, and not to the object that happens to be under it;
 * — and it lets go completely the moment it has done its job, so that the click which placed a heading is
 *   the last click that meant anything to the tool.
 *
 * The last of those three is the one that bites people who have used this board before: a person who
 * double-clicks — which is what every previous story taught them to do to write something — must get one
 * piece of text out of it, not a heading and a sticky note.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import { screenToWorld } from '../../src/client/canvas/camera';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import { STICKY_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD } from '../../src/shared/config';
import { getStickyText, isTextSnapshot } from '../../src/shared/board-model';
import type { TextSnapshot } from '../../src/shared/objects/text';
import { FakeProvider } from './helpers/fake-provider';
import {
  VIEWPORT,
  act as actOn,
  board,
  nextFrame,
  pointer,
  renderBoard,
  renderedCamera,
  type BoardFixture,
} from './harness';

/** The id of a board these tests can make fail on purpose. */
const BOARD_ID = 'boardboardboardboard01';

/** Presses a key where the board listens, and says whether the board swallowed it. */
async function key(k: string, target: Window | Element = window): Promise<boolean> {
  let swallowed: boolean = true;
  await actOn(async () => {
    // `fireEvent` returns false when somebody called preventDefault — which is exactly the difference
    // between a key the board answered and a key it left alone, and the difference TC-15 is about.
    swallowed = !fireEvent.keyDown(target, { key: k });
    await nextFrame();
  });
  return swallowed;
}

/** `aria-pressed` of one of the two tool buttons: what the screen says the pointer is. */
function pressed(which: 'select' | 'text'): string | null {
  return screen.getByTestId(`tool-${which}`).getAttribute('aria-pressed');
}

/** The tool the board says the pointer is in, read off the board itself. */
const toolOnScreen = (): string | undefined => board().dataset['tool'];

/** Presses, releases and clicks, which is what a browser makes of a click. */
async function tap(target: HTMLElement, point: { x: number; y: number }): Promise<void> {
  pointer('pointerDown', target, point);
  pointer('pointerUp', target, point);
  await actOn(async () => {
    fireEvent.click(target, { clientX: point.x, clientY: point.y });
    await nextFrame();
  });
}

/** A click on the board's own surface, at a point on the screen. */
const tapBoard = (point = { x: 320, y: 240 }): Promise<void> => tap(board(), point);

/** Types into an open editor the way a keyboard does: one change event, one character at a time. */
async function type(text: string, testId = 'text-editor'): Promise<void> {
  const el = screen.getByTestId(testId) as HTMLTextAreaElement;
  await actOn(async () => {
    fireEvent.change(el, { target: { value: `${el.value}${text}` } });
    await nextFrame();
  });
}

/** The one text object on the board, of which there must be exactly one. */
function onlyText(fixture: BoardFixture): TextSnapshot {
  const texts = fixture.objects().filter(isTextSnapshot);
  if (texts.length !== 1) throw new Error(`expected one text object, found ${texts.length}`);
  return texts[0] as TextSnapshot;
}

/** The world point a point on the screen is, as the board's own camera says. */
const worldAt = (point: { x: number; y: number }) => screenToWorld(renderedCamera(), point);

describe('the tool the pointer is in', () => {
  it('TC-14 enters the Text tool on T and leaves it on Escape and on V', async () => {
    renderBoard();
    expect(pressed('select')).toBe('true');
    expect(pressed('text')).toBe('false');
    expect(toolOnScreen()).toBe('select');

    expect(await key('t')).toBe(true); // the board answered the key
    expect(pressed('text')).toBe('true');
    expect(pressed('select')).toBe('false');
    expect(board().dataset['tool']).toBe('text');

    // Escape leaves the tool before it touches anything else, and comes back to Select, which is the
    // tool that has always been here.
    await key('Escape');
    expect(pressed('text')).toBe('false');
    expect(pressed('select')).toBe('true');
    expect(toolOnScreen()).toBe('select');

    await key('t');
    expect(pressed('text')).toBe('true');
    await key('v');
    expect(pressed('text')).toBe('false');
    expect(toolOnScreen()).toBe('select');
  });

  it('TC-14 leaves a selection alone when Escape is spent leaving the tool', async () => {
    const fixture = renderBoard();
    const id = await fixture.create(300, 200);
    await tap(fixture.objectEl(id) as HTMLElement, { x: 300, y: 200 });
    expect(fixture.selection().size).toBe(1);

    await key('t');
    await key('Escape');

    // One Escape, one thing said: "I am done pointing". The note is still selected, and the next Escape
    // is the one that means "not this".
    expect(toolOnScreen()).toBe('select');
    expect(fixture.selection().size).toBe(1);
    await key('Escape');
    expect(fixture.selection().size).toBe(0);
  });

  it('TC-14 takes the tool from the toolbar buttons too, and lights the one that is lit', async () => {
    renderBoard();
    await tap(screen.getByTestId('tool-text'), { x: 0, y: 0 });
    expect(pressed('text')).toBe('true');
    expect(toolOnScreen()).toBe('text');

    await tap(screen.getByTestId('tool-select'), { x: 0, y: 0 });
    expect(pressed('text')).toBe('false');
    expect(pressed('select')).toBe('true');
  });

  it('TC-15 has no writing tool on a board the room could not read', async () => {
    const provider = new FakeProvider();
    const fixture = renderBoard(VIEWPORT, { boardId: BOARD_ID, connect: { provider } });
    await actOn(async () => {
      provider.emitClose(CLOSE_BOARD_LOAD_FAILED);
      await nextFrame();
    });

    // The button is there and cannot be used: a tool that would fail on its first click is worse than a
    // button that says it cannot be used.
    const text = screen.getByTestId('tool-text');
    expect((text as HTMLButtonElement).disabled).toBe(true);
    expect(text.getAttribute('aria-pressed')).toBe('false');

    // And the key is not there either — not swallowed, not half-answered: it still belongs to whatever
    // else is listening, which is what a board that cannot be written to owes the browser.
    expect(await key('t')).toBe(false);
    expect(toolOnScreen()).toBe('select');
    expect(fixture.objects()).toHaveLength(0);
    await tapBoard();
    expect(fixture.objects()).toHaveLength(0);

    // Select is always reachable, because it writes nothing.
    expect(await key('v')).toBe(true);
    expect(pressed('select')).toBe('true');
  });

  it('TC-15 puts the tool away when the board it was lit on stops being editable', async () => {
    const provider = new FakeProvider();
    const fixture = renderBoard(VIEWPORT, { boardId: BOARD_ID, connect: { provider } });
    await key('t');
    expect(pressed('text')).toBe('true');

    await actOn(async () => {
      provider.emitClose(CLOSE_BOARD_LOAD_FAILED);
      await nextFrame();
    });

    // The tool was entered on a board that could be written to and cannot be now: standing in a tool
    // that cannot do its job is not a choice anybody made, so the board takes the pointer back.
    expect(pressed('text')).toBe('false');
    expect(pressed('select')).toBe('true');
    expect(toolOnScreen()).toBe('select');
    expect(fixture.objects()).toHaveLength(0);
  });

  it('TC-16 leaves T to the note that is being typed into', async () => {
    const fixture = renderBoard();
    const id = await fixture.create(300, 200);
    await tap(fixture.objectEl(id) as HTMLElement, { x: 300, y: 200 });
    await key('Enter');
    const editor = screen.getByTestId('sticky-editor');
    expect(fixture.selection().editingId).toBe(id);

    // A person typing a word that contains a t into a note is writing a word. The tool does not move,
    // the keystroke is not swallowed, and the note does not appear.
    expect(await key('t', editor)).toBe(false);
    expect(toolOnScreen()).toBe('select');
    expect(pressed('text')).toBe('false');
    expect(fixture.notes()).toHaveLength(1);
    expect(getStickyText(fixture.doc(), id)?.toString()).toBe('');

    // And the same key on the board, with nobody typing, is the tool again — which first needs the note
    // to be shut: while an object is open for editing, every letter belongs to the object, T included.
    await key('Escape', editor);
    expect(await key('t')).toBe(true);
    expect(toolOnScreen()).toBe('text');
  });

  it('TC-17 writes a text object where the Text tool was clicked', async () => {
    const fixture = renderBoard();
    await key('t');
    const point = { x: 320, y: 240 };
    await tapBoard(point);

    const text = onlyText(fixture);
    // The top-left of the object is the point that was clicked, not its centre: the person was pointing
    // at where the words begin.
    expect(text.x).toBeCloseTo(worldAt(point).x, 6);
    expect(text.y).toBeCloseTo(worldAt(point).y, 6);
    expect(text.type).toBe('text');
    expect(text.size).toBe('M');
    expect(text.widthMode).toBe('auto');
    expect(text.text).toBe('');
    // It is wide enough to be seen and clicked before anybody has typed in it.
    expect(text.width).toBeGreaterThanOrEqual(1);
    expect(text.width).toBeLessThanOrEqual(TEXT_MIN_WIDTH_WORLD);
    expect(text.height).toBeGreaterThan(0);

    // The click put it in the selection and opened it, because nobody places a text object and then goes
    // looking for the way to type into it.
    expect(fixture.selection().selectedId).toBe(text.id);
    expect(fixture.selection().editingId).toBe(text.id);
    expect(screen.getByTestId('text-editor')).toBeTruthy();

    // And the pointer is back to Select, having written: the tool is not left lit behind the words.
    expect(toolOnScreen()).toBe('select');
    expect(pressed('text')).toBe('false');
  });

  it('TC-17 puts text on top of the object the pointer landed on, and selects nothing else', async () => {
    const fixture = renderBoard();
    const note = await fixture.create(400, 300);
    const point = fixture.screenOf(note);

    await key('t');
    // The same click that would have selected and dragged the note.
    await tap(fixture.objectEl(note) as HTMLElement, point);

    // A board whose text could only be written on empty space would stop working the moment anybody put
    // anything on it: the text goes where the pointer was, over the note, and the note is left alone.
    const text = onlyText(fixture);
    expect(text.x).toBeCloseTo(worldAt(point).x, 6);
    expect(fixture.notes()).toHaveLength(1);
    expect(fixture.selection().ids.has(note)).toBe(false);
    expect(fixture.selection().selectedId).toBe(text.id);
    expect(toolOnScreen()).toBe('select');
  });

  it('TC-17 makes one text object out of a double-click, and no sticky note', async () => {
    const fixture = renderBoard();
    const point = { x: 500, y: 300 };
    await key('t');

    await tapBoard(point);
    expect(fixture.objects()).toHaveLength(1);

    // The second click of a double-click, which is the click this board has always taught people to make
    // when they want to write something. It writes no second text object, and it does not reach the
    // double-click that would have made a sticky note out of it.
    await tapBoard(point);
    await actOn(async () => {
      fireEvent.dblClick(board(), { clientX: point.x, clientY: point.y });
      await nextFrame();
    });

    expect(fixture.objects()).toHaveLength(1);
    expect(fixture.notes()).toHaveLength(0);
    // and the object of that first click is still the one selected, with its editor open on it.
    expect(fixture.selection().selectedId).toBe(onlyText(fixture).id);
    expect(screen.getByTestId('text-editor')).toBeTruthy();

    // A click somewhere else, a moment later, is a click somebody meant: the tool has let go. It has to
    // be asked for again first, because the editor that is open on this object keeps the letter t — the
    // tool and the typing are the same keyboard, and the typing is nearer.
    await type('heading');
    await key('Escape', screen.getByTestId('text-editor'));
    expect(fixture.objects()).toHaveLength(1);
    await key('t');
    await tapBoard({ x: 700, y: 500 });
    expect(fixture.objects()).toHaveLength(2);
  });

  it('TC-17 lets the pointer drag the board and write nothing, and select nothing on the way back', async () => {
    const fixture = renderBoard();
    const before = renderedCamera();
    await key('t');

    // A drag with the Text tool lit is a person who changed their mind about panning, not a person
    // drawing a marquee: nothing is written, and the board does not move either — the pointer belongs to
    // the tool, and what it does not do is done silently.
    const from = { x: 400, y: 300 };
    const to = { x: 600, y: 400 };
    pointer('pointerDown', board(), from);
    pointer('pointerMove', board(), to);
    pointer('pointerUp', board(), to);
    await actOn(async () => {
      fireEvent.click(board(), { clientX: to.x, clientY: to.y });
      await nextFrame();
    });

    expect(fixture.objects()).toHaveLength(0);
    expect(renderedCamera()).toEqual(before);
    expect(toolOnScreen()).toBe('text');
  });

  it('TC-17 keeps the tool lit on the buttons that are on the board', async () => {
    const fixture = renderBoard();
    const id = await fixture.create(400, 300);
    await tap(fixture.objectEl(id) as HTMLElement, { x: 400, y: 300 });
    expect(screen.getByTestId('note-toolbar')).toBeTruthy();

    await key('t');
    // The palette is on the board and under the pointer, and it is a control: the Text tool does not
    // take clicks away from the things a person clicks. A board that swallowed its own buttons would be
    // a board whose tools had stopped working, and the tool would be blamed for it.
    await tap(screen.getByTestId('color-pink') as HTMLElement, { x: 0, y: 0 });

    expect(fixture.notes()).toHaveLength(1);
    expect(fixture.objects()).toHaveLength(1);
    expect(fixture.notes()[0]?.color).toBe('pink');
    expect(toolOnScreen()).toBe('text');
  });

  it('TC-18 still makes a sticky note out of N, in the middle of what this person can see', async () => {
    const fixture = renderBoard();
    await key('n');

    expect(fixture.notes()).toHaveLength(1);
    const centre = worldAt({ x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 });
    expect(fixture.notes()[0]?.x).toBeCloseTo(centre.x - STICKY_SIZE_WORLD / 2, 6);
    expect(fixture.notes()[0]?.y).toBeCloseTo(centre.y - STICKY_SIZE_WORLD / 2, 6);
    expect(toolOnScreen()).toBe('select');

    // The key that makes a note and the tool that writes text are two different asks; standing in one
    // does not stop the other. The tool stays where it was, and the note arrives — once the note that is
    // open for typing has been shut, because a letter typed into an object is not a key on the board.
    await key('Escape', screen.getByTestId('sticky-editor'));
    await key('t');
    expect(toolOnScreen()).toBe('text');
    await key('n');
    expect(fixture.notes()).toHaveLength(2);
    expect(toolOnScreen()).toBe('text');
  });
});
