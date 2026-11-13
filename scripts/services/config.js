import { getArtSets, getNameSets, setArtSets, setNameSets } from "./settings.js";
import { getSetAliases, resolveSetKey } from "../utils.js";
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

export async function updateConfig({ mode, changes, expected, createDraft = false }) {
  const names = mode === "names";
  if (!names && mode !== "art") throw new Error("Unknown Character Forge configuration");
  const data = names ? getNameSets() : getArtSets();
  const validate = names ? validateNameSet : validateArtSet;
  for (const [key, value] of Object.entries(changes)) {
    if (JSON.stringify(data[key] ?? null) !== JSON.stringify(expected[key])) {
      throw new Error(game.i18n.localize("FBL_CF.Manager.ConcurrentEdit"));
    }
    if (value === null) delete data[key];
    else {
      if (!isConfigKey(key)) throw new Error(game.i18n.localize("FBL_CF.Manager.InvalidKey"));
      if (!createDraft || expected[key] !== null) {
        const validation = validate(value, key);
        if (!validation.valid) throw new Error(validation.errors.join(" "));
      }
      // Existing aliases keep stored settings and references to the same set resolvable.
      const aliases = [...new Set([...getSetAliases(data[key]), ...getSetAliases(value)])];
      for (const alias of aliases) {
        const owner = resolveSetKey(data, alias);
        if (owner && owner !== key && changes[owner] !== null) {
          throw new Error(game.i18n.format("FBL_CF.Manager.InvalidSetKey", { key: alias }));
        }
      }
      data[key] = aliases.length ? { ...value, aliases } : value;
    }
  }
  validateConfigKeys(data);
  if (names) await setNameSets(data);
  else await setArtSets(data);
  return data;
}
