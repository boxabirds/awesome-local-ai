import { act, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { Toaster } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DateChip } from '@/features/dates/DateChip';
import { DueDatePicker } from '@/features/dates/DueDatePicker';
import { listShortcuts } from '@/lib/shortcuts';
import { todayServer } from '../../msw/todayServer.ts';
import { renderWithClient, rowNamed, toastWith } from '../../support/tasks.tsx';
import { ID, dated, enterToday, useFriday } from '../../support/today.tsx';

// Story 8, ui.date_picker: the picker (shortcuts with their dates, keys, grid), the chip, the D key and the task
// detail's date. Fake clock: Fri 2026-09-25 (en-GB).

beforeEach(() => useFriday());
afterEach(() => vi.useRealTimers());

function Harness({ initial = null, onChange }: { initial?: string | null; onChange: (value: string | null) => void }) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <>
      <label>
        Task name
        <input type="text" />
      </label>
      <DueDatePicker
        value={value}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
      />
      <Toaster />
    </>
  );
}

async function openPicker(user: { click: (el: Element) => Promise<void> }, name: string | RegExp = 'Set due date') {
  await user.click(screen.getByRole('button', { name }));
  return screen.findByRole('dialog', { name: 'Due date' });
}

function shortcutButtons(dialog: HTMLElement) {
  return within(within(dialog).getByRole('group', { name: 'Shortcuts' })).getAllByRole('button');
}

describe('DueDatePicker', () => {
  it("TC-64 click 'Tomorrow · Sat 26 Sep': onChange('2026-09-26') once, the popover closes, focus returns to the trigger", async () => {
    const onChange = vi.fn();
    const { user } = await renderWithClient(<Harness onChange={onChange} />);
    const dialog = await openPicker(user);
    await user.click(within(dialog).getByText('Tomorrow · Sat 26 Sep'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('2026-09-26');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Due date' })).not.toBeInTheDocument());
    const trigger = screen.getByRole('button', { name: 'Due date: Tomorrow' });
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(within(trigger).getByText('Tomorrow')).toBeInTheDocument();
  });

  it('TC-65 No date: onChange(null) and the trigger goes back to the calendar icon', async () => {
    const onChange = vi.fn();
    const { user } = await renderWithClient(<Harness initial="2026-09-26" onChange={onChange} />);
    const dialog = await openPicker(user, 'Due date: Tomorrow');
    await user.click(within(dialog).getByRole('button', { name: 'No date' }));
    expect(onChange).toHaveBeenCalledWith(null);
    expect(await screen.findByRole('button', { name: 'Set due date' })).toBeInTheDocument();
  });

  it('TC-66 keyboard: every shortcut is reachable with Tab; into the grid, arrows to the 30th, Enter picks it', async () => {
    const onChange = vi.fn();
    const { user } = await renderWithClient(<Harness onChange={onChange} />);
    const dialog = await openPicker(user);
    const buttons = shortcutButtons(dialog);
    await waitFor(() => expect(buttons[0]).toHaveFocus());
    for (const button of buttons.slice(1)) {
      await user.tab();
      expect(button).toHaveFocus();
    }
    for (const button of buttons) expect(button).toHaveAccessibleName();
    // Past the month navigation, into the grid (today's day).
    const today = within(dialog).getByRole('gridcell', { name: /25/ }).querySelector('button')!;
    for (let i = 0; i < 4 && document.activeElement !== today; i++) await user.tab();
    expect(today).toHaveFocus();
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}');
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('2026-09-30');
  });

  it("TC-111 five shortcuts in order, each showing the date it means; accessible names say the full date", async () => {
    const { user } = await renderWithClient(<Harness onChange={() => {}} />);
    const dialog = await openPicker(user);
    const buttons = shortcutButtons(dialog);
    expect(buttons.map((button) => button.querySelector('span')?.textContent)).toEqual([
      'Today · Fri 25 Sep',
      'Tomorrow · Sat 26 Sep',
      'This weekend · Sat 26 Sep',
      'Next week · Mon 28 Sep',
      'No date',
    ]);
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Today, Friday 25 September',
      'Tomorrow, Saturday 26 September',
      'This weekend, Saturday 26 September',
      'Next week, Monday 28 September',
      'No date',
    ]);
  });

  it.each([
    ['t', '2026-09-25'],
    ['m', '2026-09-26'],
    ['w', '2026-09-26'],
    ['n', '2026-09-28'],
    ['0', null],
  ])('TC-112 pressing %s chooses %s and closes the picker once', async (key, expected) => {
    const onChange = vi.fn();
    const { user } = await renderWithClient(<Harness onChange={onChange} />);
    await openPicker(user);
    await user.keyboard(key);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(expected);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Due date' })).not.toBeInTheDocument());
  });

  it('TC-112 an unrelated key (x) does nothing; Escape closes without a change', async () => {
    const onChange = vi.fn();
    const { user } = await renderWithClient(<Harness onChange={onChange} />);
    await openPicker(user);
    await user.keyboard('x');
    expect(screen.getByRole('dialog', { name: 'Due date' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Due date' })).not.toBeInTheDocument());
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Set due date' })).toHaveFocus();
  });

  it("TC-96 typing 'Do taxes0' in a text field types every letter; the picker never opens", async () => {
    const onChange = vi.fn();
    const { user } = await renderWithClient(<Harness onChange={onChange} />);
    const input = screen.getByRole('textbox', { name: 'Task name' });
    await user.click(input);
    await user.keyboard('Do taxes0');
    await user.keyboard('dtmwn');
    expect(input).toHaveValue('Do taxes0dtmwn');
    expect(screen.queryByRole('dialog', { name: 'Due date' })).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  // TC-114 (chunk load failure, then retry) is in pickerChunk.test.tsx: it needs a fresh module graph.
});

describe('DateChip', () => {
  it.each([
    ['2026-09-22', '3 days overdue', 'overdue', true],
    ['2026-09-24', 'Yesterday', 'overdue', true],
    ['2026-09-25', 'Today', 'today', false],
    ['2026-09-26', 'Tomorrow', 'tomorrow', false],
    ['2026-09-28', 'Monday', 'neutral', false],
    ['2026-10-02', '2 Oct', 'neutral', false],
    ['2027-01-04', '4 Jan 2027', 'neutral', false],
  ])('TC-67 due %s: %j, %s tone, icon %s', async (due, text, tone, icon) => {
    await renderWithClient(<DateChip due={due} />);
    const chip = document.querySelector<HTMLElement>('[data-date-chip]')!;
    expect(chip).toHaveTextContent(text);
    expect(chip).toHaveAttribute('data-date-chip', tone);
    expect(chip).toHaveClass(`text-chip-${tone}`);
    expect(chip.querySelector('[data-chip-warning]') !== null).toBe(icon);
  });

  it("TC-115 overdue is words + icon + label, never colour alone: '3 days overdue', icon aria-hidden, 'Overdue: due Tuesday 22 September'", async () => {
    await renderWithClient(<DateChip due="2026-09-22" />);
    const chip = screen.getByRole('img', { name: 'Overdue: due Tuesday 22 September' });
    expect(chip).toHaveTextContent('3 days overdue');
    const icon = chip.querySelector('[data-chip-warning]')!;
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    // Without any colour class the words are still there.
    chip.className = '';
    expect(chip).toHaveTextContent('3 days overdue');
  });
});

describe('the D key and the task detail', () => {
  it("TC-113 D on a selected row opens its picker by the row's chip; in quick add it types 'd'; with nothing selected nothing happens; '?' lists it", async () => {
    const a = dated('Renew passport', '2026-09-26', 0);
    const b = dated('Pay council tax', null, 1);
    const api = todayServer({ tasks: [a, b] });
    const { user } = await enterToday(api, `/w/${ID}`, 'Inbox');
    await waitFor(() => expect(rowNamed('Pay council tax')).toBeInTheDocument());
    // First: row B selected (roving focus) -> its picker.
    rowNamed('Pay council tax').focus();
    await user.keyboard('d');
    const dialog = await screen.findByRole('dialog', { name: 'Due date' });
    await user.keyboard('n');
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    await waitFor(() => expect(api.callsOf('patch')).toEqual([{ op: 'patch', id: b.id, body: { dueDate: '2026-09-28' } }]));
    await waitFor(() => expect(within(rowNamed('Pay council tax')).getByText('Monday')).toBeInTheDocument());
    await waitFor(() => expect(rowNamed('Pay council tax')).toHaveFocus());
    // Second: typing in quick add types the letter.
    await user.keyboard('q');
    const name = await screen.findByRole('textbox', { name: 'Task name' });
    await user.type(name, 'd');
    expect(name).toHaveValue('d');
    expect(screen.queryByRole('dialog', { name: 'Due date' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    // Third: nothing selected -> nothing happens.
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard('d');
    expect(screen.queryByRole('dialog', { name: 'Due date' })).not.toBeInTheDocument();
    expect(api.callsOf('patch')).toHaveLength(1);
    // The ? panel lists it.
    expect(listShortcuts()).toContainEqual({ keys: ['D'], description: 'Set due date', group: 'Tasks' });
  });

  async function openDetailPicker(name: string) {
    const task = dated(name, '2026-09-26', 0);
    const api = todayServer({ tasks: [task] });
    const rendered = await enterToday(api, `/w/${ID}`, 'Inbox');
    await waitFor(() => expect(rowNamed(name)).toBeInTheDocument());
    await rendered.user.click(within(rowNamed(name)).getByText(name));
    const sheet = await screen.findByRole('dialog', { name: 'Task details' });
    await rendered.user.click(within(sheet).getByRole('button', { name: 'Due date: Tomorrow' }));
    const picker = await screen.findByRole('dialog', { name: 'Due date' });
    return { ...rendered, api, task, sheet, picker };
  }

  it("TC-68 PATCH 500: the chip goes back to the previous date and 'Couldn't save — try again' shows", async () => {
    const { user, api, sheet, picker } = await openDetailPicker('Renew passport');
    api.fail.patch = 500;
    await user.click(within(picker).getByText('Next week · Mon 28 Sep'));
    await waitFor(() => expect(api.callsOf('patch')).toHaveLength(1));
    expect(api.callsOf('patch')[0]!.body).toEqual({ dueDate: '2026-09-28' });
    await waitFor(() => expect(toastWith("Couldn't save — try again")).not.toBeNull());
    await waitFor(() => expect(within(sheet).getByRole('button', { name: 'Due date: Tomorrow' })).toBeInTheDocument());
    expect(within(rowNamed('Renew passport', { hidden: true })).getByText('Tomorrow')).toBeInTheDocument();
  });

  it("TC-69 PATCH 410: 'This task was deleted' and the detail closes", async () => {
    const { user, api, picker } = await openDetailPicker('Renew passport');
    api.fail.patch = 410;
    await user.click(within(picker).getByText('Next week · Mon 28 Sep'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Task details' })).not.toBeInTheDocument());
    expect(await screen.findByText('This task was deleted')).toBeInTheDocument();
  });
});
