import { randomOf } from "../utils.js";
import { BIO_RU } from "../data/bio-ru.js";

export const PROFILE_ROLE_KEYS = [
  "warrior",
  "marksman",
  "scout",
  "rogue",
  "scholar",
  "healer",
  "face",
  "craftsperson",
  "laborer",
  "handler"
];

export const PROFILE_TIER_KEYS = ["ordinary", "capable", "veteran"];

const ATTRIBUTE_KEYS = ["strength", "agility", "wits", "empathy"];
const SKILL_KEYS = [
  "might", "endurance", "melee", "crafting",
  "stealth", "sleight-of-hand", "move", "marksmanship",
  "scouting", "lore", "survival", "insight",
  "manipulation", "performance", "healing", "animal-handling"
];

const ROLE_DEFINITIONS = {
  warrior: {
    primary: "strength",
    secondary: "agility",
    skills: ["melee", "endurance", "might", "move", "marksmanship"],
    professions: {
      ru: { male: ["наёмник", "стражник", "солдат"], female: ["наёмница", "стражница", "солдатка"], neutral: ["воин", "охранник"] },
      en: ["mercenary", "guard", "soldier"]
    }
  },
  marksman: {
    primary: "agility",
    secondary: "wits",
    skills: ["marksmanship", "scouting", "stealth", "move", "survival"],
    professions: {
      ru: { male: ["стрелок", "охотник", "караульный"], female: ["стрелок", "охотница", "караульная"], neutral: ["стрелок", "охотник"] },
      en: ["sharpshooter", "hunter", "sentry"]
    }
  },
  scout: {
    primary: "wits",
    secondary: "agility",
    skills: ["scouting", "survival", "stealth", "move", "animal-handling"],
    professions: {
      ru: { male: ["разведчик", "следопыт", "проводник"], female: ["разведчица", "следопытка", "проводница"], neutral: ["разведчик", "следопыт"] },
      en: ["scout", "tracker", "guide"]
    }
  },
  rogue: {
    primary: "agility",
    secondary: "empathy",
    skills: ["stealth", "sleight-of-hand", "manipulation", "insight", "move"],
    professions: {
      ru: { male: ["вор", "контрабандист", "лазутчик"], female: ["воровка", "контрабандистка", "лазутчица"], neutral: ["проныра", "контрабандист"] },
      en: ["thief", "smuggler", "infiltrator"]
    }
  },
  scholar: {
    primary: "wits",
    secondary: "empathy",
    skills: ["lore", "insight", "crafting", "healing", "manipulation"],
    professions: {
      ru: { male: ["учёный", "писарь", "исследователь"], female: ["учёная", "писарь", "исследовательница"], neutral: ["знаток", "исследователь"] },
      en: ["scholar", "scribe", "researcher"]
    }
  },
  healer: {
    primary: "empathy",
    secondary: "wits",
    skills: ["healing", "insight", "lore", "survival", "manipulation"],
    professions: {
      ru: { male: ["лекарь", "цирюльник", "костоправ"], female: ["лекарка", "цирюльница", "костоправка"], neutral: ["целитель", "лекарь"] },
      en: ["healer", "surgeon", "bonesetter"]
    }
  },
  face: {
    primary: "empathy",
    secondary: "wits",
    skills: ["manipulation", "performance", "insight", "lore", "healing"],
    professions: {
      ru: { male: ["переговорщик", "торговец", "зазывала"], female: ["переговорщица", "торговка", "зазывала"], neutral: ["посредник", "торговец"] },
      en: ["negotiator", "trader", "spokesperson"]
    }
  },
  craftsperson: {
    primary: "strength",
    secondary: "wits",
    skills: ["crafting", "lore", "might", "endurance", "insight"],
    professions: {
      ru: { male: ["ремесленник", "механик", "мастеровой"], female: ["ремесленница", "механик", "мастерица"], neutral: ["мастер", "ремесленник"] },
      en: ["artisan", "mechanic", "craftsperson"]
    }
  },
  laborer: {
    primary: "strength",
    secondary: "agility",
    skills: ["might", "endurance", "crafting", "move", "melee"],
    professions: {
      ru: { male: ["рабочий", "грузчик", "шахтёр"], female: ["работница", "грузчица", "шахтёрка"], neutral: ["работник", "чернорабочий"] },
      en: ["laborer", "porter", "miner"]
    }
  },
  handler: {
    primary: "empathy",
    secondary: "wits",
    skills: ["animal-handling", "survival", "scouting", "healing", "move"],
    professions: {
      ru: { male: ["погонщик", "конюх", "зверолов"], female: ["погонщица", "смотрительница конюшни", "звероловка"], neutral: ["проводник", "укротитель"] },
      en: ["animal handler", "stable hand", "trapper"]
    }
  }
};

const TIER_DEFINITIONS = {
  ordinary: { skillPoints: 5, maxSkill: 2, seedSkills: 2 },
  capable: { skillPoints: 8, maxSkill: 3, seedSkills: 3 },
  veteran: { skillPoints: 12, maxSkill: 4, seedSkills: 4 }
};

// Все профили получают ровно 14 пунктов характеристик. Уровень влияет только на навыки.
// Несколько форм распределения сохраняют специализацию архетипа, не делая всех НПС одинаковыми.
const ATTRIBUTE_DISTRIBUTIONS = [
  { value: [5, 4, 3, 2], weight: 55 },
  { value: [5, 3, 3, 3], weight: 25 },
  { value: [4, 4, 3, 3], weight: 20 }
];

const RECENT_BIO_LIMIT = 250;
const recentBioSignatures = [];
const recentBioSet = new Set();

function weightedChoice(entries) {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = Math.random() * total;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll < 0) return entry.value;
  }
  return entries.at(-1)?.value;
}

function shuffle(values) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function resolveRoleKey(roleKey) {
  return ROLE_DEFINITIONS[roleKey]
    ? roleKey
    : randomOf(PROFILE_ROLE_KEYS);
}

function resolveTierKey(tierKey) {
  if (TIER_DEFINITIONS[tierKey]) return tierKey;
  return weightedChoice([
    { value: "ordinary", weight: 55 },
    { value: "capable", weight: 35 },
    { value: "veteran", weight: 10 }
  ]);
}

function generateAttributes(roleKey) {
  const role = ROLE_DEFINITIONS[roleKey];
  const distribution = weightedChoice(ATTRIBUTE_DISTRIBUTIONS);
  const remaining = shuffle(ATTRIBUTE_KEYS.filter(key => ![role.primary, role.secondary].includes(key)));
  const ordered = [role.primary, role.secondary, ...remaining];
  return Object.fromEntries(ordered.map((key, index) => [key, distribution[index]]));
}

function generateSkills(roleKey, tierKey) {
  const role = ROLE_DEFINITIONS[roleKey];
  const tier = TIER_DEFINITIONS[tierKey];
  const values = Object.fromEntries(SKILL_KEYS.map(key => [key, 0]));
  let remaining = tier.skillPoints;

  for (const skill of role.skills.slice(0, tier.seedSkills)) {
    values[skill] += 1;
    remaining -= 1;
  }

  const weightedRoleSkills = role.skills.flatMap((skill, index) => Array(Math.max(1, 5 - index)).fill(skill));
  while (remaining > 0) {
    const useOffRole = Math.random() < 0.12;
    const pool = useOffRole ? SKILL_KEYS : weightedRoleSkills;
    const available = pool.filter(skill => values[skill] < tier.maxSkill);
    const fallback = SKILL_KEYS.filter(skill => values[skill] < tier.maxSkill);
    const skill = randomOf(available.length ? available : fallback);
    if (!skill) break;
    values[skill] += 1;
    remaining -= 1;
  }

  return values;
}

function chooseProfession(roleKey, gender) {
  const professions = ROLE_DEFINITIONS[roleKey].professions.ru;
  const normalizedGender = ["male", "female"].includes(gender) ? gender : "neutral";
  return randomOf(professions[normalizedGender] || professions.neutral || professions.male);
}

function sampleDistinct(pool, count) {
  return shuffle(pool).slice(0, Math.max(0, Math.min(count, pool.length)));
}

function rememberBioSignature(signature) {
  recentBioSignatures.push(signature);
  recentBioSet.add(signature);
  while (recentBioSignatures.length > RECENT_BIO_LIMIT) {
    const removed = recentBioSignatures.shift();
    if (!recentBioSignatures.includes(removed)) recentBioSet.delete(removed);
  }
}

function assembleBioParts() {
  const voice = randomOf(BIO_RU.voice);
  const character = randomOf(BIO_RU.character);
  const [habitOne, habitTwo] = sampleDistinct(BIO_RU.habit, 2);
  const [detailOne, detailTwo] = sampleDistinct(BIO_RU.detail, 2);
  const pressure = randomOf(BIO_RU.pressure);
  const signature = [voice, character, habitOne, habitTwo, detailOne, detailTwo, pressure].join("|");
  const bio = [
    `Голос: ${voice}.`,
    `Характер: ${character}.`,
    `Повадки: ${habitOne}; ${habitTwo}.`,
    `Мелкие детали: ${detailOne}; ${detailTwo}.`,
    `Под давлением: ${pressure}.`
  ].join(" ");
  return { signature, bio };
}

function generateBio() {
  // При таком объёме таблиц совпадение маловероятно, но дополнительно исключаем
  // полное повторение среди последних профилей текущей сессии.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = assembleBioParts();
    if (recentBioSet.has(result.signature)) continue;
    rememberBioSignature(result.signature);
    return result.bio;
  }

  const fallback = assembleBioParts();
  rememberBioSignature(fallback.signature);
  return fallback.bio;
}

export function generateNpcProfile(options = {}) {
  const roleKey = resolveRoleKey(options.roleKey || options.role || "random");
  const tierKey = resolveTierKey(options.tierKey || options.tier || "random");
  const gender = options.gender || "neutral";
  const attributes = generateAttributes(roleKey);
  const skills = generateSkills(roleKey, tierKey);
  const profession = chooseProfession(roleKey, gender);
  const bio = generateBio();

  return {
    roleKey,
    tierKey,
    profession,
    bio,
    bioLanguage: "ru",
    attributes,
    skills,
    generatedAt: new Date().toISOString()
  };
}

export function profileToSystemData(profile) {
  const attribute = {};
  for (const [key, value] of Object.entries(profile?.attributes || {})) {
    attribute[key] = { value, max: value };
  }

  const skill = {};
  for (const [key, value] of Object.entries(profile?.skills || {})) {
    skill[key] = { value };
  }

  return {
    attribute,
    skill,
    bio: {
      profession: { value: profile?.profession || "" },
      note: { value: profile?.bio || "" }
    }
  };
}

export function applyProfileToActorData(actorData, profile, options = {}) {
  if (!actorData || !profile) return actorData;
  const overwrite = options.overwrite !== false;
  actorData.system ??= {};
  actorData.system.attribute ??= {};
  actorData.system.skill ??= {};
  actorData.system.bio ??= {};

  for (const [key, value] of Object.entries(profile.attributes || {})) {
    actorData.system.attribute[key] ??= {};
    const current = Number(actorData.system.attribute[key].value);
    if (overwrite || !Number.isFinite(current) || current <= 0) {
      actorData.system.attribute[key].value = value;
      actorData.system.attribute[key].max = value;
    } else if (!Number.isFinite(Number(actorData.system.attribute[key].max)) || Number(actorData.system.attribute[key].max) <= 0) {
      actorData.system.attribute[key].max = current;
    }
  }

  for (const [key, value] of Object.entries(profile.skills || {})) {
    actorData.system.skill[key] ??= {};
    const current = Number(actorData.system.skill[key].value);
    if (overwrite || !Number.isFinite(current) || current <= 0) actorData.system.skill[key].value = value;
  }

  actorData.system.bio.profession ??= {};
  actorData.system.bio.note ??= {};
  if (overwrite || !String(actorData.system.bio.profession.value || "").trim()) {
    actorData.system.bio.profession.value = profile.profession || "";
  }
  if (overwrite || !String(actorData.system.bio.note.value || "").trim()) {
    actorData.system.bio.note.value = profile.bio || "";
  }

  return actorData;
}
