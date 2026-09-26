import { type KeyboardEvent, type Ref, useId } from 'react';
import { LengthCounter } from '@/features/tasks/LengthCounter';
import { cn } from '@/lib/utils';
import { nameFieldState } from './nameFieldState';

/** The helper under a blank name field (create dialog, inline rename). */
export const NAME_EMPTY_TEXT = "Name can't be empty";

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** The field's accessible name (visually hidden unless `showLabel`). */
  label: string;
  max: number;
  showLabel?: boolean;
  placeholder?: string;
  inputRef?: Ref<HTMLInputElement>;
  autoFocus?: boolean;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  onBlur?: () => void;
  /**
   * Show "Name can't be empty": while the field is blank (the create dialog once touched), or for a timed moment
   * after a blank save was refused (inline rename). Announced politely (role=status).
   */
  emptyHint?: boolean;
  className?: string;
  inputClassName?: string;
};

/**
 * A name input with the shared feedback rules: no maxLength (typed or pasted text is never cut); a counter from
 * LENGTH_WARNING_RATIO of `max` ('12 characters left'), which turns destructive with an icon past it ('3
 * characters over'); and the blank-name helper. Saving rules live with the caller (canSaveName).
 */
export function NameField({
  value,
  onChange,
  label,
  max,
  showLabel = false,
  placeholder,
  inputRef,
  autoFocus,
  onKeyDown,
  onBlur,
  emptyHint = false,
  className,
  inputClassName,
}: Props) {
  const ids = useId();
  const inputId = `${ids}-input`;
  const counterId = `${ids}-counter`;
  const hintId = `${ids}-hint`;
  const { status } = nameFieldState(value, max);
  const over = status === 'over';
  const describedBy = [status === 'near' || over ? counterId : null, emptyHint ? hintId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label htmlFor={inputId} className={showLabel ? 'text-sm font-medium' : 'sr-only'}>
        {label}
      </label>
      <input
        id={inputId}
        ref={inputRef}
        type="text"
        value={value}
        autoFocus={autoFocus}
        autoComplete="off"
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        aria-invalid={over || (emptyHint && status === 'empty') || undefined}
        aria-describedby={describedBy}
        className={cn(
          'min-h-11 w-full rounded-md border border-border bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring',
          inputClassName,
        )}
      />
      <LengthCounter id={counterId} length={value.length} limit={max} />
      {emptyHint ? (
        <p id={hintId} role="status" data-name-hint className="text-xs text-muted-foreground">
          {NAME_EMPTY_TEXT}
        </p>
      ) : null}
    </div>
  );
}
