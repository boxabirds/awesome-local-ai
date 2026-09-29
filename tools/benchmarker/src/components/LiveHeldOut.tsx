import type { Story } from "../../shared/types.ts";

/** The whole held-out suite after the latest recorded story; a story dbench already reports finished,
 * whose whole-suite result isn't in the fetched record yet, shows its own tests' result. */
export function LiveHeldOut({ stories }: { stories: Story[] }) {
  const whole = stories.filter((s) => s.total !== null).at(-1);
  const last = stories.at(-1);
  const ownOnly = last && last.total === null && last.ownTotal !== null ? last : null;
  if (!whole && !ownOnly) return <span className="wait">—</span>;
  return (
    <>
      {whole ? <div>{whole.passed}/{whole.total} <span className="small">whole suite after story {whole.id}</span></div> : null}
      {ownOnly ? <div className="small">story {ownOnly.id}: {ownOnly.ownPassed}/{ownOnly.ownTotal} own tests</div> : null}
    </>
  );
}
