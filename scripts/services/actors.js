import { ACTOR_TYPE, MODULE_ID } from "../constants.js";
import { getArtSets, getNameSets } from "./settings.js";
import { generateNameDetailed, normalizeNameSetKey } from "./names.js";
import { normalizeArtSubsetKey, normalizeGenderKey, rollArt, resolveArtSetForContext } from "./art.js";
import { getUsedPathSet, markAssetsUsed, shouldUseAssetRegistry } from "./asset-registry.js";
import { deepMerge, normalizeFoundryPath, randomOf, resolveSetKey, safeDefaultKey } from "../utils.js";
import { applyProfileToActorData, generateNpcProfile } from "./profiles.js";
import { applySavedTokenDefaults } from "./token-defaults.js";
import { requireActiveGM, runOnActiveGM, runWorldOperation } from "./world-operations.js";

export async function createActorFromApi(options = {}) {
  if (!canCreateActors()) throw new Error(game.i18n.localize("FBL_CF.Status.OperationDenied"));
  const { documentClass, openSheet, ...data } = options;
  const ActorClass = globalThis.Actor?.implementation ?? globalThis.Actor;
  const suppliedClass = documentClass?.implementation ?? documentClass;
  let result;
  if (game.user.isActiveGM) {
    result = await runOnActiveGM(() => createActorDocument(data, suppliedClass || ActorClass));
  } else {
    if (suppliedClass && suppliedClass !== ActorClass) throw new Error(game.i18n.localize("FBL_CF.Status.LocalActorOptions"));
    const { actorUuid, ...created } = await runWorldOperation("createActor", data);
    const actor = await resolveCreatedActor(actorUuid);
    result = {
      ...created,
      artError: created.artError ? new Error(created.artError) : null,
      actor
    };
    if (!actor) throw new Error(game.i18n.format("FBL_CF.Status.ActorUnavailable", { uuid: actorUuid }));
  }

  if (openSheet ?? options.createOptions?.renderSheet ?? !options.sourceModule) {
    try {
      await result.actor.sheet?.render?.(true);
    } catch (err) {
      result.warnings.push(game.i18n.localize("FBL_CF.Status.SheetOpenFailed"));
      console.warn(`${MODULE_ID} | API actor was created but sheet could not be opened`, err);
    }
  }
  return result;
}

function canCreateActors() {
  return game.user?.isGM && game.user.can("ACTOR_CREATE");
}

async function resolveCreatedActor(uuid) {
  const actor = await fromUuid(uuid);
  if (actor || !uuid.startsWith("Actor.")) return actor;
  // A different client can receive the socket reply before processing the Actor creation event.
  return new Promise(resolve => {
    const finish = value => {
      Hooks.off("createActor", listener);
      clearTimeout(timeout);
      resolve(value);
    };
    const listener = Hooks.on("createActor", document => {
      if (document.uuid === uuid) finish(document);
    });
    const timeout = setTimeout(() => finish(game.actors.get(uuid.slice(6)) ?? null), 2000);
    const received = game.actors.get(uuid.slice(6));
    if (received) finish(received);
  });
}

export async function createActorForWorld(options, requestingUser) {
  const { actor, ...result } = await createActorDocument(options, undefined, requestingUser);
  return { ...result, artError: result.artError?.message || null, actorUuid: actor.uuid };
}

async function createActorDocument(options = {}, ActorClass = globalThis.Actor?.implementation ?? globalThis.Actor, requestingUser = game.user) {
  const warnings = [];
  const nameSets = getNameSets();
  const artSets = getArtSets();
  const templateData = await resolveActorTemplateData(options.templateUuid, requestingUser);
  const overrides = foundry.utils.expandObject(options.actorData || options.data || {});
  const templateType = templateData.type;
  const type = options.type || options.actorType || (overrides.type ?? templateType) || ACTOR_TYPE;
  if (!ActorClass?.create || (ActorClass.TYPES?.length && !ActorClass.TYPES.includes(type))) {
    throw new Error(game.i18n.format("FBL_CF.Status.InvalidActorType", { type }));
  }
  if (options.templateUuid && templateType !== type) {
    throw new Error(game.i18n.format("FBL_CF.Status.TemplateTypeMismatch", { type, templateType }));
  }
  const createData = deepMerge(templateData, overrides);
  const isForgeActor = type === ACTOR_TYPE;

  const requestedNameSet = normalizeNameSetKey(
    options.nameSetKey || options.cultureKey || game.settings.get(MODULE_ID, "defaultNameSet"),
    nameSets
  );
  const nameSetKey = requestedNameSet === "random"
    ? resolveSetKey(nameSets, options.resolvedNameSetKey) || randomOf(Object.keys(nameSets))
    : safeDefaultKey(nameSets, requestedNameSet);
  const requestedGender = options.gender || "random";
  const explicitResolvedGender = normalizeGenderKey(options.resolvedGender || "random");
  const providedName = String(options.name ?? "").trim();
  const nameDetails = providedName
    ? {
        name: providedName,
        gender: explicitResolvedGender !== "random" ? explicitResolvedGender : normalizeGenderKey(requestedGender),
        setKey: resolveSetKey(nameSets, options.resolvedNameSetKey) || nameSetKey
      }
    : generateNameDetailed(nameSetKey, requestedGender);

  const requestedArtSet = options.artSetKey || options.artSet || game.settings.get(MODULE_ID, "defaultArtSet");
  const artSetKey = resolveSetKey(artSets, requestedArtSet) || requestedArtSet;
  const set = Object.hasOwn(artSets, artSetKey) ? artSets[artSetKey] : null;
  const assignArt = isForgeActor && (options.assignArt ?? game.settings.get(MODULE_ID, "assignArt"));
  const artwork = options.art && typeof options.art === "object" ? options.art : options;
  const explicitArt = {
    portrait: normalizeFoundryPath(artwork.portrait),
    token: normalizeFoundryPath(artwork.token)
  };
  const context = {
    resolvedCultureKey: nameDetails.setKey || nameSetKey,
    resolvedGender: nameDetails.gender,
    gender: nameDetails.gender || requestedGender,
    artSubsetKey: options.artSubsetKey || options.artSubset || options.artSubfolder,
    fallbackArtSubset: options.fallbackArtSubset
  };
  let art = assignArt ? { ...explicitArt } : { portrait: "", token: "" };
  let artError = null;
  let trackAssetBranch = true;

  if (assignArt) {
    try {
      if (!requestingUser.can("FILES_BROWSE") && (!art.portrait && !art.token || options.previewArt)) {
        throw new Error(game.i18n.localize("FBL_CF.Status.OperationDenied"));
      }
      const resolved = set ? resolveArtSetForContext(set, context) : null;
      trackAssetBranch = resolved?.branchMarkUsed ?? true;
      const previewSubset = options.previewArt?.artSubsetKey;
      const subsetChanged = previewSubset && normalizeArtSubsetKey(previewSubset) !== resolved?.artSubsetKey;
      // The selection or availability can change while a preview is open. Check both before assigning art.
      const trackPreview = options.previewArt && trackAssetBranch && options.markUsed !== false;
      const used = trackPreview && !subsetChanged && shouldUseAssetRegistry(set)
        ? getUsedPathSet(artSetKey) : null;
      const previewIsUsed = used?.has(art.portrait) || used?.has(art.token);
      if ((!art.portrait && !art.token) || subsetChanged || previewIsUsed) {
        art = { portrait: "", token: "" };
        art = await rollArt(artSetKey, context, { resolved });
      } else if (previewSubset) art.artSubsetKey = resolved.artSubsetKey;
    } catch (err) {
      artError = err;
      warnings.push(err?.message || String(err));
      if (options.requireArt) throw err;
      console.warn(`${MODULE_ID} | API actor art roll failed`, err);
    }
  }

  if (options.requireArt && !art.portrait && !art.token) {
    throw new Error(game.i18n.localize("FBL_CF.Status.ArtRequired"));
  }
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
    createData.system.subtype ??= {};
    createData.system.subtype.type ||= "npc";
  }

  const externalFlags = options.flags && typeof options.flags === "object" ? foundry.utils.deepClone(options.flags) : {};
  const createOptions = { ...options.createOptions, renderSheet: false };
  if (requestingUser !== game.user && (createOptions.parent || createOptions.broadcast === false || createOptions.temporary)) {
    throw new Error(game.i18n.localize("FBL_CF.Status.LocalActorOptions"));
  }
  deepMerge(createData, { flags: externalFlags });
  deepMerge(createData, {
    name: nameDetails.name,
    type
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
          artSubset: art.artSubsetKey || context.artSubsetKey || "general",
          portrait: art.portrait || null,
          token: art.token || null,
          createdViaApi: options.createdViaApi !== false,
          sourceModule: options.sourceModule || null,
          purpose: options.purpose || null,
          artError: artError?.message || null,
          markUsed: options.markUsed !== false,
          trackAssetBranch,
          assetUsage: assignArt && set && (art.portrait || art.token) ? "active" : null,
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

  const prototypeName = overrides.prototypeToken?.name || nameDetails.name;
  deepMerge(createData, { prototypeToken: { name: prototypeName } });
  if (art.portrait || art.token) {
    deepMerge(createData, {
      img: art.portrait || art.token,
      prototypeToken: { randomImg: false, texture: { src: art.token || art.portrait } }
    });
  } else if (assignArt && !createData.img && options.fallbackImage) {
    createData.img = options.fallbackImage;
  }
  applySavedTokenDefaults(createData);

  delete createData._id;
  if (createData.prototypeToken?.randomImg && !requestingUser.can("FILES_BROWSE")) {
    throw new Error(game.i18n.localize("FBL_CF.Status.OperationDenied"));
  }
  requireActiveGM();
  createData.folder = await resolveActorFolderId({
    ...options, folder: options.folder ?? (options.folderName ? null : createData.folder)
  }, requestingUser);
  requireActiveGM();
  const actor = await ActorClass.create(createData, createOptions);
  if (!actor) throw new Error(game.i18n.localize("FBL_CF.Status.ActorNotCreated"));

  if (assignArt && options.markUsed !== false && trackAssetBranch && shouldUseAssetRegistry(set)
    && (art.portrait || art.token)) {
    try {
      requireActiveGM();
      await markAssetsUsed(artSetKey, actor);
    } catch (err) {
      warnings.push(game.i18n.localize("FBL_CF.Status.RegistryWriteFailed"));
      console.warn(`${MODULE_ID} | Actor was created but asset registry update failed`, err);
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
  if (!canCreateActors()) throw new Error(game.i18n.localize("FBL_CF.Status.OperationDenied"));
  const count = Math.max(1, Math.min(100, Math.trunc(Number(options.count)) || 1));
  const created = [];
  const errors = [];

  const { onProgress, stopOnError, ...actorOptions } = options;
  for (let index = 0; index < count; index += 1) {
    try {
      const result = await createActorFromApi({
        ...actorOptions,
        count: undefined,
        name: undefined,
        art: undefined,
        portrait: undefined,
        token: undefined,
        previewArt: undefined,
        resolvedNameSetKey: undefined,
        resolvedGender: undefined,
        openSheet: false
      });
      created.push(result);
      await notifyBatchProgress(onProgress, {
        index: index + 1, completed: index + 1, total: count, count, result, created, errors
      });
    } catch (error) {
      errors.push({ index, error, message: error?.message || String(error) });
      await notifyBatchProgress(onProgress, {
        index: index + 1, completed: index + 1, total: count, count, error, created, errors
      });
      if (stopOnError) break;
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

export async function resolveActorTemplateData(templateUuid, requestingUser = game.user) {
  if (!templateUuid) return {};
  const template = await fromUuid(templateUuid);
  if (template?.documentName !== "Actor" || !template.testUserPermission(requestingUser, "OBSERVER")) {
    throw new Error(game.i18n.format("FBL_CF.Status.TemplateNotFound", { uuid: templateUuid }));
  }
  const data = template.toObject();
  delete data._id;
  delete data.folder;
  delete data.sort;
  delete data._stats;
  if (data.flags) delete data.flags[MODULE_ID];
  return data;
}

export async function resolveActorFolderId(options = {}, requestingUser = game.user) {
  const explicit = options.folderId || options.folder;
  if (explicit) return typeof explicit === "string" ? explicit : explicit.id ?? explicit._id;

  const folderName = String(options.folderName || "").trim();
  if (!folderName) return null;

  const parentId = options.parentFolderId || null;
  if (options.createOptions?.pack) throw new Error(game.i18n.localize("FBL_CF.Status.WorldFolderOnly"));
  const existing = game.folders?.find?.(folder => folder.type === "Actor" && folder.name === folderName && (folder.folder?.id || folder.folder || null) === parentId);
  if (existing) return existing.id;
  if (options.createFolder === false) return null;

  const FolderClass = globalThis.Folder?.implementation ?? globalThis.Folder;
  if (!FolderClass.canUserCreate(requestingUser)) throw new Error(game.i18n.localize("FBL_CF.Status.OperationDenied"));
  const folder = await FolderClass.create({ name: folderName, type: "Actor", folder: parentId });
  if (!folder) throw new Error(game.i18n.localize("FBL_CF.Status.FolderNotCreated"));
  return folder.id;
}
