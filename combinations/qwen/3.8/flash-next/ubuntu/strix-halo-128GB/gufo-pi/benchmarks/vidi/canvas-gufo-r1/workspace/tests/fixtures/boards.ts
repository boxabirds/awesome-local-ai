import * as Y from 'yjs';
import { initDoc, createSticky, moveObject, getStickyText } from '../../src/shared/board-model';
import { PERSIST_TESTED_NOTES, type StickyColor } from '../../src/shared/config';

const RETRO_COLORS: StickyColor[] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];

const RETRO_TEXTS = [
  'What went well:\n- Shipped the new onboarding flow\n- Team velocity improved',
  'Blockers:\n- Waiting on design review\n- API rate limits hit twice',
  'Action items:\n- Schedule follow-up with infra team',
  'Great collaboration on the migration!\nEveryone pitched in during the outage window.',
  'Need better test coverage for the billing module.\nCurrent: 42%, Target: 80%',
  'Love the new dark mode feature. The contrast ratios are perfect now.',
  'Sprint 14 retrospective\nWent well: zero escalations, all P0s resolved within SLA',
  'Too many meetings on Tuesdays. Can we move standup to Wednesday and Friday only?',
  'The new CI pipeline cut build times from 12 minutes to 4. Huge win for the team!',
  'Documentation is outdated for the webhook integration. Several customers reported confusion.',
  'Shoutout to Maria for handling the production incident with such calm and clarity.',
  'Technical debt in the auth module is growing. We need to schedule a refactoring sprint.',
  'Customer feedback scores improved by 15 points this quarter.',
  'The pair programming sessions have been really productive. Learning a lot from Jordan.',
  'We should invest in better observability dashboards before the next launch.',
  'Sprint demo went great! Stakeholders loved the new analytics dashboard.',
  'On-call rotation feels unfair. Some people have 3 weekends while others have none.',
  'The new feature flag system is making rollouts much less stressful.',
  'Cross-team communication needs improvement. We keep finding out about API changes too late.',
  'Lunch-and-learn sessions are a highlight of the week. Great knowledge sharing.',
  'Need to migrate off the legacy storage system before Q3 deadline.',
  'The bug bash was fun and productive. Found 23 bugs in 2 hours.',
  'Code review turnaround has improved dramatically since we set the 24-hour SLA.',
  'Reminder: update the runbook with the new deployment procedure.',
  'The load test results look promising. We can handle 3x current traffic.',
];

/**
 * Generate a 25-note retro board with mixed colours, multi-line text, and overlapping stacking.
 */
export function generate25NoteBoard(): { doc: Y.Doc; update: Uint8Array } {
  const doc = new Y.Doc();
  initDoc(doc);

  for (let i = 0; i < 25; i++) {
    const x = (i % 5) * 250;
    const y = Math.floor(i / 5) * 280;
    const color = RETRO_COLORS[i % RETRO_COLORS.length]!;
    const id = createSticky(doc, { x, y }, color);
    // Move slightly for some notes to create overlap
    if (i % 3 === 0) {
      moveObject(doc, id, x + 50, y + 30);
    }
    // Add text
    const text = getStickyText(doc, id);
    if (text && RETRO_TEXTS[i]) {
      text.insert(0, RETRO_TEXTS[i]!);
    }
  }

  const update = Y.encodeStateAsUpdate(doc);
  return { doc, update };
}

/**
 * Generate a board with PERSIST_TESTED_NOTES notes for large board tests.
 */
export function generateLargeBoard(count: number = PERSIST_TESTED_NOTES): { doc: Y.Doc; update: Uint8Array } {
  const doc = new Y.Doc();
  initDoc(doc);

  // Realistic English phrases (10-300 chars) laid out in clusters
  const phrases = [
    'Review the quarterly report before the board meeting on Friday morning.',
    'The new employee onboarding checklist needs updating with the latest security protocols.',
    'Schedule a design review for the checkout flow redesign.',
    'Remember to submit expense reports by end of month.',
    'The API documentation for v2 endpoints is incomplete. Several response fields are missing descriptions.',
    'Team lunch on Thursday at the Italian place downtown. RSVP by Wednesday.',
    'Fix the timezone handling bug in the calendar widget. Reports coming from EU customers.',
    'The marketing team needs updated screenshots for the product page refresh.',
    'Investigate the memory leak in the background worker process.',
    'Draft the incident report from last Tuesday outage and share with leadership.',
    'The performance regression in search results was traced to the new indexing strategy.',
    'Book the conference room for the sprint planning session next Monday.',
    'Security audit findings: three low-severity items to address before release.',
    'Customer success team reports a spike in tickets related to the new import feature.',
    'The mobile app needs a hotfix for the crash on Android 14 devices.',
    'Plan the migration timeline for moving from PostgreSQL to the new database cluster.',
    'The feature flag for the new recommendation engine should be enabled gradually over two weeks.',
    'Legal team flagged a compliance issue with the data retention policy.',
    'The analytics dashboard numbers do not match the billing system output.',
    'Need to coordinate with the infrastructure team about the planned maintenance window.',
    'The localization files for Japanese and Korean translations are ready for review.',
    'Update the dependency versions to address the latest CVE disclosures.',
    'The A/B test results show a 12% improvement in conversion for the new landing page.',
    'Engineering retro: discuss the on-call escalation process improvements.',
    'The new hire starter kit needs to be prepared before the September cohort begins.',
  ];

  const colors: StickyColor[] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];

  for (let i = 0; i < count; i++) {
    // Cluster layout: 10 notes per row, clusters of 5 rows
    const cluster = Math.floor(i / 50);
    const inCluster = i % 50;
    const row = Math.floor(inCluster / 10);
    const col = inCluster % 10;
    const x = cluster * 3000 + col * 280;
    const y = row * 300;
    const color = colors[i % colors.length]!;

    const id = createSticky(doc, { x, y }, color);
    const text = getStickyText(doc, id);
    if (text) {
      const phrase = phrases[i % phrases.length]!;
      // Vary the text length for realism
      if (i % 7 === 0 && phrases[(i + 3) % phrases.length]) {
        text.insert(0, `${phrase} ${phrases[(i + 3) % phrases.length]}`);
      } else {
        text.insert(0, phrase);
      }
    }
  }

  const update = Y.encodeStateAsUpdate(doc);
  return { doc, update };
}

/** Return a copy of the update with its last `cut` bytes removed (undecodable). */
export function truncatedUpdate(update: Uint8Array, cut = 10): Uint8Array {
  return update.slice(0, Math.max(0, update.length - cut));
}

/**
 * Create random bytes of the same length as the given update.
 */
export function randomBytesOfSameLength(update: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(update.length);
  crypto.getRandomValues(bytes);
  return bytes;
}
