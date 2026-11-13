import { MODULE_ID } from "../constants.js";
import {
  DEFAULT_TOKEN_NAME_PATTERNS,
  ensureTokenNamePatternDefaults,
  normalizeTokenNamePatternsForStorage,
  splitTokenNamePatterns
} from "../services/settings.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class TokenNamePatternSettingsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "fbl-character-forge-token-patterns",
    classes: ["fbl-cf-app", "fbl-cf-token-patterns-app"],
    tag: "form",
    window: { title: "FBL_CF.TokenPatterns.Title", icon: "fas fa-tags", resizable: true },
    position: { width: 680, height: 620 }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/apps/token-name-patterns.hbs` }
  };

  constructor(options = {}) {
    super(options);
    this.value = game.settings.get(MODULE_ID, "tokenNamePatterns") || DEFAULT_TOKEN_NAME_PATTERNS.join("\n");
    this.status = "";
  }

  static open(options = {}) {
    const app = new this(options);
    app.render({ force: true });
    return app;
  }

  async _prepareContext(options) {
    const baseContext = await super._prepareContext(options);
    const patterns = splitTokenNamePatterns(this.value);
    return {
      ...baseContext,
      value: this.value,
      count: patterns.length,
      invalidCount: String(this.value || "").split(/\r?\n/).map(value => value.trim()).filter(value => value && !value.includes("{id}")).length,
      status: this.status,
      examples: patterns.slice(0, 12).map(pattern => pattern.replaceAll("{id}", "17"))
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;
    root?.querySelector?.("textarea[name='patterns']")?.addEventListener("input", event => { this.value = event.currentTarget.value; });
    root?.addEventListener?.("submit", event => event.preventDefault());
  }

  async _onClickAction(event, target) {
    try {
      return await this.#action(event, target?.dataset?.action);
    } catch (error) {
      console.error(`${MODULE_ID} | Token pattern action failed`, error);
      ui.notifications?.error?.(error?.message || game.i18n.localize("FBL_CF.TokenPatterns.SaveFailed"));
      return null;
    }
  }

  async #action(event, action) {
    event.preventDefault();
    switch (action) {
      case "save": {
        const rawLines = String(this.value || "").split(/\r?\n/).map(value => value.trim()).filter(Boolean);
        const invalidLines = rawLines.filter(value => !value.includes("{id}"));
        if (invalidLines.length) {
          throw new Error(game.i18n.format("FBL_CF.TokenPatterns.InvalidSave", { count: invalidLines.length }));
        }

        const normalized = normalizeTokenNamePatternsForStorage(this.value);
        if (!normalized) throw new Error(game.i18n.localize("FBL_CF.TokenPatterns.Empty"));
        this.value = normalized;
        await game.settings.set(MODULE_ID, "tokenNamePatterns", normalized);
        this.status = game.i18n.localize("FBL_CF.Manager.Saved");
        await this.render({ force: true });
        break;
      }
      case "restore": {
        const result = ensureTokenNamePatternDefaults(this.value);
        this.value = result.value;
        await this.render({ force: true });
        break;
      }
      case "reset":
        this.value = DEFAULT_TOKEN_NAME_PATTERNS.join("\n");
        await this.render({ force: true });
        break;
      case "close":
        await this.close();
        break;
    }
  }
}
