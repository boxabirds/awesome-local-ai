// Figures the run page's Stories table and a story run share: the speed and percentage formats, and the engine speed line.
import { Missing, NotApplicable, Term } from "./bits.tsx";

const SPEED_DECIMALS = 1;
const PERCENT = 100;

export const speed = (n: number) => n.toFixed(SPEED_DECIMALS);
export const pct = (frac: number) => `${Math.round(frac * PERCENT)}%`;

/** The model's own speeds, on one small line under the cost: "engine speed: generation 31.2 tok/s · reading 980 tok/s". */
export function EngineSpeed({ decode, prefill, whyDecode, whyPrefill, cloud = false }: { decode: number | null; prefill: number | null; whyDecode: string; whyPrefill: string; cloud?: boolean }) {
  const show = (v: number | null, why: string) => (cloud ? <NotApplicable /> : v === null ? <Missing why={why} /> : `${speed(v)} tok/s`);
  return (
    <p className="small engine-speed" data-stat="engineSpeed">
      <Term id="engineSpeed" />: <Term id="decodeTokS">generation</Term> <span data-fact="decode">{show(decode, whyDecode)}</span>
      {" · "}<Term id="prefillTokS">reading</Term> <span data-fact="prefill">{show(prefill, whyPrefill)}</span>
    </p>
  );
}
