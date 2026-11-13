import { MODULE_ID } from "./constants.js";
import { registerPublicApi } from "./api.js";
import { CharacterForgeDiagnosticsApp } from "./apps/diagnostics-app.js";
import { ArtSetManagerApp, NameSetManagerApp } from "./apps/config-manager-app.js";
import { TokenNamePatternSettingsApp } from "./apps/token-name-patterns-app.js";
import { migrateSettings, registerSettings, saveTokenNamePatterns } from "./services/settings.js";
import {
  cleanAssetRegistry, isWorldActor, migrateAssetRegistry, releaseAssetsForActor, resetAssetRegistry, syncActorAssetUsage
} from "./services/asset-registry.js";
import { createActorForWorld } from "./services/actors.js";
import { registerWorldOperations, runOnActiveGM } from "./services/world-operations.js";
import { updateConfig } from "./services/config.js";
import { randomizeSceneTokenNamePost, randomizeSceneTokenNamePre } from "./services/token-names.js";
import { patchActorCreateDialog } from "./ui/create-dialog.js";
import { enhanceTokenConfig } from "./ui/token-config.js";
import { enhanceTokenHud } from "./ui/token-hud.js";

Hooks.once("init", () => {
  registerSettings({
    NameSetManagerApp,
    ArtSetManagerApp,
    TokenNamePatternSettingsApp,
    CharacterForgeDiagnosticsApp
  });
  registerPublicApi();
});

Hooks.once("ready", async () => {
  await registerWorldOperations({
    createActor: createActorForWorld,
    resetRegistry: resetAssetRegistry,
    cleanRegistry: cleanAssetRegistry,
    savePatterns: saveTokenNamePatterns,
    updateConfig
  }, () => migrateSettings({ migrateRegistry: migrateAssetRegistry }));
  if (game.user?.isGM && game.settings.get(MODULE_ID, "replaceActorCreateDialog")) patchActorCreateDialog();
  registerPublicApi();
  console.log(`${MODULE_ID} | Ready.`);
});

Hooks.on("renderApplicationV2", (app, element, context) => {
  enhanceTokenConfig(app, element);
  enhanceTokenHud(app, element, context);
});

Hooks.on("renderTokenConfig", (app, html) => enhanceTokenConfig(app, html?.[0] ?? html));
Hooks.on("renderTokenHUD", (app, html, data) => enhanceTokenHud(app, html?.[0] ?? html, data));

Hooks.on("preCreateToken", (tokenDocument, data, options, userId) => {
  randomizeSceneTokenNamePre(tokenDocument, data, options, userId);
});

Hooks.on("createToken", (tokenDocument, options, userId) => {
  randomizeSceneTokenNamePost(tokenDocument, options, userId);
});

Hooks.on("deleteActor", actor => {
  if (!game.user?.isActiveGM || !isWorldActor(actor) || !game.settings.get(MODULE_ID, "releaseAssetsOnActorDelete")) return;
  runOnActiveGM(() => {
    if (!game.actors.has(actor.id)) return releaseAssetsForActor(actor);
  }).catch(err => {
    console.warn(`${MODULE_ID} | Could not release assets for deleted actor`, err);
  });
});

Hooks.on("updateActor", (actor, changes) => {
  if (!game.user?.isActiveGM || !isWorldActor(actor)) return;
  const flattened = foundry.utils.flattenObject(changes || {});
  const artChanged = Object.keys(flattened).some(key => ["img", "prototypeToken.texture.src", "prototypeToken.randomImg"].includes(key));
  if (!artChanged) return;
  runOnActiveGM(() => syncActorAssetUsage(game.actors.get(actor.id))).catch(err => {
    console.warn(`${MODULE_ID} | Could not synchronize actor asset usage`, err);
  });
});
