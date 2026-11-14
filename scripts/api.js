import { MODULE_ID, getRuntimeModuleVersion } from "./constants.js";
import { CharacterForgeApp } from "./apps/character-forge-app.js";
import { CharacterForgeDiagnosticsApp } from "./apps/diagnostics-app.js";
import { ArtSetManagerApp, NameSetManagerApp } from "./apps/config-manager-app.js";
import { TokenNamePatternSettingsApp } from "./apps/token-name-patterns-app.js";
import { getArtSets, getNameSets } from "./services/settings.js";
import { generateName, generateNameDetailed, normalizeNameSetKey, previewNames } from "./services/names.js";
import { getArtSubsetOptions, inspectArtSet, rollArt } from "./services/art.js";
import { clearAssetBrowseCache, getAssetBrowseCacheStats } from "./services/asset-browser.js";
import {
  cleanupOrphanedAssets,
  exportAssetRegistry,
  getAssetRegistryStats,
  resetUsedAssetsForSet
} from "./services/asset-registry.js";
import { createActorFromApi, createActorsBatch } from "./services/actors.js";
import { rerollControlledTokenNames } from "./services/token-names.js";
import { generateNpcProfile, profileToSystemData } from "./services/profiles.js";

export function registerPublicApi() {
  game.fblCharacterForge = {
    moduleId: MODULE_ID,
    version: getRuntimeModuleVersion(),
    openForge: (options = {}) => CharacterForgeApp.open(options),
    openDiagnostics: (options = {}) => CharacterForgeDiagnosticsApp.open(options),
    openNameSetManager: (options = {}) => NameSetManagerApp.open(options),
    openArtSetManager: (options = {}) => ArtSetManagerApp.open(options),
    openTokenNamePatterns: (options = {}) => TokenNamePatternSettingsApp.open(options),
    getNameSets: () => foundry.utils.deepClone(getNameSets()),
    getArtSets: () => foundry.utils.deepClone(getArtSets()),
    getCultureKeys: () => Object.keys(getNameSets()),
    getCultureOptions: () => Object.fromEntries(Object.entries(getNameSets()).map(([key, set]) => [key, set.label || key])),
    normalizeCultureKey: key => normalizeNameSetKey(key, getNameSets()),
    generateName: (setKey, gender = "random") => generateName(setKey, gender),
    generateNameDetailed: (setKey, gender = "random") => generateNameDetailed(setKey, gender),
    previewNames: (setKey, gender = "random", count = 10) => previewNames(setKey, gender, count),
    rollArt: (artSetKey, context = {}) => rollArt(artSetKey, context),
    inspectArtSet: (artSetKey, context = {}) => inspectArtSet(artSetKey, context),
    getArtSubsetOptions: (artSetKey, context = {}, options = {}) => getArtSubsetOptions(artSetKey, context, options),
    clearArtCache: () => clearAssetBrowseCache(),
    getArtCacheStats: () => getAssetBrowseCacheStats(),
    resetUsedAssetsForSet: artSetKey => resetUsedAssetsForSet(artSetKey),
    getAssetRegistryStats: () => getAssetRegistryStats(),
    cleanupAssetRegistry: options => cleanupOrphanedAssets(options),
    exportAssetRegistry: () => exportAssetRegistry(),
    createActor: (options = {}) => createActorFromApi(options),
    createRandomActor: (options = {}) => createActorFromApi(options),
    createBatch: (options = {}) => createActorsBatch(options),
    generateNpcProfile: (options = {}) => generateNpcProfile(options),
    profileToSystemData: profile => profileToSystemData(profile),
    rerollControlledTokenNames: (options = {}) => rerollControlledTokenNames(options)
  };
}
