import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { MODULE_ID, SETTINGS_SCHEMA_VERSION } from "../scripts/constants.js";
import { getArtSets, getNameSets, migrateSettings, registerSettings, setArtSets, setNameSets, setUsedAssets } from "../scripts/services/settings.js";
import { DEFAULT_NAME_SETS, applyRegionalNameExpansion } from "../scripts/data/name-sets.js";
import { BASE_NAME_SETS } from "../scripts/data/name-sets.base.js";
import { REGIONAL_NAME_EXPANSION } from "../scripts/data/regional-name-expansion.js";
import { NAME_SET_ADDITIONS } from "../scripts/data/name-set-additions.js";
import { findPairedToken, getArtBranch, getArtCandidates, getArtSubsetOptions, normalizeArtSubsetKey, rollArt, validateArtSet } from "../scripts/services/art.js";
import { browseImages, clearAssetBrowseCache } from "../scripts/services/asset-browser.js";
import {
  cleanAssetRegistry, exportAssetRegistry, getUsedPathSet, markAssetsUsed, migrateAssetRegistry,
  recoverArchivedActorAssets, releaseAssetsForActor, resetAssetRegistry, syncActorAssetUsage
} from "../scripts/services/asset-registry.js";
import { applyProfileToActorData } from "../scripts/services/profiles.js";
import { generateNameFromDefinition, validateNameSet } from "../scripts/services/names.js";
import { isWildcardToken } from "../scripts/services/token-names.js";
import { applySavedTokenDefaults, getWorldTokenOverrides, normalizeForgePrototypeToken } from "../scripts/services/token-defaults.js";
import { updateConfig } from "../scripts/services/config.js";
import { createActorFromApi } from "../scripts/services/actors.js";
import { resolveSetKey } from "../scripts/utils.js";

const settings = new Map();
let actors;

beforeEach(() => {
  actors = new Map();
  globalThis.game = {
    actors: { get: id => actors.get(id), has: id => actors.has(id), [Symbol.iterator]: () => actors.values() },
    packs: Object.assign(new Map(), { filter(predicate) { return Array.from(this.values()).filter(predicate); } }),
    user: { isActiveGM: true, isGM: true, can: () => true },
    socket: { connected: true },
    i18n: { localize: key => key, format: (key, data) => key + " " + Object.values(data).join(" ") },
    settings: {
      settings: new Map(),
      storage: new Map(),
      register: (_namespace, key, config) => settings.set(key, config.default),
      get: (_namespace, key) => settings.get(key),
      set: async (_namespace, key, value) => settings.set(key, value)
    }
  };
  globalThis.foundry = { utils: {
    deepClone: structuredClone,
    expandObject: structuredClone,
    parseUuid(uuid) {
      const [, scope, name, , id] = uuid.split(".");
      return { id, collection: game.packs.get(scope + "." + name) };
    }
  } };
  settings.clear();
  registerSettings();
  clearAssetBrowseCache();
});

function actorUsing(id, set, path) {
  const actor = {
    id,
    name: id,
    img: path,
    prototypeToken: { texture: { src: path } },
    flags: { [MODULE_ID]: { artSet: set, assetUsage: "active", portrait: path } }
  };
  actors.set(id, actor);
  return actor;
}

function archiveActor(actor, id = "archived") {
  const collection = "world.forge-archive";
  const index = new Map();
  const pack = {
    collection,
    documentName: "Actor",
    metadata: { packageType: "world" },
    index,
    indexed: true,
    get: actorId => index.get(actorId),
    getIndex: async () => index,
    getUuid: actorId => "Compendium." + collection + ".Actor." + actorId
  };
  game.packs.set(collection, pack);
  const archived = { ...structuredClone(actor), id, _id: id, pack: collection, uuid: pack.getUuid(id) };
  index.set(id, archived);
  return { archived, pack };
}

test("a token-only set reports exhaustion and preserves other owners after a deletion", async () => {
  const path = "tokens/RobertT.webp";
  await setArtSets({ people: { tokenFiles: [path] } });
  settings.set("releaseAssetsOnActorDelete", true);
  const first = actorUsing("first", "people", path);
  const second = actorUsing("second", "people", path);
  await markAssetsUsed("people", first);
  await markAssetsUsed("people", second);
  actors.delete(second.id);
  await releaseAssetsForActor(second);
  await assert.rejects(rollArt("people"), /ArtExhausted/);
  actors.delete(first.id);
  await releaseAssetsForActor(first);
  const art = await rollArt("people");
  assert.equal(art.portrait, path);
  assert.equal(art.token, path);
});

test("migration restores a shared owner and keeps reservations accessible after rename", async () => {
  const path = "portraits/Robert.webp";
  await setArtSets({ people: { portraitFiles: [path] } });
  settings.set("releaseAssetsOnActorDelete", true);
  const first = actorUsing("first", "people", path);
  const second = actorUsing("second", "people", path);
  await setUsedAssets({ people: { assets: { [path]: { kind: "portrait", actorId: second.id } } } });
  await migrateAssetRegistry();
  await setArtSets({ renamed: { ...getArtSets().people, aliases: ["people"] } });
  actors.delete(second.id);
  await releaseAssetsForActor(second);
  assert.deepEqual([...getUsedPathSet("renamed")], [first.img]);
  assert.deepEqual([...getUsedPathSet("people")], [first.img]);
});

test("a deleted world actor keeps its art until an explicit reset by default", async () => {
  const path = "portraits/Robert.webp";
  await setArtSets({ people: { portraitFiles: [path] } });
  const actor = actorUsing("first", "people", path);
  await markAssetsUsed("people", actor);
  actors.delete(actor.id);
  await releaseAssetsForActor(actor);
  assert.deepEqual(await cleanAssetRegistry(), { orphaned: 0, removed: 0 });
  await assert.rejects(rollArt("people"), /ArtExhausted/);
  assert.equal(await resetAssetRegistry({ artSetKey: "people" }), 1);
  assert.equal((await rollArt("people")).portrait, path);
});

test("an archived copy keeps its own reservation when the world actor is deleted", async () => {
  const path = "portraits/Robert.webp";
  await setArtSets({ people: { portraitFiles: [path] } });
  settings.set("releaseAssetsOnActorDelete", true);
  const actor = actorUsing("first", "people", path);
  const { archived, pack } = archiveActor(actor, actor.id);
  await markAssetsUsed("people", actor);
  await syncActorAssetUsage(archived);
  assert.equal(exportAssetRegistry().people.assets[path].owners.length, 2);
  actors.delete(actor.id);
  await releaseAssetsForActor(actor);
  assert.deepEqual(await cleanAssetRegistry(), { orphaned: 0, removed: 0 });
  assert.equal(exportAssetRegistry().people.assets[path].owners[0].actorUuid, archived.uuid);
  pack.index.delete(archived.id);
  await releaseAssetsForActor(archived);
  assert.equal((await rollArt("people")).portrait, path);
});

test("initial reservation accepts a persisted pack Actor and rejects temporary copies", async () => {
  const path = "portraits/Robert.webp";
  await setArtSets({ people: { portraitFiles: [path] } });
  const actor = actorUsing("first", "people", path);
  const { archived } = archiveActor(actor, actor.id);
  await markAssetsUsed("people", { ...archived });
  assert.equal(getUsedPathSet("people").size, 0);
  await markAssetsUsed("people", archived);
  assert.equal(exportAssetRegistry().people.assets[path].owners[0].actorUuid, archived.uuid);
  await assert.rejects(rollArt("people"), /ArtExhausted/);
});

test("deleting an entire compendium makes only its reservations stale", async () => {
  const path = "portraits/Robert.webp";
  await setArtSets({ people: { portraitFiles: [path] } });
  const actor = actorUsing("first", "people", path);
  const { archived, pack } = archiveActor(actor);
  await markAssetsUsed("people", actor);
  await syncActorAssetUsage(archived);
  game.packs.delete(pack.collection);
  assert.deepEqual(await cleanAssetRegistry(), { orphaned: 0, removed: 0 });
  assert.equal(exportAssetRegistry().people.assets[path].owners[0].actorId, actor.id);
  assert.equal(exportAssetRegistry().people.assets[path].owners.length, 1);
});

test("a schema upgrade recovers an archive without a world copy or a prior registry entry", async () => {
  const path = "portraits/Robert.webp";
  const actor = actorUsing("first", "old", path);
  const { archived, pack } = archiveActor(actor);
  const disabled = { ...structuredClone(archived), _id: "disabled" };
  disabled.flags[MODULE_ID].markUsed = false;
  disabled.img = disabled.prototypeToken.texture.src = "portraits/Disabled.webp";
  pack.index.set(disabled._id, disabled);
  actors.delete(actor.id);
  await setArtSets({ people: { portraitFiles: [path], aliases: ["old"] } });
  settings.set("settingsSchemaVersion", 3);
  await migrateSettings({ migrateRegistry: migrateAssetRegistry, recoverArchives: recoverArchivedActorAssets });
  assert.equal(settings.get("settingsSchemaVersion"), SETTINGS_SCHEMA_VERSION);
  assert.deepEqual([...getUsedPathSet("people")], [path]);
  assert.equal(exportAssetRegistry().people.assets[path].owners[0].actorUuid, archived.uuid);
  await resetAssetRegistry({ artSetKey: "old" });
  await migrateSettings({ migrateRegistry: migrateAssetRegistry, recoverArchives: recoverArchivedActorAssets });
  assert.equal(getUsedPathSet("people").size, 0);
});

test("saved token defaults use modern Character values first and fill missing fields from legacy settings", () => {
  globalThis.CONST = { TOKEN_DISPOSITIONS: { HOSTILE: -1, NEUTRAL: 0, FRIENDLY: 1 },
    TOKEN_DISPLAY_MODES: { NONE: 0, OWNER_HOVER: 20, HOVER: 30, ALWAYS: 50 } };
  game.settings.settings.set("core.prototypeTokenOverrides", true);
  game.settings.storage.set("world", { getSetting: () => ({ value: { disposition: 0, displayName: 20 } }) });
  settings.set("prototypeTokenOverrides", {});

  const legacy = { type: "character", prototypeToken: { name: "Robert" } };
  applySavedTokenDefaults(legacy);
  assert.deepEqual(legacy.prototypeToken, { name: "Robert", disposition: 0, displayName: 20 });

  settings.set("prototypeTokenOverrides", { character: { displayName: 0 } });
  const configured = { type: "character", prototypeToken: {} };
  applySavedTokenDefaults(configured);
  assert.deepEqual(configured.prototypeToken, { disposition: 0, displayName: 0 });

  settings.set("prototypeTokenOverrides", { base: { disposition: 0 }, character: {} });
  const explicit = { type: "character", prototypeToken: { disposition: -1, displayName: 30 } };
  applySavedTokenDefaults(explicit);
  assert.deepEqual(explicit.prototypeToken, { disposition: -1, displayName: 30 });
  const monster = { type: "monster" };
  applySavedTokenDefaults(monster);
  assert.equal(monster.prototypeToken, undefined);
  assert.deepEqual(getWorldTokenOverrides("monster"), { disposition: 0 });
});

test("Forge token options preserve zero-valued choices, fractions and empty defaults", () => {
  globalThis.CONST = { TOKEN_DISPOSITIONS: { NEUTRAL: 0 }, TOKEN_DISPLAY_MODES: { NONE: 0 } };
  assert.deepEqual(normalizeForgePrototypeToken({ name: "  Ranger ", displayName: 0, disposition: "0", width: "1.5", height: "" }, {
    strict: true
  }), { name: "Ranger", displayName: 0, disposition: 0, width: 1.5 });
  assert.deepEqual(normalizeForgePrototypeToken({ height: -1, displayName: 100, disposition: false }), {});
  for (const height of [0, -1, NaN, "1e999"]) {
    assert.throws(() => normalizeForgePrototypeToken({ height }, { strict: true }), /InvalidTokenDimension/);
  }
});

test("an invalid configuration write cannot delete a set and a stale rename is atomic", async () => {
  const people = { folder: "art", aliases: ["original"] };
  await setArtSets({ people });
  await assert.rejects(updateConfig({ mode: "art", changes: { people: null }, expected: { people } }), /InvalidObject/);
  await assert.rejects(updateConfig({
    mode: "art", changes: { people: { folder: 4 } }, expected: { people }
  }), /InvalidArtSource/);
  const changes = { newPeople: { ...people, aliases: ["original", "people"] } };
  await assert.rejects(updateConfig({ mode: "art", changes, remove: ["people"], expected: { people: null, newPeople: null } }), /ConcurrentEdit/);
  assert.deepEqual(getArtSets(), { people });
  await updateConfig({ mode: "art", changes, remove: ["people"], expected: { people, newPeople: null } });
  assert.deepEqual(getArtSets(), changes);
  await updateConfig({ mode: "art", remove: ["newPeople"], expected: changes });
  assert.deepEqual(getArtSets(), {});
});

test("unfinished art sets round-trip as JSON without relaxing validation of other inputs", async () => {
  const draft = { label: "Draft", folder: "", pairByName: true };
  await setArtSets({});
  const options = { mode: "art", allowDraft: true };
  await updateConfig({ ...options, changes: { draft }, expected: { draft: null } });
  const exported = JSON.parse(JSON.stringify(getArtSets()));
  await setArtSets({ draft: { folder: "previous" } });
  await updateConfig({ ...options, changes: exported, expected: getArtSets() });
  assert.deepEqual(getArtSets(), { draft });
  assert.equal(validateArtSet(draft, "draft").valid, false);

  for (const value of [null, {}, { folder: 42 }, { folder: "", folders: { male: { folder: 42 } } }]) {
    await assert.rejects(updateConfig({ ...options, changes: { draft: value }, expected: { draft } }));
  }
  await assert.rejects(updateConfig({ ...options, changes: { random: draft }, expected: { random: null } }), /InvalidKey/);
  assert.deepEqual(getArtSets(), { draft });
});

test("art validation reports every malformed branch while accepting supported legacy source shapes", () => {
  const set = { folders: { male: { novand: { folder: 42 }, default: 7 }, female: { novand: "art/Female" } },
    byCulture: { sangren: { female: ["notes.txt"], default: { tokenFiles: ["art/token.webp"] } } } };
  const result = validateArtSet(set);
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, [
    "FBL_CF.Manager.InvalidArtSource folders.male.novand.folder",
    "FBL_CF.Manager.InvalidArtSource folders.male.default",
    "FBL_CF.Manager.InvalidArtSource byCulture.sangren.female"
  ]);
  assert.equal(validateArtSet({ folder: "art", folders: "not-a-map" }).valid, false);
  assert.equal(validateArtSet({ label: "art", portraitFiles: [], folder: "shadowed" }).valid, false);
  assert.equal(validateArtSet({ novand: { male: ["art/portrait.webp"], default: "elsewhere" } }).valid, true);
  assert.equal(validateArtSet({ male: { folder: "art/Male" }, female: { folder: "art/Female" } }).valid, true);
  assert.equal(validateArtSet({ artPackOne: { folder: "art/A" }, artPackTwo: { folder: "art/B" } }).valid, false);
  assert.equal(validateArtSet({ folder: "", pairByName: true }, "new-art", { allowDraft: true }).valid, true);
});

test("legacy art migration preserves direct gender sources and only fills missing cultures in maps", async () => {
  const samples = ["custom/Male", ["art/portrait.webp"], { folder: "custom/Male" }, { default: "custom/Male" }];
  for (const male of samples) {
    await setArtSets({ humanByCultureGender: { folders: { male, female: { novand: "custom/Female" } } } });
    settings.set("settingsSchemaVersion", 1);
    await migrateSettings({ migrateRegistry: async () => {}, recoverArchives: async () => {} });
    const set = getArtSets().humanByCultureGender;
    assert.deepEqual(set.folders.male, male);
    assert.deepEqual(getArtBranch(set, "novand", "male"), Array.isArray(male) ? { portraitFiles: male } : { folder: "custom/Male" });
    assert.equal(set.folders.female.novand, "custom/Female");
    assert.match(set.folders.female.sangren, /Female\/Sangren$/);
  }
});

test("legacy name migration persists changes even when the pool length stays the same", async () => {
  const nameSets = structuredClone(DEFAULT_NAME_SETS);
  const expected = ["Адриан", ...NAME_SET_ADDITIONS.novand.male];
  nameSets.novand.male = expected.map(() => "Адриан");
  await setNameSets(nameSets);
  settings.set("settingsSchemaVersion", 1);

  await migrateSettings({ migrateRegistry: async () => {}, recoverArchives: async () => {} });

  assert.deepEqual(getNameSets().novand.male, [...expected, ...REGIONAL_NAME_EXPANSION.novand.male]);
  assert.notEqual(settings.get("settingsSchemaVersion"), 1);
});

test("legacy migration respects aliases in defaults, name additions and art folder updates", async () => {
  const customCulture = { aliases: ["novand"], male: ["Custom Name"] };
  const customArt = { aliases: ["humanByCultureGender"], folders: {
    male: "custom/Male", female: { novand: "custom/Female" }
  } };
  await setNameSets({ renamedCulture: customCulture });
  await setArtSets({ renamedArt: customArt });
  settings.set("settingsSchemaVersion", 1);
  await migrateSettings({ migrateRegistry: async () => {}, recoverArchives: async () => {} });

  const names = getNameSets();
  const art = getArtSets();
  assert.equal(resolveSetKey(names, "novand"), "renamedCulture");
  assert.equal(resolveSetKey(art, "humanByCultureGender"), "renamedArt");
  assert.deepEqual(names.renamedCulture.male, ["Custom Name", ...NAME_SET_ADDITIONS.novand.male, ...REGIONAL_NAME_EXPANSION.novand.male]);
  assert.deepEqual(names.renamedCulture.aliases, ["novand"]);
  assert.equal(art.renamedArt.folders.male, "custom/Male");
  assert.equal(art.renamedArt.folders.female.novand, "custom/Female");
  assert.match(art.renamedArt.folders.female.sangren, /Female\/Sangren$/);
  assert.ok(art.humanNamedRandom);
  assert.ok(names.sangren);
});

test("actor creation validates the template's original type before applying overrides", async t => {
  const source = { type: "monster", system: { willpower: 3, description: "Template data" } };
  const created = [];
  const documentClass = {
    TYPES: ["character", "monster"],
    async create(data) {
      created.push(data);
      return data;
    }
  };
  globalThis.fromUuid = async () => ({
    documentName: "Actor", testUserPermission: () => true, toObject: () => structuredClone(source)
  });
  t.after(() => { delete globalThis.fromUuid; });

  const options = { templateUuid: "Actor.template", documentClass, name: "Copy", openSheet: false };
  for (const input of [{ actorData: { type: "character" } }, { data: { type: "character" } }, { type: "character" }]) {
    await assert.rejects(createActorFromApi({ ...options, ...input }), /TemplateTypeMismatch character monster/);
  }
  assert.equal(created.length, 0);

  const { actor } = await createActorFromApi({ ...options, actorData: { system: { willpower: 0 } } });
  assert.equal(created.length, 1);
  assert.equal(actor.type, "monster");
  assert.deepEqual(actor.system, { willpower: 0, description: "Template data" });
  assert.equal(source.system.willpower, 3);
});

test("creation rolls for the selected subset when the submitted preview belongs to another one", async () => {
  const fresh = "art/general.webp";
  const stale = "art/old-subset/portrait.webp";
  await setArtSets({ people: { portraitFiles: [fresh], markUsed: false } });
  globalThis.CONST = { TOKEN_DISPOSITIONS: {}, TOKEN_DISPLAY_MODES: {} };
  const options = {
    documentClass: { TYPES: ["character"], create: async data => data },
    name: "Preview test", artSetKey: "people", artSubsetKey: "general", assignArt: true,
    generateProfile: false, requireArt: true, openSheet: false,
    art: { portrait: stale, token: stale }
  };
  const { actor } = await createActorFromApi({ ...options, previewArt: { artSubsetKey: "old-subset" } });
  assert.equal(actor.img, fresh);
  assert.equal(actor.prototypeToken.texture.src, fresh);
  assert.equal(actor.flags[MODULE_ID].artSubset, "general");

  const { actor: matching } = await createActorFromApi({ ...options, previewArt: { artSubsetKey: "common" } });
  assert.equal(matching.img, stale);
  assert.equal(matching.flags[MODULE_ID].artSubset, "general");

  const { actor: explicit } = await createActorFromApi(options);
  assert.equal(explicit.img, stale);
});

test("pairing respects directories and retains the trailing t in a portrait name", async () => {
  const portrait = "portraits/B/Robert.webp";
  const token = "tokens/B/RobertT.webp";
  const set = { portraitFolder: "portraits", tokenFolder: "tokens", tokenSuffixes: ["T"] };
  assert.equal(findPairedToken(portrait, ["tokens/A/RobertT.webp", token], set), token);
  assert.equal(findPairedToken(portrait, ["tokens/A/RobertT.webp"], set), null);
  assert.deepEqual(await getArtCandidates({ sameFolderTokenSuffix: true, portraitFiles: [portrait] }), {
    portraitFiles: [portrait],
    tokenFiles: []
  });
});

test("neutral art uses a stable culture branch and keeps configured neutral or general sources first", async t => {
  const fixture = "art/selected";
  const specific = fixture + "/Tavern";
  const image = specific + "/portrait.webp";
  await setNameSets({ renamed: { given: ["Custom Name"], aliases: ["novand"] } });
  await setArtSets({
    byGender: { folders: { male: { novand: fixture }, female: { novand: "art/other" } } },
    femaleOnly: { byCulture: { renamed: { female: ["art/female.webp"] } } },
    explicit: { byGender: { neutral: ["art/neutral.webp"], male: ["art/male.webp"] } },
    general: { folder: "art/general.webp", male: ["art/male.webp"] }
  });
  globalThis.FilePicker = { async browse(_source, path) {
    if (path === fixture) return { files: [], dirs: [specific] };
    assert.equal(path, specific);
    return { files: [image], dirs: [] };
  } };
  t.after(() => { delete globalThis.FilePicker; });
  const context = { cultureKey: "renamed", resolvedGender: "neutral" };
  const options = await getArtSubsetOptions("byGender", context);
  assert.equal(options[1].key, "Tavern");
  const art = await rollArt("byGender", { ...context, artSubsetKey: options[1].key });
  assert.equal(art.portrait, image);
  assert.equal(art.gender, "neutral");
  assert.equal(art.cultureKey, "renamed");
  assert.equal((await rollArt("femaleOnly", context)).portrait, "art/female.webp");
  assert.equal((await rollArt("explicit", context)).portrait, "art/neutral.webp");
  assert.equal((await rollArt("general", context)).portrait, "art/general.webp");
});

test("subset discovery matches encoded folder prefixes and preserves the browse target", async t => {
  const portraitRoot = "art/Portraits Shared";
  const tokenRoot = "art/Tokens%20Shared";
  const subset = "City Watch 50%";
  const encodedSubset = "City%20Watch%2050%25";
  const portraitFolder = "art/Portraits%20Shared/" + encodedSubset;
  const tokenFolder = "art/Tokens Shared/" + subset;
  const files = new Map([
    [portraitRoot, { files: [], dirs: [portraitFolder] }],
    ["art/Tokens Shared", { files: [], dirs: ["art/Tokens Shared/" + encodedSubset] }],
    [decodeURIComponent(portraitFolder), { files: [portraitFolder + "/guard.webp"], dirs: [] }],
    [tokenFolder, { files: ["art/Tokens%20Shared/" + encodedSubset + "/guardT.webp"], dirs: [] }]
  ]);
  globalThis.FilePicker = { async browse(_source, path) {
    const result = files.get(decodeURIComponent(path));
    assert.ok(result, path);
    return result;
  } };
  t.after(() => { delete globalThis.FilePicker; });
  await setArtSets({ people: { portraitFolder: portraitRoot, tokenFolder: tokenRoot, pairByName: true, tokenSuffixes: ["T"] } });
  const options = await getArtSubsetOptions("people");
  assert.deepEqual(options.slice(1), [{ key: encodedSubset, label: subset, folder: portraitFolder }]);
  const art = await rollArt("people", { artSubsetKey: options[1].key, fallbackArtSubset: false });
  assert.equal(art.portrait, portraitFolder + "/guard.webp");
  assert.equal(art.token, "art/Tokens%20Shared/" + encodedSubset + "/guardT.webp");
  assert.equal(normalizeArtSubsetKey(subset), encodedSubset);
  assert.equal(normalizeArtSubsetKey("Data/Subfolder"), "Data/Subfolder");
  for (const key of ["%2e%2e/child", "one%2Ftwo", "one%5Ctwo"]) {
    assert.throws(() => normalizeArtSubsetKey(key), /InvalidSubset/);
  }
});

test("S3 subset browsing keeps literal percent escapes in raw directory keys", async t => {
  const target = "art/VIP%20Room";
  const image = "https://example.test/art/VIP%2520Room/guard.webp";
  globalThis.FilePicker = { async browse(source, path) {
    assert.equal(source, "s3");
    if (path === "art") return { files: [], dirs: [target] };
    assert.equal(path, "art/VIP%2520Room");
    return { files: [image], dirs: [] };
  } };
  t.after(() => { delete globalThis.FilePicker; });
  await setArtSets({ people: { source: "s3", bucket: "art", folder: "art" } });
  const options = await getArtSubsetOptions("people");
  assert.deepEqual(options[1], { key: "VIP%2520Room", label: "VIP%20Room", folder: target });
  assert.equal((await rollArt("people", { artSubsetKey: options[1].key })).portrait, image);
});

test("a failed recursive browse is retried", async () => {
  let attempts = 0;
  globalThis.FilePicker = {
    async browse(_source, path) {
      if (path === "art") return { files: [], dirs: ["art/child"] };
      if (++attempts === 1) throw new Error("temporarily unavailable");
      return { files: ["art/child/portrait.webp"], dirs: [] };
    }
  };
  try {
    await assert.rejects(browseImages("data", "art", null, true), /temporarily unavailable/);
    assert.deepEqual(await browseImages("data", "art", null, true), ["art/child/portrait.webp"]);
    assert.equal(attempts, 2);
  } finally {
    delete globalThis.FilePicker;
  }
});

test("malformed name entries are rejected and substitutions preserve literal characters", () => {
  assert.equal(validateNameSet({ male: [null] }).valid, false);
  assert.equal(validateNameSet({ given: ["Robert"], patterns: [null] }).valid, false);
  assert.equal(generateNameFromDefinition({ given: ["Robert $&"], pattern: "{given}" }).name, "Robert $&");
});

test("profile fill preserves damaged attributes and explicit untrained skills", () => {
  const actor = { system: {
    attribute: { strength: { value: 0, max: 4 } },
    skill: { melee: { value: 0 } }
  } };
  const profile = { attributes: { strength: 5, empathy: 2 }, skills: { melee: 3, might: 2 } };
  applyProfileToActorData(actor, profile, { overwrite: false });
  assert.deepEqual(actor.system.attribute.strength, { value: 0, max: 4 });
  assert.deepEqual(actor.system.attribute.empathy, { value: 2, max: 2 });
  assert.deepEqual(actor.system.skill, { melee: { value: 0 }, might: { value: 2 } });
});

test("explicit wildcard false wins over the Actor prototype", () => {
  const token = { actor: { prototypeToken: { randomImg: true } } };
  assert.equal(isWildcardToken(token), true);
  assert.equal(isWildcardToken(token, { randomImg: false }), false);
});


test("regional expansion covers every built-in culture and preserves naming patterns", () => {
  assert.deepEqual(Object.keys(REGIONAL_NAME_EXPANSION).sort(), Object.keys(BASE_NAME_SETS).sort());
  for (const [culture, fields] of Object.entries(REGIONAL_NAME_EXPANSION)) {
    const base = BASE_NAME_SETS[culture];
    const full = DEFAULT_NAME_SETS[culture];
    assert.equal(full.pattern, base.pattern);
    assert.equal(full.description, base.description);
    assert.equal(validateNameSet(full, culture).valid, true);
    const expectedFields = Object.keys(base).filter(field => Array.isArray(base[field]));
    assert.deepEqual(Object.keys(fields).sort(), expectedFields.sort());
    for (const [field, additions] of Object.entries(fields)) {
      assert.ok(additions.length >= 60, culture + "." + field);
      assert.equal(new Set(additions).size, additions.length);
      for (const value of additions) {
        assert.equal(value.trim(), value);
        assert.match(value, /^[\p{Script=Cyrillic}\p{M}]+(?:[- '][\p{Script=Cyrillic}\p{M}]+)*$/u);
        assert.ok(full[field].includes(value), culture + "." + field + ": " + value);
      }
      for (const value of base[field]) assert.ok(full[field].includes(value));
      for (const value of NAME_SET_ADDITIONS[culture]?.[field] ?? []) assert.ok(full[field].includes(value));
    }
    if (fields.familyMale) assert.equal(fields.familyMale.length, fields.familyFemale.length);
    for (const gender of ["male", "female"]) {
      const result = generateNameFromDefinition(full, culture, gender);
      assert.equal(result.gender, gender);
      assert.notEqual(result.name, "Безымянный");
      assert.ok(!result.name.includes("{"));
    }
  }
  const defaults = structuredClone(DEFAULT_NAME_SETS);
  assert.equal(applyRegionalNameExpansion(defaults), false);
  assert.deepEqual(defaults, DEFAULT_NAME_SETS);
});

test("schema 5 appends regional names once, preserving user pools, aliases and full-name tables", async () => {
  const weighted = { value: REGIONAL_NAME_EXPANSION.novand.male[0], weight: 7 };
  const renamedCulture = { aliases: ["novand"], male: ["Custom Name", weighted], female: [], pattern: "{given}" };
  const customCulture = { male: ["Custom"], family: ["Custom family"] };
  const fullNames = { entries: ["Custom Full Name"], male: ["Ignored"] };
  await setNameSets({ renamedCulture, customCulture, royuMideki: fullNames, lezhnizem: structuredClone(BASE_NAME_SETS.lezhnizem) });
  settings.set("settingsSchemaVersion", 4);
  const noop = async () => {};
  await migrateSettings({ migrateRegistry: noop, recoverArchives: noop });
  const migrated = getNameSets();
  assert.deepEqual(migrated.renamedCulture.male, ["Custom Name", weighted, ...REGIONAL_NAME_EXPANSION.novand.male.slice(1)]);
  assert.deepEqual(migrated.renamedCulture.female, []);
  assert.equal(migrated.renamedCulture.family, undefined);
  assert.equal(migrated.renamedCulture.pattern, "{given}");
  assert.equal(migrated.novand, undefined);
  assert.deepEqual(migrated.customCulture, customCulture);
  assert.deepEqual(migrated.royuMideki, fullNames);
  assert.ok(migrated.lezhnizem.familyMale.includes(REGIONAL_NAME_EXPANSION.lezhnizem.familyMale[0]));
  assert.ok(migrated.lezhnizem.familyFemale.includes(REGIONAL_NAME_EXPANSION.lezhnizem.familyFemale[0]));
  assert.equal(settings.get("settingsSchemaVersion"), SETTINGS_SCHEMA_VERSION);
  assert.equal(applyRegionalNameExpansion(migrated), false);
  await migrateSettings({ migrateRegistry: noop, recoverArchives: noop });
  assert.deepEqual(getNameSets(), migrated);
});

test("regional expansion does not duplicate alternate Korean hyphenation", () => {
  const first = REGIONAL_NAME_EXPANSION.seiku.male[0];
  const sets = { seiku: { male: [first.replaceAll("-", "")] } };
  assert.equal(applyRegionalNameExpansion(sets), true);
  assert.equal(sets.seiku.male.length, REGIONAL_NAME_EXPANSION.seiku.male.length);
  assert.equal(sets.seiku.male.includes(first), false);
});
