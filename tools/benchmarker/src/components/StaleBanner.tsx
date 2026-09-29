interface Props { stale: boolean; age: number | null; error: string }

/** Says plainly when the data on screen is old, so it never passes for current. */
export function StaleBanner({ stale, age, error }: Props) {
  if (!stale) return null;
  const when = age === null ? "No data yet" : `Stale: the last successful update was ${Math.round(age)} s ago`;
  return (
    <div className="stale-banner" role="alert">
      {when}{error ? ` (${error})` : ""}. Is the benchmarker server running?
    </div>
  );
}
