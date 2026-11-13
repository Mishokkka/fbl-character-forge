import { BASE_NAME_SETS } from "../data/name-sets.base.js";
import { CULTURE_ALIASES } from "../data/cultures.js";
import { getNameSets } from "./settings.js";
import { capitalize, randomOf, safeDefaultKey } from "../utils.js";

const recentNames = new Map();
const RECENT_PER_SET = 20;

export function normalizeNameSetKey(key, nameSets = null) {
  const raw = String(key || "").trim();
  if (!raw) return raw;
  if (raw === "random") return raw;
  const directSets = nameSets || BASE_NAME_SETS;
  if (directSets?.[raw]) return raw;
  const compact = raw.replace(/[\s-]+/g, "_");
  if (CULTURE_ALIASES[raw]) return CULTURE_ALIASES[raw];
  if (CULTURE_ALIASES[compact]) return CULTURE_ALIASES[compact];
  const lower = compact.toLowerCase();
  for (const [alias, target] of Object.entries(CULTURE_ALIASES)) {
    if (String(alias).toLowerCase() === lower) return target;
  }
  return raw;
}

export function weightedRandom(entries) {
  if (!Array.isArray(entries) || !entries.length) return null;
  const normalized = entries.map(entry => {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      return { value: entry.value ?? entry.pattern ?? entry.name ?? "", weight: Math.max(0, Number(entry.weight) || 0) };
    }
    return { value: entry, weight: 1 };
  }).filter(entry => entry.value !== "" && entry.value != null);
  if (!normalized.length) return null;

  const total = normalized.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) return randomOf(normalized)?.value ?? null;
  let roll = Math.random() * total;
  for (const entry of normalized) {
    roll -= entry.weight;
    if (roll <= 0) return entry.value;
  }
  return normalized.at(-1)?.value ?? null;
}

export function chooseNamePattern(set, hasFamily = false) {
  const patterns = Array.isArray(set?.patterns) ? set.patterns.filter(Boolean) : [];
  if (patterns.length) return String(weightedRandom(patterns) || "{given}");
  return String(set?.pattern || (hasFamily ? "{given} {family}" : "{given}"));
}

function choosePoolValue(set, fields) {
  for (const field of fields) {
    const pool = set?.[field];
    if (Array.isArray(pool) && pool.length) return weightedRandom(pool) || "";
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
    : nameSets[normalizedSetKey] ? normalizedSetKey : safeDefaultKey(nameSets, normalizedSetKey);
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
    const resolvedGender = gender && gender !== "random" ? gender : "neutral";
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
  for (const [token, value] of Object.entries(values)) name = name.replaceAll(`{${token}}`, value || "");
  name = name
    .replace(/\{[^}]+\}/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/([,.;:])\s*([,.;:])/g, "$1")
    .trim();

  return { name: name || "Безымянный", gender: resolvedGender, setKey };
}

export function resolveGender(set, gender) {
  if (gender && gender !== "random" && Array.isArray(set?.[gender]) && set[gender].length) return gender;
  const pools = ["male", "female", "neutral"].filter(key => Array.isArray(set?.[key]) && set[key].length);
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
  if (!set || typeof set !== "object" || Array.isArray(set)) errors.push("Набор должен быть JSON-объектом.");
  else {
    const hasEntries = Array.isArray(set.entries) && set.entries.length > 0;
    const hasGiven = ["male", "female", "neutral", "given", "names"].some(field => Array.isArray(set[field]) && set[field].length);
    if (!hasEntries && !hasGiven) errors.push("Нет ни entries, ни одного пула имён.");
    const patterns = Array.isArray(set.patterns) ? set.patterns : set.pattern ? [set.pattern] : [];
    for (const pattern of patterns) {
      const value = typeof pattern === "object" ? pattern.value ?? pattern.pattern : pattern;
      if (!String(value || "").includes("{given}") && !hasEntries) warnings.push(`Шаблон «${value}» не содержит {given}.`);
    }
    for (const [field, value] of Object.entries(set)) {
      if (!Array.isArray(value)) continue;
      const strings = value.map(entry => typeof entry === "object" ? entry.value ?? entry.name ?? entry.pattern : entry).filter(Boolean).map(String);
      const duplicates = strings.filter((entry, index) => strings.indexOf(entry) !== index);
      if (duplicates.length) warnings.push(`${field}: найдено повторов ${new Set(duplicates).size}.`);
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
