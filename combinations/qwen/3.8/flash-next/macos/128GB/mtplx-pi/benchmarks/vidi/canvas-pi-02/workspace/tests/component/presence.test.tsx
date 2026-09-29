import { describe, expect, test, vi } from 'vitest';
import { createElement } from 'react';
import { fireEvent, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  PresenceIdentity,
  PresenceStack,
  RemoteCursors,
  RemoteSelections,
} from '../../src/client/presence/Presence';
import type { Person } from '../../src/client/presence/people';

/**
 * Story 6, task 5: the two presence surfaces, drawn in jsdom.
 *
 * `now` is a prop rather than a clock, so the two-second rule is an assertion
 * instead of a wait.
 */

function person(overrides: Partial<Person> & { clientId: number }): Person {
  return {
    name: 'River',
    color: '#E53935',
    id: '',
    x: 10,
    y: 10,
    selection: [],
    lastActive: 1_000,
    sentAt: 0,
    ...overrides,
  };
}

describe('remote cursors', () => {
  test('a fresh cursor is drawn with a label in that person colour', () => {
    const view = render(createElement(RemoteCursors, { people: [person({ clientId: 7 })], now: 1_500 }));
    const cursor = view.getByTestId('remote-cursor');
    expect(cursor).toBeTruthy();
    const label = view.getByTestId('cursor-label');
    expect(label.textContent).toBe('River');
    expect(label.getAttribute('style')).toContain('rgb(229, 57, 53)');
  });

  test('TC-06 a cursor two seconds after the last update is gone', () => {
    const fresh = render(createElement(RemoteCursors, { people: [person({ clientId: 7 })], now: 1_500 }));
    expect(fresh.queryByTestId('remote-cursor')).toBeTruthy();
    // A fresh container: the point is that *nothing* is drawn, and the first
    // render's cursor would still be on the page otherwise.
    const stale = render(
      createElement(RemoteCursors, { people: [person({ clientId: 7, lastActive: 0 })], now: 3_001 }),
      { container: document.createElement('div') },
    );
    expect(stale.queryByTestId('remote-cursor')).toBeNull();
  });

  test('a name longer than forty characters is cut on the label', () => {
    const long = 'N'.repeat(60);
    const view = render(
      createElement(RemoteCursors, { people: [person({ clientId: 7, name: long })], now: 1_500 }),
    );
    expect(view.getByTestId('cursor-label').textContent).toBe('N'.repeat(40));
  });

  test('nobody on the board draws nothing', () => {
    const view = render(createElement(RemoteCursors, { people: [], now: 1_000 }));
    expect(view.container.innerHTML).toBe('');
  });
});

describe('the participant stack', () => {
  test('five people are five avatars, each with its own colour', () => {
    const people = [
      person({ clientId: 1 }),
      person({ clientId: 2, color: '#1E88E5' }),
      person({ clientId: 3, color: '#43A047' }),
      person({ clientId: 4, color: '#FB8C00' }),
      person({ clientId: 5, color: '#8E24AA' }),
    ];
    const view = render(createElement(PresenceStack, { people, now: 1_500 }));
    const avatars = view.getAllByTestId('avatar');
    expect(avatars).toHaveLength(5);
    expect(new Set(avatars.map((avatar) => avatar.getAttribute('style'))).size).toBe(5);
  });

  test('TC-06 a sixth person collapses into a +N that still counts', () => {
    const people = Array.from({ length: 6 }, (_unused, index) =>
      person({ clientId: index, name: `Person ${index}`, lastActive: 1_400 - index }),
    );
    const view = render(createElement(PresenceStack, { people, now: 1_500 }));
    expect(view.getAllByTestId('avatar')).toHaveLength(5);
    // The chip says the number *and* opens: a count with no way in is a rumour
    // about people, and the sixth person is on this board whether or not there
    // is room for their dot.
    expect(view.getByTestId('avatar-overflow').querySelector('summary')?.textContent).toBe('+1');
    const list = view.getByTestId('avatar-overflow-list');
    // Every person, not just the one who did not fit: the question a reader asks
    // is "who is on this board", and five correct answers out of six is not an
    // answer to that question.
    expect(list.querySelectorAll('[data-testid="overflow-person"]')).toHaveLength(6);
    expect(list.textContent).toContain('Person 5');
  });

  test('the tooltip says who, and when', () => {
    const view = render(
      createElement(PresenceStack, {
        people: [person({ clientId: 1, name: 'River' })],
        now: 3_500,
      }),
    );
    expect(view.getByTestId('avatar').getAttribute('title')).toBe('River · active 2s ago');
  });

  test('the stack says which dot is mine, in words as well as by position', () => {
    const view = render(
      createElement(PresenceStack, {
        people: [person({ clientId: 1, name: 'Curious Otter' }), person({ clientId: 2 })],
        now: 1_500,
        selfId: 1,
      }),
    );
    const [mine, other] = view.getAllByTestId('avatar');
    expect(mine?.getAttribute('aria-label')).toBe('Curious Otter, you');
    expect(mine?.getAttribute('data-self')).toBe('true');
    expect(other?.getAttribute('aria-label')).toBe('River');
  });

  test('a cursor outside what I can see is not drawn at all', () => {
    const view = render(
      createElement(RemoteCursors, {
        people: [person({ clientId: 3, x: 2_000, y: 40 })],
        now: 1_500,
        viewport: { width: 800, height: 600 },
      }),
    );
    // Not "drawn and clipped": an arrow a hundred pixels past the edge points at
    // nothing, and it still costs a paint.
    expect(view.queryByTestId('remote-cursor')).toBeNull();
  });
});

describe('what the other people are holding', () => {
  const camera = { x: 0, y: 0, zoom: 1 };
  const note = { id: 'n1', x: 100, y: 120 };

  test('TC-23 a remote selection is an outline in that person colour, with their name', () => {
    const view = render(
      createElement(RemoteSelections, {
        people: [person({ clientId: 9, name: 'Brave Heron', selection: ['n1'] })],
        objects: [note],
        camera,
        size: 160,
      }),
    );
    const outline = view.getByTestId('selection-outline');
    expect(outline.getAttribute('data-target')).toBe('n1');
    expect(outline.getAttribute('style')).toContain('rgb(229, 57, 53)');
    expect(outline.getAttribute('style')).toContain('pointer-events: none');
    expect(view.getByTestId('selection-tag').textContent).toBe('Brave Heron');
  });

  test('the frame stays two screen pixels at any zoom, and the note does not', () => {
    const drawn = (zoom: number): string => {
      const view = render(
        createElement(RemoteSelections, {
          people: [person({ clientId: 9, selection: ['n1'] })],
          objects: [note],
          camera: { x: 0, y: 0, zoom },
          size: 160,
        }),
      );
      const style = view.getByTestId('selection-outline').getAttribute('style')!;
      view.unmount();
      return style;
    };
    expect(drawn(1)).toContain('width: 160px');
    // The box doubles with the zoom, the line around it does not.
    expect(drawn(2)).toContain('width: 320px');
    expect(drawn(2)).toContain('2px solid');
  });

  test('a selection of a note that is not here draws nothing', () => {
    const view = render(
      createElement(RemoteSelections, {
        people: [person({ clientId: 9, selection: ['gone'] })],
        objects: [note],
        camera,
        size: 160,
      }),
    );
    // A rectangle around empty space is a claim about a note that does not exist.
    expect(view.queryByTestId('selection-outline')).toBeNull();
    expect(view.container.innerHTML).toBe('');
  });

  test('the outline layer cannot eat a click', () => {
    const view = render(
      createElement(RemoteSelections, {
        people: [person({ clientId: 9, selection: ['n1'] })],
        objects: [note],
        camera,
        size: 160,
      }),
    );
    expect(view.getByTestId('remote-selections').getAttribute('style')).toContain(
      'pointer-events: none',
    );
  });
});

describe('what I am called', () => {
  test('TC-21 a name that is too long is refused, with the reason', async () => {
    const onRename = vi.fn((raw: string) => (raw.length > 32 ? 'Name must be 1–32 characters' : null));
    const view = render(createElement(PresenceIdentity, { name: 'Curious Otter', onRename }));
    await userEvent.click(view.getByRole('button', { name: 'Rename' }));
    const field = view.getByLabelText('Your name');
    // A paste, not a type: a long name arrives as one action, and the field has
    // no length cap of its own, because a field that silently chops what I pasted
    // is a field that lies about what I typed.
    fireEvent.change(field, { target: { value: 'x'.repeat(33) } });
    fireEvent.click(view.getByRole('button', { name: 'Save' }));
    expect(view.getByTestId('rename-error').textContent).toBe('Name must be 1–32 characters');
    // Refused, not shortened: the name I already agreed to stays on screen.
    expect(view.getByTestId('self-name').textContent).toBe('Curious Otter');
  });

  test('TC-21 a name that fits is said once, and the label follows it', async () => {
    const onRename = vi.fn(() => null);
    const view = render(createElement(PresenceIdentity, { name: 'Curious Otter', onRename }));
    await userEvent.click(view.getByRole('button', { name: 'Rename' }));
    const field = view.getByLabelText('Your name');
    await userEvent.clear(field);
    await userEvent.type(field, 'Alex');
    await userEvent.click(view.getByRole('button', { name: 'Save' }));
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith('Alex');
    expect(view.queryByTestId('rename-error')).toBeNull();
  });
});

