import { ACTOR_TYPE, MODULE_ID } from "../constants.js";
import { CharacterForgeApp } from "../apps/character-forge-app.js";

export function patchActorCreateDialog() {
  const ActorClass = globalThis.Actor?.implementation ?? globalThis.Actor;
  if (!ActorClass?.createDialog || Object.hasOwn(ActorClass, "__fblCharacterForgePatched")) return false;

  const original = ActorClass.createDialog;
  ActorClass.__fblCharacterForgeOriginalCreateDialog = original;
  ActorClass.__fblCharacterForgePatched = true;

  ActorClass.createDialog = async function(data = {}, createOptions = {}, options = {}) {
    const types = getAvailableActorTypes(options, this);
    if (!game.user?.isGM || !game.settings.get(MODULE_ID, "replaceActorCreateDialog") || createOptions.pack || createOptions.parent
      || options.template || options.context || options.render || options.ok || !types.includes(ACTOR_TYPE)) {
      return original.call(this, data, createOptions, options);
    }
    try {
      return await CharacterForgeApp.prompt({
        documentClass: this,
        baseData: data,
        createOptions,
        dialogOptions: options,
        types
      });
    } catch (err) {
      console.error(`${MODULE_ID} | Forge dialog failed; falling back to core Actor.createDialog`, err);
      return original.call(this, data, createOptions, options);
    }
  };

  console.log(`${MODULE_ID} | Actor.createDialog compatibility entry installed.`);
  return true;
}

export function getAvailableActorTypes(options = {}, documentClass = globalThis.Actor) {
  const configured = documentClass?.TYPES || game.system?.documentTypes?.Actor || [ACTOR_TYPE];
  const types = Array.isArray(configured) ? configured : Object.keys(configured);
  const allowed = Array.isArray(options.types) ? options.types : options.type ? [options.type] : types;
  return [...new Set(types.filter(type => type !== "base" && allowed.includes(type)))];
}

export function openCharacterForge(options = {}) {
  return CharacterForgeApp.open(options);
}
