import { BASE_NAME_SETS } from "../data/name-sets.base.js";
import { CULTURE_ALIASES } from "../data/cultures.js";
import { getNameSets } from "./settings.js";
import { capitalize, randomOf, resolveSetKey, safeDefaultKey } from "../utils.js";

const recentNames = new Map();
const RECENT_PER_SET = 20;
const GENDERS = ["male", "female", "neutral"];
const GIVEN_POOLS = ["given", "names"];
const NAME_POOLS = [
  ...GENDERS, ...GIVEN_POOLS, "entries", "familyMale", "familyFemale", "familyNeutral",
  "family", "surnames", "clan", "patronymMale", "patronymFemale", "patronymNeutral",
  "patronym", "prefix", "suffix", "title", "particle", "byname", "origin", "occupation", "patterns"
];

export function normalizeNameSetKey(key, nameSets = null) {
  const raw = String(key || "").trim();
  if (!raw) return raw;
  if (raw === "random") return raw;
  const directSets = nameSets || BASE_NAME_SETS;
  const direct = resolveSetKey(directSets, raw);
  if (direct) return direct;
  const compact = raw.replace(/[\s-]+/g, "_");
  const lower = compact.toLowerCase();
  const target = Object.hasOwn(CULTURE_ALIASES, raw) ? CULTURE_ALIASES[raw]
    : Object.entries(CULTURE_ALIASES).find(([alias]) => alias.toLowerCase() === lower)?.[1];
  return resolveSetKey(directSets, target) || target || raw;
}

export function weightedRandom(entries) {
  if (!Array.isArray(entries) || !entries.length) return null;
  const normalized = entries.map(normalizeWeightedEntry).filter(Boolean);
  if (!normalized.length) return null;

  const total = normalized.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) return randomOf(normalized)?.value ?? null;
  let roll = Math.random() * total;
  for (const entry of normalized) {
    roll -= entry.weight;
    if (roll < 0) return entry.value;
  }
  return normalized.at(-1)?.value ?? null;
}

function normalizeWeightedEntry(entry) {
  const weighted = entry && typeof entry === "object" && !Array.isArray(entry);
  const value = weighted ? entry.value ?? entry.pattern ?? entry.name : entry;
  const weight = weighted ? Number(entry.weight ?? 1) : 1;
  if (typeof value !== "string" || !value.trim() || !Number.isFinite(weight) || weight < 0) return null;
  return { value, weight };
}

export function chooseNamePattern(set, hasFamily = false) {
  const patterns = Array.isArray(set?.patterns) ? set.patterns.filter(Boolean) : [];
  if (patterns.length) return String(weightedRandom(patterns) || "{given}");
  return String(set?.pattern || (hasFamily ? "{given} {family}" : "{given}"));
}

function choosePoolValue(set, fields) {
  for (const field of fields) {
    const pool = set?.[field];
    const value = weightedRandom(pool);
    if (value) return value;
  }
  return "";
}

export function generateName(setKey, gender = "random") {
  return generateNameDetailed(setKey, gender).name;
}

export function generateNameDetailed(setKey, gender = "random") {
  const nameSets = getNameSets();
  const normalizedSetKey = normalizeNameSetKey(setKey, nameSets);
  const resolvedSetKey = normalizedSetKey === "random"
    ? randomOf(Object.keys(nameSets))
    : safeDefaultKey(nameSets, normalizedSetKey);
  const set = nameSets[resolvedSetKey];
  if (!set) return { name: "Безымянный", gender: "neutral", setKey: resolvedSetKey || null };

  let result = null;
  const recent = recentNames.get(resolvedSetKey) || [];
  for (let attempt = 0; attempt < 8; attempt += 1) {
    result = generateNameFromDefinition(set, resolvedSetKey, gender);
    if (!recent.includes(result.name) || attempt === 7) break;
  }

  const nextRecent = [result.name, ...recent.filter(name => name !== result.name)].slice(0, RECENT_PER_SET);
  recentNames.set(resolvedSetKey, nextRecent);
  return result;
}

export function generateNameFromDefinition(set, setKey = null, gender = "random") {
  if (!set || typeof set !== "object") return { name: "Безымянный", gender: "neutral", setKey };

  if (Array.isArray(set.entries) && set.entries.length) {
    const resolvedGender = GENDERS.includes(gender) ? gender : "neutral";
    return { name: String(weightedRandom(set.entries) || "Безымянный"), gender: resolvedGender, setKey };
  }

  const resolvedGender = resolveGender(set, gender);
  const capGender = capitalize(resolvedGender);
  const given = choosePoolValue(set, [resolvedGender, "given", "names"]) || "Безымянный";
  const family = choosePoolValue(set, [`family${capGender}`, "family", "surnames", "clan"]);
  const patronym = choosePoolValue(set, [`patronym${capGender}`, "patronym"]);
  const values = {
    given,
    family,
    surname: family,
    clan: family,
    patronym,
    prefix: choosePoolValue(set, ["prefix"]),
    suffix: choosePoolValue(set, ["suffix"]),
    title: choosePoolValue(set, ["title"]),
    particle: choosePoolValue(set, ["particle"]),
    byname: choosePoolValue(set, ["byname"]),
    origin: choosePoolValue(set, ["origin"]),
    occupation: choosePoolValue(set, ["occupation"])
  };

  let name = chooseNamePattern(set, !!family);
  name = name.replace(/\{([^}]+)\}/g, (_, token) => Object.hasOwn(values, token) ? values[token] : "");
  name = name
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/([,.;:])\s*([,.;:])/g, "$1")
    .trim();

  return { name: name || "Безымянный", gender: resolvedGender, setKey };
}

export function resolveGender(set, gender) {
  if (GENDERS.includes(gender) && [gender, ...GIVEN_POOLS].some(key => Array.isArray(set?.[key]) && set[key].length)) return gender;
  const pools = GENDERS.filter(key => Array.isArray(set?.[key]) && set[key].length);
  if (pools.length) return randomOf(pools);
  return "neutral";
}

export function previewNames(setKey, gender = "random", count = 10) {
  const max = Math.max(1, Math.min(100, Number(count) || 10));
  return Array.from({ length: max }, () => generateNameDetailed(setKey, gender));
}

export function previewNamesFromDefinition(set, setKey = null, gender = "random", count = 10) {
  const max = Math.max(1, Math.min(100, Number(count) || 10));
  return Array.from({ length: max }, () => generateNameFromDefinition(set, setKey, gender));
}

export function validateNameSet(set, key = "") {
  const errors = [];
  const warnings = [];
  if (!set || typeof set !== "object" || Array.isArray(set)) errors.push(game.i18n.localize("FBL_CF.Manager.InvalidObject"));
  else {
    const hasEntries = Array.isArray(set.entries) && set.entries.length > 0;
    const hasGiven = ["male", "female", "neutral", "given", "names"].some(field => Array.isArray(set[field]) && set[field].length);
    if (!hasEntries && !hasGiven) errors.push(game.i18n.localize("FBL_CF.Manager.MissingNamePool"));
    if (set.pattern != null && typeof set.pattern !== "string") errors.push(game.i18n.format("FBL_CF.Manager.InvalidNamePool", { field: "pattern" }));
    const patterns = Array.isArray(set.patterns) ? set.patterns : typeof set.pattern === "string" && set.pattern ? [set.pattern] : [];
    for (const pattern of patterns) {
      const value = normalizeWeightedEntry(pattern)?.value;
      if (value && !value.includes("{given}") && !hasEntries) warnings.push(game.i18n.format("FBL_CF.Manager.PatternMissingGiven", { pattern: value }));
    }
    for (const field of NAME_POOLS) {
      if (set[field] == null) continue;
      const values = Array.isArray(set[field]) ? set[field].map(normalizeWeightedEntry) : [null];
      if (values.includes(null)) errors.push(game.i18n.format("FBL_CF.Manager.InvalidNamePool", { field }));
      const names = values.filter(Boolean).map(entry => entry.value.trim());
      const repeats = new Set();
      const seen = new Set();
      for (const name of names) {
        if (seen.has(name)) repeats.add(name);
        seen.add(name);
      }
      if (repeats.size) warnings.push(game.i18n.format("FBL_CF.Manager.DuplicateNames", { field, count: repeats.size }));
    }
  }
  return { key, valid: !errors.length, errors, warnings };
}

export function validateNameSets(nameSets = getNameSets()) {
  return Object.entries(nameSets || {}).map(([key, set]) => validateNameSet(set, key));
}

export function clearRecentNameMemory(setKey = null) {
  if (setKey) recentNames.delete(setKey);
  else recentNames.clear();
}
