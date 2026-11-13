import { BASE_NAME_SETS } from "./name-sets.base.js";
import { NAME_SET_ADDITIONS } from "./name-set-additions.js";
import { unique } from "../utils.js";

export function buildDefaultNameSets() {
  const result = JSON.parse(JSON.stringify(BASE_NAME_SETS));
  applyNameSetAdditions(result);
  return result;
}

export function applyNameSetAdditions(nameSets) {
  if (!nameSets || typeof nameSets !== "object") return false;
  let changed = false;
  for (const [key, additions] of Object.entries(NAME_SET_ADDITIONS)) {
    if (!nameSets[key]) {
      nameSets[key] = JSON.parse(JSON.stringify(additions));
      changed = true;
      continue;
    }
    for (const [field, values] of Object.entries(additions)) {
      if (!Array.isArray(values)) continue;
      if (!Array.isArray(nameSets[key][field])) nameSets[key][field] = [];
      const before = nameSets[key][field].length;
      nameSets[key][field] = unique([...nameSets[key][field], ...values]);
      if (nameSets[key][field].length !== before) changed = true;
    }
  }
  return changed;
}

export const DEFAULT_NAME_SETS = buildDefaultNameSets();
