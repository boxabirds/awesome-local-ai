// Realistic note texts used by unit and e2e tests.
// Do not use repeated single characters: they lay out unrealistically.

export const SHORT_PHRASE = 'Faster onboarding';

export const MULTI_LINE_RETRO = 'We shipped the new onboarding flow\nNPS improved from 32 to 41\nNext: reduce time to first value';

// Exactly 1000 characters of English prose (STICKY_TEXT_MAX_CHARS).
export const LONG_PROSE = "The team gathered around the board to capture what went well and what did not during the last release cycle. Onboarding remained the biggest friction point, with several customers abandoning the flow before the first project was created. Search improved noticeably after the indexing rewrite, and support tickets about slow results dropped by half. The notification settings were confusing, and more than a third of the surveyed users could not find the digest toggle. Deployments were smoother this cycle because the preview environment now isolates every pull request from the main branch. Mobile performance regressed slightly after the new analytics script was added, so the budget needs to be rechecked. The billing team asked for invoice exports earlier, and the accounting team confirmed the format they need for audits. Accessibility audits showed that the dialog focus trap works, but the colour contrast on muted text still fails in dark mode. The on-call rotation handled the incident fast";

// Exactly 1200 characters; its first 1000 characters are exactly LONG_PROSE.
export const LONG_PASTE = "The team gathered around the board to capture what went well and what did not during the last release cycle. Onboarding remained the biggest friction point, with several customers abandoning the flow before the first project was created. Search improved noticeably after the indexing rewrite, and support tickets about slow results dropped by half. The notification settings were confusing, and more than a third of the surveyed users could not find the digest toggle. Deployments were smoother this cycle because the preview environment now isolates every pull request from the main branch. Mobile performance regressed slightly after the new analytics script was added, so the budget needs to be rechecked. The billing team asked for invoice exports earlier, and the accounting team confirmed the format they need for audits. Accessibility audits showed that the dialog focus trap works, but the colour contrast on muted text still fails in dark mode. The on-call rotation handled the incident fast, and the postmortem found a missing timeout on the media proxy. Roadmap conversations kept returning to offline support, which several enterprise customers listed as a blocking requirement. The desig";

if (LONG_PROSE.length !== 1000) throw new Error('LONG_PROSE must be 1000 chars');
if (LONG_PASTE.length !== 1200) throw new Error('LONG_PASTE must be 1200 chars');
if (LONG_PASTE.slice(0, 1000) !== LONG_PROSE) throw new Error('LONG_PASTE prefix mismatch');
