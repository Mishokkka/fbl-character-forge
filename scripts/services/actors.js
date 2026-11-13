import { ACTOR_TYPE, FALLBACK_IMAGE, MODULE_ID } from "../constants.js";
import { getArtSets, getNameSets } from "./settings.js";
import { generateNameDetailed, normalizeNameSetKey } from "./names.js";
import { normalizeGenderKey, rollArt } from "./art.js";
import { markAssetsUsed, shouldUseAssetRegistry, withAssetRegistryLock } from "./asset-registry.js";
import { deepMerge, randomOf, safeDefaultKey } from "../utils.js";
import { applyProfileToActorData, generateNpcProfile } from "./profiles.js";

export async function createActorFromApi(options = {}) {
  if (!game.user?.isGM) throw new Error("Только ГМ может создавать актёров через Character Forge API.");
  return withAssetRegistryLock(() => createActorUnlocked(options));
}

async function createActorUnlocked(options = {}) {
  const warnings = [];
  const nameSets = getNameSets();
  const artSets = getArtSets();
  const type = options.type || options.actorType || ACTOR_TYPE;
  const isForgeActor = type === ACTOR_TYPE;

  const requestedNameSet = normalizeNameSetKey(
    options.nameSetKey || options.cultureKey || game.settings.get(MODULE_ID, "defaultNameSet"),
    nameSets
  );
  const nameSetKey = requestedNameSet === "random"
    ? randomOf(Object.keys(nameSets))
    : safeDefaultKey(nameSets, requestedNameSet);
  const requestedGender = options.gender || "random";
  const explicitResolvedGender = normalizeGenderKey(options.resolvedGender || "random");
  const nameDetails = options.name
    ? {
        name: String(options.name).trim(),
        gender: explicitResolvedGender !== "random" ? explicitResolvedGender : normalizeGenderKey(requestedGender),
        setKey: options.resolvedNameSetKey || nameSetKey
      }
    : generateNameDetailed(nameSetKey, requestedGender);

  if (!nameDetails.name) throw new Error("Не удалось определить имя актёра.");

  const artSetKey = options.artSetKey || options.artSet || game.settings.get(MODULE_ID, "defaultArtSet");
  const assignArt = isForgeActor && (options.assignArt ?? game.settings.get(MODULE_ID, "assignArt"));
  const explicitArt = options.art && typeof options.art === "object"
    ? { portrait: options.art.portrait || "", token: options.art.token || "" }
    : { portrait: options.portrait || "", token: options.token || "" };
  let art = { ...explicitArt };
  let artError = null;

  if (assignArt && !art.portrait && !art.token && artSetKey && artSets[artSetKey]) {
    try {
      art = await rollArt(artSetKey, {
        nameSetKey,
        cultureKey: nameSetKey,
        resolvedNameSetKey: nameDetails.setKey || nameSetKey,
        resolvedCultureKey: nameDetails.setKey || nameSetKey,
        selectedGender: requestedGender,
        resolvedGender: nameDetails.gender,
        gender: nameDetails.gender || requestedGender,
        artSubsetKey: options.artSubsetKey || options.artSubset || options.artSubfolder || "general",
        fallbackArtSubset: options.fallbackArtSubset
      });
    } catch (err) {
      artError = err;
      warnings.push(err?.message || String(err));
      if (options.requireArt) throw err;
      console.warn(`${MODULE_ID} | API actor art roll failed`, err);
    }
  } else if (assignArt && artSetKey && !artSets[artSetKey]) {
    const message = `Набор артов не найден: ${artSetKey}`;
    warnings.push(message);
    if (options.requireArt) throw new Error(message);
  }

  const folderId = await resolveActorFolderId(options);
  const templateData = await resolveActorTemplateData(options.templateUuid);
  const createData = deepMerge(templateData, options.actorData || options.data || {});
  const generateProfile = isForgeActor && (options.generateProfile ?? game.settings.get(MODULE_ID, "generateProfile"));
  const profile = generateProfile
    ? (options.profileData || generateNpcProfile({
        roleKey: options.profileRoleKey || options.profileRole || "random",
        tierKey: options.profileTierKey || options.profileTier || "random",
        gender: nameDetails.gender || requestedGender
      }))
    : null;

  if (profile) {
    applyProfileToActorData(createData, profile, {
      overwrite: options.profileOverwrite ?? !options.templateUuid
    });
  }

  const externalFlags = options.flags && typeof options.flags === "object" ? foundry.utils.deepClone(options.flags) : {};
  deepMerge(createData, { flags: externalFlags });
  deepMerge(createData, {
    name: nameDetails.name,
    type,
    folder: folderId || null
  });

  if (isForgeActor) {
    deepMerge(createData, {
      flags: {
        [MODULE_ID]: {
          nameSet: nameSetKey,
          gender: requestedGender,
          resolvedGender: nameDetails.gender && nameDetails.gender !== "random" ? nameDetails.gender : null,
          resolvedNameSet: nameDetails.setKey || nameSetKey,
          artSet: artSetKey || null,
          artSubset: art.artSubsetKey || options.artSubsetKey || options.artSubset || options.artSubfolder || "general",
          portrait: art.portrait || null,
          token: art.token || null,
          createdViaApi: options.createdViaApi !== false,
          sourceModule: options.sourceModule || null,
          purpose: options.purpose || null,
          artError: artError?.message || null,
          assetUsage: assignArt && (art.portrait || art.token) ? "active" : null,
          generatedProfile: profile ? {
            role: profile.roleKey,
            tier: profile.tierKey,
            profession: profile.profession,
            bioLanguage: profile.bioLanguage || "ru",
            generatedAt: profile.generatedAt
          } : null
        }
      }
    });
  }

  if (assignArt) {
    const actorImg = art.portrait || art.token || createData.img || options.fallbackImage || FALLBACK_IMAGE;
    const tokenImg = art.token || art.portrait || createData.prototypeToken?.texture?.src || createData.img || options.fallbackImage || FALLBACK_IMAGE;
    deepMerge(createData, {
      img: actorImg,
      prototypeToken: {
        name: nameDetails.name,
        texture: { src: tokenImg }
      }
    });
  }

  delete createData._id;
  const suppliedDocumentClass = options.documentClass?.implementation ?? options.documentClass;
  const ActorClass = suppliedDocumentClass || globalThis.Actor?.implementation || globalThis.Actor;
  if (!ActorClass?.create) throw new Error("Actor.create недоступен.");
  const actor = await ActorClass.create(createData, options.createOptions || {});

  if (actor && assignArt && artSetKey && (art.portrait || art.token)) {
    const set = artSets[artSetKey];
    if (options.markUsed !== false && shouldUseAssetRegistry(set)) {
      try {
        await markAssetsUsed(artSetKey, art, actor);
      } catch (err) {
        warnings.push("Актёр создан, но реестр занятости артов не удалось обновить.");
        console.warn(`${MODULE_ID} | Actor was created but asset registry update failed.`, err);
      }
    }
  }

  const openSheet = options.openSheet ?? !options.sourceModule;
  if (openSheet) {
    try {
      actor?.sheet?.render?.(true);
    } catch (err) {
      warnings.push("Актёр создан, но его лист не удалось открыть.");
      console.warn(`${MODULE_ID} | API actor was created but sheet could not be opened.`, err);
    }
  }

  return {
    actor,
    nameDetails,
    nameSetKey: nameDetails.setKey || nameSetKey,
    gender: nameDetails.gender || requestedGender,
    artSetKey,
    art,
    artError,
    profile,
    warnings
  };
}

export async function createActorsBatch(options = {}) {
  if (!game.user?.isGM) throw new Error("Только ГМ может создавать актёров через Character Forge API.");
  const count = Math.max(1, Math.min(100, Number(options.count) || 1));
  const created = [];
  const errors = [];

  for (let index = 0; index < count; index += 1) {
    try {
      const result = await createActorFromApi({
        ...options,
        count: undefined,
        name: undefined,
        art: undefined,
        portrait: undefined,
        token: undefined,
        openSheet: false
      });
      created.push(result);
      await notifyBatchProgress(options.onProgress, {
        index: index + 1, completed: index + 1, total: count, count, result, created, errors
      });
    } catch (error) {
      errors.push({ index, error, message: error?.message || String(error) });
      await notifyBatchProgress(options.onProgress, {
        index: index + 1, completed: index + 1, total: count, count, error, created, errors
      });
      if (options.stopOnError) break;
    }
  }

  return { results: created, created, errors, count };
}


async function notifyBatchProgress(callback, payload) {
  if (typeof callback !== "function") return;
  try {
    await callback(payload);
  } catch (err) {
    console.warn(`${MODULE_ID} | Batch progress callback failed`, err);
  }
}

export async function resolveActorTemplateData(templateUuid) {
  if (!templateUuid) return {};
  const template = await fromUuid(templateUuid);
  if (!template || template.documentName !== "Actor") throw new Error(`Actor-шаблон не найден: ${templateUuid}`);
  const data = template.toObject();
  delete data._id;
  delete data.folder;
  delete data.sort;
  return data;
}

export async function resolveActorFolderId(options = {}) {
  const explicit = options.folderId || options.folder;
  if (explicit) return typeof explicit === "string" ? explicit : explicit.id;

  const folderName = String(options.folderName || "").trim();
  if (!folderName) return null;

  const parentId = options.parentFolderId || null;
  const existing = game.folders?.find?.(folder => folder.type === "Actor" && folder.name === folderName && (folder.folder?.id || folder.folder || null) === parentId);
  if (existing) return existing.id;
  if (options.createFolder === false) return null;

  const FolderClass = globalThis.Folder?.implementation ?? globalThis.Folder;
  const folder = await FolderClass.create({ name: folderName, type: "Actor", folder: parentId });
  return folder?.id || null;
}
