import { MODULE_ID } from "../constants.js";
import { getUsedAssets, setUsedAssets } from "./settings.js";

let assetQueue = Promise.resolve();

function normalizeEntry(entry = {}) {
  const kinds = Array.isArray(entry.kinds)
    ? entry.kinds.filter(Boolean)
    : entry.kind ? [entry.kind] : [];
  return {
    kinds: [...new Set(kinds)],
    actorId: entry.actorId || null,
    actorName: entry.actorName || null,
    usedAt: entry.usedAt || null,
    state: entry.state || "active"
  };
}

export function withAssetRegistryLock(fn) {
  const run = assetQueue.then(fn, fn);
  assetQueue = run.catch(() => undefined);
  return run;
}

export function shouldUseAssetRegistry(set) {
  try {
    return game.settings.get(MODULE_ID, "markUsedAssets") && set?.markUsed !== false;
  } catch (_err) {
    return set?.markUsed !== false;
  }
}

export function getUsedPathSet(artSetKey, { includeOrphaned = false } = {}) {
  const registry = getUsedAssets();
  const assets = registry?.[artSetKey]?.assets || {};
  return new Set(Object.entries(assets)
    .filter(([, value]) => includeOrphaned || normalizeEntry(value).state !== "orphaned")
    .map(([path]) => path));
}

export function isAssetUsed(artSetKey, path) {
  if (!path) return false;
  return getUsedPathSet(artSetKey).has(path);
}

export async function markAssetsUsed(artSetKey, art, actor, { state = "active" } = {}) {
  if (!artSetKey) return;
  const registry = getUsedAssets();
  registry[artSetKey] ??= { assets: {} };
  registry[artSetKey].assets ??= {};

  const stamp = new Date().toISOString();
  const actorId = actor?.id || null;
  const actorName = actor?.name || null;

  for (const [kind, path] of Object.entries({ portrait: art?.portrait, token: art?.token })) {
    if (!path) continue;
    const prior = normalizeEntry(registry[artSetKey].assets[path]);
    registry[artSetKey].assets[path] = {
      ...prior,
      kinds: [...new Set([...prior.kinds, kind])],
      actorId,
      actorName,
      usedAt: stamp,
      state
    };
  }

  await setUsedAssets(registry);
}

export async function releaseAssetsForActor(actorOrId, { markOrphaned = false } = {}) {
  const actorId = typeof actorOrId === "string" ? actorOrId : actorOrId?.id;
  if (!actorId) return 0;

  const registry = getUsedAssets();
  let changed = 0;
  for (const setData of Object.values(registry)) {
    const assets = setData?.assets || {};
    for (const [path, rawEntry] of Object.entries(assets)) {
      const entry = normalizeEntry(rawEntry);
      if (entry.actorId !== actorId) continue;
      changed += 1;
      if (markOrphaned) assets[path] = { ...entry, state: "orphaned" };
      else delete assets[path];
    }
  }

  if (changed) await setUsedAssets(registry);
  return changed;
}

export async function syncActorAssetUsage(actor) {
  if (!actor?.id) return 0;
  const registry = getUsedAssets();
  const portrait = actor.img || null;
  const token = actor.prototypeToken?.texture?.src || null;
  const artSetKey = actor.getFlag?.(MODULE_ID, "artSet")
    || actor.flags?.[MODULE_ID]?.artSet
    || null;

  let changed = 0;
  for (const setData of Object.values(registry)) {
    const assets = setData?.assets || {};
    for (const [path, rawEntry] of Object.entries(assets)) {
      const entry = normalizeEntry(rawEntry);
      if (entry.actorId !== actor.id) continue;
      const kinds = [];
      if (path === portrait) kinds.push("portrait");
      if (path === token) kinds.push("token");
      if (!kinds.length) {
        delete assets[path];
        changed += 1;
        continue;
      }
      if (kinds.join("|") !== entry.kinds.join("|")) {
        assets[path] = { ...entry, kinds };
        changed += 1;
      }
    }
  }

  if (artSetKey && (portrait || token)) {
    registry[artSetKey] ??= { assets: {} };
    registry[artSetKey].assets ??= {};
    const stamp = new Date().toISOString();
    for (const [kind, path] of Object.entries({ portrait, token })) {
      if (!path) continue;
      const prior = normalizeEntry(registry[artSetKey].assets[path]);
      const next = {
        ...prior,
        kinds: [...new Set([...prior.kinds, kind])],
        actorId: actor.id,
        actorName: actor.name || null,
        usedAt: stamp,
        state: "active"
      };
      if (JSON.stringify(prior) !== JSON.stringify(next)) {
        registry[artSetKey].assets[path] = next;
        changed += 1;
      }
    }
  }

  if (changed) await setUsedAssets(registry);
  return changed;
}

export async function cleanupOrphanedAssets({ remove = true } = {}) {
  const registry = getUsedAssets();
  let orphaned = 0;
  let removed = 0;

  for (const setData of Object.values(registry)) {
    const assets = setData?.assets || {};
    for (const [path, rawEntry] of Object.entries(assets)) {
      const entry = normalizeEntry(rawEntry);
      const missing = entry.actorId && !game.actors?.get?.(entry.actorId);
      if (!missing && entry.state !== "orphaned") continue;
      orphaned += 1;
      if (remove) {
        delete assets[path];
        removed += 1;
      } else {
        assets[path] = { ...entry, state: "orphaned" };
      }
    }
  }

  if (orphaned) await setUsedAssets(registry);
  return { orphaned, removed };
}

export async function resetUsedAssetsForSet(artSetKey) {
  const registry = getUsedAssets();
  const count = Object.keys(registry?.[artSetKey]?.assets || {}).length;
  delete registry[artSetKey];
  await setUsedAssets(registry);
  return count;
}

export function getAssetRegistryStats() {
  const registry = getUsedAssets();
  const sets = [];
  let total = 0;
  let orphaned = 0;
  for (const [key, setData] of Object.entries(registry)) {
    const entries = Object.values(setData?.assets || {}).map(normalizeEntry);
    const setOrphaned = entries.filter(entry => entry.state === "orphaned" || (entry.actorId && !game.actors?.get?.(entry.actorId))).length;
    total += entries.length;
    orphaned += setOrphaned;
    sets.push({ key, total: entries.length, orphaned: setOrphaned });
  }
  return { total, orphaned, sets };
}

export function exportAssetRegistry() {
  return foundry.utils.deepClone(getUsedAssets());
}
