declare module 'cloudflare:test' {
  export const SELF: {
    fetch(input: Request | string, init?: RequestInit): Promise<Response>;
  };
  export const env: Record<string, any>;
}
