import { MODULE_ID } from "../constants.js";
import { DEFAULT_ART_SETS } from "../data/art-sets.js";
import { DEFAULT_NAME_SETS } from "../data/name-sets.js";
import { getArtSets, getNameSets, setArtSets, setNameSets } from "../services/settings.js";
import { previewNamesFromDefinition, validateNameSet } from "../services/names.js";
import { validateArtSet } from "../services/art.js";
import { clearAssetBrowseCache } from "../services/asset-browser.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function saveJson(data, filename) {
  const text = JSON.stringify(data, null, 2);
  if (typeof globalThis.saveDataToFile === "function") return globalThis.saveDataToFile(text, "application/json", filename);
  const blob = new Blob([text], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function looksLikeSingleConfig(mode, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (mode === "names") return ["male", "female", "neutral", "given", "names", "entries", "pattern", "patterns"].some(key => key in value);
  return ["folder", "portraitFolder", "tokenFolder", "portraitFiles", "tokenFiles", "folders", "cultures"].some(key => key in value);
}

class ConfigManagerApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["fbl-cf-app", "fbl-cf-config-manager"],
    window: { resizable: true },
    position: { width: 900, height: 700 }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/apps/config-manager.hbs` }
  };

  static MODE = "names";
  mode = "names";
  selectedKey = null;
  draft = "";
  status = "";

  constructor(options = {}) {
    super(options);
    this.mode = this.constructor.MODE || "names";
    const keys = Object.keys(this.getData());
    this.selectedKey = options.selectedKey && keys.includes(options.selectedKey) ? options.selectedKey : keys[0] || null;
    this.#loadDraft();
  }

  static open(options = {}) {
    const app = new this(options);
    app.render({ force: true });
    return app;
  }

  getData() {
    return this.mode === "names" ? getNameSets() : getArtSets();
  }

  getDefaults() {
    return this.mode === "names" ? DEFAULT_NAME_SETS : DEFAULT_ART_SETS;
  }

  async setData(data) {
    if (this.mode === "names") await setNameSets(data);
    else {
      await setArtSets(data);
      clearAssetBrowseCache();
    }
  }

  validate(value, key = this.selectedKey) {
    return this.mode === "names" ? validateNameSet(value, key) : validateArtSet(value, key);
  }

  #loadDraft() {
    const value = this.selectedKey ? this.getData()[this.selectedKey] : {};
    this.draft = JSON.stringify(value || {}, null, 2);
    this.status = "";
  }

  async _prepareContext(options) {
    const baseContext = await super._prepareContext(options);
    const data = this.getData();
    let draftValue = {};
    let validation;
    try {
      draftValue = JSON.parse(this.draft || "{}");
      validation = this.validate(draftValue, this.selectedKey);
    } catch (err) {
      validation = { valid: false, errors: [err.message], warnings: [] };
    }

    return {
      ...baseContext,
      mode: this.mode,
      isNames: this.mode === "names",
      titleKey: this.mode === "names" ? "FBL_CF.Manager.NamesTitle" : "FBL_CF.Manager.ArtTitle",
      hintKey: this.mode === "names" ? "FBL_CF.Manager.NamesHint" : "FBL_CF.Manager.ArtHint",
      entries: Object.entries(data).map(([key, value]) => ({ key, label: value?.label || key, selected: key === this.selectedKey })),
      selectedKey: this.selectedKey,
      draft: this.draft,
      validation,
      status: this.status,
      preview: this.mode === "names" && validation.valid ? previewNamesFromDefinition(draftValue, this.selectedKey, "random", 12).map(result => result.name) : []
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;
    root?.querySelector?.("textarea[name='draft']")?.addEventListener("input", event => { this.draft = event.currentTarget.value; });
    root?.querySelector?.("input[data-import-file]")?.addEventListener("change", event => this.#importFile(event.currentTarget.files?.[0]));
  }

  async _onClickAction(event, target) {
    return this.#action(event, target);
  }

  async #action(event, button) {
    event.preventDefault();
    const action = button.dataset.action;
    try {
      switch (action) {
        case "select":
          this.selectedKey = button.dataset.key;
          this.#loadDraft();
          await this.render({ force: true });
          break;
        case "save": {
          const parsed = JSON.parse(this.draft || "{}");
          const validation = this.validate(parsed, this.selectedKey);
          if (!validation.valid) throw new Error(validation.errors.join("; "));
          const data = this.getData();
          data[this.selectedKey] = parsed;
          await this.setData(data);
          this.status = game.i18n.localize("FBL_CF.Manager.Saved");
          await this.render({ force: true });
          break;
        }
        case "add": {
          const data = this.getData();
          let index = 1;
          let key = `new-${this.mode === "names" ? "culture" : "art-set"}`;
          while (data[key]) key = `new-${this.mode === "names" ? "culture" : "art-set"}-${++index}`;
          data[key] = this.mode === "names"
            ? { label: key, male: ["Имя"], female: ["Имя"], family: ["Фамилия"], pattern: "{given} {family}" }
            : { label: key, folder: "", pairByName: true, markUsed: true };
          await this.setData(data);
          this.selectedKey = key;
          this.#loadDraft();
          await this.render({ force: true });
          break;
        }
        case "delete": {
          if (!this.selectedKey) return;
          const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: { title: game.i18n.localize("FBL_CF.Manager.Delete") },
            content: `<p>${game.i18n.format("FBL_CF.Manager.DeleteConfirm", { key: this.selectedKey })}</p>`,
            rejectClose: false
          });
          if (!confirmed) return;
          const data = this.getData();
          delete data[this.selectedKey];
          await this.setData(data);
          this.selectedKey = Object.keys(data)[0] || null;
          this.#loadDraft();
          await this.render({ force: true });
          break;
        }
        case "reset": {
          const defaults = this.getDefaults();
          if (!defaults[this.selectedKey]) throw new Error(game.i18n.localize("FBL_CF.Manager.NoDefault"));
          const data = this.getData();
          data[this.selectedKey] = foundry.utils.deepClone(defaults[this.selectedKey]);
          await this.setData(data);
          this.#loadDraft();
          await this.render({ force: true });
          break;
        }
        case "rename": {
          const input = this.element?.querySelector?.("input[name='entryKey']");
          const nextKey = String(input?.value || "").trim();
          if (!/^[A-Za-z0-9_-]+$/.test(nextKey)) throw new Error(game.i18n.localize("FBL_CF.Manager.InvalidKey"));
          if (nextKey === this.selectedKey) return;
          const data = this.getData();
          if (data[nextKey]) throw new Error(game.i18n.localize("FBL_CF.Manager.KeyExists"));
          const parsed = JSON.parse(this.draft || "{}");
          const validation = this.validate(parsed, nextKey);
          if (!validation.valid) throw new Error(validation.errors.join("; "));
          data[nextKey] = parsed;
          delete data[this.selectedKey];
          await this.setData(data);
          this.selectedKey = nextKey;
          this.#loadDraft();
          await this.render({ force: true });
          break;
        }
        case "import":
          this.element?.querySelector?.("input[data-import-file]")?.click();
          break;
        case "export":
          saveJson(this.getData(), `fbl-character-forge-${this.mode}.json`);
          break;
        case "format":
          this.draft = JSON.stringify(JSON.parse(this.draft || "{}"), null, 2);
          await this.render({ force: true });
          break;
      }
    } catch (err) {
      console.error(`${MODULE_ID} | Config manager action failed`, err);
      this.status = err?.message || String(err);
      ui.notifications?.error?.(this.status);
      await this.render({ force: true });
    }
  }

  async #importFile(file) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(game.i18n.localize("FBL_CF.Manager.ImportInvalid"));
      const data = this.getData();
      let imported;
      if (looksLikeSingleConfig(this.mode, parsed)) {
        if (!this.selectedKey) throw new Error(game.i18n.localize("FBL_CF.Manager.Empty"));
        const validation = this.validate(parsed, this.selectedKey);
        if (!validation.valid) throw new Error(validation.errors.join("; "));
        data[this.selectedKey] = parsed;
        imported = [this.selectedKey];
      } else {
        imported = Object.keys(parsed || {});
        if (!imported.length) throw new Error(game.i18n.localize("FBL_CF.Manager.ImportInvalid"));
        for (const key of imported) {
          if (!/^[A-Za-z0-9_-]+$/.test(key)) throw new Error(`${game.i18n.localize("FBL_CF.Manager.InvalidKey")} (${key})`);
          const validation = this.validate(parsed[key], key);
          if (!validation.valid) throw new Error(`${key}: ${validation.errors.join("; ")}`);
        }
        Object.assign(data, parsed);
        this.selectedKey = imported[0];
      }
      await this.setData(data);
      this.#loadDraft();
      this.status = `${game.i18n.localize("FBL_CF.Manager.Imported")}: ${imported.length}`;
      await this.render({ force: true });
    } catch (err) {
      this.status = err?.message || String(err);
      ui.notifications?.error?.(this.status);
      await this.render({ force: true });
    }
  }
}

export class NameSetManagerApp extends ConfigManagerApp {
  static MODE = "names";
  static DEFAULT_OPTIONS = {
    ...super.DEFAULT_OPTIONS,
    id: "fbl-character-forge-name-manager",
    window: { ...super.DEFAULT_OPTIONS.window, title: "FBL_CF.Manager.NamesTitle", icon: "fas fa-signature" }
  };
}

export class ArtSetManagerApp extends ConfigManagerApp {
  static MODE = "art";
  static DEFAULT_OPTIONS = {
    ...super.DEFAULT_OPTIONS,
    id: "fbl-character-forge-art-manager",
    window: { ...super.DEFAULT_OPTIONS.window, title: "FBL_CF.Manager.ArtTitle", icon: "fas fa-images" }
  };
}
