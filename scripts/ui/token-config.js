import { MODULE_ID } from "../constants.js";
import { escapeHtml, normalizeElement } from "../utils.js";
import {
  buildRandomSceneTokenNamePayload,
  buildRandomTokenNameOptions,
  findWildcardInput,
  getFormRandomNameMode,
  getTokenConfigDocument,
  getTokenRandomNameMode,
  getWildcardFormGroup,
  isInputChecked
} from "../services/token-names.js";

export function enhanceTokenConfig(app, element) {
  const root = normalizeElement(element);
  if (!root || root.querySelector(".fbl-cf-token-random-name-row")) return;
  const form = root.matches?.("form") ? root : root.querySelector?.("form");
  if (!form) return;

  const tokenDoc = getTokenConfigDocument(app);
  const appName = String(app?.constructor?.name || "");
  const looksLikeTokenConfig = appName.endsWith("TokenConfig")
    || !!form.querySelector('[name="randomImg"], [name="texture.randomImg"]')
    || tokenDoc?.documentName === "Token";
  if (!looksLikeTokenConfig) return;

  const wildcardInput = findWildcardInput(form);
  if (!wildcardInput) return;
  const current = getTokenRandomNameMode(tokenDoc) || getFormRandomNameMode(form) || "none";
  const label = escapeHtml(game.i18n.localize("FBL_CF.TokenNames.Label"));
  const preview = escapeHtml(game.i18n.localize("FBL_CF.TokenNames.Preview"));
  const id = escapeHtml(root.id + "-random-token-name");
  const row = document.createElement("div");
  row.className = "form-group fbl-cf-token-random-name-row";
  row.innerHTML = `
    <label for="${id}">${label}</label>
    <div class="form-fields">
      <select id="${id}" name="flags.${MODULE_ID}.randomTokenName" data-dtype="String">${buildRandomTokenNameOptions(current)}</select>
      <button type="button" class="fbl-cf-token-name-preview" aria-label="${preview}" data-tooltip="${preview}"><i class="fas fa-dice"></i></button>
    </div>
    <p class="hint">${escapeHtml(game.i18n.localize("FBL_CF.TokenNames.Hint"))}</p>
  `;

  const container = getWildcardFormGroup(wildcardInput) || wildcardInput.closest(".form-group") || wildcardInput.parentElement;
  container?.insertAdjacentElement?.("afterend", row);
  const select = row.querySelector("select");
  row.querySelector("button")?.addEventListener("click", () => {
    const source = tokenDoc?.toObject?.(true) || {};
    const wildcard = isInputChecked(wildcardInput);
    foundry.utils.setProperty(source, "randomImg", wildcard);
    foundry.utils.setProperty(source, "texture.randomImg", wildcard);
    foundry.utils.setProperty(source, `flags.${MODULE_ID}.randomTokenName`, select.value);
    const payload = buildRandomSceneTokenNamePayload(tokenDoc, source, "preview", { modeOverride: select.value, ignoreLock: true });
    ui.notifications?.info?.(payload?.name || game.i18n.localize("FBL_CF.TokenNames.NoPreview"));
  });

  const syncVisibility = () => row.classList.toggle("fbl-cf-hidden", !isInputChecked(wildcardInput));
  syncVisibility();
  wildcardInput.addEventListener("change", syncVisibility);
}
