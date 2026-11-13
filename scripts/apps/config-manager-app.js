import { MODULE_ID } from "../constants.js";
import { DEFAULT_ART_SETS } from "../data/art-sets.js";
import { DEFAULT_NAME_SETS } from "../data/name-sets.js";
import { getArtSets, getNameSets } from "../services/settings.js";
import { previewNamesFromDefinition, validateNameSet } from "../services/names.js";
import { validateArtSet } from "../services/art.js";
import { isConfigKey } from "../services/config.js";
import { runWorldOperation } from "../services/world-operations.js";
import { escapeHtml, getSetAliases, resolveSetKey } from "../utils.js";

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
  savedDraft = null;
  status = "";
  busy = false;

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

  setData(changes, snapshot = this.getData(), createDraft = false) {
    const expected = Object.fromEntries(Object.keys(changes).map(key => [key, snapshot[key] ?? null]));
    return runWorldOperation("updateConfig", { mode: this.mode, changes, expected, createDraft });
  }

  validate(value, key = this.selectedKey) {
    return this.mode === "names" ? validateNameSet(value, key) : validateArtSet(value, key);
  }

  #loadDraft(data = this.getData()) {
    const value = this.selectedKey ? data[this.selectedKey] : {};
    this.savedDraft = value ?? null;
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
    root?.querySelector?.("input[data-import-file]")?.addEventListener("change", event => {
      if (!this.busy) void this.#importFile(event.currentTarget.files?.[0]);
    });
  }

  async _onClickAction(event, target) {
    return this.#action(event, target);
  }

  async #action(event, button) {
    event.preventDefault();
    if (this.busy) return;
    this.busy = true;
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
          const data = await this.setData({ [this.selectedKey]: parsed }, { [this.selectedKey]: this.savedDraft });
          this.#loadDraft(data);
          this.status = game.i18n.localize("FBL_CF.Manager.Saved");
          await this.render({ force: true });
          break;
        }
        case "add": {
          const data = this.getData();
          let index = 1;
          let key = `new-${this.mode === "names" ? "culture" : "art-set"}`;
          while (resolveSetKey(data, key)) key = `new-${this.mode === "names" ? "culture" : "art-set"}-${++index}`;
          const definition = this.mode === "names"
            ? { label: key, male: ["Имя"], female: ["Имя"], family: ["Фамилия"], pattern: "{given} {family}" }
            : { label: key, folder: "", pairByName: true, markUsed: true };
          const saved = await this.setData({ [key]: definition }, data, true);
          this.selectedKey = key;
          this.#loadDraft(saved);
          await this.render({ force: true });
          break;
        }
        case "delete": {
          if (!this.selectedKey) return;
          const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: { title: game.i18n.localize("FBL_CF.Manager.Delete") },
            content: `<p>${game.i18n.format("FBL_CF.Manager.DeleteConfirm", { key: escapeHtml(this.selectedKey) })}</p>`,
            rejectClose: false
          });
          if (!confirmed) return;
          const data = await this.setData({ [this.selectedKey]: null }, { [this.selectedKey]: this.savedDraft });
          this.selectedKey = Object.keys(data)[0] || null;
          this.#loadDraft(data);
          await this.render({ force: true });
          break;
        }
        case "reset": {
          const defaults = this.getDefaults();
          const defaultKey = [this.selectedKey, ...getSetAliases(this.savedDraft)].find(key => Object.hasOwn(defaults, key));
          if (!defaultKey) throw new Error(game.i18n.localize("FBL_CF.Manager.NoDefault"));
          const data = await this.setData({ [this.selectedKey]: defaults[defaultKey] }, { [this.selectedKey]: this.savedDraft });
          this.#loadDraft(data);
          await this.render({ force: true });
          break;
        }
        case "rename": {
          const input = this.element?.querySelector?.("input[name='entryKey']");
          const nextKey = String(input?.value || "").trim();
          if (!isConfigKey(nextKey)) throw new Error(game.i18n.localize("FBL_CF.Manager.InvalidKey"));
          if (nextKey === this.selectedKey) return;
          const data = this.getData();
          const existingKey = resolveSetKey(data, nextKey);
          if (existingKey && existingKey !== this.selectedKey) throw new Error(game.i18n.localize("FBL_CF.Manager.KeyExists"));
          const parsed = JSON.parse(this.draft || "{}");
          const aliases = [...new Set([...getSetAliases(this.savedDraft), ...getSetAliases(parsed), this.selectedKey])]
            .filter(key => key !== nextKey);
          const saved = await this.setData({ [nextKey]: { ...parsed, aliases }, [this.selectedKey]: null }, {
            ...data, [this.selectedKey]: this.savedDraft
          });
          this.selectedKey = nextKey;
          this.#loadDraft(saved);
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
    } finally {
      this.busy = false;
    }
  }

  async #importFile(file) {
    if (!file) return;
    this.busy = true;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(game.i18n.localize("FBL_CF.Manager.ImportInvalid"));
      const data = this.getData();
      const entries = Object.entries(parsed);
      const collection = entries.length && entries.every(([key, value]) => isConfigKey(key) && this.validate(value, key).valid);
      const single = this.validate(parsed, this.selectedKey);
      let changes;
      if (collection) changes = parsed;
      else if (single.valid) {
        if (!this.selectedKey) throw new Error(game.i18n.localize("FBL_CF.Manager.Empty"));
        changes = { [this.selectedKey]: parsed };
      } else {
        throw new Error(`${game.i18n.localize("FBL_CF.Manager.ImportInvalid")} ${single.errors.join("; ")}`);
      }
      const saved = await this.setData(changes, data);
      const imported = Object.keys(changes);
      this.selectedKey = imported[0];
      this.#loadDraft(saved);
      this.status = `${game.i18n.localize("FBL_CF.Manager.Imported")}: ${imported.length}`;
      await this.render({ force: true });
    } catch (err) {
      this.status = err?.message || String(err);
      ui.notifications?.error?.(this.status);
      await this.render({ force: true });
    } finally {
      this.busy = false;
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
