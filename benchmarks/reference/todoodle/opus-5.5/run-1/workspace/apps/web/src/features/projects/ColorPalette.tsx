import { PROJECT_COLORS, type ProjectColorKey } from '@todoodle/shared/limits';
import { RadioGroup } from 'radix-ui';
import { ProjectDot } from './ProjectDot';

type Props = {
  value: ProjectColorKey;
  onChange: (value: ProjectColorKey) => void;
  /** Id of the visible 'Colour' label. */
  labelledBy: string;
};

/**
 * The 12 project colours as a radio group (Radix: one Tab stop, arrow keys move the selection). Each swatch is
 * named for screen readers from PROJECT_COLORS[].label and has a 44x44 hit area around its dot.
 */
export function ColorPalette({ value, onChange, labelledBy }: Props) {
  return (
    <RadioGroup.Root
      value={value}
      onValueChange={(next) => onChange(next as ProjectColorKey)}
      aria-labelledby={labelledBy}
      orientation="horizontal"
      loop
      className="grid grid-cols-6 gap-1"
    >
      {PROJECT_COLORS.map((color) => (
        <RadioGroup.Item
          key={color.key}
          value={color.key}
          aria-label={color.label}
          data-swatch={color.key}
          // Radio semantics: focus is selection (arrow keys move both; Tab only ever lands on the checked one).
          onFocus={() => onChange(color.key)}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=checked]:bg-muted"
        >
          <span className="flex size-7 items-center justify-center rounded-full border-2 border-transparent in-data-[state=checked]:border-foreground">
            <ProjectDot color={color.key} className="size-5" />
          </span>
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
