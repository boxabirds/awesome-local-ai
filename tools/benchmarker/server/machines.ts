// Machines (dbench nodes) and job actions: the node list in ~/.config/dbench/nodes.toml, shared with the
// dbench command line, and the pure steps of adding a machine and restarting a job. The commands that touch
// the network or the disk are passed in, so the steps are tested without either.

export interface Node { url: string; token: string }

const DBENCH_PORT = 7717;
/** dbench checks job and node names against this; so does the page, before running anything. */
export const NAME = /^[A-Za-z0-9._-]+$/;

/** The [nodes.<name>] tables of nodes.toml (url and token strings; anything else is ignored). */
export function parseNodes(text: string): Record<string, Node> {
  const out: Record<string, Node> = {};
  let cur: string | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const head = /^\[nodes\.("?)([^"\]]+)\1\]$/.exec(line);
    if (head) { cur = head[2]; out[cur] = { url: "", token: "" }; continue; }
    if (line.startsWith("[")) { cur = null; continue; }
    const kv = /^(url|token)\s*=\s*"([^"]*)"\s*$/.exec(line);
    if (cur && kv) out[cur][kv[1] as keyof Node] = kv[2];
  }
  return out;
}

export function renderNodes(nodes: Record<string, Node>): string {
  return Object.entries(nodes)
    .map(([name, n]) => `[nodes.${name}]\nurl = "${n.url}"\ntoken = "${n.token}"\n`)
    .join("\n");
}

/** What adding a machine needs from the world. */
export interface Commands {
  /** The node's token, read over SSH (Tailscale); throws if SSH can't. */
  sshReadToken(host: string): Promise<string>;
  /** GET <url>/v1/node with the token; throws with the reason if the node doesn't answer. */
  probe(url: string, token: string): Promise<unknown>;
  save(name: string, node: Node): Promise<void>;
}

export type AddResult =
  | { ok: true; name: string; url: string; tokenFrom: "pasted" | "ssh"; node: unknown }
  | { ok: false; needToken?: boolean; message: string };

/** Add a machine: its token as pasted, else read over SSH, else ask for it (saying how); then check the
 * node answers with that token before saving, so nodes.toml never holds a machine that doesn't work. */
export async function addMachine(req: { name: string; url?: string; token?: string }, c: Commands): Promise<AddResult> {
  const name = req.name.trim();
  if (!NAME.test(name)) return { ok: false, message: `"${name}" isn't a valid machine name: letters, digits, dot, dash and underscore only` };
  const url = req.url?.trim() || `http://${name}:${DBENCH_PORT}`;
  let token = req.token?.trim() ?? "";
  let tokenFrom: "pasted" | "ssh" = "pasted";
  if (!token) {
    try {
      token = (await c.sshReadToken(name)).trim();
      tokenFrom = "ssh";
    } catch {
      return {
        ok: false, needToken: true,
        message: `Couldn't read ${name}'s token over SSH. On ${name}, run: cat ~/.dbench/token — and paste what it prints.`,
      };
    }
  }
  let node: unknown;
  try {
    node = await c.probe(url, token);
  } catch (e) {
    return { ok: false, message: `${name} didn't answer at ${url}: ${e instanceof Error ? e.message : String(e)}` };
  }
  await c.save(name, { url, token });
  return { ok: true, name, url, tokenFrom, node };
}

/** A new id to resubmit a job under. The same run id makes the harness resume at the first unfinished story,
 * so a restart carries on the run rather than starting it again. */
export function restartId(id: string, existing: string[]): string {
  const base = id.replace(/-again\d+$/, "");
  let n = 1;
  while (existing.includes(`${base}-again${n}`)) n++;
  return `${base}-again${n}`;
}
