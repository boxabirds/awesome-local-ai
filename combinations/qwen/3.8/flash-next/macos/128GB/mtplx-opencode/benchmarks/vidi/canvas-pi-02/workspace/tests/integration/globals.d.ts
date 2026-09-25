/**
 * `cloudflare:test` is provided by the workers Vitest pool at runtime (the
 * pool adds the module condition and the workerd import specifier); this file
 * only makes TypeScript aware of it so the integration tests typecheck.
 */
/// <reference types="@cloudflare/vitest-pool-workers" />
