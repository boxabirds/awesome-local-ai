/**
 * Test fixtures: realistic board generators using the real board-model functions.
 *
 * - 25-note retro board with mixed colours, multi-line texts, overlapping stacking
 * - PERSIST_TESTED_NOTES-note board with realistic English phrases in clusters
 * - Damaged bytes: truncated update and same-length random bytes
 */

import * as Y from 'yjs';
import { createSticky, moveObject, setStickyColor, getStickyText } from '../../src/shared/board-model';
import type { StickyColor } from '../../src/shared/config';
import { PERSIST_TESTED_NOTES } from '../../src/shared/config';

const COLORS: StickyColor[] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];

const PHRASES = [
  'What are the key risks?',
  'How do we measure success here?',
  'Can we ship this by Friday?',
  'Need more context on the API design',
  'The user flow feels clunky at step 3',
  'Let\'s sync up tomorrow morning',
  'This needs a better error message',
  'What if we just remove this feature?',
  'Performance is way too slow on mobile',
  'The onboarding drops off at step 2',
  'We should A/B test this approach',
  'Security review is blocking launch',
  'Can we get design feedback on this?',
  'The data model doesn\'t scale well',
  'Users are confused by the navigation',
  'This breaks the existing integration',
  'We need to handle the edge case here',
  'The loading state is way too long',
  'Let\'s simplify the settings page',
  'This is a critical bug for production',
  'The search results are not relevant',
  'We should add pagination here',
  'The form validation is too strict',
  'Accessibility issues with the modal',
  'The dark mode contrast is insufficient',
  'Caching strategy needs rethinking',
  'The webhook retries are too aggressive',
  'Rate limiting is causing false positives',
  'The mobile layout breaks at 375px',
  'We need better logging for debugging',
  'The state management is getting complex',
  'Type safety is missing in this module',
  'The test coverage dropped below 80%',
  'Memory leak in the websocket handler',
  'The build time is unacceptable',
  'Dependency audit found 3 vulnerabilities',
  'The API contract is not versioned',
  'Error handling is inconsistent across services',
  'The database migration is too risky',
  'We need a feature flag for this',
  'The client-side validation is duplicated',
  'The internationalization is incomplete',
  'The image optimization is not working',
  'The service worker cache is stale',
  'The cookie consent is not GDPR compliant',
  'The accessibility audit found 12 issues',
  'The responsive breakpoints are wrong',
  'The animation causes jank on low-end devices',
  'The form autosave is not reliable',
  'The notification system is spammable',
  'The audit trail is missing timestamps',
  'The role-based access is too permissive',
  'The data export is missing fields',
  'The import wizard is too complex',
  'The bulk edit is not atomic',
  'The undo stack is not persisted',
  'The keyboard shortcuts conflict',
  'The focus trap is broken in the dialog',
  'The screen reader announces wrong labels',
  'The color scheme fails WCAG AA',
  'The touch targets are too small',
  'The scroll behavior is janky',
  'The lazy loading causes layout shift',
  'The prefetch strategy wastes bandwidth',
  'The offline mode loses data',
  'The sync conflicts are not resolved',
  'The crash reporting is not actionable',
  'The performance budget is exceeded',
  'The bundle size is too large',
  'The code splitting is not optimal',
  'The tree shaking is not working',
  'The sourcemaps are not uploaded',
  'The CI pipeline is too slow',
  'The deploy strategy has no rollback',
  'The monitoring alerts are too noisy',
  'The dashboards are not real-time',
  'The SLA is not being met',
  'The incident response is too slow',
  'The postmortem is not actionable',
  'The runbook is outdated',
  'The on-call rotation is unfair',
  'The escalation path is unclear',
  'The status page is not accurate',
  'The changelog is inconsistent',
  'The release notes are missing',
  'The deprecation policy is unclear',
  'The migration guide is incomplete',
  'The API documentation is outdated',
  'The SDK examples don\'t compile',
  'The community support is slow',
  'The enterprise features are missing',
  'The pricing model is confusing',
  'The trial conversion is low',
  'The churn rate is too high',
  'The NPS is declining',
  'The feature requests are piling up',
  'The roadmap is not communicated',
  'The customer success is reactive',
  'The sales enablement is weak',
  'The marketing messages are inconsistent',
  'The brand guidelines are not followed',
  'The content strategy is unclear',
  'The SEO is not optimized',
  'The social media is inactive',
  'The email campaigns are ineffective',
  'The landing page conversion is low',
  'The paywall is too aggressive',
  'The upgrade path is confusing',
  'The cancellation flow is hostile',
  'The refund policy is unclear',
  'The support tickets are piling up',
  'The knowledge base is outdated',
  'The community forum is dead',
  'The developer experience is poor',
  'The CLI is not intuitive',
  'The configuration is too complex',
  'The plugins are not discoverable',
  'The extensions break often',
  'The themes are not customizable',
  'The integrations are missing',
  'The webhooks are unreliable',
  'The API rate limits are too low',
  'The authentication is not secure',
  'The authorization is too broad',
  'The data retention is unclear',
  'The privacy policy is too long',
  'The terms of service are confusing',
  'The cookie policy is outdated',
  'The accessibility statement is missing',
  'The security policy is not public',
  'The bug bounty is not active',
  'The responsible disclosure is unclear',
  'The incident communication is slow',
  'The post-incident review is missing',
  'The security training is outdated',
  'The password policy is too weak',
  'The MFA is not enforced',
  'The session timeout is too long',
  'The API keys are not rotated',
  'The secrets are in the repository',
  'The dependencies are not audited',
  'The supply chain is not verified',
  'The build artifacts are not signed',
  'The deployment is not automated',
  'The rollback is not tested',
  'The canary is not monitored',
  'The blue-green is not atomic',
  'The database is not replicated',
  'The cache is not invalidated',
  'The CDN is not configured',
  'The DNS is not failover',
  'The load balancer is not healthy',
  'The autoscaling is not responsive',
  'The spot instances are not handled',
  'The reserved capacity is not optimized',
  'The cost allocation is unclear',
  'The budget alerts are not set',
  'The waste is not identified',
  'The rightsizing is not done',
  'The tag strategy is missing',
  'The governance is not enforced',
  'The compliance is not audited',
  'The audit logs are not retained',
  'The access reviews are not done',
  'The least privilege is not applied',
  'The network segmentation is missing',
  'The encryption is not end-to-end',
  'The key management is not automated',
  'The certificate rotation is manual',
  'The vulnerability scanning is not continuous',
  'The penetration testing is annual',
  'The threat modeling is not done',
  'The risk assessment is outdated',
  'The business continuity is not tested',
  'The disaster recovery is not verified',
  'The backup is not restored',
  'The RTO is not met',
  'The RPO is not met',
  'The failover is not tested',
  'The data loss is not measured',
  'The service degradation is not detected',
  'The dependency failures are not handled',
  'The circuit breaker is not configured',
  'The retry logic is not exponential',
  'The backoff is not jittered',
  'The timeout is not propagated',
  'The deadline is not enforced',
  'The priority is not inherited',
  'The cancellation is not cooperative',
  'The context is not passed',
  'The trace is not continuous',
  'The metrics are not correlated',
  'The logs are not structured',
  'The alerts are not actionable',
  'The dashboards are not shared',
  'The SLO is not defined',
  'The error budget is not tracked',
  'The reliability is not measured',
  'The availability is not guaranteed',
  'The consistency is not ensured',
  'The durability is not verified',
  'The scalability is not proven',
  'The portability is not tested',
  'The interoperability is not checked',
  'The compatibility is not maintained',
  'The backward compatibility is broken',
  'The forward compatibility is unclear',
  'The deprecation is not planned',
  'The migration is not automatic',
  'The upgrade is not seamless',
  'The downgrade is not supported',
  'The rollback is not possible',
  'The compatibility matrix is missing',
  'The supported versions are unclear',
  'The end-of-life is not communicated',
  'The security patches are not timely',
  'The bug fixes are not prioritized',
  'The feature development is not aligned',
  'The technical debt is not managed',
  'The code quality is not enforced',
  'The code review is not thorough',
  'The testing is not comprehensive',
  'The documentation is not complete',
  'The onboarding is not smooth',
  'The training is not effective',
  'The mentoring is not structured',
  'The career path is not clear',
  'The compensation is not competitive',
  'The benefits are not attractive',
  'The culture is not inclusive',
  'The diversity is not represented',
  'The equity is not addressed',
  'The belonging is not fostered',
  'The growth is not supported',
  'The recognition is not given',
  'The feedback is not regular',
  'The goals are not aligned',
  'The OKRs are not measurable',
  'The KPIs are not tracked',
  'The metrics are not meaningful',
  'The data is not accurate',
  'The reporting is not timely',
  'The analysis is not actionable',
  'The insights are not shared',
  'The decisions are not data-driven',
  'The experiments are not rigorous',
  'The hypotheses are not tested',
  'The results are not significant',
  'The sample size is not adequate',
  'The bias is not controlled',
  'The confounders are not addressed',
  'The causality is not established',
  'The generalizability is not ensured',
  'The reproducibility is not guaranteed',
  'The transparency is not maintained',
  'The ethics are not considered',
  'The privacy is not protected',
  'The consent is not obtained',
  'The anonymization is not sufficient',
  'The aggregation is not appropriate',
  'The minimization is not applied',
  'The purpose limitation is not respected',
  'The data quality is not ensured',
  'The data governance is not established',
  'The data lifecycle is not managed',
  'The data ownership is not clear',
  'The data sharing is not controlled',
  'The data breach is not prevented',
  'The data loss is not recovered',
  'The data corruption is not detected',
  'The data inconsistency is not resolved',
  'The data duplication is not eliminated',
  'The data obsolescence is not archived',
  'The data disposal is not secure',
  'The data retention is not compliant',
  'The data portability is not enabled',
  'The data erasure is not honored',
  'The data access is not restricted',
  'The data modification is not tracked',
  'The data creation is not logged',
  'The data use is not monitored',
  'The data transfer is not encrypted',
  'The data storage is not secured',
  'The data processing is not lawful',
  'The data handling is not responsible',
  'The data stewardship is not assigned',
  'The data accountability is not defined',
  'The data liability is not allocated',
  'The data sovereignty is not respected',
  'The data jurisdiction is not compliant',
  'The data localization is not met',
  'The data residency is not ensured',
  'The data jurisdiction is not clear',
  'The data governance is not enforced',
  'The data policy is not followed',
  'The data standard is not applied',
  'The data model is not normalized',
  'The data schema is not versioned',
  'The data migration is not tested',
  'The data validation is not enforced',
  'The data quality is not measured',
  'The data integrity is not maintained',
  'The data consistency is not guaranteed',
  'The data availability is not ensured',
  'The data reliability is not verified',
  'The data accuracy is not confirmed',
  'The data completeness is not checked',
  'The data timeliness is not monitored',
  'The data uniqueness is not enforced',
  'The data validity is not verified',
  'The data conformance is not ensured',
  'The data richness is not assessed',
  'The data accessibility is not guaranteed',
  'The data usability is not evaluated',
  'The data interpretability is not ensured',
  'The data presentability is not maintained',
  'The data trustworthiness is not established',
  'The data contextuality is not considered',
  'The data value is not maximized',
  'The data utility is not optimized',
  'The data relevance is not ensured',
  'The data sufficiency is not verified',
  'The data economy is not achieved',
  'The data consistency is not maintained',
  'The data timeliness is not ensured',
  'The data accuracy is not guaranteed',
  'The data completeness is not verified',
];

/**
 * Generate a 25-note retro board with mixed colours, multi-line texts,
 * and overlapping stacking. Returns the doc and the list of note ids.
 */
export function generateRetroBoard(doc: Y.Doc): string[] {
  const ids: string[] = [];
  for (let i = 0; i < 25; i++) {
    const x = 100 + (i % 5) * 220 + Math.floor(i / 5) * 30;
    const y = 100 + Math.floor(i / 5) * 230;
    const id = createSticky(doc, { x, y }, COLORS[i % COLORS.length]);
    ids.push(id);
    // Add text
    const text = getStickyText(doc, id);
    if (text) {
      const phrase = PHRASES[i % PHRASES.length];
      text.insert(0, phrase);
      // Some notes get multi-line text
      if (i % 3 === 0) {
        text.insert(text.length, '\nSecond line of thought');
      }
    }
    // Some notes get moved (creating overlapping stacking)
    if (i % 4 === 0 && i > 0) {
      moveObject(doc, id, x + 50, y + 20);
    }
  }
  return ids;
}

/**
 * Generate a PERSIST_TESTED_NOTES-note board with realistic phrases in clusters.
 */
export function generateLargeBoard(doc: Y.Doc): void {
  const clusterSize = 20;
  const clusters = Math.ceil(PERSIST_TESTED_NOTES / clusterSize);
  for (let i = 0; i < PERSIST_TESTED_NOTES; i++) {
    const cluster = Math.floor(i / clusterSize);
    const inCluster = i % clusterSize;
    const cx = cluster * 800;
    const cy = Math.floor(cluster / 4) * 800;
    const x = cx + (inCluster % 5) * 220;
    const y = cy + Math.floor(inCluster / 5) * 230;
    const id = createSticky(doc, { x, y }, COLORS[i % COLORS.length]);
    const text = getStickyText(doc, id);
    if (text) {
      text.insert(0, PHRASES[i % PHRASES.length]);
    }
  }
}

/**
 * Create a truncated (damaged) version of an update: last 10 bytes removed.
 */
export function truncateUpdate(update: Uint8Array): Uint8Array {
  if (update.byteLength <= 10) return new Uint8Array(0);
  return update.subarray(0, update.byteLength - 10);
}

/**
 * Create random bytes of the same length as the input.
 */
export function randomBytesSameLength(update: Uint8Array): Uint8Array {
  const result = new Uint8Array(update.byteLength);
  for (let i = 0; i < result.length; i++) {
    result[i] = Math.floor(Math.random() * 256);
  }
  return result;
}
