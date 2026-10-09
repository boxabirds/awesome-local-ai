import { expect, type Locator, type Page } from '@playwright/test';
import type { Participant } from './participants';

/**
 * Undo from the outside: the two shortcuts and the two buttons, pressed the way a person
 * presses them. Nothing here knows how the history works — it only asks for the step the
 * story says a Ctrl+Z takes.
 */

/** The shortcut, on a page whose focus is on the board (or on any object, or a toolbar button). */
export async function undo(person: Participant): Promise<void> {
  await person.page.keyboard.press('Control+z');
}

/** `Ctrl+Shift+Z`, the same key with Shift on it. */
export async function redo(person: Participant): Promise<void> {
  await person.page.keyboard.press('Control+Shift+z');
}

export function undoButton(page: Page): Locator {
  return page.locator('[data-testid="undo-button"]');
}

export function redoButton(page: Page): Locator {
  return page.locator('[data-testid="redo-button"]');
}

export async function clickUndo(person: Participant): Promise<void> {
  await undoButton(person.page).click();
}

export async function clickRedo(person: Participant): Promise<void> {
  await redoButton(person.page).click();
}

/** The tooltips say the shortcuts, because the shortcuts are the faster way to do this. */
export async function expectUndoTooltips(page: Page): Promise<void> {
  await expect(undoButton(page)).toHaveAttribute('title', 'Undo (Ctrl/Cmd+Z)');
  await expect(redoButton(page)).toHaveAttribute('title', 'Redo (Ctrl/Cmd+Shift+Z)');
}

/**
 * Which of the two controls this person can use, once the board has had its say. The undo
 * button being enabled or disabled is the only way the history tells anyone, so tests check
 * it instead of counting transactions.
 */
export async function expectUndoControls(
  person: Participant,
  { undo: canUndo, redo: canRedo }: { undo: boolean; redo: boolean },
): Promise<void> {
  await expect
    .poll(
      async () =>
        (await undoButton(person.page).isEnabled()) === canUndo &&
        (await redoButton(person.page).isEnabled()) === canRedo,
      {
        timeout: 10_000,
        message: `${person.name}'s undo/redo buttons are not undo=${canUndo} redo=${canRedo}`,
      },
    )
    .toBe(true);
}
