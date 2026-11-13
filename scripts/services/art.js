import { MODULE_ID } from "../constants.js";
import { getArtSets, getGlobalTokenNamePatterns, getNameSets, splitTokenNamePatterns } from "./settings.js";
import { browseDirectories, browseImages, isMissingArtFolder } from "./asset-browser.js";
import { getUsedPathSet, shouldUseAssetRegistry } from "./asset-registry.js";
import { normalizeNameSetKey } from "./names.js";
import { getSetAliases, isImagePath, normalizeFoundryPath, randomOf, resolveSetKey, unique } from "../utils.js";

export async function rollArt(artSetKey, context = {}, { resolved: preResolved } = {}) {
  const artSets = getArtSets();
  const key = resolveSetKey(artSets, artSetKey);
  const baseSet = artSets[key];
  if (!baseSet) throw new Error(game.i18n.format("FBL_CF.Status.ArtSetMissing", { set: artSetKey }));

  let resolved = preResolved || resolveArtSetForContext(baseSet, context);
  let candidates;
  const hasRequestedSubset = isSpecificArtSubset(context.artSubsetKey || context.artSubset || context.artSubfolder);
  const fallback = hasRequestedSubset && context.fallbackArtSubset !== false;
  try {
    candidates = await getArtCandidates(resolved.set, { artSubsetKey: resolved.artSubsetKey });
  } catch (error) {
    if (!fallback || !isMissingArtFolder(error)) throw error;
  }
  if (fallback && (!candidates || !(candidates.portraitFiles.length || candidates.tokenFiles.length))) {
    resolved = resolveArtSetForContext(baseSet, { ...context, resolvedGender: resolved.gender, artSubsetKey: "general" });
    candidates = await getArtCandidates(resolved.set);
  }
  const set = resolved.set;

  if (!candidates.portraitFiles.length && !candidates.tokenFiles.length) {
    const contextText = getArtContextLabel(resolved);
    throw new Error(game.i18n.format("FBL_CF.Status.ArtMissing", {
      set: baseSet.label || key, context: contextText ? " (" + contextText + ")" : ""
    }));
  }

  const used = getTrackedPaths(key, baseSet, resolved);
  const reuseWhenAllUsed = game.settings.get(MODULE_ID, "reuseWhenAllUsed");

  const pairedTokens = indexPairedTokens(candidates, set);
  const portraitPool = getAvailablePortraitPool(candidates, set, used, pairedTokens);
  const tokenPool = candidates.tokenFiles.filter(path => !used.has(path));
  const exhausted = candidates.portraitFiles.length ? !portraitPool.length : !tokenPool.length;
  if (exhausted && !reuseWhenAllUsed) {
    const contextText = getArtContextLabel(resolved);
    throw new Error(game.i18n.format("FBL_CF.Status.ArtExhausted", {
      set: baseSet.label || key,
      context: contextText ? " (" + contextText + ")" : ""
    }));
  }

  const portrait = randomOf(exhausted ? candidates.portraitFiles : portraitPool);
  const pairs = pairedTokens.get(portrait) || [];
  const availableTokens = tokenPool.length || !reuseWhenAllUsed ? tokenPool : candidates.tokenFiles;
  const token = pairs.find(path => !used.has(path))
    || (exhausted && pairs[0])
    || (!set.pairByName || !portrait ? randomOf(availableTokens) : null);

  return {
    portrait: portrait || token,
    token: token || portrait,
    gender: resolved.gender,
    cultureKey: resolved.cultureKey,
    artSubsetKey: resolved.artSubsetKey || null,
    artSubsetFolder: resolved.artSubsetFolder || null
  };
}

export async function inspectArtSet(artSetKey, context = {}) {
  const artSets = getArtSets();
  const key = resolveSetKey(artSets, artSetKey);
  const baseSet = artSets[key];
  if (!baseSet) throw new Error(game.i18n.format("FBL_CF.Status.ArtSetMissing", { set: artSetKey }));
  const resolved = resolveArtSetForContext(baseSet, context);
  const set = resolved.set;
  const candidates = await getArtCandidates(set, { artSubsetKey: resolved.artSubsetKey });
  const used = getTrackedPaths(key, baseSet, resolved);
  const portraitPool = getAvailablePortraitPool(candidates, set, used);
  return {
    portraitsTotal: candidates.portraitFiles.length,
    tokensTotal: candidates.tokenFiles.length,
    tokensAvailable: candidates.tokenFiles.filter(path => !used.has(path)).length,
    portraitsAvailable: portraitPool.length,
    usedCount: used.size,
    folder: getArtSetFolderLabel(set),
    notes: set.notes || baseSet.notes || "",
    context: resolved
  };
}

function getTrackedPaths(key, baseSet, resolved) {
  return resolved.branchMarkUsed && shouldUseAssetRegistry(baseSet) ? getUsedPathSet(key) : new Set();
}

export function resolveArtSetForContext(baseSet, context = {}) {
  const requestedCulture = context.resolvedCultureKey || context.resolvedNameSetKey || context.cultureKey || context.nameSetKey || null;
  const nameSets = getNameSets();
  const cultureKey = normalizeNameSetKey(requestedCulture, nameSets) || null;
  let gender = normalizeGenderKey(context.resolvedGender || context.gender || context.selectedGender);

  if (gender === "random") {
    const available = getAvailableArtGenders(baseSet, cultureKey);
    gender = randomOf(available) || "random";
  }

  const branch = getArtBranch(baseSet, cultureKey, gender, getSetAliases(nameSets[cultureKey]));

  let set = branch ? mergeArtBranch(baseSet, branch) : shallowArtSetCopy(baseSet);
  const artSubsetKey = normalizeArtSubsetKey(context.artSubsetKey || context.artSubset || context.artSubfolder || "general");
  let artSubsetFolder = null;

  if (isSpecificArtSubset(artSubsetKey)) {
    const applied = applyArtSubsetToSet(set, artSubsetKey);
    set = applied.set;
    artSubsetFolder = applied.folder;
  }

  return {
    set,
    cultureKey,
    gender,
    branchFound: !!branch,
    baseLabel: baseSet.label || "",
    artSubsetKey,
    artSubsetFolder,
    branchMarkUsed: branch?.markUsed !== false
  };
}

export function normalizeGenderKey(value) {
  if (value === "male" || value === "female" || value === "neutral") return value;
  return "random";
}

export function getAvailableArtGenders(set, cultureKey = null) {
  const aliases = getSetAliases(getNameSets()[cultureKey]);
  const genders = ["male", "female", "neutral"].filter(gender => !!getArtBranch(set, cultureKey, gender, aliases, true));
  return genders.length ? genders : ["male", "female"];
}

export function getArtBranch(set, cultureKey = null, gender = null, aliases = [], genderOnly = false) {
  const candidates = [];
  const cultures = [cultureKey, ...aliases].filter(Boolean);
  const byCulture = key => [set.folders?.[key], set.cultures?.[key], set.byCulture?.[key], set[key]];
  const byGender = key => [set.folders?.[key], set.byGenderCulture?.[key], set.byGender?.[key], set[key]];
  const genders = genderOnly ? [gender] : unique([gender, "neutral"]);
  const fallbacks = branches => branches.flatMap(branch => [branch?.default, branch]);
  for (const key of genders) {
    const branches = byGender(key);
    for (const culture of cultures) {
      candidates.push(...branches.map(branch => branch?.[culture]), ...byCulture(culture).map(branch => branch?.[key]));
    }
    if (genderOnly) candidates.push(...fallbacks(branches));
  }
  if (!genderOnly) {
    candidates.push(...fallbacks(cultures.flatMap(byCulture)), ...fallbacks(genders.flatMap(byGender)), set.default);
  }

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
  if (branch.folder || branch.portraitFiles || branch.portraits || branch.portraitFolder) {
    delete merged.portraitFiles;
    delete merged.portraits;
    delete merged.portraitFolder;
  }
  if (branch.folder || branch.tokenFiles || branch.tokens || branch.tokenFolder) {
    delete merged.tokenFiles;
    delete merged.tokens;
    delete merged.tokenFolder;
  }
  if (!branch.folder && (branch.portraitFiles || branch.portraits || branch.portraitFolder)) delete merged.folder;
  if (!branch.folder && (branch.tokenFiles || branch.tokens || branch.tokenFolder) && merged.folder) {
    merged.portraitFolder ||= merged.folder;
    delete merged.folder;
  }
  return { ...merged, ...branch };
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
  if (["male", "female", "neutral"].includes(resolved?.gender)) {
    const gender = resolved.gender[0].toUpperCase() + resolved.gender.slice(1);
    parts.push(game.i18n.localize("FBL_CF.Gender." + gender));
  }
  if (isSpecificArtSubset(resolved?.artSubsetKey)) parts.push(resolved.artSubsetKey);
  return parts.join(", ");
}

export function getAvailablePortraitPool(candidates, set, used, pairs = indexPairedTokens(candidates, set)) {
  if (!used?.size) return candidates.portraitFiles.slice();
  return candidates.portraitFiles.filter(p => {
    if (used.has(p)) return false;
    const tokens = pairs.get(p);
    return !tokens?.length || tokens.some(token => !used.has(token));
  });
}

export async function getArtCandidates(set, options = {}) {
  const source = set.source || "data";
  const bucket = set.bucket || null;
  const recursive = set.recursive ?? game.settings.get(MODULE_ID, "recursiveFolders");
  const { shared, portrait, token } = getArtSources(set);
  if (shared) {
    const files = await resolveAssetList(shared, source, bucket, recursive, options);
    const split = splitSameFolderAssets(files, getTokenRules(set));
    return { portraitFiles: split.portraits, tokenFiles: split.tokens };
  }

  const [portraitFiles, tokenFiles] = await Promise.all([portrait, token].map(async path => {
    try {
      return await resolveAssetList(path, source, bucket, recursive, options);
    } catch (error) {
      if (isSpecificArtSubset(options.artSubsetKey) && isMissingArtFolder(error)) return [];
      throw error;
    }
  }));
  return { portraitFiles: unique(portraitFiles), tokenFiles: unique(tokenFiles) };
}

function getArtSources(set) {
  const explicitPortrait = set.portraitFiles ?? set.portraits;
  const explicitToken = set.tokenFiles ?? set.tokens;
  const portrait = explicitPortrait ?? (set.portraitFolder || set.folder);
  const token = explicitToken ?? set.tokenFolder;
  const sharedFolder = samePath(portrait, token) || (!token && samePath(portrait, set.folder))
    || (set.sameFolderTokenSuffix && (!portrait || !token));
  const shared = explicitPortrait == null && explicitToken == null && sharedFolder ? portrait || token : null;
  return { shared, portrait, token };
}

export function splitSameFolderAssets(files, tokenRulesOrSuffixes, maybeSet = null) {
  const rules = normalizeTokenRules(tokenRulesOrSuffixes, maybeSet);
  if (!rules.suffixes.length && !rules.patterns.length) return { portraits: files, tokens: [] };

  const key = (file, stem) => JSON.stringify([assetDirectory(file), normalizeStem(stem)]);
  const stems = new Set(files.flatMap(file => [key(file, assetStem(file)), key(file, pairBase(file))]));
  const tokenSet = new Set();

  for (const file of files) {
    const stem = assetStem(file);
    const bases = getTokenBaseCandidates(stem, rules);
    if (bases.some(base => normalizeStem(base) !== normalizeStem(stem) && stems.has(key(file, base)))) tokenSet.add(file);
  }

  const tokens = files.filter(f => tokenSet.has(f));
  const portraits = files.filter(f => !tokenSet.has(f));
  return { portraits, tokens };
}

export async function resolveAssetList(value, source = "data", bucket = null, recursive = false, options = {}) {
  if (!value) return [];
  if (Array.isArray(value)) return unique(value.map(path => typeof path === "string" ? normalizeFoundryPath(path) : "").filter(isImagePath));
  if (typeof value !== "string") return [];

  const target = normalizeFoundryPath(value.trim());
  if (!target) return [];

  if (isImagePath(target)) return [target];

  return browseImages(source, target, bucket, recursive, options);
}

export async function getArtSubsetOptions(artSetKey, context = {}, browseOptions = {}) {
  const artSets = getArtSets();
  const baseSet = artSets[resolveSetKey(artSets, artSetKey)];
  const label = game.i18n.localize("FBL_CF.Forge.GeneralSubset");
  if (!baseSet) return [{ key: "general", label, folder: "" }];

  const resolved = resolveArtSetForContext(baseSet, { ...context, artSubsetKey: "general" });
  const set = resolved.set;
  const source = set.source || "data";
  const bucket = set.bucket || null;
  const { shared, portrait, token } = getArtSources(set);
  const roots = unique([folderSource(shared || portrait), folderSource(token)]);
  const [baseFolder = ""] = roots;
  const options = [{ key: "general", label, folder: baseFolder }];
  if (!baseFolder || isImagePath(baseFolder)) return options;

  const directories = await Promise.all(roots.map(root => browseDirectories(source, root, bucket, true, browseOptions)));
  const seen = new Set(["general"]);
  for (const [i, dirs] of directories.entries()) {
    for (const dir of dirs) {
      const rel = relativeFoundryPath(roots[i], dir);
      if (!rel || seen.has(rel)) continue;
      seen.add(rel);
      options.push({ key: rel, label: rel, folder: dir });
    }
  }

  return options;
}

export function applyArtSubsetToSet(set, artSubsetKey) {
  const subset = normalizeArtSubsetKey(artSubsetKey);
  if (!isSpecificArtSubset(subset)) return { set, folder: null };

  const next = { ...set, recursive: false };
  const { shared, portrait, token } = getArtSources(set);
  const baseFolder = folderSource(shared || portrait) || folderSource(token);
  const folder = baseFolder ? joinFoundryPath(baseFolder, subset) : null;

  for (const field of ["folder", "portraitFolder", "tokenFolder", "portraitFiles", "tokenFiles", "portraits", "tokens"]) {
    if (folderSource(next[field])) next[field] = joinFoundryPath(next[field], subset);
  }

  return { set: next, folder };
}

export function normalizeArtSubsetKey(value) {
  const raw = normalizeFoundryPath(String(value ?? "").trim());
  if (!raw || raw === "." || raw === "general" || raw === "common" || raw === "root" || raw === "__general__") return "general";
  const key = raw.replace(/^\/+|\/+$/g, "");
  if (key.split("/").some(part => /[\\/]/.test(decodePathPart(part)) || [".", ".."].includes(decodePathPart(part)))) {
    throw new Error(game.i18n.localize("FBL_CF.Status.InvalidSubset"));
  }
  return key || "general";
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

export function getArtSetFolderLabel(set) {
  const { shared, portrait, token } = getArtSources(set);
  return folderSource(shared || portrait) || folderSource(token) || game.i18n.localize("FBL_CF.Diagnostics.NoArtFolder");
}

export function findPairedToken(portrait, tokenFiles, set) {
  return indexPairedTokens({ portraitFiles: [portrait], tokenFiles }, { ...set, pairByName: true }).get(portrait)?.[0] ?? null;
}

function indexPairedTokens({ portraitFiles, tokenFiles }, set) {
  const pairs = new Map();
  if (!set.pairByName || !portraitFiles.length || !tokenFiles.length) return pairs;
  const rules = getTokenRules(set);
  const { shared, portrait, token } = getArtSources(set);
  const portraitRoot = folderSource(portrait);
  const tokenRoot = folderSource(token);
  const allowUnambiguousPair = !shared && !set.sameFolderTokenSuffix && !(portraitRoot && tokenRoot);
  const tokensByKey = new Map();
  const tokensByStem = new Map();
  const portraitsByStem = new Map();
  const append = (index, key, file) => {
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(file);
  };
  for (const file of tokenFiles) {
    const directory = pairingDirectory(file, shared ? null : tokenRoot);
    for (const base of new Set(getTokenBaseCandidates(assetStem(file), rules).map(normalizeStem))) {
      append(tokensByKey, JSON.stringify([directory, base]), file);
      if (allowUnambiguousPair) append(tokensByStem, base, file);
    }
  }
  if (allowUnambiguousPair) {
    for (const file of portraitFiles) {
      for (const base of portraitStems(file)) append(portraitsByStem, base, file);
    }
  }
  for (const file of portraitFiles) {
    const directory = pairingDirectory(file, shared ? null : portraitRoot);
    const bases = portraitStems(file);
    const matches = unique(bases.flatMap(base => tokensByKey.get(JSON.stringify([directory, base])) || []));
    // Lists may point to separate roots without naming either root. Only an unambiguous match is safe there.
    const unambiguous = unique(bases.filter(base => portraitsByStem.get(base)?.length === 1)
      .flatMap(base => tokensByStem.get(base) || []));
    if (matches?.length) pairs.set(file, matches);
    else if (unambiguous.length === 1) pairs.set(file, unambiguous);
  }
  return pairs;
}

function portraitStems(file) {
  return unique([normalizeStem(assetStem(file)), pairBase(file)]);
}

function folderSource(value) {
  return typeof value === "string" && !isImagePath(value) ? normalizeFoundryPath(value) : "";
}

function assetDirectory(path) {
  const clean = normalizeFoundryPath(String(path).split(/[?#]/, 1)[0]);
  return clean.slice(0, Math.max(0, clean.lastIndexOf("/"))).split("/").map(decodePathPart).join("/");
}

function pairingDirectory(file, root) {
  const dir = assetDirectory(file);
  if (!root) return dir;
  const decodedRoot = root.split("/").map(decodePathPart).join("/");
  return dir === decodedRoot ? "" : relativeFoundryPath(decodedRoot, dir) || dir;
}

export function pairBase(path) {
  return normalizeStem(assetStem(path).replace(/[-_\s]+(?:portrait|actor|avatar)$/i, ""));
}

export function assetStem(path) {
  const clean = normalizeFoundryPath(String(path).split(/[?#]/, 1)[0]);
  const rawFile = clean.split("/").pop() || clean;
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
      patterns: unique(splitTokenNamePatterns(rulesOrSuffixes.patterns))
    };
  }

  if (maybeSet) return getTokenRules(maybeSet);
  if (Array.isArray(rulesOrSuffixes)) return { suffixes: unique(rulesOrSuffixes.map(String).filter(Boolean)), patterns: getGlobalTokenNamePatterns() };
  return getTokenRules(rulesOrSuffixes || {});
}

export function getTokenBaseCandidates(stem, rules) {
  const cleanStem = String(stem || "");
  const candidates = new Set();
  for (const suffix of rules.suffixes || []) {
    const suffixBase = stripTokenSuffix(cleanStem, [suffix]);
    if (normalizeStem(suffixBase) !== normalizeStem(cleanStem)) candidates.add(suffixBase);
  }

  for (const pattern of rules.patterns || []) {
    const match = matchTokenPattern(cleanStem, pattern);
    if (match) candidates.add(match);
  }

  candidates.add(cleanStem);
  return [...candidates].filter(Boolean);
}

export function matchTokenPattern(stem, pattern) {
  const source = normalizeVisibleSpaces(decodePathPart(String(pattern || "").trim()));
  const pieces = source.split("{id}");
  if (pieces.length !== 2) return null;

  const cleanStem = normalizeVisibleSpaces(decodePathPart(String(stem || "")));
  const patternRegex = "^" + pieces.map(escapeRegExp).join("(.+?)") + "$";
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

export function samePath(a, b) {
  if (!a || !b) return false;
  return normalizeFoundryPath(a) === normalizeFoundryPath(b);
}

export function validateArtSet(set, key = "") {
  const errors = [];
  const warnings = [];
  if (!set || typeof set !== "object" || Array.isArray(set)) {
    errors.push(game.i18n.localize("FBL_CF.Manager.InvalidObject"));
    return { key, valid: false, errors, warnings };
  }

  const directFields = ["folder", "portraitFolder", "tokenFolder", "portraitFiles", "tokenFiles", "portraits", "tokens"];
  const branchFields = ["folders", "cultures", "byCulture", "byGender", "byGenderCulture", "male", "female", "neutral", "default"];
  const validSource = value => typeof value === "string" ? Boolean(value.trim())
    : Array.isArray(value) && value.length > 0 && value.every(path => typeof path === "string" && isImagePath(path.trim()));
  const hasBranch = value => validSource(value) || (value && typeof value === "object" && !Array.isArray(value)
    && (isArtBranchConfig(value) ? validateSources(value, directFields).length === 0 : Object.values(value).some(hasBranch)));
  errors.push(...validateSources(set, directFields));
  const hasDirectSource = directFields.some(field => validSource(set[field]));
  const hasBranches = branchFields.some(field => hasBranch(set[field]));
  if (!hasDirectSource && !hasBranches) errors.push(game.i18n.localize("FBL_CF.Manager.MissingArtSource"));
  if (set.pairByName && !getArtSources(set).shared && !getArtSources(set).token && !hasBranches) {
    warnings.push(game.i18n.localize("FBL_CF.Manager.MissingTokenSource"));
  }
  if (set.source && !["data", "public", "s3"].includes(set.source)) warnings.push(game.i18n.format("FBL_CF.Manager.UnknownFileSource", { source: set.source }));
  return { key, valid: !errors.length, errors, warnings };
}

function validateSources(set, fields) {
  return fields.filter(field => {
    const value = set[field];
    if (value == null || value === "") return false;
    if (field === "folder" || field.endsWith("Folder")) return typeof value !== "string";
    return !(typeof value === "string" || Array.isArray(value) && value.every(path => typeof path === "string" && isImagePath(path.trim())));
  }).map(field => game.i18n.format("FBL_CF.Manager.InvalidArtSource", { field }));
}

export function validateArtSets(artSets = getArtSets()) {
  return Object.entries(artSets || {}).map(([key, set]) => validateArtSet(set, key));
}
