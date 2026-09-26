import { type ReactNode, memo } from 'react';
import { CheckIcon } from '@/components/icons';
import { cn } from '@/lib/utils';

type Props = {
  /** DOM id, referenced by the input's aria-activedescendant. */
  id: string;
  index: number;
  active: boolean;
  disabled: boolean;
  /** Marked with a check (e.g. the task's current list). */
  checked?: boolean;
  /** A leading visual (a colour dot); decorative. */
  adornment?: ReactNode;
  children: ReactNode;
  onChoose: (index: number) => void;
  onHover: (index: number) => void;
};

/**
 * One option of a combobox listbox: at least MIN_TOUCH_TARGET_PX (44px) tall, an optional adornment, and
 * aria-disabled (still listed, never chosen). Focus stays in the input (aria-activedescendant), so the option
 * never takes focus itself. Memoised: typing re-renders only options whose props change.
 */
export const OptionRow = memo(function OptionRow({ id, index, active, disabled, checked = false, adornment, children, onChoose, onHover }: Props) {
  return (
    <li
      id={id}
      role="option"
      aria-selected={active}
      aria-disabled={disabled || undefined}
      data-active={active || undefined}
      // Keep focus in the input: a pointer press must not blur it.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => !disabled && onChoose(index)}
      onPointerMove={() => onHover(index)}
      className={cn(
        'flex min-h-11 cursor-default select-none items-center gap-3 rounded-md px-3 text-sm',
        active && 'bg-muted',
        disabled && 'text-muted-foreground',
      )}
    >
      {adornment}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {checked ? <CheckIcon aria-hidden="true" data-current-check className="size-4 shrink-0" /> : null}
    </li>
  );
});
