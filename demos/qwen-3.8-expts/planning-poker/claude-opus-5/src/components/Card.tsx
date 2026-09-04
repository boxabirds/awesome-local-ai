import type { CSSProperties } from "react";

export type CardSize = "sm" | "md" | "lg";

const SIZE_CLASSES: Record<CardSize, string> = {
  sm: "w-10 h-14 text-sm",
  md: "w-14 h-20 text-lg",
  lg: "w-16 h-[5.5rem] text-xl",
};

interface PlayedCardProps {
  value: string | null | undefined;
  revealed: boolean;
  hasVoted: boolean;
  size?: CardSize;
  highlight?: boolean;
}

/**
 * A player's card on the table. Face-down while the round is hidden, flipping
 * to its value on reveal — the flip is the moment the whole ritual is about.
 */
export function PlayedCard({
  value,
  revealed,
  hasVoted,
  size = "md",
  highlight = false,
}: PlayedCardProps) {
  const dimensions = SIZE_CLASSES[size];

  if (!hasVoted) {
    return (
      <div
        className={`${dimensions} rounded-[--radius-card] border-2 border-dashed border-ink-700/80 bg-ink-900/40`}
        aria-label="No card played yet"
      />
    );
  }

  return (
    <div className={`card3d ${dimensions} ${revealed ? "is-revealed" : ""}`}>
      <div className="card3d-inner">
        <div className="card3d-face card-back-pattern border border-ink-600/70 shadow-lg shadow-black/40" />
        <div
          className={`card3d-face card3d-back border font-semibold tabular-nums shadow-lg shadow-black/40 ${
            highlight
              ? "border-teal-brand/70 bg-teal-brand/15 text-teal-brand"
              : "border-ink-600 bg-ink-100 text-ink-950"
          }`}
        >
          {value ?? "–"}
        </div>
      </div>
    </div>
  );
}

interface HandCardProps {
  value: string;
  selected: boolean;
  disabled: boolean;
  onSelect: (value: string) => void;
  style?: CSSProperties;
}

/** A selectable card in the player's own hand. */
export function HandCard({ value, selected, disabled, onSelect, style }: HandCardProps) {
  return (
    <button
      type="button"
      style={style}
      disabled={disabled}
      aria-pressed={selected}
      onClick={() => onSelect(value)}
      className={`focus-ring ${SIZE_CLASSES.lg} shrink-0 rounded-[--radius-card] border font-semibold tabular-nums transition-all duration-150
        disabled:cursor-not-allowed disabled:opacity-40
        ${
          selected
            ? "-translate-y-3 border-amber-brand bg-amber-brand text-ink-950 shadow-[0_10px_30px_-8px_rgba(242,163,60,0.7)]"
            : "border-ink-600 bg-ink-850 text-ink-100 hover:-translate-y-2 hover:border-amber-brand/70 hover:bg-ink-800"
        }`}
    >
      {value}
    </button>
  );
}
