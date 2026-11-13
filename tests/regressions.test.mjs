import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { MODULE_ID } from "../scripts/constants.js";
import { getArtSets, registerSettings, setArtSets, setUsedAssets } from "../scripts/services/settings.js";
import { findPairedToken, getArtCandidates, rollArt } from "../scripts/services/art.js";
import { browseImages, clearAssetBrowseCache } from "../scripts/services/asset-browser.js";
import { getUsedPathSet, markAssetsUsed, migrateAssetRegistry, releaseAssetsForActor } from "../scripts/services/asset-registry.js";
import { applyProfileToActorData } from "../scripts/services/profiles.js";
import { generateNameFromDefinition, validateNameSet } from "../scripts/services/names.js";
import { isWildcardToken } from "../scripts/services/token-names.js";

const settings = new Map();
let actors;

beforeEach(() => {
  actors = new Map();
  globalThis.game = {
    actors: { get: id => actors.get(id), [Symbol.iterator]: () => actors.values() },
    user: { isActiveGM: true },
    socket: { connected: true },
    i18n: { localize: key => key, format: (key, data) => key + " " + Object.values(data).join(" ") },
    settings: {
      register: (_namespace, key, config) => settings.set(key, config.default),
      get: (_namespace, key) => settings.get(key),
      set: async (_namespace, key, value) => settings.set(key, value)
    }
  };
  globalThis.foundry = { utils: { deepClone: structuredClone } };
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

test("a token-only set reports exhaustion and preserves other owners after a deletion", async () => {
  const path = "tokens/RobertT.webp";
  await setArtSets({ people: { tokenFiles: [path] } });
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
