// The browser reads the collaboration endpoint from a Vite env var. It lives in
// its own client-only module (not the shared `config`, which the Worker also
// imports) because `import.meta.env` only exists in the client bundle.
//
//   dev / e2e against a standalone y-websocket-server: ws://127.0.0.1:1234
//   default (and production): empty, meaning "same origin", so the provider
//   connects to `ws(s)://<this host>/api/rooms/<boardId>` and the Worker relays
//   it to the room.

/** An absolute `ws(s)://host[:port]` base without a trailing slash, or "" for same origin. */
export const COLLAB_ENDPOINT: string = import.meta.env.VITE_COLLAB_ENDPOINT ?? '';
