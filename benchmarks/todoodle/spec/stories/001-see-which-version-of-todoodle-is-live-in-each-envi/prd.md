# PRD

Deployable skeleton: local dev, staging, production, health reporting, and release safety checks. Every later story ships through this.

## Problem

Todoodle does not exist yet. Without a working path from a developer's machine to staging and production, every feature story stalls at 'works on my machine'. Releases that silently include unsafe data changes, or that cannot be traced back to a specific code revision, make incidents slow to diagnose and hard to roll back. The developer also wants a single toolchain (bun) rather than juggling several package managers and runners.

## Solution

A developer can clone the repository, install with bun, and have the app running locally in minutes with no connection to staging or production. A single release command promotes a tagged revision to staging or production, refuses to ship data changes known to be irreversible, retries transient failures, confirms the release is healthy, and records who released what and when. Anyone can ask a running environment which version and revision it is serving.

## User Experience

Users here are the developer/operator (the experience is technical by nature).

**Golden path**
1. Developer clones, runs one bun install command, one command to prepare local data, one command to start the app. The app opens in the browser showing the Todoodle landing page.
2. Developer runs the test suite with one bun command; it runs entirely offline.
3. Developer runs the release command for staging. Output shows: safety scan result, release progress, health confirmation with the version and revision now live.
4. Same for production.

**Alternate flows**
- Release requested for a revision already live with no pending data changes: command reports 'already deployed' and exits successfully without redeploying.
- Pending data change contains an irreversible pattern: production release is refused with the offending file named; staging release warns and continues.
- Health check after release fails: command exits with failure, names the environment, and the failure is recorded in the release log.
- Transient platform error during release: retried automatically; the operator sees each attempt.

**Non-behaviours**
- Does not release automatically on push (manual command only for now).
- Does not roll back automatically on failed health check.

## Local development is self-contained

> Anchor: `prd.local_dev`

THE SYSTEM SHALL run the full application (interface and data service) on a developer machine using only local data, with bun as the package manager and script runner.

## Tests never touch real environments

> Anchor: `prd.isolated_tests`

IF the automated test suite is run THEN THE SYSTEM SHALL NOT read from or write to staging or production data.

## Environments report their identity

> Anchor: `prd.health`

WHEN anyone requests the health status of an environment THE SYSTEM SHALL report its status, environment name, version, code revision, and release time.

## Unsafe data changes are blocked from production

> Anchor: `prd.release_safety`

IF a pending data change contains a known-irreversible pattern THEN THE SYSTEM SHALL NOT release it to production, and SHALL name the offending change.

## Unsafe data changes warn on staging

> Anchor: `prd.release_safety_staging`

WHEN a pending data change released to staging contains a known-irreversible pattern THE SYSTEM SHALL warn the operator, name the offending change, and continue the staging release.

## Re-releasing the live version is a no-op

> Anchor: `prd.release_idempotent`

WHEN a release is requested for the revision already live in that environment and no data changes are pending THE SYSTEM SHALL skip the release and report that it is already deployed.

## Every release is verified and recorded

> Anchor: `prd.release_verify`

WHEN a release completes THE SYSTEM SHALL confirm the environment reports the released revision and SHALL record operator, revision, version, time, and outcome in the release log.

## Transient release failures are retried

> Anchor: `prd.release_retry`

IF publishing a release fails THEN THE SYSTEM SHALL retry up to 3 attempts in total with increasing delay between attempts, show each attempt to the operator, and record the release as failed if every attempt fails.

## Baseline protections on every response

> Anchor: `prd.security_baseline`

THE SYSTEM SHALL attach a request identifier and baseline browser security protections (no framing, no content sniffing, no caching of private data, no referrer leakage) to every response.

## Test-only operations never exist in production

> Anchor: `prd.test_routes_gated`

IF the environment is production THEN THE SYSTEM SHALL NOT perform any test-only operation (such as seeding or resetting data) and SHALL respond as though the operation does not exist.

## Malformed or oversized requests are rejected early

> Anchor: `prd.request_limits`

IF a request uses an unsupported method, an unsupported content format for a change, or exceeds 1 MB THEN THE SYSTEM SHALL reject it with a clear error and SHALL NOT act on it.

## Out of scope

- Continuous deployment on push
- Automatic rollback
- Metrics dashboards and alerting beyond platform log collection
- Custom domain purchase/DNS (configured manually once)

## Constraints

- Hosting on Cloudflare (Workers, D1, Pages), three environments: local, staging, production, each with fully separate data.
- bun is the package manager and script runner. Note: Cloudflare's worker test pool runs under vitest, so tests are invoked via bun but executed by vitest inside the Workers runtime.
- Secrets are never stored in configuration files checked into the repository.
- No-referrer policy is mandatory because workspace links are credentials (see workspaces epic).

