import { MODULE_ID } from "./constants.js";
import { registerPublicApi } from "./api.js";
import { CharacterForgeDiagnosticsApp } from "./apps/diagnostics-app.js";
import { ArtSetManagerApp, NameSetManagerApp } from "./apps/config-manager-app.js";
import { TokenNamePatternSettingsApp } from "./apps/token-name-patterns-app.js";
import { migrateSettings, registerSettings, saveTokenNamePatterns } from "./services/settings.js";
import {
  actorAssetFieldsChanged, cleanAssetRegistry, isRegistryActor, migrateAssetRegistry, recoverArchivedActorAssets, releaseAssetsForActor,
  resetAssetRegistry, syncActorAssetUsage
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
  }, () => migrateSettings({ migrateRegistry: migrateAssetRegistry, recoverArchives: recoverArchivedActorAssets }));
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

function queueActorAssetChange(actor, change) {
  if (!game.user?.isActiveGM || !isRegistryActor(actor)) return;
  runOnActiveGM(() => change(actor)).catch(err => {
    console.warn(`${MODULE_ID} | Could not synchronize actor asset usage`, err);
  });
}

Hooks.on("createActor", actor => {
  if (actor.flags?.[MODULE_ID]?.assetUsage === "active") queueActorAssetChange(actor, syncActorAssetUsage);
});

Hooks.on("deleteActor", actor => queueActorAssetChange(actor, document => {
  const exists = document.pack ? game.packs.get(document.pack)?.index.has(document.id) : game.actors.has(document.id);
  if (!exists) return releaseAssetsForActor(document);
}));

Hooks.on("updateActor", (actor, changes) => {
  if (!game.user?.isActiveGM || !isRegistryActor(actor)) return;
  if (actorAssetFieldsChanged(changes)) queueActorAssetChange(actor, syncActorAssetUsage);
});
