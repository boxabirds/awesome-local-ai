import { describe, expect, it } from 'vitest';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN, getStickyText } from '../../src/shared/board-model';
import { screenToWorld, worldToScreen } from '../../src/client/canvas/camera';
import { dispatch, pointerEvent } from './harness';
import { renderApp, typeText } from './appHarness';

/**
 * TC-23, TC-24, TC-26, TC-38 - the text layer of a sticky note.
 *
 * These pin down the three rules the design calls unconditional: text reaches
 * Y.Text on every input (so nothing can be lost when the edit ends), the write
 * is a diff rather than a replace (so story 3 can merge), and leaving the edit
 * - by Escape or by clicking away - keeps what was typed.
 */

async function editHarness(text = '') {
  const harness = renderApp([{ x: 300, y: 200, text }]);
  const id = harness.notes()[0].id;
  const note = harness.noteElement(id);
  // Select the note, then Enter: the keyboard route into Editing.
  await dispatch(note, pointerEvent('pointerdown', { clientX: 400, clientY: 250 }));
  await dispatch(note, pointerEvent('pointerup', { clientX: 400, clientY: 250 }));
  await dispatch(document.body, new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  return { harness, id, note };
}

describe('sticky note text editing', () => {
  it('TC-23 Enter on a selected note opens the editor with the caret at the end', async () => {
    const { harness, note } = await editHarness('Faster onboarding');

    const editor = harness.editor();
    expect(editor).not.toBeNull();
    expect(editor?.value).toBe('Faster onboarding');
    expect(document.activeElement).toBe(editor);
    expect(editor?.selectionStart).toBe('Faster onboarding'.length);
    expect(editor?.selectionEnd).toBe('Faster onboarding'.length);
    // No character was invented on the way in.
    expect(harness.notes()[0].text).toBe('Faster onboarding');
    expect(note.getAttribute('data-selected')).toBe('true');
  });

  it('TC-28 a new sticky is created at the centre of the view and opens in edit mode', async () => {
    const harness = renderApp();

    await dispatch(
      harness.button('Sticky note'),
      new MouseEvent('click', { bubbles: true }),
    );

    expect(harness.notes()).toHaveLength(1);
    expect(harness.editor()).not.toBeNull();

    // "Centred on the viewport": the note's centre maps to the middle of the
    // screen, wherever the board happens to be panned.
    const camera = harness.camera();
    const centre = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const world = screenToWorld(camera, centre);
    const note = harness.notes()[0];
    expect(note.x).toBeCloseTo(world.x - 100, 6);
    expect(note.y).toBeCloseTo(world.y - 100, 6);
    const painted = worldToScreen(camera, { x: note.x + 100, y: note.y + 100 });
    expect(painted.x).toBeCloseTo(centre.x, 6);
    expect(painted.y).toBeCloseTo(centre.y, 6);
  });

  it('TC-24 Escape ends the edit and keeps the text, leaving the note selected', async () => {
    const { harness, id } = await editHarness('Retro');
    const editor = harness.editor() as HTMLTextAreaElement;

    await typeText(editor, 'Retro\nKeep\nDrop');
    expect(harness.notes()[0].text).toBe('Retro\nKeep\nDrop');

    await dispatch(
      editor,
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );

    expect(harness.editor()).toBeNull();
    expect(harness.noteText(id)).toBe('Retro\nKeep\nDrop');
    expect(harness.noteElement(id).getAttribute('data-selected')).toBe('true');
  });

  it('TC-26 Backspace while editing edits the text and never deletes the note', async () => {
    const { harness, id } = await editHarness('ab');
    const editor = harness.editor() as HTMLTextAreaElement;

    // What Backspace does inside a text field: a keydown the browser turns into
    // an edit, then the input event. The board must ignore the key and apply
    // the edit.
    await dispatch(editor, new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    expect(harness.notes()).toHaveLength(1);
    expect(harness.notes()[0].text).toBe('ab');

    await typeText(editor, 'a');
    expect(harness.notes()).toHaveLength(1);
    expect(harness.notes()[0].text).toBe('a');
    // Still editing, so the textarea is the visible layer of the text.
    expect(harness.editor()?.value).toBe('a');
    expect(document.activeElement).toBe(harness.editor());

    // Leaving the edit shows the same text, not the old one.
    await dispatch(
      editor,
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    expect(harness.noteText(id)).toBe('a');
  });

  it('TC-38 clicking away commits the text and drops the selection', async () => {
    const { harness, id } = await editHarness();
    await typeText(harness.editor() as HTMLTextAreaElement, 'abc');
    expect(harness.notes()[0].text).toBe('abc');

    // A press and release on empty board surface.
    await dispatch(harness.board(), pointerEvent('pointerdown', { clientX: 60, clientY: 60 }));
    await dispatch(harness.board(), pointerEvent('pointerup', { clientX: 60, clientY: 60 }));

    expect(harness.editor()).toBeNull();
    expect(harness.notes()[0].text).toBe('abc');
    expect(harness.noteElement(id).getAttribute('data-selected')).toBe('false');
    expect(harness.toolbar()).toBeNull();
  });

  it('writes a middle insertion as a diff, and everything with a local origin', async () => {
    const { harness, id } = await editHarness('abc');
    const editor = harness.editor() as HTMLTextAreaElement;
    const ytext = getStickyText(harness.doc, id) as Y.Text;

    const seen: Array<{ ops: unknown; origin: unknown }> = [];
    ytext.observe((event, transaction) => {
      seen.push({ ops: event.delta, origin: transaction.origin });
    });

    await typeText(editor, 'abXc');

    // One change, and it is the minimal one: keep "ab", insert "X"; the final
    // "c" is never touched, so it does not even appear in the delta.
    expect(seen).toHaveLength(1);
    expect(seen[0].ops).toEqual([{ retain: 2 }, { insert: 'X' }]);
    // Story 3 must be able to tell my edits from the ones it echoed back.
    expect(seen[0].origin).toBe(LOCAL_ORIGIN);
  });

  it('a 1,200 character paste is cut to 1,000 and shows the counter', async () => {
    const { harness } = await editHarness();
    const editor = harness.editor() as HTMLTextAreaElement;
    const pasted = `${'the quick brown fox jumps over the lazy dog '.repeat(28)}extra`;
    expect(pasted.length).toBeGreaterThan(1_000);

    await typeText(editor, pasted);

    const note = harness.notes()[0];
    expect(note.text).toHaveLength(1_000);
    expect(editor.value).toHaveLength(1_000);
    expect(editor.selectionStart).toBe(1_000);
    expect(harness.counter()?.textContent).toBe('1000/1000');
  });

  it('the counter appears at 950 characters and stays to 1,000', async () => {
    const { harness } = await editHarness('x'.repeat(400));
    expect(harness.counter()).toBeNull();

    const editor = harness.editor() as HTMLTextAreaElement;
    await typeText(editor, 'x'.repeat(949));
    expect(harness.counter()).toBeNull();

    await typeText(editor, 'x'.repeat(950));
    expect(harness.counter()?.textContent).toBe('950/1000');

    await typeText(editor, 'x'.repeat(951));
    expect(harness.counter()?.textContent).toBe('951/1000');
  });
});
