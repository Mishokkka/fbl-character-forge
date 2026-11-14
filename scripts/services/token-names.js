import { MODULE_ID } from "../constants.js";
import { getNameSets } from "./settings.js";
import { generateName } from "./names.js";
import { escapeHtml, getPropertyCompat, randomOf, resolveSetKey } from "../utils.js";

function localize(key, fallback) {
  const value = game.i18n?.localize?.(key);
  return value && value !== key ? value : fallback;
}

export function randomizeSceneTokenNamePre(tokenDocument, data = {}, options = {}, userId = null) {
  if (userId && userId !== game.user.id) return;
  if (options.keepId || data.flags?.[MODULE_ID]?.randomTokenNameRolled) return;
  const payload = buildRandomSceneTokenNamePayload(tokenDocument, data, "preCreateToken");
  try {
    if (payload) tokenDocument.updateSource(payload);
    // Foundry v13 drops randomImg from placed tokens. Persist an explicit opt-out for the post-create hook and HUD.
    if (wildcardValue(data) === false) tokenDocument.updateSource({ ["flags." + MODULE_ID + ".wildcardToken"]: false });
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not set random scene token name during preCreateToken`, err);
  }
}

export async function randomizeSceneTokenNamePost(tokenDocument, options = {}, userId = null) {
  if ((userId && userId !== game.user.id) || !tokenDocument || options.keepId) return;
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
  const setKey = resolveRandomTokenNameSet(mode, nameSets, { useFallback: options.useFallback });
  if (!setKey) return null;

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
  current = resolveSetKey(nameSets, current) || current;
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

export function resolveRandomTokenNameSet(mode, nameSets = getNameSets(), { useFallback = true } = {}) {
  if (!mode || mode === "none") return null;
  if (mode !== "random") return resolveSetKey(nameSets, mode);
  const fallback = useFallback ? game.settings.get(MODULE_ID, "randomTokenNameFallback") : null;
  return resolveSetKey(nameSets, fallback) || randomOf(Object.keys(nameSets));
}

export function getTokenRandomNameMode(tokenDocument, sourceData = null) {
  const flagPath = `flags.${MODULE_ID}.randomTokenName`;
  const actor = getActorFromTokenData(tokenDocument, sourceData);
  const candidates = [
    sourceData,
    tokenDocument,
    tokenDocument?._source,
    actor?.prototypeToken,
    actor
  ].filter(Boolean);

  for (const candidate of candidates) {
    const direct = getPropertyCompat(candidate, flagPath);
    if (direct) return direct;
    const viaGetFlag = candidate?.getFlag?.(MODULE_ID, "randomTokenName");
    if (viaGetFlag) return viaGetFlag;
  }
  return tokenDocument?.getFlag?.(MODULE_ID, "randomTokenNameRolled")?.mode
    || getPropertyCompat(sourceData, "flags." + MODULE_ID + ".randomTokenNameRolled.mode") || null;
}

export function getFormRandomNameMode(form) {
  return form?.querySelector?.(`[name="flags.${MODULE_ID}.randomTokenName"]`)?.value || null;
}

export async function rerollPlacedTokenName(tokenDocument, { modeOverride = null, useFallback = true } = {}) {
  if (!tokenDocument) return null;
  const payload = buildRandomSceneTokenNamePayload(
    tokenDocument,
    tokenDocument.toObject?.(true) ?? {},
    "manualReroll",
    { modeOverride, useFallback, ignoreLock: true }
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
  const tokenOverride = [sourceData, tokenDocument, tokenDocument?._source].map(wildcardValue).find(value => value !== undefined);
  if (tokenOverride !== undefined) return tokenOverride;
  if (sourceData?.flags?.[MODULE_ID]?.wildcardToken === false || tokenDocument?.flags?.[MODULE_ID]?.wildcardToken === false) return false;
  return wildcardValue(actor?.prototypeToken) ?? false;
}

function wildcardValue(data) {
  for (const value of [data?.randomImg, data?.texture?.randomImg]) {
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
  }
  return undefined;
}

export function getActorFromTokenData(tokenDocument, sourceData = null) {
  const actor = tokenDocument?.baseActor || tokenDocument?.actor;
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
  return input?.type === "checkbox" ? input.checked : input?.value === "true";
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
