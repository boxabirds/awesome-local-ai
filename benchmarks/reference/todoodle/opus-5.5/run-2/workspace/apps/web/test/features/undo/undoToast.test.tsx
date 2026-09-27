import { COMPLETE_ANIMATION_MS, UNDO_WINDOW_MS } from '@todoodle/shared/limits';
import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  advance,
  checkbox,
  fakeTime,
  focusRow,
  fourTasks,
  renderInbox,
  rowNames,
  settle,
  toastGone,
} from '../tasks/lifecycle-helpers';

const NAMES = ['Buy milk', 'Email Sam re: invoice #4411', 'Call Mum 📞', 'Book dentist — ask about Tuesday'];
const toastOf = (text: string) => screen.getByText(text).closest('[data-undo-toast]') as HTMLElement;

/** Cmd+Z on Mac, Ctrl+Z elsewhere (happy-dom reports a non-Mac platform). */
function pressModZ(target: Element = document.activeElement ?? document.body) {
  const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

describe('TC-C24 the undo toast waits while it is hovered or focused', () => {
  it('hovered for 20000 ms it stays; after leaving it goes UNDO_WINDOW_MS of unpaused time later', async () => {
    await renderInbox(fourTasks());
    fakeTime();
    fireEvent.click(checkbox('Buy milk'));
    await advance(COMPLETE_ANIMATION_MS);
    const toast = toastOf('Task completed');
    fireEvent.pointerEnter(toast);
    await advance(20_000);
    expect(screen.getByText('Task completed')).toBeInTheDocument();
    fireEvent.pointerLeave(toast);
    await advance(UNDO_WINDOW_MS - COMPLETE_ANIMATION_MS - 100);
    expect(screen.getByText('Task completed')).toBeInTheDocument();
    expect(toastGone('Task completed')).toBe(false);
    await advance(100);
    expect(toastGone('Task completed')).toBe(true);
  });

  it('focus on Undo for 20000 ms keeps it; after blur it goes UNDO_WINDOW_MS of unpaused time later', async () => {
    await renderInbox(fourTasks());
    fakeTime();
    fireEvent.click(checkbox('Buy milk'));
    await advance(COMPLETE_ANIMATION_MS);
    const undo = screen.getByRole('button', { name: 'Undo' });
    act(() => undo.focus());
    await advance(20_000);
    expect(screen.getByText('Task completed')).toBeInTheDocument();
    act(() => undo.blur());
    await advance(UNDO_WINDOW_MS - COMPLETE_ANIMATION_MS - 100);
    expect(screen.getByText('Task completed')).toBeInTheDocument();
    expect(toastGone('Task completed')).toBe(false);
    await advance(100);
    expect(toastGone('Task completed')).toBe(true);
  });

  it('hovered and focused: leaving with the pointer alone keeps it paused', async () => {
    await renderInbox(fourTasks());
    fakeTime();
    fireEvent.click(checkbox('Buy milk'));
    await advance(COMPLETE_ANIMATION_MS);
    const toast = toastOf('Task completed');
    fireEvent.pointerEnter(toast);
    act(() => screen.getByRole('button', { name: 'Undo' }).focus());
    fireEvent.pointerLeave(toast);
    await advance(UNDO_WINDOW_MS * 2);
    expect(screen.getByText('Task completed')).toBeInTheDocument();
  });
});

describe('TC-C25 Cmd/Ctrl+Z', () => {
  it('with a toast showing and focus on a row, it sends the inverse and prevents the default', async () => {
    const srv = await renderInbox(fourTasks());
    focusRow('Buy milk');
    fireEvent.keyDown(document.activeElement!, { key: 'Delete' });
    await screen.findByText('Task deleted');
    await settle();
    focusRow('Email Sam re: invoice #4411');
    const event = pressModZ();
    expect(event.defaultPrevented).toBe(true);
    await screen.findByText('Task restored');
    await settle();
    expect(rowNames()).toEqual(NAMES);
    expect(srv.sent.map((s) => s.op)).toEqual(['delete', 'restore']);
  });

  it('in the quick-add field it sends nothing and does not prevent the default (native text undo)', async () => {
    const srv = await renderInbox(fourTasks());
    focusRow('Buy milk');
    fireEvent.keyDown(document.activeElement!, { key: 'Delete' });
    await screen.findByText('Task deleted');
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
    const field = screen.getByRole('textbox', { name: 'Task name' });
    act(() => field.focus());
    const event = pressModZ(field);
    expect(event.defaultPrevented).toBe(false);
    await settle();
    expect(srv.sent.map((s) => s.op)).toEqual(['delete']);
  });

  it('with no toast showing it does nothing and keeps the default', async () => {
    const srv = await renderInbox(fourTasks());
    focusRow('Buy milk');
    const event = pressModZ();
    expect(event.defaultPrevented).toBe(false);
    await settle();
    expect(srv.sent).toEqual([]);
  });

  it('Cmd+Z with Ctrl-less Meta is not Ctrl+Z on other platforms', async () => {
    const srv = await renderInbox(fourTasks());
    focusRow('Buy milk');
    fireEvent.keyDown(document.activeElement!, { key: 'Delete' });
    await screen.findByText('Task deleted');
    const event = new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true, cancelable: true });
    act(() => {
      document.body.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
    await settle();
    expect(srv.sent.map((s) => s.op)).toEqual(['delete']);
  });
});

describe('TC-C26 only the most recent action is undone', () => {
  it('complete A, delete B, mod+z: only B is restored; A\'s toast is still counting', async () => {
    const srv = await renderInbox(fourTasks());
    fireEvent.click(checkbox('Buy milk'));
    await screen.findByText('Task completed');
    await settle(COMPLETE_ANIMATION_MS + 50);
    focusRow('Email Sam re: invoice #4411');
    fireEvent.keyDown(document.activeElement!, { key: 'Delete' });
    await screen.findByText('Task deleted');
    await settle();
    pressModZ(document.body);
    await screen.findByText('Task restored');
    await settle();
    expect(srv.sent.map((s) => s.op)).toEqual(['complete', 'delete', 'restore']);
    expect(rowNames()).toEqual(NAMES.slice(1));
    expect(toastGone('Task completed')).toBe(false);
    expect(toastGone('Task deleted')).toBe(true);
  });
});
