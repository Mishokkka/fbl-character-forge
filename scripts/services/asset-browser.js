import { IMAGE_EXTENSIONS, MODULE_ID } from "../constants.js";
import { isImagePath, normalizeFoundryPath, unique } from "../utils.js";

const browseCache = new Map();
let cacheGeneration = 0;

export function isMissingArtFolder(error) {
  // The v13 FilePicker exposes local browse failures as error messages without an error code.
  return /does not exist or is not accessible/.test(error?.cause?.message || "");
}

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
  return JSON.stringify([kind, source, bucket, target, recursive]);
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

function writeCache(key, value, generation) {
  if (generation === cacheGeneration) browseCache.set(key, { at: Date.now(), value: foundry.utils.deepClone(value) });
  return value;
}

async function browseDirect(source, target, bucket = null, { refresh = false } = {}) {
  const cleanTarget = normalizeFoundryPath(target);
  if (!cleanTarget) return { files: [], dirs: [] };

  const key = makeCacheKey("direct", source, cleanTarget, bucket, false);
  if (!refresh) {
    const cached = readCache(key);
    if (cached) return cached;
  } else browseCache.delete(key);

  const FilePickerClass = getFilePickerClass();
  if (!FilePickerClass?.browse) throw new Error("FilePicker.browse недоступен.");

  const generation = cacheGeneration;
  try {
    const result = await FilePickerClass.browse(source, cleanTarget, {
      ...(bucket ? { bucket } : {}),
      extensions: IMAGE_EXTENSIONS
    });
    if (result?.error || !Array.isArray(result?.files) || !Array.isArray(result?.dirs)) {
      throw new Error(result?.error || "Invalid FilePicker response");
    }
    return writeCache(key, {
      files: result.files.filter(isImagePath).map(normalizeFoundryPath),
      dirs: result.dirs.map(normalizeFoundryPath).filter(Boolean)
    }, generation);
  } catch (err) {
    throw new Error(game.i18n.format("FBL_CF.Status.BrowseFailed", {
      path: cleanTarget, message: err?.message || String(err)
    }), { cause: err });
  }
}

export function browseImages(source, target, bucket = null, recursive = false, options = {}) {
  return browseAssets("files", source, target, bucket, recursive, options);
}

export function browseDirectories(source, target, bucket = null, recursive = false, options = {}) {
  return browseAssets("dirs", source, target, bucket, recursive, options);
}

async function browseAssets(kind, source, target, bucket, recursive, options) {
  const cleanTarget = normalizeFoundryPath(target);
  if (!cleanTarget) return [];
  const key = makeCacheKey(kind, source, cleanTarget, bucket, recursive);
  if (!options.refresh) {
    const cached = readCache(key);
    if (cached) return cached;
  } else browseCache.delete(key);

  const generation = cacheGeneration;
  const seen = new Set();
  const pending = [cleanTarget];
  const values = [];
  while (pending.length) {
    const path = pending.pop();
    if (seen.has(path)) continue;
    seen.add(path);
    const result = await browseDirect(source, path, bucket, options);
    for (const value of result[kind]) values.push(value);
    if (recursive) {
      for (const dir of result.dirs) pending.push(dir);
    }
  }
  return writeCache(key, unique(values), generation);
}

export function clearAssetBrowseCache() {
  const count = browseCache.size;
  cacheGeneration += 1;
  browseCache.clear();
  return count;
}

export function getAssetBrowseCacheStats() {
  return {
    entries: browseCache.size,
    ttlMinutes: getCacheTtlMs() / 60_000
  };
}
