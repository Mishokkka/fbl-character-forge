import { MODULE_ID } from "../constants.js";
import { getNameSets } from "./settings.js";
import { generateName } from "./names.js";
import { escapeHtml, getPropertyCompat, randomOf } from "../utils.js";

function localize(key, fallback) {
  const value = game.i18n?.localize?.(key);
  return value && value !== key ? value : fallback;
}

export function randomizeSceneTokenNamePre(tokenDocument, data = {}, options = {}, userId = null) {
  if (userId && userId !== game.user.id) return;
  const payload = buildRandomSceneTokenNamePayload(tokenDocument, data, "preCreateToken");
  if (!payload) return;
  try {
    tokenDocument.updateSource(payload);
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not set random scene token name during preCreateToken`, err);
  }
}

export async function randomizeSceneTokenNamePost(tokenDocument, options = {}, userId = null) {
  if (userId && userId !== game.user.id || !tokenDocument) return;
  const alreadyRolled = tokenDocument.getFlag?.(MODULE_ID, "randomTokenNameRolled")
    || getPropertyCompat(tokenDocument?._source, `flags.${MODULE_ID}.randomTokenNameRolled`);
  if (alreadyRolled) return;

  const payload = buildRandomSceneTokenNamePayload(tokenDocument, tokenDocument.toObject?.(true) ?? {}, "createToken");
  if (!payload) return;
  try {
    await tokenDocument.update(payload);
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not set random scene token name during createToken`, err);
  }
}

export function buildRandomSceneTokenNamePayload(tokenDocument, data = {}, phase = "unknown", options = {}) {
  if (!tokenDocument) return null;
  if (!options.allowNonWildcard && !isWildcardToken(tokenDocument, data)) return null;
  const locked = tokenDocument.getFlag?.(MODULE_ID, "tokenNameLocked")
    || getPropertyCompat(data, `flags.${MODULE_ID}.tokenNameLocked`);
  if (locked && !options.ignoreLock) return null;

  const mode = options.modeOverride || getTokenRandomNameMode(tokenDocument, data);
  if (!mode || mode === "none") return null;
  const nameSets = getNameSets();
  const setKey = resolveRandomTokenNameSet(mode, nameSets);
  if (!setKey || !nameSets[setKey]) return null;

  const name = generateName(setKey, options.gender || "random");
  if (!name) return null;

  return {
    name,
    [`flags.${MODULE_ID}.randomTokenNameRolled`]: {
      mode,
      setKey,
      phase,
      actorName: tokenDocument.actor?.name || tokenDocument.baseActor?.name || null,
      rolledAt: new Date().toISOString()
    }
  };
}

export function buildRandomTokenNameOptions(current = "none") {
  const nameSets = getNameSets();
  const options = [
    ["none", localize("FBL_CF.TokenNames.None", "Нет")],
    ["random", localize("FBL_CF.TokenNames.Random", "Случайная культура")]
  ];
  for (const [key, set] of Object.entries(nameSets)) options.push([key, set?.label || key]);

  return options.map(([value, label]) => {
    const selected = value === current ? "selected" : "";
    return `<option value="${escapeHtml(value)}" ${selected}>${escapeHtml(label)}</option>`;
  }).join("");
}

export function resolveRandomTokenNameSet(mode, nameSets = getNameSets()) {
  if (!mode || mode === "none") return null;
  if (mode !== "random") return nameSets[mode] ? mode : null;
  const fallback = game.settings.get(MODULE_ID, "randomTokenNameFallback");
  if (fallback && fallback !== "random" && nameSets[fallback]) return fallback;
  return randomOf(Object.keys(nameSets));
}

export function getTokenRandomNameMode(tokenDocument, sourceData = null) {
  const flagPath = `flags.${MODULE_ID}.randomTokenName`;
  const actor = getActorFromTokenData(tokenDocument, sourceData);
  const candidates = [
    sourceData,
    tokenDocument?._source,
    tokenDocument?.toObject?.(true),
    tokenDocument,
    tokenDocument?.baseActor,
    tokenDocument?.actor,
    tokenDocument?.actor?.prototypeToken,
    tokenDocument?.actor?._source?.prototypeToken,
    actor,
    actor?.prototypeToken,
    actor?._source?.prototypeToken
  ].filter(Boolean);

  for (const candidate of candidates) {
    const direct = getPropertyCompat(candidate, flagPath);
    if (direct) return direct;
    const viaGetFlag = candidate?.getFlag?.(MODULE_ID, "randomTokenName");
    if (viaGetFlag) return viaGetFlag;
    const rolledDirect = getPropertyCompat(candidate, `flags.${MODULE_ID}.randomTokenNameRolled.mode`);
    if (rolledDirect) return rolledDirect;
    const rolledViaFlag = candidate?.getFlag?.(MODULE_ID, "randomTokenNameRolled");
    if (rolledViaFlag?.mode) return rolledViaFlag.mode;
  }
  return null;
}

export function getFormRandomNameMode(form) {
  return form?.querySelector?.(`[name="flags.${MODULE_ID}.randomTokenName"]`)?.value || null;
}

export async function rerollPlacedTokenName(tokenDocument, { modeOverride = null } = {}) {
  if (!tokenDocument) return null;
  const payload = buildRandomSceneTokenNamePayload(
    tokenDocument,
    tokenDocument.toObject?.(true) ?? {},
    "manualReroll",
    { modeOverride, ignoreLock: true }
  );
  if (!payload) return null;
  await tokenDocument.update(payload);
  return payload.name;
}

export async function restorePlacedTokenName(tokenDocument) {
  if (!tokenDocument) return null;
  const actorName = tokenDocument.actor?.name
    || tokenDocument.baseActor?.name
    || tokenDocument.getFlag?.(MODULE_ID, "randomTokenNameRolled")?.actorName;
  if (!actorName) return null;
  await tokenDocument.update({
    name: actorName,
    [`flags.${MODULE_ID}.randomTokenNameRolled`]: {
      mode: getTokenRandomNameMode(tokenDocument) || "none",
      restored: true,
      actorName,
      rolledAt: new Date().toISOString()
    }
  });
  return actorName;
}

export async function rerollControlledTokenNames({ modeOverride = null } = {}) {
  const controlled = Array.from(canvas?.tokens?.controlled || []).map(token => token.document).filter(Boolean);
  const results = [];
  const errors = [];
  for (const token of controlled) {
    try {
      const name = await rerollPlacedTokenName(token, { modeOverride });
      if (name) results.push({ token, name });
    } catch (error) {
      errors.push({ token, error });
    }
  }
  return { results, errors };
}

export function isWildcardToken(tokenDocument, sourceData = null) {
  const actor = getActorFromTokenData(tokenDocument, sourceData);
  const candidates = [
    sourceData,
    tokenDocument?._source,
    tokenDocument?.toObject?.(true),
    tokenDocument,
    tokenDocument?.baseActor,
    tokenDocument?.actor,
    tokenDocument?.actor?.prototypeToken,
    tokenDocument?.actor?._source?.prototypeToken,
    actor,
    actor?.prototypeToken,
    actor?._source?.prototypeToken
  ].filter(Boolean);

  return candidates.some(data => {
    return data?.randomImg === true
      || data?.randomImg === "true"
      || getPropertyCompat(data, "randomImg") === true
      || getPropertyCompat(data, "randomImg") === "true"
      || getPropertyCompat(data, "texture.randomImg") === true
      || getPropertyCompat(data, "texture.randomImg") === "true";
  });
}

export function getActorFromTokenData(tokenDocument, sourceData = null) {
  const actor = tokenDocument?.actor || tokenDocument?.baseActor;
  if (actor) return actor;
  const actorId = sourceData?.actorId
    || getPropertyCompat(sourceData, "actorId")
    || tokenDocument?.actorId
    || getPropertyCompat(tokenDocument?._source, "actorId");
  return actorId ? game.actors?.get?.(actorId) || null : null;
}

export function findWildcardInput(form) {
  return form.querySelector('[name="randomImg"]')
    || form.querySelector('[name="texture.randomImg"]')
    || Array.from(form.querySelectorAll('input[type="checkbox"]')).find(input => {
      const label = input.closest(".form-group")?.querySelector("label")?.textContent || input.parentElement?.textContent || "";
      return /wildcard|randomize/i.test(label);
    });
}

export function getWildcardFormGroup(input) {
  return input?.closest?.(".form-group") || input?.closest?.("fieldset") || null;
}

export function isInputChecked(input) {
  return !!(input?.checked || input?.value === "true");
}

export function getTokenConfigDocument(app) {
  const candidates = [
    app?.document,
    app?.object,
    app?.token,
    app?.options?.document,
    app?.object?.prototypeToken,
    app?.document?.prototypeToken,
    app?.actor?.prototypeToken
  ].filter(Boolean);
  return candidates.find(doc => doc?.documentName === "Token")
    || candidates.find(doc => doc?.constructor?.name === "PrototypeToken")
    || candidates.find(doc => doc?._source?.texture || doc?._source?.randomImg)
    || candidates[0]
    || null;
}
