import './ui/styles.css';
import { TrackerService, type ProviderFactory } from './app/services';
import {
  createGitHubProvider,
  isSyncConfigured,
  testGitHubConnection,
} from './storage/github/connect';
import { openTrackerDb, type TrackerDatabase } from './storage/idb';
import { IdbSettingsStore, LocalProvider } from './storage/LocalProvider';
import { MemoryProvider, MemorySettingsStore } from './storage/MemoryProvider';
import { mountApp } from './ui/app';
import { DataSection } from './ui/components/DataSection';
import { SyncBadge } from './ui/components/SyncBadge';
import { SyncSection } from './ui/components/SyncSection';

async function bootstrap(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) return;

  let db: TrackerDatabase | null = null;
  try {
    db = await openTrackerDb();
  } catch (error) {
    console.error('IndexedDB unavailable', error);
  }

  const memory = new MemoryProvider();
  const providerFactory: ProviderFactory = (settings) => {
    if (!db) return memory;
    return isSyncConfigured(settings.sync)
      ? createGitHubProvider(db, settings.sync)
      : new LocalProvider(db);
  };
  const settingsStore = db ? new IdbSettingsStore(db) : new MemorySettingsStore();
  const service = new TrackerService(
    settingsStore,
    providerFactory,
    Date.now,
    testGitHubConnection,
  );

  mountApp(root, service, {
    settingsSections: [DataSection, SyncSection],
    headerExtras: [SyncBadge],
  });
  if (!db) {
    service.store.set({
      storageError:
        'This browser blocks local storage (private mode?). Entries will be lost when you close the tab.',
    });
  }
  // Pull on open.
  await service.load();

  // Flush queued writes when connectivity returns or the app comes back to the foreground.
  window.addEventListener('online', () => {
    void service.sync();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void service.sync();
  });

  // Ask the browser not to evict our data under storage pressure.
  if ('storage' in navigator && 'persist' in navigator.storage) {
    void navigator.storage.persist().catch(() => false);
  }
}

void bootstrap();
