import type { RoundStats } from "../../shared/protocol";

interface Props {
  stats: RoundStats | null;
}

/** Post-reveal summary: the numbers that decide whether to re-vote or move on. */
export function Results({ stats }: Props) {
  if (!stats || stats.totalVoteCount === 0) {
    return <p className="text-sm text-ink-400">Nobody played a card this round.</p>;
  }

  const maxCount = Math.max(...stats.distribution.map((d) => d.count));

  return (
    <div className="flex w-full flex-col items-center gap-5 animate-pop-in">
      <div className="flex items-end justify-center gap-8">
        <Metric
          label="Average"
          value={stats.average === null ? "–" : String(stats.average)}
          emphasis
        />
        <Metric label="Median" value={stats.median === null ? "–" : String(stats.median)} />
        <Metric label="Voted" value={String(stats.totalVoteCount)} />
      </div>

      {stats.consensus ? (
        <span className="rounded-full border border-teal-brand/50 bg-teal-brand/10 px-3 py-1 text-xs font-medium text-teal-brand">
          Unanimous — write it down and move on
        </span>
      ) : stats.spread ? (
        <span className="rounded-full border border-amber-brand/40 bg-amber-brand/10 px-3 py-1 text-xs text-amber-brand">
          Split from {stats.spread.low} to {stats.spread.high} — ask the outliers first
        </span>
      ) : null}

      <div className="flex w-full items-end justify-center gap-3">
        {stats.distribution.map(({ card, count }) => (
          <div key={card} className="flex w-11 flex-col items-center gap-1.5">
            <span className="text-[0.7rem] tabular-nums text-ink-400">{count}</span>
            <div
              className="w-full rounded-t bg-linear-to-t from-ink-700 to-amber-brand/80"
              style={{ height: `${Math.max(6, (count / maxCount) * 64)}px` }}
            />
            <span className="truncate text-xs font-medium text-ink-100">{card}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex flex-col items-center">
      <span
        className={`tabular-nums font-semibold ${
          emphasis ? "text-4xl text-amber-brand" : "text-2xl text-ink-100"
        }`}
      >
        {value}
      </span>
      <span className="text-[0.65rem] uppercase tracking-widest text-ink-400">{label}</span>
    </div>
  );
}
