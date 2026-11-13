import { IMAGE_RE } from "./constants.js";

export function normalizeElement(element) {
  if (!element) return null;
  if (element instanceof HTMLElement) return element;
  if (element[0] instanceof HTMLElement) return element[0];
  return null;
}

export function getPropertyCompat(object, path) {
  if (!object || !path) return undefined;
  const getProperty = foundry?.utils?.getProperty;
  if (getProperty) return getProperty(object, path);

  return String(path).split(".").reduce((value, key) => value?.[key], object);
}

export function normalizeFoundryPath(path) {
  const value = String(path || "").trim();
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value)) return value.replace(/\/+$/, "");
  return value
    .replace(/\\+/g, "/")
    .replace(/^Data\//i, "")
    .replace(/^FoundryVTT\/Data\//i, "")
    .replace(/\/+/g, "/")
    .replace(/\/+$/, "");
}

export function randomOf(array) {
  if (!Array.isArray(array) || !array.length) return null;
  return array[Math.floor(Math.random() * array.length)];
}

export function isImagePath(path) {
  return typeof path === "string" && IMAGE_RE.test(path.split(/[?#]/, 1)[0]);
}

export function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function capitalize(value) {
  value = String(value || "");
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

export function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function deepMerge(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    if (["__proto__", "constructor", "prototype"].includes(key)) continue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (!Object.hasOwn(target, key) || !target[key] || typeof target[key] !== "object" || Array.isArray(target[key])) target[key] = {};
      deepMerge(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

export function safeDefaultKey(collection, preferred) {
  const key = resolveSetKey(collection, preferred);
  if (key) return key;
  return Object.keys(collection)[0] ?? "";
}

export function resolveSetKey(collection, key) {
  if (!key) return null;
  if (Object.hasOwn(collection, key)) return key;
  return Object.keys(collection).find(candidate => getSetAliases(collection[candidate]).includes(key)) ?? null;
}

export function getSetAliases(set) {
  return Array.isArray(set?.aliases) ? set.aliases : [];
}
