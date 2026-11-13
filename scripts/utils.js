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
  return String(path || "")
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
  return typeof path === "string" && IMAGE_RE.test(path);
}

export function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function capitalize(value) {
  value = String(value || "");
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

export function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

export function deepMerge(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (!target[key] || typeof target[key] !== "object" || Array.isArray(target[key])) target[key] = {};
      deepMerge(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

export function safeDefaultKey(collection, preferred) {
  if (preferred && collection[preferred]) return preferred;
  return Object.keys(collection)[0] ?? "";
}
