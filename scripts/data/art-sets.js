import { buildDefaultGenderCultureFolders } from "./cultures.js";

export const ART_SOURCE_FIELDS = ["folder", "portraitFolder", "tokenFolder", "portraitFiles", "tokenFiles", "portraits", "tokens"];

export const DEFAULT_ART_SETS = {
  "humanByCultureGender": {
    "label": "Люди: пол и культура",
    "source": "data",
    "folders": buildDefaultGenderCultureFolders("3_F00L/Art/NPC/Human/Named/Random"),
    "pairByName": true,
    "sameFolderTokenSuffix": true,
    "tokenSuffixes": [
      "T",
      "t"
    ],
    "markUsed": true,
    "notes": "Структура по умолчанию: Random/Male/Novand, Random/Female/Novand и так далее. Внутри папки культуры можно создавать подпапки-наборы, например Tavern. Если портрет называется 1.webp, токен ищется по глобальным шаблонам имени токена: 1T, 1t, t1, t 1 и т.п."
  },
  "humanNamedRandom": {
    "label": "Люди: Named Random, общий старый набор",
    "source": "data",
    "folder": "3_F00L/Art/NPC/Human/Named/Random",
    "portraitFolder": "3_F00L/Art/NPC/Human/Named/Random",
    "tokenFolder": "3_F00L/Art/NPC/Human/Named/Random",
    "pairByName": true,
    "sameFolderTokenSuffix": true,
    "tokenSuffixes": [
      "T",
      "t"
    ],
    "markUsed": true,
    "notes": "Старый общий набор без разделения по полу и культуре. Портрет 1.webp ищет токен по глобальным шаблонам имени токена: 1T, 1t, t1, t 1 и т.п."
  }
};
