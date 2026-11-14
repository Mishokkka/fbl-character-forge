import { getArtSets, getNameSets, setArtSets, setNameSets } from "./settings.js";
import { getSetAliases } from "../utils.js";
import { validateArtSet } from "./art.js";
import { validateNameSet } from "./names.js";

export function isConfigKey(key) {
  return typeof key === "string" && /^[A-Za-z0-9_-]+$/.test(key) && !["random", "none", "prototype"].includes(key)
    && !Object.hasOwn(Object.prototype, key);
}

function validateConfigKeys(data) {
  const used = new Set();
  for (const [key, set] of Object.entries(data)) {
    if (set?.aliases != null && !Array.isArray(set.aliases)) {
      throw new Error(game.i18n.format("FBL_CF.Manager.InvalidSetKey", { key }));
    }
    for (const candidate of [key, ...getSetAliases(set)]) {
      if (!isConfigKey(candidate)) throw new Error(game.i18n.format("FBL_CF.Manager.InvalidSetKey", { key: candidate }));
      if (used.has(candidate)) throw new Error(`${game.i18n.localize("FBL_CF.Manager.KeyExists")} (${candidate})`);
      used.add(candidate);
    }
  }
}

export async function updateConfig({ mode, changes = {}, remove = [], expected, createDraft = false }) {
  const names = mode === "names";
  if (!names && mode !== "art") throw new Error("Unknown Character Forge configuration");
  const data = names ? getNameSets() : getArtSets();
  for (const key of [...Object.keys(changes), ...remove]) {
    if (!isConfigKey(key)) throw new Error(game.i18n.localize("FBL_CF.Manager.InvalidKey"));
    if (!Object.hasOwn(expected ?? {}, key) || JSON.stringify(data[key] ?? null) !== JSON.stringify(expected[key])) {
      throw new Error(game.i18n.localize("FBL_CF.Manager.ConcurrentEdit"));
    }
  }
  for (const key of remove) delete data[key];
  for (const [key, value] of Object.entries(changes)) {
    const validation = names ? validateNameSet(value, key)
      : validateArtSet(value, key, { allowEmpty: createDraft && expected[key] === null });
    if (!validation.valid) throw new Error(validation.errors.join(" "));
    if (value.aliases != null && !Array.isArray(value.aliases)) {
      throw new Error(game.i18n.format("FBL_CF.Manager.InvalidSetKey", { key }));
    }
    // Existing aliases keep stored settings and references to the same set resolvable.
    const aliases = [...new Set([...getSetAliases(data[key]), ...getSetAliases(value)])];
    data[key] = aliases.length ? { ...value, aliases } : value;
  }
  validateConfigKeys(data);
  if (names) await setNameSets(data);
  else await setArtSets(data);
  return data;
}
