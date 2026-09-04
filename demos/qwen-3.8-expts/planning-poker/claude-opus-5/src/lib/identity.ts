const CLIENT_ID_KEY = "pp.clientId";
const NAME_KEY = "pp.name";
const ROLE_KEY = "pp.role";
const CLIENT_ID_LENGTH = 24;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // Private browsing or blocked storage: fall back to a per-tab identity.
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Nothing to do; the session still works, it just will not survive a refresh.
  }
}

let memoryClientId: string | null = null;

/** Stable per-browser id, so a refresh reclaims the same seat rather than duplicating it. */
export function clientId(): string {
  const stored = read(CLIENT_ID_KEY);
  if (stored) return stored;
  if (memoryClientId) return memoryClientId;

  const generated = crypto.randomUUID().replace(/-/g, "").slice(0, CLIENT_ID_LENGTH);
  memoryClientId = generated;
  write(CLIENT_ID_KEY, generated);
  return generated;
}

export function savedName(): string {
  return read(NAME_KEY) ?? "";
}

export function saveName(name: string): void {
  write(NAME_KEY, name);
}

export function savedRole(): "voter" | "spectator" {
  return read(ROLE_KEY) === "spectator" ? "spectator" : "voter";
}

export function saveRole(role: "voter" | "spectator"): void {
  write(ROLE_KEY, role);
}
