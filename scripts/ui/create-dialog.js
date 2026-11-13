import { ACTOR_TYPE, MODULE_ID } from "../constants.js";
import { CharacterForgeApp } from "../apps/character-forge-app.js";

export function patchActorCreateDialog() {
  const ActorClass = globalThis.Actor?.implementation ?? globalThis.Actor;
  if (!ActorClass?.createDialog || ActorClass.__fblCharacterForgePatched) return false;

  const original = ActorClass.createDialog.bind(ActorClass);
  ActorClass.__fblCharacterForgeOriginalCreateDialog = original;
  ActorClass.__fblCharacterForgePatched = true;

  ActorClass.createDialog = async function(data = {}, createOptions = {}, options = {}) {
    try {
      if (!game.settings.get(MODULE_ID, "replaceActorCreateDialog")) return original(data, createOptions, options);
      const types = getAvailableActorTypes(options, data);
      const canHandle = types.includes(ACTOR_TYPE) || data?.type === ACTOR_TYPE;
      if (!canHandle) return original(data, createOptions, options);
      return await CharacterForgeApp.prompt({
        documentClass: this,
        baseData: data,
        createOptions,
        dialogOptions: options,
        types
      });
    } catch (err) {
      console.error(`${MODULE_ID} | Forge dialog failed; falling back to core Actor.createDialog`, err);
      return original(data, createOptions, options);
    }
  };

  console.log(`${MODULE_ID} | Actor.createDialog compatibility entry installed.`);
  return true;
}

export function getAvailableActorTypes(options = {}, data = {}) {
  const configured = options.types || game.system?.documentTypes?.Actor || [];
  let types = Array.isArray(configured) ? configured : Object.keys(configured || {});
  if (options.type) types = [options.type];
  if (data.type && !types.includes(data.type)) types.unshift(data.type);
  return [...new Set(types.length ? types : [ACTOR_TYPE])];
}

export function openCharacterForge(options = {}) {
  return CharacterForgeApp.open(options);
}
