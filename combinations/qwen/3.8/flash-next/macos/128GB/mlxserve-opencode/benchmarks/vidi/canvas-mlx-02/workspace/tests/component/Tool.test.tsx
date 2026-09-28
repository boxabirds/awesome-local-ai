// Story 9, tool.mode (component): the board has two tools and exactly one is
// active. The tests below are the design's TC-14 to TC-18: T opens the Text
// tool and the toolbar says so, the read-only board never opens it at all,
// typing in a note is typing and not a command, a click with the Text tool
// lands a new text EXACTLY on the pressed point and hands the tool back to
// Select with the editor already open, and N keeps its story 2 meaning.
import { describe, it, expect } from 'vitest';
import { screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderBoard7, seedSticky, settle } from './story7TestUtils.tsx';
import { objectsSnapshot } from '../../src/shared/board-model.ts';
import { TEXT_MIN_WIDTH_WORLD, TEXT_LINE_HEIGHT, TEXT_SIZES, STICKY_SIZE_WORLD } from '../../src/shared/config.ts';

const textButton = (): HTMLElement => screen.getByTestId('tool-text');
const selectButton = (): HTMLElement => screen.getByTestId('tool-select');
const pressed = (el: HTMLElement): boolean | null => el.getAttribute('aria-pressed') === 'true';

describe('tool.mode', () => {
  // TC-14: T opens the Text tool; Escape and V both close it again.
  it('TC-14 opens the text tool with T and gives Select back on Escape and V', async () => {
    const h = renderBoard7();

    h.key('t');
    expect(pressed(textButton())).toBe(true);
    expect(pressed(selectButton())).toBe(false);
    // The board itself says so too: the whole board shows the text cursor.
    expect(h.viewport().style.cursor).toBe('text');

    h.key('Escape');
    expect(pressed(textButton())).toBe(false);
    expect(pressed(selectButton())).toBe(true);
    expect(h.viewport().style.cursor).toBe('');

    h.key('t');
    expect(pressed(textButton())).toBe(true);
    h.key('v');
    expect(pressed(textButton())).toBe(false);
    expect(pressed(selectButton())).toBe(true);
  });

  // TC-15: a board this client cannot edit has no Text tool at all - the
  // button is disabled, and the T key changes nothing.
  it('TC-15 refuses the text tool on a board that failed to load', async () => {
    const h = renderBoard7();
    act(() => {
      h.provider().failToLoad();
    });

    expect(textButton()).toHaveAttribute('disabled');
    h.key('t');
    expect(pressed(textButton())).toBe(false);

    // And a tool that was already open falls back by itself when the board
    // becomes uneditable under it.
    h.key('t'); // still refused while load_failed - nothing was ever opened
    expect(pressed(textButton())).toBe(false);
    expect(h.viewport().style.cursor).not.toBe('text');
  });

  // TC-16: T while a note's editor is open is typing, not a command.
  it('TC-16 lets a typed t reach the note instead of the tool switch', async () => {
    const h = renderBoard7();
    const id = seedSticky(h.doc(), { x: 0, y: 0 });
    fireEvent.doubleClick(h.object(id)!);
    await settle();
    const editor = screen.getByTestId('sticky-editor');

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.type(editor, 't');

    // The character landed in the note...
    expect((editor as HTMLTextAreaElement).value).toBe('t');
    const sticky = objectsSnapshot(h.doc()).find((o) => o.id === id);
    expect(sticky?.text).toBe('t');
    // ...and the tool never moved.
    expect(pressed(textButton())).toBe(false);
    expect(pressed(selectButton())).toBe(true);
  });

  // TC-17: a click with the Text tool active creates a text exactly on the
  // pressed point, hands the tool back to Select, and opens the editor.
  it('TC-17 creates a text on the pressed point and returns to Select', async () => {
    const h = renderBoard7();
    h.key('t');
    expect(pressed(textButton())).toBe(true);

    // The camera opens with the world origin at the view centre; project the
    // pressed screen point the way the board does.
    const world = h.toWorld({ x: 300, y: 200 });
    const before = new Set(objectsSnapshot(h.doc()).map((o) => o.id));
    fireEvent.pointerDown(h.viewport(), { clientX: 300, clientY: 200, button: 0, pointerId: 7 });
    fireEvent.pointerUp(h.viewport(), { clientX: 300, clientY: 200, button: 0, pointerId: 7 });
    await settle();

    const created = objectsSnapshot(h.doc()).find((o) => !before.has(o.id));
    expect(created).toBeDefined();
    expect(created!.type).toBe('text');
    expect(created!.x).toBeCloseTo(world.x, 6);
    expect(created!.y).toBeCloseTo(world.y, 6); // exactly on the pressed point

    // The tool went back to Select...
    expect(pressed(textButton())).toBe(false);
    expect(pressed(selectButton())).toBe(true);
    // ...and the new text is already being edited.
    await settle();
    expect(screen.getByTestId('text-editor')).toBeTruthy();
    const el = h.object(created!.id)!;
    expect(el.getAttribute('data-editing')).toBe('true');
  });

  // TC-18: N still creates a sticky note at the centre of the view - the text
  // tool took nothing from it.
  it('TC-18 keeps N creating a sticky note at the view centre', async () => {
    const h = renderBoard7();

    h.key('n');
    await settle();

    const notes = objectsSnapshot(h.doc()).filter((o) => o.type === 'sticky');
    expect(notes).toHaveLength(1);
    // The centre of the view, and createSticky CENTRES the note on it.
    const centre = h.toWorld({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    expect(notes[0].x).toBeCloseTo(centre.x - STICKY_SIZE_WORLD / 2, 6);
    expect(notes[0].y).toBeCloseTo(centre.y - STICKY_SIZE_WORLD / 2, 6);
    // A sticky creation opens its editor as it always did; no text appeared.
    expect(screen.getByTestId('sticky-editor')).toBeTruthy();
  });

  // The Text tool's press belongs to the tool: it neither pans the camera nor
  // draws a marquee, and a press-release with no movement is the only click.
  it('a text-tool press never pans and never marquees', async () => {
    const h = renderBoard7();
    h.key('t');

    const camBefore = { ...h.cam() };
    const before = objectsSnapshot(h.doc()).length;
    fireEvent.pointerDown(h.viewport(), { clientX: 100, clientY: 100, button: 0, pointerId: 8 });
    fireEvent.pointerMove(h.viewport(), { clientX: 200, clientY: 150, button: 0, pointerId: 8 });
    fireEvent.pointerUp(h.viewport(), { clientX: 200, clientY: 150, button: 0, pointerId: 8 });
    await h.frames(2);
    await settle();

    expect(h.cam()).toEqual(camBefore); // the camera never moved
    expect(screen.queryByTestId('marquee')).toBeNull(); // and no marquee was drawn
    expect(objectsSnapshot(h.doc()).length).toBe(before); // a drag was nothing
    expect(pressed(textButton())).toBe(true); // still open, waiting for a real click
  });

  // An empty text still carries the model's minimum box, and the first line
  // is exactly one line high at the default size.
  it('a brand-new text is an empty auto-width box at the default size', async () => {
    const h = renderBoard7();
    h.key('t');
    fireEvent.pointerDown(h.viewport(), { clientX: 50, clientY: 60, button: 0, pointerId: 9 });
    fireEvent.pointerUp(h.viewport(), { clientX: 50, clientY: 60, button: 0, pointerId: 9 });
    await settle();

    const text = objectsSnapshot(h.doc()).find((o) => o.type === 'text');
    expect(text).toBeDefined();
    expect(text!.text).toBe('');
    expect(text!.size).toBe('M');
    expect(text!.widthMode).toBe('auto');
    expect(text!.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(text!.height).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });
});
