import { useEffect, useState } from 'react';
import { AppProvider, useApp } from './state/AppContext';
import { Dashboard } from './pages/Dashboard';
import { ApplyExam } from './pages/ApplyExam';
import { History } from './pages/History';
import { Statistics } from './pages/Statistics';
import { Subjects } from './pages/Subjects';
import { Settings } from './pages/Settings';
import { Note } from './components/primitives';

interface Tab {
  id: string;
  label: string;
  component: () => JSX.Element;
}

// Components are referenced, not instantiated: only the active page renders.
const TABS: Tab[] = [
  { id: 'dashboard', label: 'Dashboard', component: Dashboard },
  { id: 'apply', label: 'Apply Exam · ثبت آزمون', component: ApplyExam },
  { id: 'history', label: 'History', component: History },
  { id: 'statistics', label: 'Statistics · آمار', component: Statistics },
  { id: 'subjects', label: 'Subjects', component: Subjects },
  { id: 'settings', label: 'Settings', component: Settings },
];

type TabId = string;

function isTabId(value: string): value is TabId {
  return TABS.some((t) => t.id === value);
}

function Shell(): JSX.Element {
  const { ready, error } = useApp();
  const [tab, setTab] = useState<TabId>(() => {
    const hash = window.location.hash.replace('#', '');
    return isTabId(hash) ? hash : 'dashboard';
  });

  useEffect(() => {
    const onHashChange = (): void => {
      const hash = window.location.hash.replace('#', '');
      if (isTabId(hash)) setTab(hash);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const go = (id: TabId): void => {
    setTab(id);
    window.location.hash = id;
  };

  if (!ready) {
    return (
      <div className="app">
        <div className="page">
          <p className="faint small">Opening local storage…</p>
        </div>
      </div>
    );
  }

  const Active = (TABS.find((t) => t.id === tab) ?? TABS[0]!).component;

  return (
    <div className="app">
      <nav className="topnav" aria-label="Main">
        <span className="topnav-mark">
          <b>Konkur Progress Lab</b>
          <span>local · offline · private</span>
        </span>
        <div className="topnav-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              className="tab"
              role="tab"
              type="button"
              aria-current={t.id === tab ? 'page' : undefined}
              onClick={() => go(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      {error ? (
        <div style={{ padding: '16px 20px 0' }}>
          <div className="page" style={{ padding: 0, maxWidth: 'var(--page-max)' }}>
            <Note warn>
              <strong>Storage unavailable.</strong> {error} The app cannot save exams until this is
              resolved — check that the browser is not blocking IndexedDB for this site.
            </Note>
          </div>
        </div>
      ) : null}

      <Active />
    </div>
  );
}

export function App(): JSX.Element {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}

export default App;