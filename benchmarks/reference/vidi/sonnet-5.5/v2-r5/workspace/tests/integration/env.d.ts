/// <reference path="../../node_modules/@cloudflare/vitest-pool-workers/types/cloudflare-test.d.ts" />
import type { Env } from "../../src/worker/index";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}
