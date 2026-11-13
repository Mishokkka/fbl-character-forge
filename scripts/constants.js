export const MODULE_ID = "fbl-character-forge";
export const MODULE_VERSION = "2.1.1";
export const ACTOR_TYPE = "character";
export const FALLBACK_IMAGE = "icons/svg/mystery-man.svg";
export const IMAGE_RE = /\.(jpe?g|png|webp|gif|svg|avif)$/i;
export const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".avif"];
export const SETTINGS_SCHEMA_VERSION = 3;

export function getRuntimeModuleVersion() {
  return globalThis.game?.modules?.get?.(MODULE_ID)?.version || MODULE_VERSION;
}
