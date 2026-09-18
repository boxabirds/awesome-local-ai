import { test, expect } from 'vitest';
import { render } from '@testing-library/react';
import {
  distribution,
  averageEstimate,
  chunkByRow,
  isHost,
  cardWeight,
  buildInviteUrl,
} from './poker.js';
import { PlayerSeat, ShareBar } from './components.jsx';

function room(overrides) {
  return {
    phase: 'voting',
    round: 1,
    topic: 'x',
    players: [],
    ...overrides,
  };
}

test('averageEstimate ignores non-numeric and disconnected votes', () => {
  const r = room({
    players: [
      { id: 'a', connected: true, vote: '5' },
      { id: 'b', connected: true, vote: '3' },
      { id: 'c', connected: true, vote: '?' },
      { id: 'd', connected: false, vote: '55' },
    ],
  });
  expect(averageEstimate(r)).toBe(4);
});

test('averageEstimate is null when nothing valid voted', () => {
  const r = room({ players: [{ id: 'a', connected: true, vote: '☕' }] });
  expect(averageEstimate(r)).toBeNull();
});

test('distribution counts active votes only', () => {
  const r = room({
    players: [
      { id: 'a', connected: true, vote: '8' },
      { id: 'b', connected: true, vote: '8' },
      { id: 'c', connected: false, vote: '1' },
    ],
  });
  const d = distribution(r);
  expect(d['8']).toBe(2);
  expect(d['1']).toBe(0);
});

test('chunkByRow splits by default 5', () => {
  const rows = chunkByRow([1, 2, 3, 4, 5, 6, 7]);
  expect(rows.map((r) => r.length)).toEqual([5, 2]);
});

test('isHost is the first connected player', () => {
  const r = room({
    players: [
      { id: 'a', connected: true },
      { id: 'b', connected: true },
    ],
  });
  expect(isHost(r, 'a')).toBe(true);
  expect(isHost(r, 'b')).toBe(false);
});

test('cardWeight maps values and defaults to 0', () => {
  expect(cardWeight('1/2')).toBe(0.5);
  expect(cardWeight('?')).toBe(0);
});

test('PlayerSeat renders name and flips card after reveal', () => {
  const player = { id: 'a', name: 'Ann', color: '#ef4444', vote: '8', index: 2, connected: true };
  const { rerender } = render(<PlayerSeat player={player} revealed={false} />);
  const unflipped = document.querySelector('.card-inner:not(.is-flipped)');
  expect(unflipped).toBeTruthy();
  rerender(<PlayerSeat player={player} revealed={true} />);
  const flipped = document.querySelector('.card-inner.is-flipped');
  expect(flipped).toBeTruthy();
});

test('buildInviteUrl composes a joinable link and guards empty room', () => {
  expect(buildInviteUrl('https://x.trycloudflare.com', '/', 'ab12cd')).toBe(
    'https://x.trycloudflare.com/?room=ab12cd',
  );
  expect(buildInviteUrl('http://localhost:5173', '/demo', 'zz')).toBe(
    'http://localhost:5173/demo?room=zz',
  );
  expect(buildInviteUrl('http://h', '/', '')).toBe('');
});

test('ShareBar shows the link and a copy button', () => {
  const { getByLabelText, getByRole } = render(
    <ShareBar url="http://localhost:5173/?room=abc" />,
  );
  expect(getByLabelText('Invite link').value).toBe(
    'http://localhost:5173/?room=abc',
  );
  expect(getByRole('button', { name: 'Copy link' })).toBeTruthy();
});
