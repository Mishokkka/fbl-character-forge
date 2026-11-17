import { BASE_NAME_SETS } from "./name-sets.base.js";
import { NAME_SET_ADDITIONS } from "./name-set-additions.js";
import { REGIONAL_NAME_EXPANSION } from "./regional-name-expansion.js";
import { resolveSetKey, unique } from "../utils.js";

export function buildDefaultNameSets() {
  const result = JSON.parse(JSON.stringify(BASE_NAME_SETS));
  applyNameSetAdditions(result);
  applyRegionalNameExpansion(result);
  return result;
}

export function applyNameSetAdditions(nameSets) {
  if (!nameSets || typeof nameSets !== "object") return false;
  let changed = false;
  for (const [key, additions] of Object.entries(NAME_SET_ADDITIONS)) {
    const storedKey = resolveSetKey(nameSets, key) ?? key;
    if (!nameSets[storedKey]) {
      nameSets[storedKey] = JSON.parse(JSON.stringify(additions));
      changed = true;
      continue;
    }
    for (const [field, values] of Object.entries(additions)) {
      if (!Array.isArray(values)) continue;
      const pool = Array.isArray(nameSets[storedKey][field]) ? nameSets[storedKey][field] : [];
      const merged = unique([...pool, ...values]);
      if (merged.length === pool.length && merged.every((value, index) => value === pool[index])) continue;
      nameSets[storedKey] = { ...nameSets[storedKey], [field]: merged };
      changed = true;
    }
  }
  return changed;
}

// Match common orthographic variants without rewriting existing names or weights.
function expansionNameKey(value, culture) {
  const name = typeof value === "string" ? value : value?.value ?? value?.pattern ?? value?.name;
  if (typeof name !== "string") return "";
  const normalized = name.trim().normalize("NFC").toLowerCase()
    .replace(/\u0301/g, "").replace(/ё/g, "е").replace(/\s+/g, " ");
  return culture === "seiku" ? normalized.replace(/[- ]/g, "") : normalized;
}

// Update legacy descriptions only if they still exactly match the shipped defaults.
const LEGACY_CULTURE_DESCRIPTIONS = {
  yaknizem: "Белорусская и польская основа.",
  tiribor: "Дварфийская основа для Воздушных Островов."
};

// Append only to existing, nonempty pools in recognized cultures. A deleted pool,
// a full-name entries table or a custom culture must not be recreated by an upgrade.
export function applyRegionalNameExpansion(nameSets) {
  if (!nameSets || typeof nameSets !== "object" || Array.isArray(nameSets)) return false;
  let changed = false;
  for (const [culture, fields] of Object.entries(REGIONAL_NAME_EXPANSION)) {
    const key = resolveSetKey(nameSets, culture);
    const set = key ? nameSets[key] : null;
    if (!set || typeof set !== "object" || (Array.isArray(set.entries) && set.entries.length)) continue;
    if (Object.hasOwn(LEGACY_CULTURE_DESCRIPTIONS, culture) && set.description === LEGACY_CULTURE_DESCRIPTIONS[culture]) {
      set.description = BASE_NAME_SETS[culture].description;
      changed = true;
    }
    for (const [field, additions] of Object.entries(fields)) {
      const pool = set[field];
      if (!Array.isArray(pool) || !pool.length) continue;
      const seen = new Set(pool.map(value => expansionNameKey(value, culture)));
      const missing = additions.filter(value => {
        const normalized = expansionNameKey(value, culture);
        if (!normalized || seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
      });
      if (!missing.length) continue;
      set[field] = [...pool, ...missing];
      changed = true;
    }
  }
  return changed;
}

export const DEFAULT_NAME_SETS = buildDefaultNameSets();
