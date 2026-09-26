// Local folders through the browser's File System Access API (Chrome and
// Edge). The folders you pick are remembered in this browser; after a restart
// the browser asks you once to allow access again.

const DB = 'chronicler';
const STORE = 'handles';

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbDo(mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

export const foldersSupported = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window;

export async function pickFolder(key, mode = 'read') {
  const handle = await window.showDirectoryPicker({ id: key, mode });
  try {
    await idbDo('readwrite', (s) => s.put(handle, key));
  } catch (err) {
    // Only costs re-picking the folder next time.
    console.warn('Could not remember the folder', err);
  }
  return handle;
}

export async function savedFolder(key) {
  try {
    return (await idbDo('readonly', (s) => s.get(key))) || null;
  } catch {
    return null;
  }
}

export async function forgetFolder(key) {
  await idbDo('readwrite', (s) => s.delete(key));
}

// 'granted', 'prompt' or 'denied'
export async function permission(handle, mode = 'read') {
  if (!handle?.queryPermission) return 'granted';
  return handle.queryPermission({ mode });
}

// Must be called from a click.
export async function requestPermission(handle, mode = 'read') {
  if (!handle?.requestPermission) return 'granted';
  return handle.requestPermission({ mode });
}

async function child(dir, name, kind = 'directory') {
  try {
    return kind === 'directory' ? await dir.getDirectoryHandle(name) : await dir.getFileHandle(name);
  } catch {
    return null;
  }
}

async function* entries(dir) {
  for await (const entry of dir.values()) yield entry;
}

const FLAVORS = ['_classic_era_', '_anniversary_', '_classic_', '_retail_', '_ptr_', '_classic_era_ptr_', '_classic_ptr_', '_beta_'];

// Game installs inside the picked folder: [{ flavor, dir }]. Works whether
// the "World of Warcraft" folder or a flavor folder like _classic_era_ was
// picked.
export async function wowInstalls(root) {
  if (await child(root, 'WTF') || await child(root, 'Interface')) return [{ flavor: root.name, dir: root }];
  const out = [];
  for (const name of FLAVORS) {
    const dir = await child(root, name);
    if (dir) out.push({ flavor: name, dir });
  }
  return out;
}

// Chronicler SavedVariables files: [{ flavor, account, handle }].
export async function savedVariablesFiles(root) {
  const out = [];
  for (const { flavor, dir } of await wowInstalls(root)) {
    const accounts = await child(await child(dir, 'WTF') ?? dir, 'Account');
    if (!accounts) continue;
    for await (const acc of entries(accounts)) {
      if (acc.kind !== 'directory') continue;
      const sv = await child(acc, 'SavedVariables');
      const file = sv && await child(sv, 'Chronicler.lua', 'file');
      if (file) out.push({ flavor, account: acc.name, handle: file });
    }
  }
  return out;
}

// Version of the installed addon in a flavor folder, or null.
export async function installedAddonVersion(flavorDir) {
  const addons = await child(await child(flavorDir, 'Interface') ?? flavorDir, 'AddOns');
  const dir = addons && await child(addons, 'Chronicler');
  const toc = dir && await child(dir, 'Chronicler.toc', 'file');
  if (!toc) return null;
  const m = /^## Version:\s*(\S+)/m.exec(await (await toc.getFile()).text());
  return m ? m[1] : 'unknown';
}

// Writes the addon files into <flavor>/Interface/AddOns/Chronicler.
// files: [{ name, text }]
export async function installAddon(flavorDir, files) {
  const iface = await flavorDir.getDirectoryHandle('Interface', { create: true });
  const addons = await iface.getDirectoryHandle('AddOns', { create: true });
  const dir = await addons.getDirectoryHandle('Chronicler', { create: true });
  for (const f of files) {
    const handle = await dir.getFileHandle(f.name, { create: true });
    const w = await handle.createWritable();
    await w.write(f.text);
    await w.close();
  }
}

// macOS writes "._name" companion files next to every file on drives that are
// not Mac-formatted; they are not videos.
export function isHiddenFile(name) {
  return name.startsWith('.');
}

export const VIDEO_EXTENSIONS = ['.mkv', '.mp4', '.mov', '.flv', '.ts', '.m4v', '.webm'];

// Video files in the recordings folder (and one level of subfolders):
// [{ name, handle, size, lastModified }].
export async function listVideos(dir, depth = 0) {
  const out = [];
  for await (const entry of entries(dir)) {
    if (entry.kind === 'directory' && depth < 1) out.push(...await listVideos(entry, depth + 1));
    else if (entry.kind === 'file' && !isHiddenFile(entry.name) && VIDEO_EXTENSIONS.some((ext) => entry.name.toLowerCase().endsWith(ext))) {
      const file = await entry.getFile();
      out.push({ name: entry.name, handle: entry, size: file.size, lastModified: file.lastModified });
    }
  }
  return out;
}
