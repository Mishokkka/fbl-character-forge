import { IMAGE_EXTENSIONS, MODULE_ID } from "../constants.js";
import { isImagePath, normalizeFoundryPath, unique } from "../utils.js";

const browseCache = new Map();

function getFilePickerClass() {
  return foundry.applications?.apps?.FilePicker?.implementation
    ?? foundry.applications?.apps?.FilePicker
    ?? globalThis.FilePicker;
}

function getCacheTtlMs() {
  try {
    const minutes = Number(game.settings.get(MODULE_ID, "assetCacheTtlMinutes"));
    return Math.max(0, Number.isFinite(minutes) ? minutes : 10) * 60_000;
  } catch (_err) {
    return 10 * 60_000;
  }
}

function makeCacheKey(kind, source, target, bucket, recursive) {
  return `${kind}:${source}:${bucket || ""}:${normalizeFoundryPath(target)}:${recursive ? 1 : 0}`;
}

function readCache(key) {
  const entry = browseCache.get(key);
  if (!entry) return null;
  const ttl = getCacheTtlMs();
  if (ttl > 0 && Date.now() - entry.at > ttl) {
    browseCache.delete(key);
    return null;
  }
  return foundry.utils.deepClone(entry.value);
}

function writeCache(key, value) {
  browseCache.set(key, { at: Date.now(), value: foundry.utils.deepClone(value) });
  return value;
}

async function browseDirect(source, target, bucket = null, { refresh = false } = {}) {
  const cleanTarget = normalizeFoundryPath(target);
  if (!cleanTarget) return { files: [], dirs: [] };

  const key = makeCacheKey("direct", source, cleanTarget, bucket, false);
  if (!refresh) {
    const cached = readCache(key);
    if (cached) return cached;
  }

  const FilePickerClass = getFilePickerClass();
  if (!FilePickerClass?.browse) throw new Error("FilePicker.browse недоступен.");

  try {
    const result = await FilePickerClass.browse(source, cleanTarget, {
      ...(bucket ? { bucket } : {}),
      extensions: IMAGE_EXTENSIONS
    });
    return writeCache(key, {
      files: Array.from(result?.files ?? []).filter(isImagePath),
      dirs: Array.from(result?.dirs ?? []).map(normalizeFoundryPath).filter(Boolean)
    });
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not browse ${source}:${cleanTarget}`, err);
    return { files: [], dirs: [], error: err?.message || String(err) };
  }
}

export async function browseImages(source, target, bucket = null, recursive = false, options = {}) {
  const cleanTarget = normalizeFoundryPath(target);
  if (!cleanTarget) return [];
  const key = makeCacheKey("images", source, cleanTarget, bucket, recursive);
  if (!options.refresh) {
    const cached = readCache(key);
    if (cached) return cached;
  }

  const seen = new Set();
  const walk = async (path) => {
    const cleanPath = normalizeFoundryPath(path);
    const visitKey = `${source}:${bucket || ""}:${cleanPath}`;
    if (!cleanPath || seen.has(visitKey)) return [];
    seen.add(visitKey);

    const result = await browseDirect(source, cleanPath, bucket, options);
    const files = [...(result.files || [])];
    if (recursive) {
      for (const dir of result.dirs || []) files.push(...await walk(dir));
    }
    return files;
  };

  return writeCache(key, unique(await walk(cleanTarget)));
}

export async function browseDirectories(source, target, bucket = null, recursive = false, options = {}) {
  const cleanTarget = normalizeFoundryPath(target);
  if (!cleanTarget) return [];
  const key = makeCacheKey("dirs", source, cleanTarget, bucket, recursive);
  if (!options.refresh) {
    const cached = readCache(key);
    if (cached) return cached;
  }

  const seen = new Set();
  const walk = async (path) => {
    const cleanPath = normalizeFoundryPath(path);
    const visitKey = `${source}:${bucket || ""}:${cleanPath}`;
    if (!cleanPath || seen.has(visitKey)) return [];
    seen.add(visitKey);

    const result = await browseDirect(source, cleanPath, bucket, options);
    const dirs = [...(result.dirs || [])];
    if (recursive) {
      for (const dir of result.dirs || []) dirs.push(...await walk(dir));
    }
    return dirs;
  };

  return writeCache(key, unique(await walk(cleanTarget)));
}

export function clearAssetBrowseCache() {
  const count = browseCache.size;
  browseCache.clear();
  return count;
}

export function getAssetBrowseCacheStats() {
  return {
    entries: browseCache.size,
    ttlMinutes: getCacheTtlMs() / 60_000
  };
}
