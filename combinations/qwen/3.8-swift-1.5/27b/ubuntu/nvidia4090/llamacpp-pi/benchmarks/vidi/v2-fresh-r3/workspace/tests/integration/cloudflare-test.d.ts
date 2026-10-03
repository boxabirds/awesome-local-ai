declare module 'cloudflare:test' {
  export const SELF: {
    fetch: (input: Request | string, init?: RequestInit) => Promise<Response>;
  };
}
