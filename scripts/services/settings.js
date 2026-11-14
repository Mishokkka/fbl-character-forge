import { MODULE_ID, SETTINGS_SCHEMA_VERSION } from "../constants.js";
import { DEFAULT_NAME_SETS, applyNameSetAdditions } from "../data/name-sets.js";
import { ART_SOURCE_FIELDS, DEFAULT_ART_SETS } from "../data/art-sets.js";
import { buildDefaultGenderCultureFolders } from "../data/cultures.js";
import { BASE_NAME_SETS } from "../data/name-sets.base.js";
import { resolveSetKey } from "../utils.js";
import { clearAssetBrowseCache } from "./asset-browser.js";
import { requireActiveGM } from "./world-operations.js";

export const DEFAULT_TOKEN_NAME_PATTERNS = [
  "{id}T", "{id}t", "T{id}", "t{id}", "T {id}", "t {id}", "T-{id}", "t-{id}",
  "T_{id}", "t_{id}", "token-{id}", "token_{id}", "token {id}", "Token-{id}",
  "Token_{id}", "Token {id}", "{id}-token", "{id}_token", "{id} token", "{id}-Token",
  "{id}_Token", "{id} Token", "processed- {id}", "processed-{id}"
];

export function parseTokenNamePatternEntries(value) {
  const source = Array.isArray(value) ? value.join("\n") : String(value ?? "");
  return source
    .split(/[\r\n,;]+/g)
    .map(pattern => pattern.trim())
    .filter(Boolean);
}

export function isTokenNamePattern(pattern) {
  const parts = pattern.split("{id}");
  return parts.length === 2;
}

export function splitTokenNamePatterns(value) {
  return parseTokenNamePatternEntries(value).filter(isTokenNamePattern);
}

export function uniquePreserveOrder(values) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const clean = String(value || "").trim();
    const key = clean.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
  }
  return result;
}

export function normalizeTokenNamePatternsForStorage(value) {
  return uniquePreserveOrder(splitTokenNamePatterns(value)).join("\n");
}

export function ensureTokenNamePatternDefaults(value) {
  const current = uniquePreserveOrder(parseTokenNamePatternEntries(value));
  let changed = false;
  for (const pattern of DEFAULT_TOKEN_NAME_PATTERNS) {
    if (current.some(existing => existing.toLowerCase() === pattern.toLowerCase())) continue;
    current.push(pattern);
    changed = true;
  }
  return { value: current.join("\n"), changed };
}

function registerMenu(key, data) {
  if (!data?.type) return;
  try {
    game.settings.registerMenu(MODULE_ID, key, data);
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not register settings menu ${key}`, err);
  }
}

export function registerSettings(menuTypes = {}) {
  game.settings.register(MODULE_ID, "nameSets", {
    name: "FBL_CF.Settings.NameSets.Name",
    hint: "FBL_CF.Settings.NameSets.Hint",
    scope: "world",
    config: false,
    type: String,
    default: JSON.stringify(DEFAULT_NAME_SETS, null, 2)
  });

  game.settings.register(MODULE_ID, "artSets", {
    name: "FBL_CF.Settings.ArtSets.Name",
    hint: "FBL_CF.Settings.ArtSets.Hint",
    scope: "world",
    config: false,
    type: String,
    default: JSON.stringify(DEFAULT_ART_SETS, null, 2),
    onChange: clearAssetBrowseCache
  });

  game.settings.register(MODULE_ID, "tokenNamePatterns", {
    name: "FBL_CF.Settings.TokenPatterns.Name",
    hint: "FBL_CF.Settings.TokenPatterns.Hint",
    scope: "world",
    config: false,
    type: String,
    default: normalizeTokenNamePatternsForStorage(DEFAULT_TOKEN_NAME_PATTERNS)
  });

  registerMenu("nameSetManager", {
    name: "FBL_CF.Settings.NameSetManager.Name",
    label: "FBL_CF.Settings.Open",
    hint: "FBL_CF.Settings.NameSetManager.Hint",
    icon: "fas fa-signature",
    type: menuTypes.NameSetManagerApp,
    restricted: true
  });

  registerMenu("artSetManager", {
    name: "FBL_CF.Settings.ArtSetManager.Name",
    label: "FBL_CF.Settings.Open",
    hint: "FBL_CF.Settings.ArtSetManager.Hint",
    icon: "fas fa-images",
    type: menuTypes.ArtSetManagerApp,
    restricted: true
  });

  registerMenu("tokenNamePatternMenu", {
    name: "FBL_CF.Settings.TokenPatterns.Name",
    label: "FBL_CF.Settings.Open",
    hint: "FBL_CF.Settings.TokenPatterns.Hint",
    icon: "fas fa-tags",
    type: menuTypes.TokenNamePatternSettingsApp,
    restricted: true
  });

  registerMenu("diagnosticsMenu", {
    name: "FBL_CF.Settings.Diagnostics.Name",
    label: "FBL_CF.Settings.Open",
    hint: "FBL_CF.Settings.Diagnostics.Hint",
    icon: "fas fa-stethoscope",
    type: menuTypes.CharacterForgeDiagnosticsApp,
    restricted: true
  });

  game.settings.register(MODULE_ID, "defaultNameSet", {
    name: "FBL_CF.Settings.DefaultNameSet.Name",
    hint: "FBL_CF.Settings.DefaultNameSet.Hint",
    scope: "world",
    config: true,
    type: String,
    default: "novand"
  });

  game.settings.register(MODULE_ID, "defaultArtSet", {
    name: "FBL_CF.Settings.DefaultArtSet.Name",
    hint: "FBL_CF.Settings.DefaultArtSet.Hint",
    scope: "world",
    config: true,
    type: String,
    default: "humanByCultureGender"
  });

  game.settings.register(MODULE_ID, "replaceActorCreateDialog", {
    name: "FBL_CF.Settings.ReplaceCreateDialog.Name",
    hint: "FBL_CF.Settings.ReplaceCreateDialog.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true
  });

  game.settings.register(MODULE_ID, "autoGenerateName", {
    name: "FBL_CF.Settings.AutoGenerateName.Name",
    hint: "FBL_CF.Settings.AutoGenerateName.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "autoRollArt", {
    name: "FBL_CF.Settings.AutoRollArt.Name",
    hint: "FBL_CF.Settings.AutoRollArt.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, "assignArt", {
    name: "FBL_CF.Settings.AssignArt.Name",
    hint: "FBL_CF.Settings.AssignArt.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "generateProfile", {
    name: "FBL_CF.Settings.GenerateProfile.Name",
    hint: "FBL_CF.Settings.GenerateProfile.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "markUsedAssets", {
    name: "FBL_CF.Settings.MarkUsed.Name",
    hint: "FBL_CF.Settings.MarkUsed.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "reuseWhenAllUsed", {
    name: "FBL_CF.Settings.Reuse.Name",
    hint: "FBL_CF.Settings.Reuse.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, "releaseAssetsOnActorDelete", {
    name: "FBL_CF.Settings.ReleaseOnDelete.Name",
    hint: "FBL_CF.Settings.ReleaseOnDelete.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, "recursiveFolders", {
    name: "FBL_CF.Settings.Recursive.Name",
    hint: "FBL_CF.Settings.Recursive.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, "assetCacheTtlMinutes", {
    name: "FBL_CF.Settings.CacheTtl.Name",
    hint: "FBL_CF.Settings.CacheTtl.Hint",
    scope: "world",
    config: true,
    type: Number,
    default: 10,
    range: { min: 0, max: 120, step: 5 }
  });

  game.settings.register(MODULE_ID, "showTokenHudReroll", {
    name: "FBL_CF.Settings.TokenHud.Name",
    hint: "FBL_CF.Settings.TokenHud.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "randomTokenNameFallback", {
    name: "FBL_CF.Settings.TokenFallback.Name",
    hint: "FBL_CF.Settings.TokenFallback.Hint",
    scope: "world",
    config: true,
    type: String,
    default: "random"
  });

  game.settings.register(MODULE_ID, "batchDefaultCount", {
    name: "FBL_CF.Settings.BatchCount.Name",
    hint: "FBL_CF.Settings.BatchCount.Hint",
    scope: "client",
    config: true,
    type: Number,
    default: 5,
    range: { min: 2, max: 50, step: 1 }
  });

  game.settings.register(MODULE_ID, "historyLimit", {
    name: "FBL_CF.Settings.HistoryLimit.Name",
    hint: "FBL_CF.Settings.HistoryLimit.Hint",
    scope: "client",
    config: true,
    type: Number,
    default: 20,
    range: { min: 0, max: 100, step: 5 }
  });

  game.settings.register(MODULE_ID, "lastNameSet", {
    name: "FBL_CF.Settings.LastNameSet",
    scope: "client",
    config: false,
    type: String,
    default: ""
  });

  game.settings.register(MODULE_ID, "lastProfileRole", {
    name: "FBL_CF.Settings.LastProfileRole",
    scope: "client",
    config: false,
    type: String,
    default: "random"
  });

  game.settings.register(MODULE_ID, "lastProfileTier", {
    name: "FBL_CF.Settings.LastProfileTier",
    scope: "client",
    config: false,
    type: String,
    default: "random"
  });

  game.settings.register(MODULE_ID, "lastPrototypeToken", {
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.register(MODULE_ID, "generationHistory", {
    name: "FBL_CF.Settings.GenerationHistory",
    scope: "client",
    config: false,
    type: String,
    default: "[]"
  });

  game.settings.register(MODULE_ID, "usedAssets", {
    name: "FBL_CF.Settings.UsedAssets",
    scope: "world",
    config: false,
    type: String,
    default: "{}"
  });

  game.settings.register(MODULE_ID, "settingsSchemaVersion", {
    name: "FBL_CF.Settings.SchemaVersion",
    scope: "world",
    config: false,
    type: Number,
    default: 0
  });
}

export async function migrateSettings({ migrateRegistry, recoverArchives }) {
  try {
    const schema = Number(game.settings.get(MODULE_ID, "settingsSchemaVersion")) || 0;
    if (schema >= SETTINGS_SCHEMA_VERSION) return;
    if (schema < 2) await migrateLegacyConfig();
    if (schema < 3) {
      await migrateDefaultSurnames();
      await migrateRegistry();
    }
    if (schema < 4) await recoverArchives();
    requireActiveGM();
    await game.settings.set(MODULE_ID, "settingsSchemaVersion", SETTINGS_SCHEMA_VERSION);
  } catch (err) {
    console.warn(`${MODULE_ID} | Settings migration failed`, err);
  }
}

async function migrateDefaultSurnames() {
  const nameSets = getNameSets();
  let changed = false;
  for (const key of ["lezhnizem", "dikhtbeyr"]) {
    const setKey = resolveSetKey(nameSets, key);
    if (!setKey) continue;
    for (const field of ["familyMale", "familyFemale"]) {
      const pool = nameSets[setKey]?.[field];
      const base = BASE_NAME_SETS[key][field];
      if (!Array.isArray(pool) || pool.length !== base.length || !pool.every((value, i) => value === base[i])) continue;
      nameSets[setKey][field] = DEFAULT_NAME_SETS[key][field];
      changed = true;
    }
  }
  if (changed) await setNameSets(nameSets);
}

async function migrateLegacyConfig() {
  const nameSets = getNameSets();
  const mergedNames = { ...DEFAULT_NAME_SETS, ...nameSets };
  const addedNames = Object.keys(mergedNames).length !== Object.keys(nameSets).length;
  if (applyNameSetAdditions(mergedNames) || addedNames) await setNameSets(mergedNames);

  const artSets = getArtSets();
  const mergedArt = { ...DEFAULT_ART_SETS, ...artSets };
  const branches = artSets.humanByCultureGender?.folders;
  if (branches && typeof branches === "object" && !Array.isArray(branches)) {
    const defaults = buildDefaultGenderCultureFolders();
    const folders = { ...branches };
    for (const [gender, cultures] of Object.entries(defaults)) {
      const branch = branches[gender];
      if (branch == null) folders[gender] = cultures;
      else if (typeof branch === "object" && !Array.isArray(branch)
        && !Object.hasOwn(branch, "default") && !ART_SOURCE_FIELDS.some(field => Object.hasOwn(branch, field))) {
        folders[gender] = { ...cultures, ...branch };
      }
    }
    mergedArt.humanByCultureGender = { ...artSets.humanByCultureGender, folders };
  }
  if (JSON.stringify(mergedArt) !== JSON.stringify(artSets)) await setArtSets(mergedArt);
}

export function parseJsonSetting(key, fallback) {
  const raw = game.settings.get(MODULE_ID, key);
  try {
    const parsed = JSON.parse(raw || "{}");
    if (!parsed || typeof parsed !== "object") throw new Error("Expected JSON object or array");
    return parsed;
  } catch (err) {
    console.warn(`${MODULE_ID} | Invalid JSON setting ${key}`, err);
    if (key !== "usedAssets" && key !== "generationHistory") {
      ui.notifications?.warn?.(`Forbidden Lands Character Forge: ошибка в JSON-настройке ${key}. Используются значения по умолчанию.`);
    }
    return foundry.utils.deepClone(fallback);
  }
}

export function getNameSets() {
  const parsed = parseJsonSetting("nameSets", DEFAULT_NAME_SETS);
  return Array.isArray(parsed) ? foundry.utils.deepClone(DEFAULT_NAME_SETS) : parsed;
}

export async function setNameSets(data) {
  requireActiveGM();
  await game.settings.set(MODULE_ID, "nameSets", JSON.stringify(data || {}, null, 2));
}

export function getArtSets() {
  const parsed = parseJsonSetting("artSets", DEFAULT_ART_SETS);
  return Array.isArray(parsed) ? foundry.utils.deepClone(DEFAULT_ART_SETS) : parsed;
}

export async function setArtSets(data) {
  requireActiveGM();
  await game.settings.set(MODULE_ID, "artSets", JSON.stringify(data || {}, null, 2));
}

export function getGlobalTokenNamePatterns() {
  return splitTokenNamePatterns(game.settings.get(MODULE_ID, "tokenNamePatterns"));
}

export async function saveTokenNamePatterns({ value, expected }) {
  if (game.settings.get(MODULE_ID, "tokenNamePatterns") !== expected) {
    throw new Error(game.i18n.localize("FBL_CF.Manager.ConcurrentEdit"));
  }
  const invalid = parseTokenNamePatternEntries(value).filter(pattern => !isTokenNamePattern(pattern)).length;
  if (invalid) throw new Error(game.i18n.format("FBL_CF.TokenPatterns.InvalidSave", { count: invalid }));
  const normalized = normalizeTokenNamePatternsForStorage(value);
  requireActiveGM();
  await game.settings.set(MODULE_ID, "tokenNamePatterns", normalized);
  return normalized;
}

export function getUsedAssets() {
  const parsed = parseJsonSetting("usedAssets", {});
  return Array.isArray(parsed) ? {} : parsed;
}

export async function setUsedAssets(data) {
  requireActiveGM();
  await game.settings.set(MODULE_ID, "usedAssets", JSON.stringify(data || {}, null, 2));
}

export function getGenerationHistory() {
  const parsed = parseJsonSetting("generationHistory", []);
  return Array.isArray(parsed) ? parsed : [];
}

export async function addGenerationHistory(entry) {
  const limit = Math.max(0, Number(game.settings.get(MODULE_ID, "historyLimit")) || 0);
  if (!limit) return [];
  const history = getGenerationHistory();
  history.unshift({ ...entry, timestamp: entry?.timestamp || new Date().toISOString() });
  history.splice(limit);
  await game.settings.set(MODULE_ID, "generationHistory", JSON.stringify(history));
  return history;
}

export async function clearGenerationHistory() {
  await game.settings.set(MODULE_ID, "generationHistory", "[]");
}
