/**
 * JSON backup format.
 *
 * A backup carries everything needed to reproduce the stored numbers: the raw
 * answer inputs, the subject layout, the profile snapshot, the engine version,
 * and the stored result itself. Recomputing from inputs alone must match the
 * stored result, and `verifyBackup` checks exactly that before anything is
 * written to the database.
 */
import { SCORING_ENGINE_VERSION, isValidIsoDate, scoreExam, validateExam } from '../scoring';
import type { AnswerMap, ExamStatus } from '../scoring';
import { SCHEMA_VERSION, type BackupMetadata, type ExamRecord } from './models';

export interface BackupFile {
  metadata: BackupMetadata;
  settings?: unknown;
  profiles?: unknown[];
  exams: ExamRecord[];
}

export const BACKUP_APP_ID = 'konkur-progress-lab';

export function buildBackup(
  exams: ExamRecord[],
  options: { settings?: unknown; profiles?: unknown[]; now?: Date } = {},
): BackupFile {
  const now = options.now ?? new Date();
  return {
    metadata: {
      app: BACKUP_APP_ID,
      schemaVersion: SCHEMA_VERSION,
      engineVersion: SCORING_ENGINE_VERSION,
      exportedAt: now.toISOString(),
      examCount: exams.length,
    },
    settings: options.settings,
    profiles: options.profiles,
    exams,
  };
}

export function serialiseBackup(backup: BackupFile): string {
  return `${JSON.stringify(backup, null, 2)}\n`;
}

export interface BackupIssue {
  examId?: string;
  examIndex?: number;
  message: string;
  severity: 'error' | 'warning';
}

export interface BackupValidation {
  ok: boolean;
  file: BackupFile | null;
  errors: BackupIssue[];
  warnings: BackupIssue[];
  examCount: number;
  questionRecords: number;
  duplicateDates: { date: string; provider: string; count: number }[];
  engineMismatch: boolean;
  schemaMismatch: boolean;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && isValidIsoDate(value);
}

/**
 * Full validation of a parsed backup. Nothing here touches the database; the
 * caller decides whether to commit only after this returns.
 */
export function validateBackup(input: unknown): BackupValidation {
  const errors: BackupIssue[] = [];
  const warnings: BackupIssue[] = [];

  const base: BackupValidation = {
    ok: false,
    file: null,
    errors,
    warnings,
    examCount: 0,
    questionRecords: 0,
    duplicateDates: [],
    engineMismatch: false,
    schemaMismatch: false,
  };

  if (typeof input !== 'object' || input === null) {
    errors.push({ message: 'File is not a JSON object.', severity: 'error' });
    return base;
  }
  const candidate = input as Partial<BackupFile>;

  if (candidate.metadata?.app !== BACKUP_APP_ID) {
    errors.push({
      message: `Not a Konkur Progress Lab backup (expected app id "${BACKUP_APP_ID}").`,
      severity: 'error',
    });
  }
  if (typeof candidate.exams !== 'object' || candidate.exams === null) {
    errors.push({ message: 'Backup has no "exams" array.', severity: 'error' });
    return base;
  }

  base.schemaMismatch = candidate.metadata?.schemaVersion !== SCHEMA_VERSION;
  base.engineMismatch = candidate.metadata?.engineVersion !== SCORING_ENGINE_VERSION;
  if (base.schemaMismatch) {
    warnings.push({
      message: `Backup schema version ${String(candidate.metadata?.schemaVersion)} differs from app version ${SCHEMA_VERSION}.`,
      severity: 'warning',
    });
  }
  if (base.engineMismatch) {
    warnings.push({
      message: `Backup scoring engine ${String(candidate.metadata?.engineVersion)} differs from ${SCORING_ENGINE_VERSION}. Stored results are imported as-is and are not silently recalculated.`,
      severity: 'warning',
    });
  }

  const exams = candidate.exams as ExamRecord[];
  base.examCount = exams.length;

  const seenIds = new Set<string>();
  const dateKey = new Map<string, number>();

  exams.forEach((exam, index) => {
    const label = (e: ExamWriteIssue): BackupIssue => ({ ...e, examIndex: index, severity: 'error' });
    if (typeof exam?.id !== 'string' || exam.id === '') {
      errors.push(label({ message: `Exam at index ${index} has no id.` }));
      return;
    }
    if (seenIds.has(exam.id)) {
      errors.push(
        label({ examId: exam.id, message: `Duplicate exam id "${exam.id}" inside the file.` }),
      );
      return;
    }
    seenIds.add(exam.id);

    if (!isIsoDate(exam.date)) {
      errors.push(
        label({ examId: exam.id, message: `Exam "${exam.id}" has an invalid date: ${String(exam.date)}.` }),
      );
    }
    if (typeof exam.provider !== 'string' || exam.provider.trim() === '') {
      errors.push(label({ examId: exam.id, message: `Exam "${exam.id}" has no provider.` }));
    }
    if (!['draft', 'completed', 'archived'].includes(exam.status as ExamStatus)) {
      errors.push(
        label({ examId: exam.id, message: `Exam "${exam.id}" has an unknown status "${String(exam.status)}".` }),
      );
    }
    if (typeof exam.answers !== 'object' || exam.answers === null) {
      errors.push(label({ examId: exam.id, message: `Exam "${exam.id}" has no answers object.` }));
      return;
    }

    const answers = exam.answers as AnswerMap;
    const questionNumbers = Object.keys(answers).map(Number).filter(Number.isFinite);
    base.questionRecords += questionNumbers.length;
    if (questionNumbers.length !== 95) {
      warnings.push({
        examId: exam.id,
        examIndex: index,
        message: `Exam "${exam.id}" holds ${questionNumbers.length} question records (expected 95).`,
        severity: 'warning',
      });
    }
    const outOfRange = questionNumbers.filter((q) => q < 1 || q > 95);
    if (outOfRange.length > 0) {
      errors.push(
        label({
          examId: exam.id,
          message: `Exam "${exam.id}" has out-of-range question numbers: ${outOfRange.join(', ')}.`,
        }),
      );
    }

    const validation = validateExam({
      date: exam.date,
      provider: exam.provider,
      answers,
      profile: exam.profileSnapshot,
    });
    if (!validation.ok && exam.status !== 'draft') {
      errors.push(
        label({
          examId: exam.id,
          message: `Exam "${exam.id}" is ${exam.status} but fails validation (${validation.issues.length} issue(s), e.g. ${validation.issues[0]?.message ?? ''}).`,
        }),
      );
    }

    if (exam.status === 'completed') {
      if (!exam.result) {
        errors.push(
          label({ examId: exam.id, message: `Completed exam "${exam.id}" has no stored result.` }),
        );
      } else {
        // Reproducibility: the stored result must be derivable from the inputs.
        try {
          const recomputed = scoreExam({
            date: exam.date,
            provider: exam.provider,
            answers,
            profile: exam.profileSnapshot,
          });
          if (
            Math.abs(recomputed.raw.weightedRawScore - exam.result.raw.weightedRawScore) > 1e-9 ||
            Math.abs(recomputed.adjusted.overallIndex - exam.result.adjusted.overallIndex) > 1e-9
          ) {
            errors.push(
              label({
                examId: exam.id,
                message: `Exam "${exam.id}" stored result does not match its own inputs.`,
              }),
            );
          }
        } catch (error) {
          errors.push(
            label({
              examId: exam.id,
              message: `Exam "${exam.id}" could not be rescored: ${(error as Error).message}`,
            }),
          );
        }
      }
    }

    const key = `${exam.date}|${exam.provider}`;
    dateKey.set(key, (dateKey.get(key) ?? 0) + 1);
  });

  base.duplicateDates = [...dateKey.entries()]
    .filter(([, count]) => count > 1)
    .map(([key, count]) => {
      const [date, provider] = key.split('|');
      return { date: date ?? '', provider: provider ?? '', count };
    });

  base.ok = errors.length === 0;
  base.file = base.ok ? (input as BackupFile) : null;
  return base;
}

export interface ExamWriteIssue extends Omit<BackupIssue, 'severity' | 'examIndex'> {}

export function parseBackup(text: string): { file: BackupFile | null; errors: BackupIssue[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      file: null,
      errors: [{ message: `File is not valid JSON: ${(error as Error).message}`, severity: 'error' }],
    };
  }
  const validation = validateBackup(parsed);
  return { file: validation.file, errors: validation.errors };
}