// The machines API as the page sees it (/api/machines, /api/jobs): what dbench says about each node, and the
// refresh after a change. Shared by the machines list, each machine's page and the overview.
import useSWR, { mutate } from "swr";
import type { Reachability } from "../../../shared/overviewView.ts";

/** How often the machine list is asked again. */
export const MACHINES_POLL_MS = 10_000;
export const MACHINES_KEY = "/api/machines";
const STATE_KEY = "/api/state";
const GIB = 1024 ** 3;
const MIB_PER_GIB = 1024;

export interface Install { install_id: string; combination: string; backend?: string }
export interface NodeInfo {
  hostname?: string; os?: string; cpu_brand?: string; cpus?: number; total_ram_bytes?: number;
  gpus?: { name: string; memory_mib?: number; unified?: boolean }[]; dbench_version?: string;
  current_job?: string | null; combinations?: Install[];
}
/** One machine in the list: its address, whether dbench answered, and what it said. */
export interface MachineInfo { name: string; url: string; ok: boolean; error?: string; node?: NodeInfo }
/** What a change returned. */
export interface OpResult { ok: boolean; message: string; needToken?: boolean; ids?: string[] }

export const fetchJson = async (url: string) => (await fetch(url, { cache: "no-store" })).json();

/** After a change: ask again for the machines and the state, so the page shows what the change did. */
export const refreshAll = () => Promise.all([mutate(MACHINES_KEY), mutate(STATE_KEY)]);

/** The machine list, polled; and each machine's reachability (null until the list has answered). */
export function useMachineList(): { machines: MachineInfo[] | undefined; reach: Reachability } {
  const { data } = useSWR<MachineInfo[]>(MACHINES_KEY, fetchJson, { refreshInterval: MACHINES_POLL_MS });
  const machines = Array.isArray(data) ? data : undefined;
  const reach: Reachability = machines ? Object.fromEntries(machines.map((m) => [m.name, { ok: m.ok, error: m.error }])) : null;
  return { machines, reach };
}

const gpuText = (g: NonNullable<NodeInfo["gpus"]>[number]) =>
  g.unified ? `${g.name} (unified memory)` : `${g.name}${g.memory_mib ? ` ${Math.round(g.memory_mib / MIB_PER_GIB)} GB` : ""}`;

/** Everything dbench says about the hardware, in one line: processor, cores, memory, graphics, OS. */
export function hardware(n: NodeInfo): string {
  const gpus = (n.gpus ?? []).map(gpuText);
  return [n.cpu_brand, n.cpus ? `${n.cpus} cores` : "", n.total_ram_bytes ? `${Math.round(n.total_ram_bytes / GIB)} GB RAM` : "", ...gpus, n.os].filter(Boolean).join(" · ");
}

/** The hardware in a few words, for a list: processor, memory, and a graphics card that isn't the processor's own. */
export function hardwareShort(n: NodeInfo): string {
  const gpus = (n.gpus ?? []).filter((g) => !g.unified && g.name !== n.cpu_brand).map(gpuText);
  return [n.cpu_brand, n.total_ram_bytes ? `${Math.round(n.total_ram_bytes / GIB)} GB` : "", ...gpus].filter(Boolean).join(" · ");
}
