import { MODULE_ID } from "../constants.js";
import { normalizeElement } from "../utils.js";
import {
  getTokenRandomNameMode,
  rerollPlacedTokenName,
  restorePlacedTokenName
} from "../services/token-names.js";

export function enhanceTokenHud(app, element, data = null) {
  if (!game.user?.isGM || !game.settings.get(MODULE_ID, "showTokenHudReroll")) return;
  const root = normalizeElement(element);
  if (!root) return;

  const appName = String(app?.constructor?.name || "");
  const looksLikeHud = appName.endsWith("TokenHUD") || root.id === "token-hud" || root.classList?.contains?.("token-hud");
  if (!looksLikeHud) return;
  const tokenDocument = getHudTokenDocument(app, data);
  if (!tokenDocument) return;
  const mode = getTokenRandomNameMode(tokenDocument, tokenDocument.toObject?.(true) ?? null);

  root.querySelectorAll?.(".fbl-cf-reroll-token-name")?.forEach(node => node.remove());
  if (!mode || mode === "none") return;
  const target = getHudButtonTarget(root);
  if (!target) return;

  const button = document.createElement("div");
  button.className = "control-icon fbl-cf-reroll-token-name";
  button.dataset.action = "fbl-cf-reroll-token-name";
  button.title = game.i18n.localize("FBL_CF.TokenNames.HudHint");
  button.innerHTML = '<i class="fas fa-dice-d20"></i>';
  button.addEventListener("click", async event => {
    event.preventDefault();
    event.stopPropagation();
    try {
      const liveToken = getHudTokenDocument(app, data) || tokenDocument;
      if (event.ctrlKey || event.metaKey) {
        const restored = await restorePlacedTokenName(liveToken);
        if (restored) ui.notifications?.info?.(`${game.i18n.localize("FBL_CF.TokenNames.Restored")}: ${restored}`);
        return;
      }
      const name = await rerollPlacedTokenName(liveToken, { modeOverride: event.altKey ? "random" : null });
      if (name) ui.notifications?.info?.(`${game.i18n.localize("FBL_CF.TokenNames.Rerolled")}: ${name}`);
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not reroll token name`, err);
      ui.notifications?.error?.(err?.message || game.i18n.localize("FBL_CF.TokenNames.Error"));
    }
  });
  target.appendChild(button);
}

export function getHudButtonTarget(root) {
  return root.querySelector?.(".col.right")
    || root.querySelector?.(".right")
    || root.querySelector?.("[data-position='right']")
    || root.querySelector?.(".controls")
    || root.querySelector?.(".control-icons")
    || root;
}

export function getHudTokenDocument(app, data = null) {
  const candidates = [
    app?.document,
    app?.object?.document,
    app?.object,
    app?.token?.document,
    app?.token,
    canvas?.hud?.token?.document,
    canvas?.hud?.token?.object?.document,
    canvas?.hud?.token?.object
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate?.documentName === "Token") return candidate;
    if (candidate?.document?.documentName === "Token") return candidate.document;
  }
  const tokenId = data?._id || data?.id || app?.object?.id || app?.document?.id;
  return tokenId ? canvas?.scene?.tokens?.get?.(tokenId) || canvas?.tokens?.get?.(tokenId)?.document || null : null;
}
