import type {
  AnswerMap,
  ExamScoreResult,
  ExamStatus,
  ScoringProfile,
  SubjectId,
} from '../scoring';

/** Current on-disk schema. Bump alongside a migration in db.ts. */
export const SCHEMA_VERSION = 1;

/** Snapshot of the subject layout an exam was scored against. */
export interface SubjectLayoutSnapshot {
  id: SubjectId;
  nameEn: string;
  nameFa: string;
  startQuestion: number;
  endQuestion: number;
  questionCount: number;
  coefficient: number;
}

export interface ExamRecord {
  id: string;
  /** ISO Gregorian, YYYY-MM-DD. */
  date: string;
  provider: string;
  status: ExamStatus;
  notes: string;
  answers: AnswerMap;
  /** Profile the stored result was computed with. */
  profileVersion: string;
  profileSnapshot: ScoringProfile;
  engineVersion: string;
  /** Frozen result for completed exams; null for drafts. */
  result: ExamScoreResult | null;
  subjectLayout: SubjectLayoutSnapshot[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  /** Increments each time a completed exam is explicitly reopened. */
  revision: number;
}

export interface AppSettingsRecord {
  key: string;
  value: unknown;
}

export interface MetaRecord {
  key: string;
  value: unknown;
}

export const SETTINGS_KEY = 'settings';
export const META_SCHEMA_KEY = 'schemaVersion';
export const META_LAST_BACKUP_KEY = 'lastBackupAt';

export interface AppSettings {
  /** 'gregorian' | 'jalali' -- display only; storage is always ISO. */
  dateDisplay: 'gregorian' | 'jalali';
  /** Days between backup reminders. */
  backupReminderDays: number;
  defaultProvider: string;
  /** Days between mock exams, used only to suggest the next date. */
  examIntervalDays: number;
  includeArchivedInTrends: boolean;
  activeProfileVersion: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  dateDisplay: 'gregorian',
  backupReminderDays: 14,
  defaultProvider: 'Maz',
  examIntervalDays: 14,
  includeArchivedInTrends: false,
  activeProfileVersion: 'v1',
};

/** Metadata written into every JSON backup. */
export interface BackupMetadata {
  app: string;
  schemaVersion: number;
  engineVersion: string;
  exportedAt: string;
  examCount: number;
}