import { FALLBACK_IMAGE, MODULE_ID } from "../constants.js";
import { isImagePath, normalizeFoundryPath, resolveSetKey } from "../utils.js";
import { getArtSets, getUsedAssets, setUsedAssets } from "./settings.js";
import { runWorldOperation } from "./world-operations.js";

const ART_FLAGS = "flags." + MODULE_ID;
const ARCHIVE_INDEX_FIELDS = [
  ART_FLAGS + ".artSet", ART_FLAGS + ".assetUsage", ART_FLAGS + ".markUsed", ART_FLAGS + ".trackAssetBranch",
  "prototypeToken.texture.src", "prototypeToken.randomImg"
];
const ACTOR_ASSET_FIELDS = new Set(["img", ...ARCHIVE_INDEX_FIELDS]);

export function actorAssetFieldsChanged(changes) {
  return Object.keys(foundry.utils.flattenObject(changes || {})).some(key => {
    return ACTOR_ASSET_FIELDS.has(key.replace(".-=", ".")) || key === "flags.-=" + MODULE_ID;
  });
}

function normalizeEntry(entry) {
  if (Array.isArray(entry?.owners)) return entry;
  if (!entry) return { owners: [] };
  const { actorId = null, actorName = null, usedAt = null, state = "active" } = entry;
  const kinds = Array.isArray(entry.kinds) ? entry.kinds : entry.kind ? [entry.kind] : [];
  return { owners: [{ actorId, actorName, kinds, usedAt, state }] };
}

function mergeOwners(left, right) {
  const owners = new Map(left.map(owner => [ownerKey(owner), owner]));
  for (const owner of right) {
    const key = ownerKey(owner);
    const prior = owners.get(key);
    owners.set(key, prior ? {
      ...prior,
      kinds: [...new Set([...prior.kinds, ...owner.kinds])],
      state: prior.state === "active" || owner.state === "active" ? "active" : "orphaned"
    } : owner);
  }
  return [...owners.values()];
}

function ownerKey(owner) {
  if (owner.retainedFrom) return "retained:" + owner.retainedFrom;
  return owner.actorUuid ?? (owner.actorId ? "Actor." + owner.actorId : null);
}

function isCompendiumActor(actor) {
  return Boolean(actor?.id && actor.pack && !actor.parent && !actor.isToken);
}

// Legacy buckets can still be referenced through an art-set alias after a rename.
function combineBuckets(registry, artSetKey, artSets = getArtSets()) {
  const key = resolveSetKey(artSets, artSetKey) || artSetKey;
  const matching = Object.keys(registry).filter(candidate => candidate === key || resolveSetKey(artSets, candidate) === key);
  const assets = Object.create(null);
  for (const candidate of matching) {
    for (const [path, entry] of Object.entries(registry[candidate]?.assets || {})) {
      const normalizedPath = normalizeFoundryPath(path);
      assets[normalizedPath] = { owners: mergeOwners(assets[normalizedPath]?.owners || [], normalizeEntry(entry).owners) };
    }
  }
  return { key, matching, assets };
}

function updateBucket(registry, key, matching, assets) {
  for (const candidate of matching) delete registry[candidate];
  if (Object.keys(assets).length) registry[key] = { assets };
}

export function shouldUseAssetRegistry(set) {
  return Boolean(set && set.markUsed !== false && game.settings.get(MODULE_ID, "markUsedAssets"));
}

export function getUsedPathSet(artSetKey, { includeOrphaned = false } = {}) {
  const { assets } = combineBuckets(getUsedAssets(), artSetKey);
  return new Set(Object.entries(assets)
    .filter(([, entry]) => entry.owners.some(owner => includeOrphaned || isReserved(owner)))
    .map(([path]) => path));
}

export function isAssetUsed(artSetKey, path) {
  return Boolean(path && getUsedPathSet(artSetKey).has(normalizeFoundryPath(path)));
}

function isWorldActor(actor) {
  return Boolean(actor?.id && !actor.pack && !actor.parent && !actor.isToken);
}

export function isRegistryActor(actor) {
  return isWorldActor(actor) || isCompendiumActor(actor);
}

function isPersistedRegistryActor(actor) {
  if (isWorldActor(actor)) return game.actors.get(actor.id) === actor;
  return isCompendiumActor(actor) && game.packs.get(actor.pack)?.get(actor.id) === actor;
}

function actorArt(actor) {
  const source = actor.toObject?.() ?? actor;
  return {
    portrait: assetPath(source.img),
    token: source.prototypeToken?.randomImg ? "" : assetPath(source.prototypeToken?.texture?.src)
  };
}

function assetPath(path) {
  const clean = normalizeFoundryPath(path);
  return isImagePath(clean) && clean !== FALLBACK_IMAGE ? clean : "";
}

function addActorAssets(assets, art, actor) {
  const actorUuid = actor.uuid || "Actor." + actor.id;
  const paths = new Map();
  for (const [kind, path] of Object.entries(art)) {
    if (!path) continue;
    paths.set(path, [...(paths.get(path) || []), kind]);
  }
  let changed = 0;
  for (const [path, kinds] of paths) {
    const { owners } = normalizeEntry(assets[path]);
    const prior = owners.find(owner => ownerKey(owner) === actorUuid);
    if (prior?.state === "active" && prior.actorUuid === actorUuid
      && prior.kinds.join() === kinds.join() && prior.actorName === actor.name) continue;
    assets[path] = { owners: [
      ...owners.filter(owner => ownerKey(owner) !== actorUuid),
      { actorId: actor.id, actorUuid, actorName: actor.name, kinds, usedAt: new Date().toISOString(), state: "active" }
    ] };
    changed += 1;
  }
  return changed;
}

export async function markAssetsUsed(artSetKey, actor) {
  if (!artSetKey || !isPersistedRegistryActor(actor)) return;
  const registry = getUsedAssets();
  const { key, matching, assets } = combineBuckets(registry, artSetKey);
  if (!addActorAssets(assets, actorArt(actor), actor)) return;
  updateBucket(registry, key, matching, assets);
  await setUsedAssets(registry);
}

function changeActorAssets(registry, actor, update = () => null) {
  const actorUuid = actor.uuid || "Actor." + actor.id;
  let changed = 0;
  for (const [key, setData] of Object.entries(registry)) {
    const assets = setData?.assets || {};
    for (const [path, rawEntry] of Object.entries(assets)) {
      const { owners } = normalizeEntry(rawEntry);
      const owner = owners.find(candidate => ownerKey(candidate) === actorUuid);
      if (!owner) continue;
      const next = update(owner, key, path);
      if (next === owner) continue;
      const remaining = owners.filter(candidate => candidate !== owner);
      const updated = next ? mergeOwners(remaining, [next]) : remaining;
      if (updated.length) assets[path] = { owners: updated };
      else delete assets[path];
      changed += 1;
    }
  }
  return changed;
}

export async function releaseAssetsForActor(actor) {
  const worldActor = isWorldActor(actor);
  if (!isRegistryActor(actor)) return 0;
  const registry = getUsedAssets();
  const keepUsed = worldActor && !game.settings.get(MODULE_ID, "releaseAssetsOnActorDelete");
  const retainOwner = keepUsed ? owner => ({
    ...owner, actorId: null, actorUuid: null, retainedFrom: ownerKey(owner), state: "active"
  }) : undefined;
  const changed = changeActorAssets(registry, actor, retainOwner);
  if (changed) await setUsedAssets(registry);
  return changed;
}

export async function syncActorAssetUsage(actor) {
  if (!isPersistedRegistryActor(actor)) return 0;

  const registry = getUsedAssets();
  const artSets = getArtSets();
  const flags = actor.flags?.[MODULE_ID];
  const key = resolveSetKey(artSets, flags?.artSet);
  const art = actorArt(actor);
  const eligible = flags?.markUsed !== false && flags?.trackAssetBranch !== false;
  let hasReservation = false;
  let changed = changeActorAssets(registry, actor, (owner, bucket, path) => {
    if (!eligible || !key || resolveSetKey(artSets, bucket) !== key) return null;
    hasReservation = true;
    const kinds = Object.keys(art).filter(kind => art[kind] === normalizeFoundryPath(path));
    if (!kinds.length) return null;
    return kinds.join() === owner.kinds.join() ? owner : { ...owner, kinds };
  });
  const track = eligible && (flags?.assetUsage === "active" || hasReservation) && shouldUseAssetRegistry(artSets[key]);
  if (track) {
    const { matching, assets } = combineBuckets(registry, key, artSets);
    const added = addActorAssets(assets, art, actor);
    if (added) updateBucket(registry, key, matching, assets);
    changed += added;
  }
  if (changed) await setUsedAssets(registry);
  return changed;
}

function shouldTrackActor(flags) {
  return flags?.assetUsage === "active" && flags.markUsed !== false && flags.trackAssetBranch !== false;
}

function isReserved(owner) {
  if (owner.state === "orphaned") return false;
  if (!owner.actorUuid?.startsWith("Compendium.")) return true;
  // Players may not have the pack in their collection.
  return !game.user?.isGM || !isMissingCompendiumActor(owner.actorUuid);
}

function isMissingCompendiumActor(uuid) {
  const parsed = foundry.utils.parseUuid(uuid);
  return !parsed?.collection?.index?.has(parsed.id);
}

function isOrphaned(owner) {
  if (owner.state === "orphaned") return true;
  if (owner.actorUuid?.startsWith("Compendium.")) return game.user?.isGM && isMissingCompendiumActor(owner.actorUuid);
  if (!owner.actorId) return false;
  return !game.actors.has(owner.actorId) && game.settings.get(MODULE_ID, "releaseAssetsOnActorDelete");
}

export async function cleanAssetRegistry({ remove = true } = {}) {
  const registry = getUsedAssets();
  let orphaned = 0;
  let removed = 0;
  let changed = false;
  for (const setData of Object.values(registry)) {
    const assets = setData?.assets || {};
    for (const [path, rawEntry] of Object.entries(assets)) {
      const { owners } = normalizeEntry(rawEntry);
      const stale = owners.filter(isOrphaned);
      if (!stale.length && owners.length) continue;
      changed ||= remove || stale.some(owner => owner.state !== "orphaned");
      const active = owners.filter(owner => !stale.includes(owner));
      if (!active.length) orphaned += 1;
      if (remove && !active.length) {
        delete assets[path];
        removed += 1;
      } else assets[path] = { owners: remove ? active : [...active, ...stale.map(owner => ({ ...owner, state: "orphaned" }))] };
    }
  }
  if (changed) await setUsedAssets(registry);
  return { orphaned, removed };
}

export function cleanupOrphanedAssets(options = {}) {
  return runWorldOperation("cleanRegistry", options);
}

export async function resetAssetRegistry({ artSetKey }) {
  const registry = getUsedAssets();
  const { assets, matching } = combineBuckets(registry, artSetKey);
  for (const key of matching) delete registry[key];
  if (matching.length) await setUsedAssets(registry);
  return Object.keys(assets).length;
}

export function resetUsedAssetsForSet(artSetKey) {
  return runWorldOperation("resetRegistry", { artSetKey });
}

export function getAssetRegistryStats() {
  const registry = getUsedAssets();
  const artSets = getArtSets();
  const keys = new Set(Object.keys(registry).map(key => resolveSetKey(artSets, key) || key));
  const sets = [...keys].map(key => {
    const entries = Object.values(combineBuckets(registry, key, artSets).assets);
    return { key, total: entries.length, orphaned: entries.filter(entry => entry.owners.every(isOrphaned)).length };
  });
  return {
    total: sets.reduce((sum, set) => sum + set.total, 0),
    orphaned: sets.reduce((sum, set) => sum + set.orphaned, 0),
    sets
  };
}

export function exportAssetRegistry() {
  return getUsedAssets();
}

export async function migrateAssetRegistry() {
  const source = getUsedAssets();
  if (!Object.keys(source).length) return;
  const artSets = getArtSets();
  const keys = new Set(Object.keys(source).map(key => resolveSetKey(artSets, key) || key));
  const registry = Object.fromEntries([...keys].map(key => [key, { assets: combineBuckets(source, key, artSets).assets }]));

  // Older versions stored only the most recent owner of a reused path.
  for (const actor of game.actors) {
    const flags = actor.flags?.[MODULE_ID];
    if (!isWorldActor(actor) || !flags?.artSet || !shouldTrackActor(flags)) continue;
    const key = resolveSetKey(artSets, flags.artSet) || flags.artSet;
    const assets = registry[key]?.assets;
    if (!assets) continue;
    const flagPaths = [flags.portrait, flags.token].map(normalizeFoundryPath);
    const art = Object.fromEntries(Object.entries(actorArt(actor)).filter(([, path]) => path && Object.hasOwn(assets, path) && flagPaths.includes(path)));
    addActorAssets(assets, art, actor);
  }
  await setUsedAssets(registry);
}

export async function recoverArchivedActorAssets() {
  const registry = getUsedAssets();
  const artSets = getArtSets();
  // Compendia supplied by content packages are not archives of this world.
  const packs = game.packs.filter(pack => pack.documentName === "Actor" && pack.metadata.packageType === "world");
  const reserved = new Map();
  let changed = false;
  for (const pack of packs) {
    const index = await pack.getIndex({ fields: ARCHIVE_INDEX_FIELDS });
    for (const entry of index.values()) {
      const flags = entry.flags?.[MODULE_ID];
      const key = resolveSetKey(artSets, flags?.artSet);
      if (!key || !shouldTrackActor(flags) || artSets[key].markUsed === false) continue;
      if (!reserved.has(key)) reserved.set(key, combineBuckets(registry, key, artSets));
      const added = addActorAssets(reserved.get(key).assets, actorArt(entry), {
        id: entry._id, uuid: pack.getUuid(entry._id), name: entry.name
      });
      if (added) changed = true;
    }
  }
  for (const [key, { matching, assets }] of reserved) updateBucket(registry, key, matching, assets);
  if (changed) await setUsedAssets(registry);
}
