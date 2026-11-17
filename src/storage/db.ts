import { openDB, type IDBPDatabase } from 'idb';
import { STORAGE_KEYS, GAME_VERSION } from '../game/config';
import { defaultProfile, defaultSettings } from '../game/types';
import type { Checkpoint, Profile, Settings } from '../game/types';

/**
 * IndexedDB persistence.
 *
 * One database, three small stores. Everything is optional-read: a missing
 * record falls back to defaults rather than throwing, so a first run, a
 * private-mode browser and a corrupted store all degrade to "fresh game"
 * instead of a blank canvas.
 */

const DB_NAME = 'pig-legends';
const DB_VERSION = 1;

const STORE_META = 'meta';
const STORE_SETTINGS = 'settings';
const STORE_PROFILE = 'profile';
const STORE_CHECKPOINT = 'checkpoint';

let dbPromise: Promise<IDBPDatabase> | null = null;
/** Last known good state, so a failed write never leaves the UI unsynced. */
let memoryFallback: {
  settings: Settings;
  profile: Profile;
  checkpoint: Checkpoint | null;
} = { settings: { ...defaultSettings }, profile: { ...defaultProfile }, checkpoint: null };

let dbAvailable = true;

function getDb(): Promise<IDBPDatabase> | null {
  if (!dbAvailable) return null;
  if (!dbPromise) {
    try {
      dbPromise = openDB(DB_NAME, DB_VERSION, {
        // Inside `upgrade` the database is locked by the versionchange
        // transaction. `db.put()` starts a *second* readwrite transaction and
        // IndexedDB rejects it outright — "A version change transaction is
        // running" — which on the first launch of a fresh install kills the
        // very write it was meant to perform. The upgrade's own transaction is
        // the only one allowed to touch stores here.
        upgrade(db, oldVersion, _newVersion, tx) {
          if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META);
          if (!db.objectStoreNames.contains(STORE_SETTINGS)) db.createObjectStore(STORE_SETTINGS);
          if (!db.objectStoreNames.contains(STORE_PROFILE)) db.createObjectStore(STORE_PROFILE);
          if (!db.objectStoreNames.contains(STORE_CHECKPOINT))
            db.createObjectStore(STORE_CHECKPOINT);
          if (oldVersion < 1) {
            void tx.objectStore(STORE_META).put(GAME_VERSION, 'schemaVersion');
          }
        },
        blocked() {
          // An old service-worker tab is holding the connection open.
          dbAvailable = false;
        },
      });
    } catch {
      dbAvailable = false;
      return null;
    }
  }
  return dbPromise;
}

async function read<T>(store: string, key: string): Promise<T | undefined> {
  const p = getDb();
  if (!p) return undefined;
  try {
    return (await p).get(store, key) as T | undefined;
  } catch {
    return undefined;
  }
}

async function write(store: string, key: string, value: unknown): Promise<void> {
  const p = getDb();
  if (!p) return;
  try {
    await p.then((db) => db.put(store, value, key));
  } catch {
    // Quota exceeded or storage blocked: the in-memory copy stays authoritative
    // for this session and the next successful write will reconcile.
  }
}

/** Merge-on-load so a settings object written by an older build still works. */
export async function loadSettings(): Promise<Settings> {
  const stored = await read<Partial<Settings>>(STORE_SETTINGS, STORAGE_KEYS.settings);
  const merged: Settings = { ...defaultSettings, ...(stored ?? {}) };
  // Guard against a bad value sneaking in from a manual edit.
  merged.masterVolume = clamp01try(merged.masterVolume, defaultSettings.masterVolume);
  merged.sfxVolume = clamp01try(merged.sfxVolume, defaultSettings.sfxVolume);
  merged.musicVolume = clamp01try(merged.musicVolume, defaultSettings.musicVolume);
  merged.cameraSensitivity = clampRange(merged.cameraSensitivity, 0.4, 2.5, 1);
  merged.joystickSize = clampRange(merged.joystickSize, 96, 190, 132);
  merged.buttonSize = clampRange(merged.buttonSize, 48, 92, 66);
  if (merged.quality !== 'low' && merged.quality !== 'medium' && merged.quality !== 'high') {
    merged.quality = defaultSettings.quality;
  }
  if (merged.touchControls !== 'auto' && merged.touchControls !== 'always' && merged.touchControls !== 'never') {
    merged.touchControls = 'auto';
  }
  memoryFallback.settings = merged;
  return merged;
}

export async function saveSettings(settings: Settings): Promise<void> {
  memoryFallback.settings = settings;
  await write(STORE_SETTINGS, STORAGE_KEYS.settings, settings);
}

export async function loadProfile(): Promise<Profile> {
  const stored = await read<Partial<Profile>>(STORE_PROFILE, STORAGE_KEYS.profile);
  const merged: Profile = { ...defaultProfile, ...(stored ?? {}) };
  memoryFallback.profile = merged;
  return merged;
}

export async function saveProfile(profile: Profile): Promise<void> {
  memoryFallback.profile = profile;
  await write(STORE_PROFILE, STORAGE_KEYS.profile, profile);
}

export async function loadCheckpoint(): Promise<Checkpoint | null> {
  const stored = await read<Checkpoint>(STORE_CHECKPOINT, STORAGE_KEYS.checkpoint);
  memoryFallback.checkpoint = stored ?? null;
  return stored ?? null;
}

export async function saveCheckpoint(checkpoint: Checkpoint): Promise<void> {
  memoryFallback.checkpoint = checkpoint;
  await write(STORE_CHECKPOINT, STORAGE_KEYS.checkpoint, checkpoint);
}

export async function clearCheckpoint(): Promise<void> {
  memoryFallback.checkpoint = null;
  const p = getDb();
  if (!p) return;
  try {
    await p.then((db) => db.delete(STORE_CHECKPOINT, STORAGE_KEYS.checkpoint));
  } catch {
    /* already absent */
  }
}

/** Wipes saves but keeps settings; used by the "erase my data" control. */
export async function clearProgress(): Promise<{ profile: Profile; checkpoint: null }> {
  memoryFallback.profile = { ...defaultProfile };
  memoryFallback.checkpoint = null;
  const p = getDb();
  if (p) {
    try {
      const db = await p;
      await db.clear(STORE_PROFILE);
      await db.clear(STORE_CHECKPOINT);
    } catch {
      /* ignore */
    }
  }
  return { profile: { ...defaultProfile }, checkpoint: null };
}

export function isStorageAvailable(): boolean {
  return dbAvailable;
}

function clamp01try(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
}

function clampRange(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}
