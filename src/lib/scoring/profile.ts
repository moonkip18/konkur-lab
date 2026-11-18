import { DIFFICULTY_ORDER, type Difficulty } from './types';

export interface DifficultyAssumption {
  /** Share of attempted questions answered correctly, per difficulty band. */
  p: number;
  /** Share of questions attempted at all, per difficulty band. */
  a: number;
}

export interface ScoringProfile {
  version: string;
  label: string;
  createdAt: string;
  difficulty: Record<Difficulty, DifficultyAssumption>;
  /** Index at zero deviation from expectation. */
  A: number;
  /** Index points per standard deviation of performance. */
  B: number;
  /** Assumed spread (percentage points) of subject performance. */
  sigma: number;
  subjectCoefficients: { math: number; physics: number; chemistry: number };
  /** Optional free-text note describing the rationale / limitations. */
  note?: string;
}

/**
 * Profile v1. Every number here is a modelling assumption chosen by the app
 * author -- none of it is measured Maz or Sanjesh statistics, and nothing in
 * this profile is ever fitted to the user's own history.
 */
export const PROFILE_V1: ScoringProfile = {
  version: 'v1',
  label: 'Profile v1 (default assumptions)',
  createdAt: '2024-01-01T00:00:00.000Z',
  difficulty: {
    easy: { p: 0.85, a: 0.97 },
    medium: { p: 0.65, a: 0.88 },
    hard: { p: 0.25, a: 0.6 },
  },
  A: 5000,
  B: 2000,
  sigma: 15,
  subjectCoefficients: { math: 12, physics: 9, chemistry: 7 },
  note:
    'Fixed modelling assumptions. The p and a values are plausible guesses for a strong exam candidate, not observed Maz statistics. They apply to every exam identically.',
};

export function getProfile(version?: string): ScoringProfile {
  if (!version || version === PROFILE_V1.version) return PROFILE_V1;
  throw new Error(`Unknown scoring profile version: ${version}`);
}

export function totalCoefficient(profile: ScoringProfile): number {
  const c = profile.subjectCoefficients;
  return c.math + c.physics + c.chemistry;
}

/**
 * Expected net score per question, including unattempted questions:
 *   mu_d = a_d * (p_d - (1 - p_d) / 3)
 * Hard's zero is a consequence of the +1 / -1/3 marking rule under a = 0.60,
 * not a claim that hard questions are worth zero.
 */
export function expectedNetPerQuestion(
  difficulty: Difficulty,
  profile: ScoringProfile = PROFILE_V1,
): number {
  const { p, a } = profile.difficulty[difficulty];
  return a * (p - (1 - p) / 3);
}

/** Expected net per question for every band, as a percentage (0..100). */
export function expectedNetPercentages(
  profile: ScoringProfile = PROFILE_V1,
): Record<Difficulty, number> {
  const out = {} as Record<Difficulty, number>;
  for (const d of DIFFICULTY_ORDER) out[d] = 100 * expectedNetPerQuestion(d, profile);
  return out;
}

export interface ProfileValidationIssue {
  field: string;
  message: string;
}

export function validateProfile(profile: ScoringProfile): ProfileValidationIssue[] {
  const issues: ProfileValidationIssue[] = [];
  const finite = (v: number): boolean => Number.isFinite(v);

  if (typeof profile.version !== 'string' || profile.version.trim() === '') {
    issues.push({ field: 'version', message: 'Profile version must be a non-empty string.' });
  }
  for (const d of DIFFICULTY_ORDER) {
    const entry = profile.difficulty?.[d];
    if (!entry) {
      issues.push({ field: `difficulty.${d}`, message: `Missing difficulty band: ${d}.` });
      continue;
    }
    if (!finite(entry.p) || entry.p < 0 || entry.p > 1) {
      issues.push({ field: `difficulty.${d}.p`, message: `p for ${d} must be between 0 and 1.` });
    }
    if (!finite(entry.a) || entry.a < 0 || entry.a > 1) {
      issues.push({ field: `difficulty.${d}.a`, message: `a for ${d} must be between 0 and 1.` });
    }
  }
  if (!finite(profile.A)) issues.push({ field: 'A', message: 'A must be a finite number.' });
  if (!finite(profile.B)) issues.push({ field: 'B', message: 'B must be a finite number.' });
  if (!finite(profile.sigma) || profile.sigma === 0) {
    issues.push({ field: 'sigma', message: 'sigma must be a finite non-zero number.' });
  }
  const c = profile.subjectCoefficients;
  if (!c) {
    issues.push({ field: 'subjectCoefficients', message: 'Missing subject coefficients.' });
  } else {
    for (const key of ['math', 'physics', 'chemistry'] as const) {
      const value = c[key];
      if (typeof value !== 'number' || !finite(value)) {
        issues.push({ field: `subjectCoefficients.${key}`, message: `Coefficient ${key} must be a finite number.` });
      }
    }
    const sum = (c.math ?? NaN) + (c.physics ?? NaN) + (c.chemistry ?? NaN);
    if (finite(sum) && sum === 0) {
      issues.push({
        field: 'subjectCoefficients',
        message: 'Subject coefficients must not sum to zero.',
      });
    }
  }
  return issues;
}

/** Throws when the profile cannot produce finite scores. */
export function assertValidProfile(profile: ScoringProfile): void {
  const issues = validateProfile(profile);
  if (issues.length > 0) {
    throw new Error(`Invalid scoring profile: ${issues.map((i) => `${i.field} ${i.message}`).join(' ')}`);
  }
}