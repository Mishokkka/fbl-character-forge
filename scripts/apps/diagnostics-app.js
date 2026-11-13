import { MODULE_ID, getRuntimeModuleVersion } from "../constants.js";
import { getArtSets, getNameSets } from "../services/settings.js";
import { validateNameSets } from "../services/names.js";
import { validateArtSets } from "../services/art.js";
import { clearAssetBrowseCache, getAssetBrowseCacheStats } from "../services/asset-browser.js";
import { cleanupOrphanedAssets, getAssetRegistryStats } from "../services/asset-registry.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class CharacterForgeDiagnosticsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "fbl-character-forge-diagnostics",
    classes: ["fbl-cf-app", "fbl-cf-diagnostics-app"],
    window: { title: "FBL_CF.Diagnostics.Title", icon: "fas fa-stethoscope", resizable: true },
    position: { width: 720, height: 680 }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/apps/diagnostics.hbs` }
  };

  static open(options = {}) {
    const app = new this(options);
    app.render({ force: true });
    return app;
  }

  async _prepareContext(options) {
    const baseContext = await super._prepareContext(options);
    const nameResults = validateNameSets(getNameSets());
    const artResults = validateArtSets(getArtSets());
    const registry = getAssetRegistryStats();
    const cache = getAssetBrowseCacheStats();
    const flatten = results => results.map(result => ({
      ...result,
      message: [...result.errors, ...result.warnings].join("; ")
    }));

    const report = {
      moduleVersion: getRuntimeModuleVersion(),
      foundryVersion: game.version || game.release?.version || "?",
      system: `${game.system?.id || "?"} ${game.system?.version || "?"}`,
      nameSets: nameResults.length,
      invalidNameSets: nameResults.filter(result => !result.valid).length,
      artSets: artResults.length,
      invalidArtSets: artResults.filter(result => !result.valid).length,
      registry,
      cache,
      nameProblems: flatten(nameResults.filter(result => !result.valid || result.warnings.length)),
      artProblems: flatten(artResults.filter(result => !result.valid || result.warnings.length))
    };
    this.report = report;
    return { ...baseContext, ...report };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
  }

  async _onClickAction(event, target) {
    return this.#action(event, target?.dataset?.action);
  }

  async #action(event, action) {
    event.preventDefault();
    switch (action) {
      case "refresh":
        await this.render({ force: true });
        break;
      case "clear-cache": {
        const count = clearAssetBrowseCache();
        ui.notifications?.info?.(`Character Forge: очищено записей кеша: ${count}.`);
        await this.render({ force: true });
        break;
      }
      case "clean-registry": {
        const result = await cleanupOrphanedAssets({ remove: true });
        ui.notifications?.info?.(`Character Forge: удалено записей-сирот: ${result.removed}.`);
        await this.render({ force: true });
        break;
      }
      case "copy-report": {
        const text = JSON.stringify(this.report || {}, null, 2);
        if (game.clipboard?.copyPlainText) await game.clipboard.copyPlainText(text);
        else await navigator.clipboard?.writeText?.(text);
        ui.notifications?.info?.("Character Forge: отчёт скопирован.");
        break;
      }
    }
  }
}
