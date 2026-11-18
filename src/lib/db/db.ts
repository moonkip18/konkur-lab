import Dexie, { type Table, type Transaction } from 'dexie';
import {
  META_LAST_BACKUP_KEY,
  META_SCHEMA_KEY,
  SCHEMA_VERSION,
  type AppSettings,
  type AppSettingsRecord,
  type ExamRecord,
  type MetaRecord,
  SETTINGS_KEY,
} from './models';

export class KonkurDB extends Dexie {
  exams!: Table<ExamRecord, string>;
  settings!: Table<AppSettingsRecord, string>;
  meta!: Table<MetaRecord, string>;

  constructor(name = 'konkur-lab') {
    super(name);
    // Version 1 is the initial schema. Future changes must add version(2),
    // version(3), ... each with its own upgrade step; existing databases are
    // never deleted and rebuilt.
    this.version(1).stores({
      exams: 'id, date, status, provider',
      settings: 'key',
      meta: 'key',
    });
  }
}

export const db = new KonkurDB();

/** Writes the schema marker on first open so backups can be validated later. */
export async function ensureSchemaMeta(database: KonkurDB = db): Promise<void> {
  const existing = await database.meta.get(META_SCHEMA_KEY);
  if (existing?.value !== SCHEMA_VERSION) {
    await database.meta.put({ key: META_SCHEMA_KEY, value: SCHEMA_VERSION });
  }
}

export async function loadSettings(database: KonkurDB = db): Promise<AppSettings | null> {
  const row = await database.settings.get(SETTINGS_KEY);
  return (row?.value as AppSettings | undefined) ?? null;
}

export async function saveSettings(
  settings: AppSettings,
  database: KonkurDB = db,
): Promise<void> {
  await database.settings.put({ key: SETTINGS_KEY, value: settings });
}

export async function getLastBackupAt(database: KonkurDB = db): Promise<string | null> {
  const row = await database.meta.get(META_LAST_BACKUP_KEY);
  return typeof row?.value === 'string' ? row.value : null;
}

export async function setLastBackupAt(iso: string, database: KonkurDB = db): Promise<void> {
  await database.meta.put({ key: META_LAST_BACKUP_KEY, value: iso });
}

type TxMode = 'r' | 'rw';

/**
 * Runs `fn` inside a Dexie transaction over both tables. Dexie rolls the whole
 * transaction back on any thrown error, which is what lets import refuse to
 * leave a half-written database behind.
 */
export async function withTransaction<T>(
  fn: (tx: Transaction) => Promise<T>,
  database: KonkurDB = db,
  mode: TxMode = 'rw',
): Promise<T> {
  return database.transaction(mode, database.exams, database.settings, database.meta, fn);
}