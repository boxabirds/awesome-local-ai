import { describe, expect, it } from "vitest";
import { addMachine, parseNodes, renderNodes, restartId, type Commands } from "./machines.ts";

const TOML = `[nodes.node-a]
url = "http://node-a:7717"
token = "abc"

[nodes.node-d]
url = "http://node-d:7717"
token = "def"
`;

describe("nodes.toml", () => {
  it("reads every node's url and token", () => {
    expect(parseNodes(TOML)).toEqual({
      "node-a": { url: "http://node-a:7717", token: "abc" },
      "node-d": { url: "http://node-d:7717", token: "def" },
    });
  });

  it("writes back what it read, so adding one machine keeps the others", () => {
    expect(parseNodes(renderNodes(parseNodes(TOML)))).toEqual(parseNodes(TOML));
  });
});

/** Commands that record what they were asked and answer as scripted. */
function commands(opts: { sshToken?: string | null; reachable?: boolean }): Commands & { saved: Record<string, unknown>[]; sshTo: string[] } {
  const saved: Record<string, unknown>[] = [], sshTo: string[] = [];
  return {
    saved, sshTo,
    async sshReadToken(host) {
      sshTo.push(host);
      if (opts.sshToken == null) throw new Error("ssh: connect to host failed");
      return opts.sshToken;
    },
    async probe(url, token) {
      if (!opts.reachable) throw new Error(`${url}: connection refused`);
      return { hostname: "newbox", token };
    },
    async save(name, node) { saved.push({ name, ...node }); },
  };
}

describe("adding a machine", () => {
  it("fetches the token over SSH when none is given, checks the node answers, then saves it", async () => {
    const c = commands({ sshToken: "tok\n", reachable: true });
    const r = await addMachine({ name: "newbox" }, c);
    expect(r).toMatchObject({ ok: true, name: "newbox", url: "http://newbox:7717", tokenFrom: "ssh" });
    expect(c.sshTo).toEqual(["newbox"]);
    expect(c.saved).toEqual([{ name: "newbox", url: "http://newbox:7717", token: "tok" }]);
  });

  it("asks for the token, saying how to get it, when SSH can't read it", async () => {
    const c = commands({ sshToken: null, reachable: true });
    const r = await addMachine({ name: "newbox" }, c);
    expect(r).toMatchObject({ ok: false, needToken: true });
    expect(r.message).toContain("cat ~/.dbench/token");
    expect(c.saved).toEqual([]);
  });

  it("uses a pasted token without trying SSH", async () => {
    const c = commands({ sshToken: "never", reachable: true });
    const r = await addMachine({ name: "newbox", token: " pasted " }, c);
    expect(r).toMatchObject({ ok: true, tokenFrom: "pasted" });
    expect(c.sshTo).toEqual([]);
    expect(c.saved[0]).toMatchObject({ token: "pasted" });
  });

  it("saves nothing when the node doesn't answer, and says so", async () => {
    const c = commands({ sshToken: "tok", reachable: false });
    const r = await addMachine({ name: "newbox", url: "http://10.0.0.9:7717" }, c);
    expect(r).toMatchObject({ ok: false });
    expect(r.message).toContain("connection refused");
    expect(c.saved).toEqual([]);
  });

  it("refuses names dbench wouldn't accept", async () => {
    const r = await addMachine({ name: "new box; rm -rf" }, commands({ reachable: true }));
    expect(r).toMatchObject({ ok: false });
  });
});

describe("restarting a job", () => {
  it("resubmits under a new id: the same run id resumes at the first unfinished story", () => {
    expect(restartId("vidi-v2b-swift15-r2", [])).toBe("vidi-v2b-swift15-r2-again1");
    expect(restartId("vidi-v2b-swift15-r2-again1", ["vidi-v2b-swift15-r2-again1"])).toBe("vidi-v2b-swift15-r2-again2");
  });
});
