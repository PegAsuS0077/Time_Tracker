import './ui/styles.css';
import { TrackerService, type ProviderFactory } from './app/services';
import { openTrackerDb, type TrackerDatabase } from './storage/idb';
import { IdbSettingsStore, LocalProvider } from './storage/LocalProvider';
import { MemoryProvider, MemorySettingsStore } from './storage/MemoryProvider';
import { mountApp } from './ui/app';
import { DataSection } from './ui/components/DataSection';

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
  const providerFactory: ProviderFactory = () => (db ? new LocalProvider(db) : memory);
  const settingsStore = db ? new IdbSettingsStore(db) : new MemorySettingsStore();
  const service = new TrackerService(settingsStore, providerFactory);

  mountApp(root, service, { settingsSections: [DataSection] });
  if (!db) {
    service.store.set({
      storageError:
        'This browser blocks local storage (private mode?). Entries will be lost when you close the tab.',
    });
  }
  await service.load();

  // Ask the browser not to evict our data under storage pressure.
  void navigator.storage.persist().catch(() => false);
}

void bootstrap();
