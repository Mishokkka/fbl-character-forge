import { MODULE_ID } from "../constants.js";
import { getArtSets, getGlobalTokenNamePatterns, getNameSets, splitTokenNamePatterns } from "./settings.js";
import { browseDirectories, browseImages } from "./asset-browser.js";
import { getUsedPathSet, shouldUseAssetRegistry } from "./asset-registry.js";
import { escapeHtml, isImagePath, normalizeFoundryPath, randomOf, unique } from "../utils.js";

export async function rollArt(artSetKey, context = {}) {
  const artSets = getArtSets();
  const baseSet = artSets[artSetKey];
  if (!baseSet) throw new Error(`Набор артов не найден: ${artSetKey}`);

  let resolved = resolveArtSetForContext(baseSet, context);
  let set = resolved.set;
  let candidates = await getArtCandidates(set);

  const hasRequestedSubset = isSpecificArtSubset(context.artSubsetKey || context.artSubset || context.artSubfolder);
  if (!candidates.portraitFiles.length && !candidates.tokenFiles.length && hasRequestedSubset && context.fallbackArtSubset !== false) {
    resolved = resolveArtSetForContext(baseSet, { ...context, artSubsetKey: "general", artSubset: "general", artSubfolder: "" });
    set = resolved.set;
    candidates = await getArtCandidates(set);
  }

  if (!candidates.portraitFiles.length && !candidates.tokenFiles.length) {
    const contextText = getArtContextLabel(resolved);
    throw new Error(`В наборе «${baseSet.label || artSetKey}»${contextText ? ` (${contextText})` : ""} не найдено изображений.`);
  }

  const used = shouldUseAssetRegistry(baseSet) ? getUsedPathSet(artSetKey) : new Set();
  const reuseWhenAllUsed = game.settings.get(MODULE_ID, "reuseWhenAllUsed");

  let portraitPool = getAvailablePortraitPool(candidates, set, used);
  let usingReuse = false;

  if (!portraitPool.length && candidates.portraitFiles.length && reuseWhenAllUsed) {
    portraitPool = candidates.portraitFiles;
    usingReuse = true;
  }

  if (!portraitPool.length && candidates.portraitFiles.length) {
    const contextText = getArtContextLabel(resolved);
    throw new Error(`Все портреты в наборе «${baseSet.label || artSetKey}»${contextText ? ` (${contextText})` : ""} уже заняты. Сбрось занятость набора или включи повтор после исчерпания.`);
  }

  let portrait = randomOf(portraitPool) || "";
  let token = "";

  if (set.pairByName && portrait && candidates.tokenFiles.length) {
    const paired = findPairedToken(portrait, candidates.tokenFiles, set);
    const freeTokens = candidates.tokenFiles.filter(candidate => !used.has(candidate));
    const canReusePaired = usingReuse || !freeTokens.length;
    if (paired && (!used.has(paired) || (reuseWhenAllUsed && canReusePaired))) token = paired;
  }

  if (!token && candidates.tokenFiles.length) {
    let tokenPool = candidates.tokenFiles.filter(t => !used.has(t));
    if (!tokenPool.length && reuseWhenAllUsed) tokenPool = candidates.tokenFiles;
    token = randomOf(tokenPool) || "";
  }

  if (!portrait && token) portrait = token;
  if (!token && portrait) token = portrait;

  return {
    portrait,
    token,
    gender: resolved.gender,
    cultureKey: resolved.cultureKey,
    artSubsetKey: resolved.artSubsetKey || null,
    artSubsetFolder: resolved.artSubsetFolder || null
  };
}

export async function inspectArtSet(artSetKey, context = {}) {
  const baseSet = getArtSets()[artSetKey];
  if (!baseSet) throw new Error(`Набор артов не найден: ${artSetKey}`);
  const resolved = resolveArtSetForContext(baseSet, context);
  const set = resolved.set;
  const candidates = await getArtCandidates(set);
  const used = shouldUseAssetRegistry(baseSet) ? getUsedPathSet(artSetKey) : new Set();
  const portraitPool = getAvailablePortraitPool(candidates, set, used);
  return {
    portraitsTotal: candidates.portraitFiles.length,
    tokensTotal: candidates.tokenFiles.length,
    portraitsAvailable: portraitPool.length,
    usedCount: used.size,
    folder: getArtSetFolderLabel(set),
    notes: set.notes || baseSet.notes || "",
    context: resolved
  };
}

export function resolveArtSetForContext(baseSet, context = {}) {
  const cultureKey = context.resolvedCultureKey || context.cultureKey || context.resolvedNameSetKey || context.nameSetKey || null;
  let gender = normalizeGenderKey(context.gender || context.resolvedGender || context.selectedGender || "random");

  if (gender === "random") {
    const available = getAvailableArtGenders(baseSet, cultureKey);
    gender = randomOf(available) || "random";
  }

  const branch = getArtBranch(baseSet, cultureKey, gender)
    || getArtBranch(baseSet, cultureKey, "neutral")
    || getArtBranch(baseSet, null, gender)
    || getArtBranch(baseSet, cultureKey, null);

  let set = branch ? mergeArtBranch(baseSet, branch) : shallowArtSetCopy(baseSet);
  const artSubsetKey = normalizeArtSubsetKey(context.artSubsetKey || context.artSubset || context.artSubfolder || "general");
  let artSubsetFolder = null;

  if (isSpecificArtSubset(artSubsetKey)) {
    const applied = applyArtSubsetToSet(set, artSubsetKey);
    set = applied.set;
    artSubsetFolder = applied.folder;
  } else if (context.artSubsetKey || context.artSubset || context.artSubfolder) {
    set = { ...set, recursive: false };
  }

  return {
    set,
    cultureKey,
    gender,
    branchFound: !!branch,
    baseLabel: baseSet.label || "",
    artSubsetKey,
    artSubsetFolder
  };
}

export function normalizeGenderKey(value) {
  if (value === "male" || value === "female" || value === "neutral") return value;
  return "random";
}

export function getAvailableArtGenders(set, cultureKey = null) {
  const genders = ["male", "female", "neutral"].filter(gender => !!getArtBranch(set, cultureKey, gender));
  return genders.length ? genders : ["male", "female"];
}

export function getArtBranch(set, cultureKey = null, gender = null) {
  const candidates = [];

  if (gender && cultureKey) {
    candidates.push(
      set?.folders?.[gender]?.[cultureKey],
      set?.folders?.[cultureKey]?.[gender],
      set?.cultures?.[cultureKey]?.[gender],
      set?.byCulture?.[cultureKey]?.[gender],
      set?.byGenderCulture?.[gender]?.[cultureKey],
      set?.byGender?.[gender]?.[cultureKey],
      set?.[gender]?.[cultureKey]
    );
  }

  if (cultureKey) {
    candidates.push(
      set?.folders?.[cultureKey]?.default,
      set?.folders?.[cultureKey]?.folder,
      set?.cultures?.[cultureKey]?.default,
      set?.cultures?.[cultureKey]?.folder,
      set?.byCulture?.[cultureKey]?.default,
      set?.byCulture?.[cultureKey]?.folder,
      set?.[cultureKey]?.default,
      set?.[cultureKey]?.folder
    );
  }

  if (gender) {
    candidates.push(
      set?.folders?.[gender]?.default,
      set?.folders?.[gender]?.folder,
      set?.byGender?.[gender]?.default,
      set?.byGender?.[gender]?.folder,
      set?.[gender]?.default,
      set?.[gender]?.folder,
      set?.[gender]
    );
  }

  candidates.push(set?.default);

  for (const candidate of candidates) {
    const branch = normalizeArtBranch(candidate);
    if (branch) return branch;
  }
  return null;
}

export function normalizeArtBranch(candidate) {
  if (!candidate) return null;
  if (typeof candidate === "string") return { folder: candidate };
  if (Array.isArray(candidate)) return { portraitFiles: candidate };
  if (typeof candidate !== "object") return null;

  if (isArtBranchConfig(candidate)) return candidate;
  return null;
}

export function isArtBranchConfig(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
  return !!(
    candidate.folder
    || candidate.portraitFolder
    || candidate.tokenFolder
    || candidate.portraitFiles
    || candidate.tokenFiles
    || candidate.portraits
    || candidate.tokens
  );
}

export function mergeArtBranch(baseSet, branch) {
  const merged = shallowArtSetCopy(baseSet);
  for (const [key, value] of Object.entries(branch || {})) merged[key] = value;
  return merged;
}

export function shallowArtSetCopy(set) {
  const copy = { ...(set || {}) };
  delete copy.folders;
  delete copy.cultures;
  delete copy.byCulture;
  delete copy.byGender;
  delete copy.byGenderCulture;
  delete copy.male;
  delete copy.female;
  delete copy.neutral;
  delete copy.default;
  return copy;
}

export function getArtContextLabel(resolved) {
  const parts = [];
  const nameSets = getNameSets();
  if (resolved?.cultureKey) parts.push(nameSets[resolved.cultureKey]?.label || resolved.cultureKey);
  if (resolved?.gender && resolved.gender !== "random") {
    const labels = { male: "мужской пул", female: "женский пул", neutral: "нейтральный пул" };
    parts.push(labels[resolved.gender] || resolved.gender);
  }
  if (isSpecificArtSubset(resolved?.artSubsetKey)) parts.push(`набор ${resolved.artSubsetKey}`);
  return parts.join(", ");
}

export function getAvailablePortraitPool(candidates, set, used) {
  if (!used?.size) return candidates.portraitFiles.slice();
  return candidates.portraitFiles.filter(p => {
    if (used.has(p)) return false;
    if (set.pairByName && candidates.tokenFiles.length) {
      const paired = findPairedToken(p, candidates.tokenFiles, set);
      if (paired && used.has(paired)) return false;
    }
    return true;
  });
}

export async function getArtCandidates(set, options = {}) {
  const source = set.source || "data";
  const bucket = set.bucket || null;
  const recursive = set.recursive ?? game.settings.get(MODULE_ID, "recursiveFolders");
  const sameFolder = !!(set.sameFolderTokenSuffix || set.folder || samePath(set.portraitFolder, set.tokenFolder));

  if (sameFolder) {
    const folder = set.folder || set.portraitFolder || set.tokenFolder;
    const allFiles = await resolveAssetList(folder, source, bucket, recursive, options);
    const split = splitSameFolderAssets(allFiles, getTokenRules(set));
    return { portraitFiles: unique(split.portraits), tokenFiles: unique(split.tokens) };
  }

  const portraitFiles = await resolveAssetList(set.portraitFiles ?? set.portraits ?? set.portraitFolder, source, bucket, recursive, options);
  const tokenFiles = await resolveAssetList(set.tokenFiles ?? set.tokens ?? set.tokenFolder, source, bucket, recursive, options);

  return { portraitFiles: unique(portraitFiles), tokenFiles: unique(tokenFiles) };
}

export function splitSameFolderAssets(files, tokenRulesOrSuffixes, maybeSet = null) {
  const rules = normalizeTokenRules(tokenRulesOrSuffixes, maybeSet);
  if (!rules.suffixes.length && !rules.patterns.length) return { portraits: files, tokens: files };

  const stems = new Map(files.map(file => [normalizeStem(assetStem(file)), file]));
  const tokenSet = new Set();

  for (const file of files) {
    const stem = assetStem(file);
    const bases = getTokenBaseCandidates(stem, rules);
    if (bases.some(base => normalizeStem(base) !== normalizeStem(stem) && stems.has(normalizeStem(base)))) tokenSet.add(file);
  }

  const tokens = files.filter(f => tokenSet.has(f));
  const portraits = files.filter(f => !tokenSet.has(f));
  return { portraits, tokens };
}

export async function resolveAssetList(value, source = "data", bucket = null, recursive = false, options = {}) {
  if (!value) return [];
  if (Array.isArray(value)) return unique(value.filter(isImagePath));
  if (typeof value !== "string") return [];

  const target = normalizeFoundryPath(value.trim());
  if (!target) return [];

  if (isImagePath(target)) return [target];

  return browseImages(source, target, bucket, recursive, options);
}

export async function getArtSubsetOptions(artSetKey, context = {}, browseOptions = {}) {
  const baseSet = getArtSets()[artSetKey];
  if (!baseSet) return [{ key: "general", label: "Общие", folder: "" }];

  const resolved = resolveArtSetForContext(baseSet, { ...context, artSubsetKey: "general" });
  const set = resolved.set;
  const source = set.source || "data";
  const bucket = set.bucket || null;
  const baseFolder = normalizeFoundryPath(set.folder || set.portraitFolder || set.tokenFolder || "");
  const options = [{ key: "general", label: "Общие", folder: baseFolder }];
  if (!baseFolder) return options;

  const dirs = await browseDirectories(source, baseFolder, bucket, true, browseOptions);
  const seen = new Set(["general"]);
  for (const dir of dirs) {
    const rel = relativeFoundryPath(baseFolder, dir);
    if (!rel || seen.has(rel)) continue;
    seen.add(rel);
    options.push({ key: rel, label: rel, folder: dir });
  }

  return options;
}

export function applyArtSubsetToSet(set, artSubsetKey) {
  const subset = normalizeArtSubsetKey(artSubsetKey);
  if (!isSpecificArtSubset(subset)) return { set: { ...set, recursive: false }, folder: null };

  const next = { ...set, recursive: false };
  const baseFolder = normalizeFoundryPath(next.folder || next.portraitFolder || next.tokenFolder || "");
  const folder = baseFolder ? joinFoundryPath(baseFolder, subset) : null;

  if (next.folder) next.folder = joinFoundryPath(next.folder, subset);
  if (next.portraitFolder) next.portraitFolder = joinFoundryPath(next.portraitFolder, subset);
  if (next.tokenFolder) next.tokenFolder = joinFoundryPath(next.tokenFolder, subset);
  if (!next.folder && !next.portraitFolder && !next.tokenFolder && folder) next.folder = folder;

  return { set: next, folder };
}

export function normalizeArtSubsetKey(value) {
  const raw = normalizeFoundryPath(String(value ?? "").trim());
  if (!raw || raw === "." || raw === "general" || raw === "common" || raw === "root" || raw === "__general__") return "general";
  return raw.replace(/^\/+|\/+$/g, "");
}

export function isSpecificArtSubset(value) {
  const key = normalizeArtSubsetKey(value);
  return Boolean(key && key !== "general");
}

export function joinFoundryPath(base, child) {
  const left = normalizeFoundryPath(base).replace(/\/+$/g, "");
  const right = normalizeFoundryPath(child).replace(/^\/+|\/+$/g, "");
  if (!left) return right;
  if (!right) return left;
  return `${left}/${right}`;
}

export function relativeFoundryPath(base, full) {
  const cleanBase = normalizeFoundryPath(base).replace(/\/+$/g, "");
  const cleanFull = normalizeFoundryPath(full).replace(/\/+$/g, "");
  if (!cleanFull.startsWith(`${cleanBase}/`)) return "";
  return cleanFull.slice(cleanBase.length + 1);
}

export function updateArtSetInfo(root, artSetKey, inspection = null, context = {}) {
  const target = root.querySelector("[data-artset-info]");
  if (!target) return;
  const baseSet = getArtSets()[artSetKey];
  if (!baseSet) {
    target.innerHTML = `<strong>Набор не найден:</strong> ${escapeHtml(artSetKey)}`;
    return;
  }

  const resolved = inspection?.context || resolveArtSetForContext(baseSet, context);
  const set = resolved.set;
  const folder = getArtSetFolderLabel(set);
  const rules = getTokenRules(set);
  const registry = shouldUseAssetRegistry(baseSet) ? "включена" : "выключена";
  const contextLabel = getArtContextLabel(resolved) || "общий набор";
  const branchNotice = resolved.branchFound ? "" : ' <span class="fbl-cf-warn">Для этой культуры/пола отдельная папка не найдена, используется общий набор.</span>';
  const checked = inspection
    ? `<br>Проверка: портретов ${inspection.portraitsTotal}, свободно ${inspection.portraitsAvailable}, токенов ${inspection.tokensTotal}, занятых файлов ${inspection.usedCount}.`
    : "";
  const tokenRule = formatTokenRuleHint(rules);

  target.innerHTML = `
    <div><strong>Контекст:</strong> ${escapeHtml(contextLabel)}.${branchNotice}</div>
    <div><strong>Папка:</strong> <code>${escapeHtml(folder)}</code></div>
    <div><strong>Схема:</strong> ${tokenRule} Занятость: ${registry}.${checked}</div>
  `;
}

export function getArtSetFolderLabel(set) {
  return normalizeFoundryPath(set.folder || set.portraitFolder || set.tokenFolder || "не указана");
}

export function findPairedToken(portrait, tokenFiles, set) {
  const rules = getTokenRules(set);
  const pBase = pairBase(portrait, rules);
  return tokenFiles.find(t => getTokenBaseCandidates(assetStem(t), rules).some(base => normalizeStem(base) === pBase)) || null;
}

export function pairBase(path, rulesOrSuffixes = null) {
  const rules = normalizeTokenRules(rulesOrSuffixes);
  const stem = assetStem(path).replace(/[-_\s]*(portrait|actor|avatar)$/i, "");
  const bases = getTokenBaseCandidates(stem, rules);
  const best = bases.find(base => normalizeStem(base) !== normalizeStem(stem)) || stem;
  return normalizeStem(best);
}

export function assetStem(path) {
  const rawFile = String(path).split("/").pop() || String(path);
  const file = decodePathPart(rawFile);
  return normalizeVisibleSpaces(file.replace(/\.[^.]+$/, ""));
}

export function stripTokenSuffix(stem, suffixes) {
  for (const suffix of suffixes.slice().sort((a, b) => b.length - a.length)) {
    if (!suffix) continue;
    if (normalizeStem(stem).endsWith(normalizeStem(suffix))) return stem.slice(0, stem.length - suffix.length);
  }
  return stem;
}

export function getTokenSuffixes(set) {
  const suffixes = set?.tokenSuffixes;
  if (Array.isArray(suffixes)) return suffixes.map(s => String(s)).filter(Boolean);
  if (typeof suffixes === "string") return suffixes.split(/[\n,;]+/g).map(s => s.trim()).filter(Boolean);
  return [];
}

export function getTokenRules(set = {}) {
  return {
    suffixes: unique(getTokenSuffixes(set)),
    patterns: unique([...splitTokenNamePatterns(set?.tokenNamePatterns), ...getGlobalTokenNamePatterns()])
  };
}

export function normalizeTokenRules(rulesOrSuffixes = null, maybeSet = null) {
  if (rulesOrSuffixes && typeof rulesOrSuffixes === "object" && !Array.isArray(rulesOrSuffixes) && (rulesOrSuffixes.suffixes || rulesOrSuffixes.patterns)) {
    return {
      suffixes: unique((rulesOrSuffixes.suffixes || []).map(String).filter(Boolean)),
      patterns: unique((rulesOrSuffixes.patterns || []).map(String).filter(pattern => pattern.includes("{id}")))
    };
  }

  if (maybeSet) return getTokenRules(maybeSet);
  if (Array.isArray(rulesOrSuffixes)) return { suffixes: unique(rulesOrSuffixes.map(String).filter(Boolean)), patterns: getGlobalTokenNamePatterns() };
  return getTokenRules(rulesOrSuffixes || {});
}

export function getTokenBaseCandidates(stem, rules) {
  const cleanStem = String(stem || "");
  const candidates = new Set();
  const suffixBase = stripTokenSuffix(cleanStem, rules.suffixes || []);
  if (normalizeStem(suffixBase) !== normalizeStem(cleanStem)) candidates.add(suffixBase);

  for (const pattern of rules.patterns || []) {
    const match = matchTokenPattern(cleanStem, pattern);
    if (match) candidates.add(match);
  }

  candidates.add(cleanStem);
  return [...candidates].filter(Boolean);
}

export function matchTokenPattern(stem, pattern) {
  const source = normalizeVisibleSpaces(decodePathPart(String(pattern || "").trim()));
  if (!source.includes("{id}")) return null;

  const cleanStem = normalizeVisibleSpaces(decodePathPart(String(stem || "")));
  const marker = "__FBL_CF_ID__";
  const escaped = escapeRegExp(source).replace(escapeRegExp("{id}"), marker);
  const patternRegex = `^${escaped.replace(marker, "(.+?)")}$`;
  const match = new RegExp(patternRegex, "i").exec(cleanStem);
  return normalizeVisibleSpaces(match?.[1] || "") || null;
}

export function normalizeStem(value) {
  return normalizeVisibleSpaces(decodePathPart(String(value || ""))).toLowerCase();
}

export function normalizeVisibleSpaces(value) {
  return String(value || "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function decodePathPart(value) {
  const raw = String(value || "");
  try {
    return decodeURIComponent(raw);
  } catch (_err) {
    return raw.replace(/%20/gi, " ");
  }
}

export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function formatTokenRuleHint(rules) {
  const suffixText = rules.suffixes?.length
    ? `суффиксы: ${rules.suffixes.map(s => `<code>${escapeHtml(s)}</code>`).join(", ")}`
    : "";
  const patterns = rules.patterns || [];
  const patternText = patterns.length
    ? `шаблоны: ${patterns.slice(0, 8).map(s => `<code>${escapeHtml(s)}</code>`).join(", ")}${patterns.length > 8 ? ` и ещё ${patterns.length - 8}` : ""}`
    : "";
  const parts = [suffixText, patternText].filter(Boolean);
  return parts.length ? `Токены распознаются по имени (${parts.join("; ")}).` : "Токены берутся из отдельного списка или папки.";
}

export function samePath(a, b) {
  if (!a || !b) return false;
  return normalizeFoundryPath(a) === normalizeFoundryPath(b);
}

export function validateArtSet(set, key = "") {
  const errors = [];
  const warnings = [];
  if (!set || typeof set !== "object" || Array.isArray(set)) {
    errors.push("Набор должен быть JSON-объектом.");
    return { key, valid: false, errors, warnings };
  }

  const hasDirectSource = !!(set.folder || set.portraitFolder || set.tokenFolder || set.portraitFiles || set.tokenFiles || set.portraits || set.tokens);
  const hasBranches = !!(set.folders || set.cultures || set.byCulture || set.byGender || set.byGenderCulture);
  if (!hasDirectSource && !hasBranches) errors.push("Не указан folder, portraitFolder/tokenFolder, список файлов или ветвящаяся структура folders.");
  if (set.pairByName && !set.sameFolderTokenSuffix && !set.tokenFolder && !set.tokenFiles && !set.tokens && !hasBranches) {
    warnings.push("pairByName включён, но отдельный источник токенов не указан.");
  }
  if (set.source && !["data", "public", "s3"].includes(set.source)) warnings.push(`Необычный FilePicker source: ${set.source}.`);
  return { key, valid: !errors.length, errors, warnings };
}

export function validateArtSets(artSets = getArtSets()) {
  return Object.entries(artSets || {}).map(([key, set]) => validateArtSet(set, key));
}
