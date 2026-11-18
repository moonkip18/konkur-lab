import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, ensureSchemaMeta, loadSettings, saveSettings } from '../lib/db/db';
import { DEFAULT_SETTINGS, type AppSettings, type ExamRecord } from '../lib/db/models';
import { sortExams } from '../lib/db/examRepo';

interface AppState {
  ready: boolean;
  error: string | null;
  settings: AppSettings;
  exams: ExamRecord[];
  setSettings: (patch: Partial<AppSettings>) => Promise<void>;
  refresh: () => void;
}

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }): JSX.Element {
  const [settings, setSettingsState] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await db.open();
        await ensureSchemaMeta();
        const stored = await loadSettings();
        if (!cancelled) {
          if (stored) setSettingsState({ ...DEFAULT_SETTINGS, ...stored });
          setReady(true);
        }
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error
              ? `Local storage could not be opened: ${e.message}`
              : 'Local storage could not be opened.',
          );
          setReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const exams = useLiveQuery(() => db.exams.toArray().then(sortExams), [nonce], undefined);

  const setSettings = useCallback(
    async (patch: Partial<AppSettings>): Promise<void> => {
      const next = { ...settings, ...patch };
      setSettingsState(next);
      try {
        await saveSettings(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Settings could not be saved.');
      }
    },
    [settings],
  );

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  const value = useMemo<AppState>(
    () => ({
      ready,
      error,
      settings,
      exams: exams ?? [],
      setSettings,
      refresh,
    }),
    [ready, error, settings, exams, setSettings, refresh],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}