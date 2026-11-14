export const CULTURE_ALIASES = {
  novandia: "novand",
  novand: "novand",
  sangren: "sangren",
  sirost: "sirostyen",
  sirostyen: "sirostyen",
  flechenrand: "flechenrand",
  yaknizem: "yaknizem",
  horslia: "horsliaOntakwa",
  ontakwa: "horsliaOntakwa",
  horsliaOntakwa: "horsliaOntakwa",
  tirabor: "tiribor",
  tiribor: "tiribor",
  lezhnizem: "lezhnizem",
  dichtbeir: "dikhtbeyr",
  dikhtbeyr: "dikhtbeyr",
  naerder: "naerder",
  kaldvelg: "kaldvelg",
  boltrask: "boltras",
  boltras: "boltras",
  sarroyo: "seiku",
  seiku: "seiku",
  royu_mideki: "royuMideki",
  royuMideki: "royuMideki",
  royu_sageki: "royuSageki",
  royuSageki: "royuSageki",
  izuaver: "izuaver"
};

export const CULTURE_ART_FOLDER_LABELS = {
  novand: "Novand",
  sangren: "Sangren",
  sirostyen: "Sirostyen",
  flechenrand: "Flechenrand",
  yaknizem: "Yaknizem",
  horsliaOntakwa: "Horslia-Ontakwa",
  tiribor: "Tiribor",
  lezhnizem: "Lezhnizem",
  dikhtbeyr: "Dikhtbeyr",
  naerder: "Naerder",
  kaldvelg: "Kaldvelg",
  izuaver: "Izuaver",
  boltras: "Boltras",
  seiku: "Seiku",
  royuMideki: "Royu-Mideki",
  royuSageki: "Royu-Sageki"
};

export function buildDefaultGenderCultureFolders(root = "3_F00L/Art/NPC/Human/Named/Random") {
  const result = { male: {}, female: {} };
  for (const [key, folderName] of Object.entries(CULTURE_ART_FOLDER_LABELS)) {
    result.male[key] = `${root}/Male/${folderName}`;
    result.female[key] = `${root}/Female/${folderName}`;
  }
  return result;
}
