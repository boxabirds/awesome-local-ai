interface Props { stale: boolean; age: number | null }

const MS_PER_S = 1000;
const ISO_MINUTE = 16;
const HH_MM_FROM = 11;

/** Says plainly when the data on screen is old, so it never passes for current: since when, and no more. */
export function StaleBanner({ stale, age }: Props) {
  if (!stale) return null;
  const since = age === null ? null : new Date(Date.now() - age * MS_PER_S).toISOString().slice(HH_MM_FROM, ISO_MINUTE);
  return (
    <div className="stale-banner" role="alert">
      {since === null ? "No data yet." : `Not updated since ${since} UTC.`}
    </div>
  );
}
