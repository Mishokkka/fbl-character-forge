import { ACTOR_TYPE, FALLBACK_IMAGE, MODULE_ID } from "../constants.js";
import { createActorFromApi, createActorsBatch } from "../services/actors.js";
import {
  addGenerationHistory,
  clearGenerationHistory,
  getArtSets,
  getGenerationHistory,
  getNameSets
} from "../services/settings.js";
import { generateNameDetailed, previewNames } from "../services/names.js";
import {
  getArtSubsetOptions,
  inspectArtSet,
  normalizeArtSubsetKey,
  rollArt
} from "../services/art.js";
import { clearAssetBrowseCache } from "../services/asset-browser.js";
import { resetUsedAssetsForSet } from "../services/asset-registry.js";
import { PROFILE_ROLE_KEYS, PROFILE_TIER_KEYS } from "../services/profiles.js";
import { safeDefaultKey } from "../utils.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function localize(key, fallback = key) {
  const value = game.i18n?.localize?.(key);
  return value && value !== key ? value : fallback;
}

function optionList(entries, selected) {
  return entries.map(([value, label]) => ({ value, label, selected: value === selected }));
}

function actorFolderOptions(selectedId = "") {
  const folders = Array.from(game.folders || [])
    .filter(folder => folder.type === "Actor")
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name));

  const depth = folder => {
    let count = 0;
    let parent = folder.folder;
    const seen = new Set();
    while (parent && !seen.has(parent.id)) {
      seen.add(parent.id);
      count += 1;
      parent = parent.folder;
    }
    return count;
  };

  return [
    { value: "", label: localize("FBL_CF.Common.RootFolder", "Без папки"), selected: !selectedId },
    ...folders.map(folder => ({
      value: folder.id,
      label: `${" ".repeat(depth(folder))}${folder.name}`,
      selected: folder.id === selectedId
    }))
  ];
}

export class CharacterForgeApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "fbl-character-forge-app",
    classes: ["fbl-cf-app", "fbl-cf-forge-app"],
    tag: "form",
    window: {
      title: "FBL_CF.Forge.Title",
      icon: "fas fa-hammer",
      resizable: true
    },
    position: { width: 780, height: 500 }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/apps/character-forge.hbs` }
  };

  constructor(options = {}) {
    super(options);
    this.documentClass = options.documentClass || globalThis.Actor;
    this.baseData = foundry.utils.deepClone(options.baseData || {});
    this.createOptions = foundry.utils.deepClone(options.createOptions || {});
    this.dialogOptions = foundry.utils.deepClone(options.dialogOptions || {});
    this.allowedTypes = Array.isArray(options.types) && options.types.length
      ? [...new Set(options.types)]
      : this.#getActorTypes();
    this.dialogResolver = typeof options.dialogResolver === "function" ? options.dialogResolver : null;
    this.dialogResolved = false;
    this.initialized = false;
    this.busy = false;
    this.status = { type: "", text: "" };
    this.inspection = null;
    this.forgeState = {};
  }

  static open(options = {}) {
    const app = new this(options);
    void app.render({ force: true }).catch(err => {
      console.error(`${MODULE_ID} | Character Forge render failed`, err);
      ui.notifications?.error?.(err?.message || String(err));
    });
    return app;
  }

  static prompt(options = {}) {
    return new Promise((resolve, reject) => {
      try {
        const app = new this({ ...options, dialogResolver: resolve });
        void app.render({ force: true }).catch(reject);
      } catch (err) {
        reject(err);
      }
    });
  }

  #getActorTypes() {
    const configured = game.system?.documentTypes?.Actor || [];
    const types = Array.isArray(configured) ? configured : Object.keys(configured || {});
    return types.length ? types : [ACTOR_TYPE];
  }

  async #ensureInitialized() {
    if (this.initialized) return;
    const nameSets = getNameSets();
    const artSets = getArtSets();
    const requestedType = this.baseData.type || ACTOR_TYPE;
    const type = this.allowedTypes.includes(requestedType) ? requestedType : (this.allowedTypes[0] || ACTOR_TYPE);
    const rememberedNameSet = game.settings.get(MODULE_ID, "lastNameSet");
    const defaultNameSet = rememberedNameSet || game.settings.get(MODULE_ID, "defaultNameSet");
    const nameSetKey = defaultNameSet === "random" ? "random" : safeDefaultKey(nameSets, defaultNameSet);
    const artSetKey = safeDefaultKey(artSets, game.settings.get(MODULE_ID, "defaultArtSet"));

    this.forgeState = {
      name: String(this.baseData.name || ""),
      type,
      folderId: this.baseData.folder?.id || this.baseData.folder || this.dialogOptions.folder?.id || this.dialogOptions.folder || "",
      nameSetKey,
      gender: "random",
      resolvedGender: null,
      resolvedNameSetKey: null,
      generatedName: false,
      nameSuggestions: [],
      artSetKey,
      artSubsetKey: "general",
      subsetOptions: [{ key: "general", label: localize("FBL_CF.Forge.GeneralSubset", "Общие"), folder: "" }],
      assignArt: type === ACTOR_TYPE && game.settings.get(MODULE_ID, "assignArt"),
      generateProfile: type === ACTOR_TYPE && game.settings.get(MODULE_ID, "generateProfile"),
      profileRoleKey: game.settings.get(MODULE_ID, "lastProfileRole") || "random",
      profileTierKey: game.settings.get(MODULE_ID, "lastProfileTier") || "random",
      portrait: "",
      token: "",
      batchCount: Number(game.settings.get(MODULE_ID, "batchDefaultCount")) || 5
    };

    if (!this.forgeState.name && game.settings.get(MODULE_ID, "autoGenerateName") && type === ACTOR_TYPE) {
      this.#generateName();
    }

    await this.#refreshSubsets();
    if (game.settings.get(MODULE_ID, "autoRollArt") && this.forgeState.assignArt && type === ACTOR_TYPE) {
      try {
        await this.#rollArt({ silent: true });
      } catch (err) {
        this.#clearArt();
        this.#setStatus("warning", err?.message || String(err));
      }
    }
    this.initialized = true;
  }

  async _prepareContext(options) {
    const baseContext = await super._prepareContext(options);
    await this.#ensureInitialized();
    const nameSets = getNameSets();
    const artSets = getArtSets();
    const isCharacter = this.forgeState.type === ACTOR_TYPE;
    const history = getGenerationHistory().slice(0, 8).map(entry => ({
      ...entry,
      timestampLabel: entry.timestamp ? new Date(entry.timestamp).toLocaleString() : ""
    }));

    return {
      ...baseContext,
      isGM: !!game.user?.isGM,
      busy: this.busy,
      status: this.status,
      state: this.forgeState,
      isCharacter,
      portraitPreview: this.forgeState.portrait || FALLBACK_IMAGE,
      tokenPreview: this.forgeState.token || this.forgeState.portrait || FALLBACK_IMAGE,
      typeOptions: optionList(this.allowedTypes.map(type => [type, CONFIG.Actor?.typeLabels?.[type] ? game.i18n.localize(CONFIG.Actor.typeLabels[type]) : type]), this.forgeState.type),
      folderOptions: actorFolderOptions(this.forgeState.folderId),
      nameSetOptions: optionList([
        ["random", localize("FBL_CF.Forge.RandomCulture", "Случайная культура")],
        ...Object.entries(nameSets).map(([key, set]) => [key, set?.label || key])
      ], this.forgeState.nameSetKey),
      genderOptions: optionList([
        ["random", localize("FBL_CF.Gender.Random", "Случайный")],
        ["male", localize("FBL_CF.Gender.Male", "Мужской")],
        ["female", localize("FBL_CF.Gender.Female", "Женский")],
        ["neutral", localize("FBL_CF.Gender.Neutral", "Нейтральный")]
      ], this.forgeState.gender),
      profileRoleOptions: optionList([
        ["random", localize("FBL_CF.Profile.Roles.Random", "Случайный")],
        ...PROFILE_ROLE_KEYS.map(key => [key, localize(`FBL_CF.Profile.Roles.${key[0].toUpperCase()}${key.slice(1)}`, key)])
      ], this.forgeState.profileRoleKey),
      profileTierOptions: optionList([
        ["random", localize("FBL_CF.Profile.Tiers.Random", "Случайный")],
        ...PROFILE_TIER_KEYS.map(key => [key, localize(`FBL_CF.Profile.Tiers.${key[0].toUpperCase()}${key.slice(1)}`, key)])
      ], this.forgeState.profileTierKey),
      artSetOptions: optionList(Object.entries(artSets).map(([key, set]) => [key, set?.label || key]), this.forgeState.artSetKey),
      subsetOptions: (this.forgeState.subsetOptions || []).map(option => ({ ...option, selected: option.key === this.forgeState.artSubsetKey })),
      suggestions: this.forgeState.nameSuggestions.map((suggestion, index) => ({
        name: suggestion.name,
        gender: suggestion.gender,
        setKey: suggestion.setKey,
        index
      })),
      inspection: this.inspection,
      history,
      historyAvailable: history.length > 0,
      resolvedContext: [
        this.forgeState.resolvedNameSetKey && (nameSets[this.forgeState.resolvedNameSetKey]?.label || this.forgeState.resolvedNameSetKey),
        this.forgeState.resolvedGender && localize(`FBL_CF.Gender.${this.forgeState.resolvedGender[0].toUpperCase()}${this.forgeState.resolvedGender.slice(1)}`, this.forgeState.resolvedGender)
      ].filter(Boolean).join(" · ")
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;
    if (!root) return;

    root.addEventListener("submit", event => event.preventDefault());

    const bind = (name, eventName, handler) => {
      root.querySelector(`[name="${CSS.escape(name)}"]`)?.addEventListener(eventName, handler);
    };

    bind("name", "input", event => {
      this.forgeState.name = event.currentTarget.value;
      this.forgeState.generatedName = false;
      this.forgeState.resolvedGender = null;
      this.forgeState.resolvedNameSetKey = null;
      root.querySelector(".fbl-cf-context")?.remove();
    });
    bind("type", "change", async event => {
      this.forgeState.type = event.currentTarget.value;
      await this.render({ force: true });
    });
    bind("folderId", "change", event => { this.forgeState.folderId = event.currentTarget.value; });
    bind("nameSetKey", "change", async event => {
      this.forgeState.nameSetKey = event.currentTarget.value;
      await game.settings.set(MODULE_ID, "lastNameSet", this.forgeState.nameSetKey);
      this.#resetResolvedContext();
      await this.#refreshSubsets();
      await this.render({ force: true });
    });
    bind("gender", "change", async event => {
      this.forgeState.gender = event.currentTarget.value;
      this.#resetResolvedContext();
      await this.#refreshSubsets();
      await this.render({ force: true });
    });
    bind("artSetKey", "change", async event => {
      this.forgeState.artSetKey = event.currentTarget.value;
      this.#clearArt();
      this.inspection = null;
      await this.#refreshSubsets();
      await this.render({ force: true });
    });
    bind("artSubsetKey", "change", async event => {
      this.forgeState.artSubsetKey = normalizeArtSubsetKey(event.currentTarget.value);
      this.#clearArt();
      this.inspection = null;
      await this.render({ force: true });
    });
    bind("assignArt", "change", event => { this.forgeState.assignArt = !!event.currentTarget.checked; });
    bind("generateProfile", "change", async event => {
      this.forgeState.generateProfile = !!event.currentTarget.checked;
      await this.render({ force: true });
    });
    bind("profileRoleKey", "change", async event => {
      this.forgeState.profileRoleKey = event.currentTarget.value;
      await game.settings.set(MODULE_ID, "lastProfileRole", this.forgeState.profileRoleKey);
    });
    bind("profileTierKey", "change", async event => {
      this.forgeState.profileTierKey = event.currentTarget.value;
      await game.settings.set(MODULE_ID, "lastProfileTier", this.forgeState.profileTierKey);
    });
    bind("batchCount", "change", event => {
      this.forgeState.batchCount = Math.max(2, Math.min(100, Number(event.currentTarget.value) || 2));
    });
  }

  async _onClickAction(event, target) {
    return this.#handleAction(event, target?.dataset?.action, target);
  }

  async #handleAction(event, action, target = null) {
    event.preventDefault();
    if (this.busy && !["close"].includes(action)) return;

    target ||= event.currentTarget;
    try {
      switch (action) {
        case "generate-name":
          this.#generateName();
          await this.render({ force: true });
          break;
        case "suggest-names":
          this.forgeState.nameSuggestions = previewNames(this.forgeState.nameSetKey, this.forgeState.gender, 8);
          await this.render({ force: true });
          break;
        case "choose-name":
          this.forgeState.name = target.dataset.name || "";
          this.forgeState.generatedName = true;
          this.forgeState.resolvedGender = target.dataset.gender || null;
          this.forgeState.resolvedNameSetKey = target.dataset.setKey || (this.forgeState.nameSetKey !== "random" ? this.forgeState.nameSetKey : null);
          await this.render({ force: true });
          break;
        case "roll-art":
          await this.#runBusy(() => this.#rollArt());
          break;
        case "clear-art":
          this.#clearArt();
          this.inspection = null;
          await this.render({ force: true });
          break;
        case "inspect-art":
          await this.#runBusy(() => this.#inspectArt());
          break;
        case "refresh-art":
          clearAssetBrowseCache();
          await this.#runBusy(async () => {
            await this.#refreshSubsets({ refresh: true });
            await this.#inspectArt({ refresh: true });
          });
          break;
        case "reset-used": {
          const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: { title: localize("FBL_CF.Forge.ResetUsed", "Сбросить занятость") },
            content: `<p>${localize("FBL_CF.Forge.ResetUsedConfirm", "Освободить все изображения выбранного набора?")}</p>`,
            rejectClose: false
          });
          if (!confirmed) break;
          await resetUsedAssetsForSet(this.forgeState.artSetKey);
          this.#setStatus("success", localize("FBL_CF.Status.RegistryReset", "Занятость выбранного набора сброшена."));
          await this.render({ force: true });
          break;
        }
        case "create":
          await this.#runBusy(() => this.#createOne({ openSheet: false, continueAfter: false }));
          break;
        case "create-open":
          await this.#runBusy(() => this.#createOne({ openSheet: true, continueAfter: false }));
          break;
        case "create-continue":
          await this.#runBusy(() => this.#createOne({ openSheet: false, continueAfter: true }));
          break;
        case "create-batch":
          await this.#runBusy(() => this.#createBatch());
          break;
        case "open-diagnostics":
          game.fblCharacterForge?.openDiagnostics?.();
          break;
        case "clear-history":
          await clearGenerationHistory();
          await this.render({ force: true });
          break;
        case "close":
          await this.close();
          break;
      }
    } catch (err) {
      console.error(`${MODULE_ID} | Forge action ${action} failed`, err);
      this.#setStatus("error", err?.message || String(err));
      ui.notifications?.error?.(err?.message || String(err));
      await this.render({ force: true });
    }
  }

  async #runBusy(operation) {
    this.busy = true;
    this.#setStatus("busy", localize("FBL_CF.Status.Working", "Выполняется…"));
    await this.render({ force: true });
    try {
      return await operation();
    } finally {
      this.busy = false;
      if (this.element) await this.render({ force: true });
    }
  }

  #generateName() {
    const details = generateNameDetailed(this.forgeState.nameSetKey, this.forgeState.gender);
    this.forgeState.name = details.name || "";
    this.forgeState.resolvedGender = details.gender || null;
    this.forgeState.resolvedNameSetKey = details.setKey || this.forgeState.nameSetKey;
    this.forgeState.generatedName = true;
    this.forgeState.nameSuggestions = [];
    this.#setStatus("", "");
  }

  #resetResolvedContext() {
    this.forgeState.resolvedGender = null;
    this.forgeState.resolvedNameSetKey = null;
    this.forgeState.generatedName = false;
    this.forgeState.nameSuggestions = [];
    this.#clearArt();
    this.inspection = null;
  }

  #clearArt() {
    this.forgeState.portrait = "";
    this.forgeState.token = "";
  }

  #artContext() {
    return {
      nameSetKey: this.forgeState.nameSetKey,
      cultureKey: this.forgeState.nameSetKey,
      resolvedNameSetKey: this.forgeState.resolvedNameSetKey || this.forgeState.nameSetKey,
      resolvedCultureKey: this.forgeState.resolvedNameSetKey || this.forgeState.nameSetKey,
      selectedGender: this.forgeState.gender,
      resolvedGender: this.forgeState.resolvedGender || this.forgeState.gender,
      gender: this.forgeState.resolvedGender || this.forgeState.gender,
      artSubsetKey: this.forgeState.artSubsetKey,
      fallbackArtSubset: true
    };
  }

  async #refreshSubsets(options = {}) {
    if (!this.forgeState.artSetKey) return;
    try {
      const subsets = await getArtSubsetOptions(this.forgeState.artSetKey, this.#artContext(), options);
      this.forgeState.subsetOptions = subsets;
      if (!subsets.some(option => option.key === this.forgeState.artSubsetKey)) this.forgeState.artSubsetKey = "general";
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not read art subsets`, err);
      this.forgeState.subsetOptions = [{ key: "general", label: localize("FBL_CF.Forge.GeneralSubset", "Общие"), folder: "" }];
      this.forgeState.artSubsetKey = "general";
    }
  }

  async #rollArt({ silent = false } = {}) {
    if (!this.forgeState.artSetKey) return;
    const art = await rollArt(this.forgeState.artSetKey, this.#artContext());
    this.forgeState.portrait = art.portrait || "";
    this.forgeState.token = art.token || art.portrait || "";
    this.inspection = null;
    if (!silent) this.#setStatus("success", localize("FBL_CF.Status.ArtRolled", "Арт выбран."));
  }

  async #inspectArt() {
    this.inspection = await inspectArtSet(this.forgeState.artSetKey, this.#artContext());
    this.#setStatus("success", localize("FBL_CF.Status.ArtInspected", "Проверка набора завершена."));
  }

  #buildCreateOptions({ openSheet = false, name = null } = {}) {
    return {
      createOptions: foundry.utils.deepClone(this.createOptions),
      documentClass: this.documentClass,
      actorData: foundry.utils.deepClone(this.baseData),
      name: name ?? this.forgeState.name,
      type: this.forgeState.type,
      folderId: this.forgeState.folderId || null,
      nameSetKey: this.forgeState.nameSetKey,
      cultureKey: this.forgeState.nameSetKey,
      gender: this.forgeState.gender,
      resolvedGender: this.forgeState.resolvedGender,
      resolvedNameSetKey: this.forgeState.resolvedNameSetKey,
      artSetKey: this.forgeState.artSetKey,
      artSubsetKey: this.forgeState.artSubsetKey,
      assignArt: this.forgeState.assignArt,
      art: { portrait: this.forgeState.portrait, token: this.forgeState.token },
      generateProfile: this.forgeState.generateProfile,
      profileRoleKey: this.forgeState.profileRoleKey,
      profileTierKey: this.forgeState.profileTierKey,
      openSheet,
      sourceModule: MODULE_ID
    };
  }

  async #createOne({ openSheet = false, continueAfter = false } = {}) {
    if (!String(this.forgeState.name || "").trim()) this.#generateName();
    const result = await createActorFromApi(this.#buildCreateOptions({ openSheet }));
    await this.#recordHistory(result);

    this.#resolveDialog(result.actor);
    ui.notifications?.info?.(localize("FBL_CF.Status.ActorCreated", "Актёр создан: ") + result.actor.name);

    if (!continueAfter) {
      await this.close();
      return result;
    }

    this.#generateName();
    if (this.forgeState.assignArt) {
      try { await this.#rollArt({ silent: true }); }
      catch (_err) { this.#clearArt(); }
    }
    this.#setStatus("success", localize("FBL_CF.Status.ReadyNext", "Актёр создан. Подготовлен следующий вариант."));
    return result;
  }

  async #createBatch() {
    const count = Math.max(2, Math.min(100, Number(this.forgeState.batchCount) || 2));
    const options = this.#buildCreateOptions({ openSheet: false });
    delete options.name;
    options.art = {};
    const result = await createActorsBatch({
      ...options,
      count,
      onProgress: async ({ completed, total }) => {
        this.#setStatus("busy", `${localize("FBL_CF.Status.BatchProgress", "Создание")}: ${completed}/${total}`);
        if (this.element) await this.render({ force: true });
      }
    });

    for (const item of result.results) await this.#recordHistory(item);

    const message = `${localize("FBL_CF.Status.BatchDone", "Создано актёров")}: ${result.results.length}`
      + (result.errors.length ? `; ${localize("FBL_CF.Status.Errors", "ошибок")}: ${result.errors.length}` : "");
    this.#setStatus(result.errors.length ? "warning" : "success", message);
    ui.notifications?.info?.(message);
  }

  async #recordHistory(result) {
    try {
      await addGenerationHistory({
        actorId: result.actor.id,
        actorName: result.actor.name,
        name: result.actor.name,
        nameSetKey: result.nameSetKey,
        gender: result.gender,
        profileRole: result.profile?.roleKey || null,
        profileTier: result.profile?.tierKey || null,
        portrait: result.art?.portrait || "",
        token: result.art?.token || ""
      });
    } catch (err) {
      console.warn(`${MODULE_ID} | Actor was created but generation history could not be updated`, err);
    }
  }

  #setStatus(type, text) {
    this.status = { type, text };
  }

  #resolveDialog(actor) {
    if (this.dialogResolved || !this.dialogResolver) return;
    this.dialogResolved = true;
    this.dialogResolver(actor || null);
  }

  async _onClose(options) {
    this.#resolveDialog(null);
    return super._onClose(options);
  }
}
