import { ACTOR_TYPE } from "../constants.js";

const OVERRIDES_SETTING = "prototypeTokenOverrides";
const NUMERIC_TOKEN_FIELDS = ["displayName", "disposition", "width", "height"];
export const FORGE_TOKEN_FIELDS = ["name", ...NUMERIC_TOKEN_FIELDS];

export function getTokenChoices() {
  return { displayName: CONST.TOKEN_DISPLAY_MODES, disposition: CONST.TOKEN_DISPOSITIONS };
}

export function getWorldTokenOverrides(type) {
  const settings = game.settings;
  if (!settings.settings.has(`core.${OVERRIDES_SETTING}`)) return {};
  const overrides = settings.get("core", OVERRIDES_SETTING);
  const result = {};
  for (const [field, choices] of Object.entries(getTokenChoices())) {
    const value = overrides?.[type]?.[field] ?? overrides?.base?.[field];
    if (Object.values(choices).includes(value)) result[field] = value;
  }
  return result;
}

export function normalizeForgePrototypeToken(input, { strict = false } = {}) {
  const token = {};
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  if (name) token.name = name;

  const choices = getTokenChoices();
  for (const field of NUMERIC_TOKEN_FIELDS) {
    const raw = input?.[field];
    if (raw == null || raw === "") continue;
    const value = typeof raw === "number" || (typeof raw === "string" && raw.trim()) ? Number(raw) : NaN;
    const valid = choices[field] ? Object.values(choices[field]).includes(value) : Number.isFinite(value) && value > 0;
    if (valid) token[field] = value;
    else if (strict) {
      const namespace = choices[field] ? "TOKEN" : "DOCUMENT";
      const key = choices[field] ? "InvalidTokenField" : "InvalidTokenDimension";
      const label = game.i18n.localize(`${namespace}.FIELDS.${field}.label`);
      throw new Error(game.i18n.format(`FBL_CF.Forge.${key}`, { field: label }));
    }
  }
  return token;
}

export function applySavedTokenDefaults(actorData) {
  if (actorData.type !== ACTOR_TYPE) return;
  const overrides = getWorldTokenOverrides(actorData.type);
  const legacy = getLegacyDefaults(game.settings);
  const token = actorData.prototypeToken ??= {};

  for (const [field, choices] of Object.entries(getTokenChoices())) {
    if (token[field] != null) continue;
    const value = overrides[field] ?? legacy?.[field];
    if (Object.values(choices).includes(value)) token[field] = value;
  }
}

function getLegacyDefaults(settings) {
  // Foundry v13 replaced defaultToken, but upgraded worlds can still contain the saved value.
  const saved = settings.storage.get("world")?.getSetting("core.defaultToken")?.value;
  if (typeof saved !== "string") return saved;
  try { return JSON.parse(saved); }
  catch { return null; }
}
