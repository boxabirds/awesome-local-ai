// Theme colour tokens: the single source of colour for every story. apps/web/scripts/build-tokens.ts
// generates apps/web/src/styles/tokens.css from this file; the contrast tests read it directly.

import { PROJECT_COLORS, type ProjectColorKey } from './limits.ts';

export type Theme = 'light' | 'dark';

export const SEMANTIC_TOKENS = [
  'background',
  'foreground',
  'muted',
  'muted-foreground',
  'primary',
  'primary-foreground',
  'destructive',
  'border',
  'ring',
  'warning',
  'success',
] as const;
export type SemanticToken = (typeof SEMANTIC_TOKENS)[number];

export const TOKENS: Record<Theme, Record<SemanticToken, string>> = {
  light: {
    background: '#ffffff',
    foreground: '#171717',
    muted: '#f4f4f5',
    'muted-foreground': '#52525b',
    primary: '#1d4ed8',
    'primary-foreground': '#ffffff',
    destructive: '#b91c1c',
    border: '#8a8a93',
    ring: '#2563eb',
    warning: '#a14b05',
    success: '#15803d',
  },
  dark: {
    background: '#0a0a0a',
    foreground: '#fafafa',
    muted: '#262626',
    'muted-foreground': '#a3a3a3',
    primary: '#93c5fd',
    'primary-foreground': '#0a0a0a',
    destructive: '#f87171',
    border: '#6b6b73',
    ring: '#60a5fa',
    warning: '#fbbf24',
    success: '#4ade80',
  },
};

/** The 12 project colours (story 7): keys, labels and values live in limits.ts PROJECT_COLORS. */
export type ProjectColor = ProjectColorKey;

export const PROJECT_COLOR_TOKENS: Record<Theme, Record<ProjectColor, string>> = {
  light: Object.fromEntries(PROJECT_COLORS.map((color) => [color.key, color.light])) as Record<ProjectColor, string>,
  dark: Object.fromEntries(PROJECT_COLORS.map((color) => [color.key, color.dark])) as Record<ProjectColor, string>,
};

/** Pairs that carry text: [foreground, background], each must reach 4.5:1. */
export const TEXT_PAIRS: ReadonlyArray<readonly [SemanticToken, SemanticToken]> = [
  ['foreground', 'background'],
  ['foreground', 'muted'],
  ['muted-foreground', 'background'],
  ['muted-foreground', 'muted'],
  ['primary-foreground', 'primary'],
  ['destructive', 'background'],
  ['warning', 'background'],
  ['success', 'background'],
];

/** UI boundaries (borders, focus rings, filled controls) against the page: each must reach 3:1. */
export const UI_PAIRS: ReadonlyArray<readonly [SemanticToken, SemanticToken]> = [
  ['border', 'background'],
  ['ring', 'background'],
  ['ring', 'muted'],
  ['primary', 'background'],
];

/** CSS custom property name for a project colour. */
export function projectColorVar(color: ProjectColor): string {
  return `--project-${color}`;
}

// ---------------------------------------------------------------- story 8: due date chips

/** Date chip tones (prd.date_chip): overdue red, today green, tomorrow orange, anything else neutral. */
export const CHIP_TONES = ['overdue', 'today', 'tomorrow', 'neutral'] as const;
export type ChipToneToken = (typeof CHIP_TONES)[number];

/**
 * Chip text colours per theme. Each is at least 4.5:1 (WCAG AA text) against the row background and the muted
 * surface a selected or hovered row sits on (TC-110): light vs #ffffff/#f4f4f5 — overdue 6.47/5.89,
 * today 5.02/4.56, tomorrow 5.18/4.71, neutral 7.73/7.03; dark vs #0a0a0a/#262626 — overdue 7.16/5.47,
 * today 11.36/8.68, tomorrow 8.75/6.69, neutral 8.08/6.18. Colour is never the only signal: overdue chips also
 * carry words and a warning icon.
 */
export const CHIP_TOKENS: Record<Theme, Record<ChipToneToken, string>> = {
  light: { overdue: '#b91c1c', today: '#15803d', tomorrow: '#c2410c', neutral: '#52525b' },
  dark: { overdue: '#f87171', today: '#4ade80', tomorrow: '#fb923c', neutral: '#a3a3a3' },
};

/** CSS custom property name for a chip tone ('--chip-overdue'). */
export function chipToneVar(tone: ChipToneToken): string {
  return `--chip-${tone}`;
}
