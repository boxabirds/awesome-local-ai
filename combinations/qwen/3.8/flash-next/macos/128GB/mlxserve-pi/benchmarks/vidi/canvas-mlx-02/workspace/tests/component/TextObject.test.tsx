// Story 9, text.object (component): the full life of one free text on the
// real board - TC-19 to TC-25 of the design. Editing behaves exactly like the
// sticky note's (caret at the end, Enter is a newline, Escape keeps the text);
// the size toolbar changes only the size and the box follows in the same step;
// a lone text shows two side handles and nothing else; in a mixed selection
// the text rides along - repositioned, never vertically dragged, its font
// size never touched by a resize; a remote delete ends the edit cleanly; and
// one Ctrl+Z takes the typed words and the box they grew back together.
//
// jsdom has no canvas, so the board's measurer answers with the documented
// fallback: a character is TEXT_GLYPH_WIDTH_RATIO * fontPx wide. The expected
// boxes below are that arithmetic.
import { describe, it, expect } from 'vitest';
import { screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as Y from 'yjs';
import { renderBoard7, seedSticky, settle, type Board7Harness } from './story7TestUtils.tsx';
import { objectsMapOf, objectsSnapshot, LOCAL_ORIGIN } from '../../src/shared/board-model.ts';
import {
  createText,
  getTextContent,
} from '../../src/shared/objects/text.ts';
import {
  TEXT_GLYPH_WIDTH_RATIO,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_MAX_AUTO_WIDTH_WORLD,
} from '../../src/shared/config.ts';

/** The width jsdom's canvas-less measurer answers for a string at a font size. */
const width = (text: string, size: keyof typeof TEXT_SIZES = 'M'): number =>
  text.length * TEXT_SIZES[size] * TEXT_GLYPH_WIDTH_RATIO;

const lineHeight = (size: keyof typeof TEXT_SIZES): number => TEXT_SIZES[size] * TEXT_LINE_HEIGHT;

/**
 * Seed a text exactly as the model creates it, then let the board mount its
 * layout hook and do one round trip: the refresh write (a no-op change with a
 * local origin) gives the freshly-mounted hook its first look, so the stored
 * box is the laid-out one before the test starts operating on it.
 */
function seedText(doc: Y.Doc, seed: { x: number; y: number; text?: string; size?: string }): string {
  let id = '';
  act(() => {
    id = createText(doc, { x: seed.x, y: seed.y }, 'g_seed') as string;
    if (seed.text !== undefined) getTextContent(doc, id)!.insert(0, seed.text);
    if (seed.size !== undefined) {
      // Size before mount: the initial height is the default line's, so bring
      // the size in and refresh right after, which the hook's first look fixes.
      objectsMapOf(doc).get(id)!.set('size', seed.size);
    }
  });
  refreshBox(doc, id);
  return id;
}

/** One no-op LOCAL write: the text is unchanged, but the box sync re-measures. */
function refreshBox(doc: Y.Doc, id: string): void {
  act(() => {
    Y.transact(
      doc,
      () => {
        const yt = getTextContent(doc, id);
        if (!yt) return;
        yt.insert(0, '~');
        yt.delete(0, 1);
      },
      LOCAL_ORIGIN,
    );
  });
}

/** Open the text's editor the way a person does: select it, then double-click. */
async function openEditor(h: Board7Harness, id: string): Promise<HTMLTextAreaElement> {
  const el = h.object(id)!;
  const box = boxOf(h, id);
  h.press(el, box.x + 2, box.y + 2);
  h.release(el, box.x + 2, box.y + 2);
  fireEvent.doubleClick(el);
  await settle();
  return screen.getByTestId('text-editor') as HTMLTextAreaElement;
}

const boxOf = (h: Board7Harness, id: string) => {
  const o = objectsSnapshot(h.doc()).find((x) => x.id === id);
  if (!o) throw new Error('the text object is gone');
  return o;
};

describe('text.object', () => {
  // TC-19: editing a text is editing a sticky's words - caret at the end of
  // what is there, Enter a newline, Escape keeping everything and leaving the
  // text selected.
  it('TC-19 edits with the caret at the end, Enter as a newline, Escape kept and selected', async () => {
    const h = renderBoard7();
    const id = seedText(h.doc(), { x: 300, y: 100, text: 'abc' });
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    const editor = await openEditor(h, id);
    expect(editor.value).toBe('abc');
    expect(editor.selectionStart).toBe(3); // caret at the end of the existing text

    await user.type(editor, 'def');
    expect(boxOf(h, id).text).toBe('abcdef');
    // The display element is the only thing the typing changed visibly.
    const shown = document.querySelector(`[data-testid="text-shown-${id}"]`);
    expect(shown?.textContent).toBe('abcdef');

    await user.keyboard('{Enter}');
    expect(boxOf(h, id).text).toBe('abcdef\n');
    expect(boxOf(h, id).height).toBeCloseTo(2 * lineHeight('M'), 6);

    // Escape keeps the text and lands on the selected object.
    fireEvent.keyDown(editor, { key: 'Escape', bubbles: true, cancelable: true });
    await settle();
    expect(screen.queryByTestId('text-editor')).toBeNull();
    expect(boxOf(h, id).text).toBe('abcdef\n');
    expect(h.selectedIds()).toEqual([id]);
  });

  // TC-20: a text nobody typed into leaves no trace: Escape removes the
  // object, clears the selection, and nothing rewrites it afterwards.
  it('TC-20 removes a text that stayed empty when its edit ends', async () => {
    const h = renderBoard7();

    // The Text tool's own creation path, so creation and removal meet.
    h.key('t');
    fireEvent.pointerDown(h.viewport(), { clientX: 400, clientY: 250, button: 0, pointerId: 4 });
    fireEvent.pointerUp(h.viewport(), { clientX: 400, clientY: 250, button: 0, pointerId: 4 });
    await settle();

    const editor = screen.getByTestId('text-editor');
    const created = objectsSnapshot(h.doc()).filter((o) => o.type === 'text');
    expect(created).toHaveLength(1);

    fireEvent.keyDown(editor, { key: 'Escape', bubbles: true, cancelable: true });
    await settle();

    expect(objectsSnapshot(h.doc())).toHaveLength(0); // object removed
    expect(h.selectedIds()).toEqual([]); // selection cleared
    expect(screen.queryByTestId('text-editor')).toBeNull(); // and not recreated
    // One undo step brings the creation back (story 8 kept it).
    h.key('z', { ctrlKey: true });
    await settle();
    expect(objectsSnapshot(h.doc())).toHaveLength(1);
  });

  // TC-21: the size toolbar shows its four sizes with the current one pressed;
  // choosing XL changes the size and the laid-out height, and moves nothing.
  it('TC-21 changes only the size (and the height it lays out), not the place', async () => {
    const h = renderBoard7();
    const id = seedText(h.doc(), { x: 250, y: 80, text: 'hello' });

    // Select it (a press, not a drag) and read the toolbar.
    h.press(h.object(id)!, 260, 90);
    h.release(h.object(id)!, 260, 90);
    await settle();

    const bar = screen.getByTestId('text-toolbar');
    const m = screen.getByRole('button', { name: 'Text size M' });
    expect(bar).toBeTruthy();
    expect(m).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Text size S' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Text size XL' }).getAttribute('aria-pressed')).toBe('false');

    const before = boxOf(h, id);
    expect(before.x).toBe(250);
    expect(before.y).toBe(80);

    fireEvent.click(screen.getByRole('button', { name: 'Text size XL' }));
    await settle();

    const after = boxOf(h, id);
    expect(after.size).toBe('XL');
    expect(after.x).toBe(250); // the object did not move
    expect(after.y).toBe(80);
    // 'hello' fits one XL line: the height is exactly that line's.
    expect(after.height).toBeCloseTo(lineHeight('XL'), 6);
  });

  // TC-22: the only handles a lone text offers are the two sides. There is no
  // top, bottom, or corner to drag: the layout owns the height.
  it('TC-22 shows only the e and w handles for a lone text', () => {
    const h = renderBoard7();
    const id = seedText(h.doc(), { x: 120, y: 60, text: 'side ways' });

    h.press(h.object(id)!, 130, 70);
    h.release(h.object(id)!, 130, 70);

    const names = h.handles().map((el) => el.getAttribute('data-handle'));
    expect(names).toEqual(['e', 'w']);
  });

  // TC-23: a text and a sticky together show the full eight handles again,
  // and a group resize repositions the text proportionally - its font size
  // and its laid-out box untouched - while the sticky resizes freely.
  it('TC-23 rides a group resize: repositioned, not resized, font unchanged', async () => {
    const h = renderBoard7();
    const sticky = seedSticky(h.doc(), { x: 0, y: 0 });
    const id = seedText(h.doc(), { x: 300, y: 50, text: 'hello' });

    // Select both: a press on the note, a Shift-press on the text.
    h.press(h.object(sticky)!, 50, 50);
    h.release(h.object(sticky)!, 50, 50);
    h.press(h.object(id)!, 310, 60, { shiftKey: true });
    h.release(h.object(id)!, 310, 60, { shiftKey: true });
    expect(h.handles().length).toBe(8);

    // The union box the gesture records: sticky 0..200 wide, text out to
    // 300 + its laid-out width (the longest line plus slack) = 358.
    const union = 300 + width('hello') + 8;
    const dx = 100;
    h.drag(h.handle('e'), { x: 100, y: 100 }, { x: 100 + dx, y: 100 });
    await settle();

    const scale = (union + dx) / union; // the sticky's aspect lock makes it uniform
    const text = boxOf(h, id);
    const note = objectsSnapshot(h.doc()).find((o) => o.id === sticky)!;
    expect(text.x).toBeCloseTo(300 * scale, 1); // repositioned proportionally
    expect(text.y).toBeCloseTo(50 * scale, 1); // with the group, never dragged on its own
    expect(text.size).toBe('M'); // the font size is never a resize's business
    expect(text.width).toBeCloseTo(width('hello') + 8, 6); // auto width: the layout's
    expect(text.height).toBeCloseTo(lineHeight('M'), 6); // one line, grown or shrunk by nobody
    expect(note.width).toBeCloseTo(200 * scale, 1); // the sticky resized
    expect(note.height).toBeCloseTo(200 * scale, 1);
  });

  // TC-24: another client deletes the text mid-edit. The editor unmounts, no
  // error escapes, and nothing on this client recreates the object.
  it('TC-24 closes the editor on a remote delete without error or resurrection', async () => {
    const h = renderBoard7();
    const id = seedText(h.doc(), { x: 40, y: 40, text: 'shared words' });
    const editor = await openEditor(h, id);
    expect(editor.value).toBe('shared words');

    // A colleague with the same board deletes the object and the update lands.
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(h.doc()));
    const FROM_ELSEWHERE = Symbol('elsewhere');
    Y.transact(peer, () => {
      peer.getMap('objects').delete(id);
    });
    const patch = Y.encodeStateAsUpdate(peer, Y.encodeStateAsUpdate(h.doc()));
    act(() => {
      Y.applyUpdate(h.doc(), patch, FROM_ELSEWHERE);
    });
    await settle();

    expect(screen.queryByTestId('text-editor')).toBeNull(); // editor gone
    expect(objectsSnapshot(h.doc())).toHaveLength(0); // and it stays gone
    expect(h.selectedIds()).toEqual([]); // the selection pruned with it
    // A re-measure here would have written the box of a vanished object; there
    // is no object to write to, and this client never recreates one.
    refreshBox(h.doc(), id); // no throw, no write
    expect(objectsSnapshot(h.doc())).toHaveLength(0);
  });

  // TC-25: the typed words and the box they grew are one step: a single
  // Ctrl+Z takes both back together.
  it('TC-25 undoes typed text and the box it grew in one step', async () => {
    const h = renderBoard7();
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    // Create through the Text tool, so the creation is its own step first.
    h.key('t');
    fireEvent.pointerDown(h.viewport(), { clientX: 220, clientY: 140, button: 0, pointerId: 6 });
    fireEvent.pointerUp(h.viewport(), { clientX: 220, clientY: 140, button: 0, pointerId: 6 });
    await settle();
    const id = objectsSnapshot(h.doc()).find((o) => o.type === 'text')!.id;
    const editor = screen.getByTestId('text-editor') as HTMLTextAreaElement;

    await user.type(editor, 'hello world');
    const typed = boxOf(h, id);
    expect(typed.text).toBe('hello world');
    const grownWidth = width('hello world') + 8;
    expect(grownWidth).toBeLessThan(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(typed.width).toBeCloseTo(grownWidth, 6);

    // One Ctrl+Z, steered to the board's history by the editor itself.
    fireEvent.keyDown(editor, { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    await settle();

    const back = boxOf(h, id);
    expect(back.text).toBe(''); // the words are gone...
    expect(back.width).toBe(TEXT_MIN_WIDTH_WORLD); // ...and the box they grew went with them
    expect(back.height).toBeCloseTo(lineHeight('M'), 6);
    expect(editor.value).toBe(''); // the textarea shows what the doc holds
    // The object itself is still there - the creation was the step before.
    expect(objectsSnapshot(h.doc()).filter((o) => o.type === 'text')).toHaveLength(1);
  });

  // The stored limit is the text object's own, five times the note's.
  it('clamps at TEXT_MAX_CHARS like the note clamps at its own limit', async () => {
    const h = renderBoard7();
    const id = seedText(h.doc(), { x: 10, y: 10 });
    const editor = await openEditor(h, id);
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    const long = 'x'.repeat(TEXT_MAX_CHARS + 200);
    await user.paste(long);

    expect(editor.value.length).toBe(TEXT_MAX_CHARS);
    expect((boxOf(h, id).text ?? '').length).toBe(TEXT_MAX_CHARS);
    // The auto width stopped at the cap: no single line escapes the box.
    expect(boxOf(h, id).width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
  });
});
