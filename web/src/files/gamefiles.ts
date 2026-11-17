/**
 * gamefiles.ts - the player's copy of the game: its files by name (lower case, no folders), read from a folder, loose
 * files or a .zip, and kept in this browser (IndexedDB). Nothing leaves the device.
 */
import { unzipSync } from 'fflate';

export type GameFiles = Map<string, Uint8Array>;

/** What a game must have to start (Ultima 6). */
export const REQUIRED = [
  'map', 'chunks', 'maptiles.vga', 'objtiles.vga', 'masktype.vga', 'tileindx.vga', 'tileflag', 'animdata',
  'animmask.vga', 'basetile', 'u6pal', 'look.lzd', 'converse.a', 'converse.b', 'schedule', 'lzobjblk', 'lzdngblk',
];

const base = (path: string): string => path.replace(/\\/g, '/').split('/').pop()!.toLowerCase();

export function missing(files: GameFiles): string[] {
  return REQUIRED.filter((n) => !files.has(n));
}

/** Read what the player chose: any .zip among it is opened, everything else kept under its bare name. */
export async function readPicked(picked: Iterable<File>): Promise<GameFiles> {
  const files: GameFiles = new Map();
  for (const f of picked) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (/\.zip$/i.test(f.name)) {
      for (const [path, data] of Object.entries(unzipSync(bytes))) {
        if (data.length && !path.endsWith('/')) keep(files, path, data);
      }
    } else keep(files, f.webkitRelativePath || f.name, bytes);
  }
  return files;
}

/** Keep a file under its bare name; a saved game's files (in a savegame folder) do not displace the game's own. */
function keep(files: GameFiles, path: string, data: Uint8Array): void {
  const name = base(path);
  const inSave = /savegame[/\\]/i.test(path);
  if (files.has(name) && inSave) return;
  files.set(name, data);
}

const DB = 'nuvie-web';
const STORE = 'kv';

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const rq = indexedDB.open(DB, 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore(STORE);
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const db = await open();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
  db.close();
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await open();
  const v = await new Promise<T | undefined>((res, rej) => {
    const rq = db.transaction(STORE).objectStore(STORE).get(key);
    rq.onsuccess = () => res(rq.result as T | undefined);
    rq.onerror = () => rej(rq.error);
  });
  db.close();
  return v;
}

export async function kvDelete(key: string): Promise<void> {
  const db = await open();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
  db.close();
}
