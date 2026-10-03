import { test, expect } from '@playwright/test';
import {
  openParticipants,
  closeParticipants,
  expectEventually,
  createBoardId,
  type Participant,
} from './helpers/participants';

/**
 * Get the count of sticky notes visible on a participant's board.
 */
async function noteCount(p: Participant): Promise<number> {
  return p.page.locator('[data-vidi6="sticky-note"]').count();
}

/**
 * Get the text content of the first sticky note.
 */
async function firstNoteText(p: Participant): Promise<string> {
  const el = p.page.locator('[data-vidi6="sticky-text-display"]').first();
  return (await el.textContent())?.trim() ?? '';
}

/**
 * Create a sticky note by clicking on the canvas.
 */
async function createNote(p: Participant, x: number, y: number): Promise<void> {
  await p.page.mouse.click(x, y);
}

/**
 * Type text into the selected note.
 */
async function typeInNote(p: Participant, text: string): Promise<void> {
  // Double-click to edit
  const note = p.page.locator('[data-vidi6="sticky-note"]').first();
  await note.dblclick();
  await p.page.keyboard.type(text);
  // Click outside to deselect
  await p.page.mouse.click(10, 10);
}

test.describe('TC-22: Two-person workshop', () => {
  let alex: Participant;
  let sam: Participant;
  let boardId: string;

  test.beforeEach(async ({ browser }) => {
    boardId = createBoardId();
    [alex, sam] = await openParticipants(browser, 'http://localhost:27240', boardId, 2);
  });

  test.afterEach(async () => {
    await closeParticipants([alex, sam]);
  });

  test('Alex creates a note → Sam sees it (TC-22a)', async () => {
    // Alex creates a note
    await createNote(alex, 400, 300);
    
    // Sam should see it
    await expectEventually(
      async () => (await noteCount(sam)) >= 1,
      'Sam sees Alex\'s note'
    );
    
    expect(await noteCount(sam)).toBe(1);
  });

  test('Alex types in a note → Sam sees the text (TC-22b)', async () => {
    // Alex creates and types
    await createNote(alex, 400, 300);
    await typeInNote(alex, 'Hello Sam!');
    
    // Sam should see the text
    await expectEventually(
      async () => (await firstNoteText(sam)) === 'Hello Sam!',
      'Sam sees Alex\'s text'
    );
  });

  test('Sam creates a note → Alex sees it (TC-22c)', async () => {
    // Sam creates a note
    await createNote(sam, 600, 400);
    
    // Alex should see it
    await expectEventually(
      async () => (await noteCount(alex)) >= 1,
      'Alex sees Sam\'s note'
    );
  });
});

test.describe('TC-23: Concurrent typing', () => {
  let alex: Participant;
  let sam: Participant;
  let boardId: string;

  test.beforeEach(async ({ browser }) => {
    boardId = createBoardId();
    [alex, sam] = await openParticipants(browser, 'http://localhost:27240', boardId, 2);
  });

  test.afterEach(async () => {
    await closeParticipants([alex, sam]);
  });

  test('both type into the same note → identical text (TC-23)', async () => {
    // Alex creates a note
    await createNote(alex, 400, 300);
    await expectEventually(
      async () => (await noteCount(sam)) >= 1,
      'Sam sees the note'
    );
    
    // Both type into the note
    // Alex types "Hello "
    const alexNote = alex.page.locator('[data-vidi6="sticky-note"]').first();
    await alexNote.dblclick();
    await alex.page.keyboard.type('Hello ');
    
    // Sam types "World"
    const samNote = sam.page.locator('[data-vidi6="sticky-note"]').first();
    await samNote.dblclick();
    await sam.page.keyboard.type('World');
    
    // Wait for both to converge
    await expectEventually(
      async () => {
        const alexText = await firstNoteText(alex);
        const samText = await firstNoteText(sam);
        return alexText === samText && alexText.includes('Hello') && alexText.includes('World');
      },
      'Both see identical text with Hello and World'
    );
    
    const alexText = await firstNoteText(alex);
    const samText = await firstNoteText(sam);
    expect(alexText).toBe(samText);
    expect(alexText).toContain('Hello');
    expect(alexText).toContain('World');
  });
});

test.describe('TC-25: Delete during edit', () => {
  let alex: Participant;
  let sam: Participant;
  let boardId: string;

  test.beforeEach(async ({ browser }) => {
    boardId = createBoardId();
    [alex, sam] = await openParticipants(browser, 'http://localhost:27240', boardId, 2);
  });

  test.afterEach(async () => {
    await closeParticipants([alex, sam]);
  });

  test('Sam editing, Alex deletes → Sam\'s note disappears (TC-25)', async () => {
    // Alex creates a note
    await createNote(alex, 400, 300);
    await expectEventually(
      async () => (await noteCount(sam)) >= 1,
      'Sam sees the note'
    );
    
    // Sam starts editing
    const samNote = sam.page.locator('[data-vidi6="sticky-note"]').first();
    await samNote.dblclick();
    
    // Alex deletes the note (select and press Delete)
    const alexNote = alex.page.locator('[data-vidi6="sticky-note"]').first();
    await alexNote.click();
    await alex.page.keyboard.press('Delete');
    
    // Sam's note should disappear
    await expectEventually(
      async () => (await noteCount(sam)) === 0,
      'Sam\'s note disappears after Alex deletes'
    );
    
    expect(await noteCount(sam)).toBe(0);
  });
});

test.describe('TC-28: Selection is local', () => {
  let alex: Participant;
  let sam: Participant;
  let boardId: string;

  test.beforeEach(async ({ browser }) => {
    boardId = createBoardId();
    [alex, sam] = await openParticipants(browser, 'http://localhost:27240', boardId, 2);
  });

  test.afterEach(async () => {
    await closeParticipants([alex, sam]);
  });

  test('Alex selects a note → Sam sees no selection outline (TC-28)', async () => {
    // Alex creates a note
    await createNote(alex, 400, 300);
    await expectEventually(
      async () => (await noteCount(sam)) >= 1,
      'Sam sees the note'
    );
    
    // Alex selects the note
    const alexNote = alex.page.locator('[data-vidi6="sticky-note"]').first();
    await alexNote.click();
    
    // Sam should NOT see a selection outline
    // The selection state is local, not synced
    const samNote = sam.page.locator('[data-vidi6="sticky-note"]').first();
    const samNoteClass = await samNote.getAttribute('class') ?? '';
    expect(samNoteClass).not.toContain('selected');
  });
});
