# Forbidden Lands Character Forge 2.0

Модуль для Foundry VTT 13.351 и Forbidden Lands 13.0.5. Создаёт случайных NPC с именами культур Воздушных Островов, назначает портреты и prototype tokens, следит за повторами изображений и умеет давать разные имена размещённым wildcard-токенам одного Actor.

## Установка

Скопируй папку `fbl-character-forge` в:

```text
FoundryVTT/Data/modules/fbl-character-forge
```

Включи модуль в мире и перезагрузи его.

При обновлении с 1.7.4 настройки мигрируют автоматически. Перед обновлением мира всё равно сделай обычную резервную копию.

## Основное окно

По умолчанию Character Forge заменяет стандартное создание Actor, когда среди доступных типов есть `character`.

Независимый запуск макросом:

```js
game.fblCharacterForge.openForge();
```

В окне доступны:

- конкретная или случайная культура и пол имени;
- генерация одного имени или восьми вариантов;
- ручное редактирование имени;
- выбор типа Actor и папки;
- выбор арт-набора и вложенного поднабора;
- предпросмотр портрета и токена;
- reroll, инспекция, обновление кеша и сброс занятости;
- создание, создание с открытием листа, создание с продолжением;
- пакетное создание;
- история последних созданных Actor.

Замену стандартного окна можно отключить в настройках модуля. После этого Forge остаётся доступен через макрос и API.

## Структура арт-папок

Пути Foundry задаются относительно `FoundryVTT/Data`, без слова `Data` и с `/` вместо `\`.

Пример:

```text
FoundryVTT/Data/3_F00L/Art/NPC/Human/Named/Random
```

В настройке:

```text
3_F00L/Art/NPC/Human/Named/Random
```

Стандартный набор `humanByCultureGender` ожидает ветки:

```text
Random/
  Male/
    Novand/
    Sangren/
    Sirostyen/
    ...
  Female/
    Novand/
    Sangren/
    Sirostyen/
    ...
```

Названия и пути можно изменить в редакторе наборов артов.

## Pairing портрета и токена

Для портрета `12.webp` модуль может найти:

```text
12T.webp
t12.webp
token-12.webp
12-token.webp
processed-12.webp
```

Правила находятся в настройке «Шаблоны имён токенов». В каждой строке должен быть `{id}`.

Примеры:

```text
{id}T
t{id}
token-{id}
{id}-token
```

## Реестр занятых изображений

При успешном создании Actor назначенные portrait и token записываются в скрытый world registry. Модуль не переименовывает и не удаляет файлы на диске.

В версии 2.0:

- выбор и запись проходят через последовательную очередь;
- один файл может хранить роли `portrait` и `token` одновременно;
- удаление Actor освобождает его записи;
- ручная смена изображений освобождает старые пути и регистрирует новые в известном арт-наборе;
- диагностика удаляет записи-сироты;
- занятость можно сбросить отдельно для выбранного набора.

## Кеш папок

Результаты `FilePicker.browse` кешируются. TTL задаётся в настройках модуля. Значение `0` хранит кеш до ручной очистки или перезагрузки.

Ручная очистка доступна:

- в Character Forge;
- в диагностике;
- через `game.fblCharacterForge.clearArtCache()`.

## Редакторы

В настройках модуля доступны отдельные ApplicationV2-окна:

- редактор наборов имён;
- редактор наборов артов;
- редактор шаблонов имён токенов;
- диагностика.

Редакторы имён и артов сохраняют JSON как внутренний формат, но работают с одним набором за раз, валидируют структуру до сохранения, позволяют импортировать и экспортировать JSON, переименовать ключ и вернуть стандартный набор.

## Пакетное создание

Из Forge можно создать до 100 Actor подряд. Через API:

```js
const report = await game.fblCharacterForge.createBatch({
  count: 10,
  cultureKey: "novand",
  gender: "random",
  artSetKey: "humanByCultureGender",
  folderName: "Новандские NPC",
  createFolder: true
});

console.log(report.results, report.errors);
```

## Actor-шаблоны из Compendium

Forge может клонировать Actor по UUID, затем заменить имя, арт, папку и flags:

```js
await game.fblCharacterForge.createActor({
  templateUuid: "Compendium.world.actor-templates.Actor.xxxxxxxxxxxxxxxx",
  cultureKey: "sangren",
  gender: "random",
  folderName: "Сангренские NPC",
  createFolder: true,
  openSheet: false
});
```

Результат создаётся в world Actors. Прямая запись в Compendium pack в 2.0 не включена.

## Случайные имена wildcard-токенов

В Prototype Token Config:

1. включи wildcard/random image;
2. выбери «Случайное имя размещённого токена»;
3. укажи конкретную культуру или случайную культуру.

При размещении на сцене меняется только имя Token. Имя Actor остаётся прежним.

Кнопка d20 в Token HUD показывается только для настроенного токена:

- клик: новое имя выбранной культуры;
- Alt-клик: новая случайная культура;
- Ctrl-клик: вернуть имя Actor.

Массовый reroll выделенных токенов:

```js
await game.fblCharacterForge.rerollControlledTokenNames();
```

## Основной API

```js
const forge = game.fblCharacterForge;

forge.openForge();
forge.openDiagnostics();
forge.openNameSetManager();
forge.openArtSetManager();
forge.openTokenNamePatterns();

forge.generateName("novand", "male");
forge.generateNameDetailed("sangren", "female");
forge.previewNames("izuaver", "random", 20);
forge.normalizeCultureKey("novandia");

await forge.rollArt("humanByCultureGender", {
  cultureKey: "sangren",
  gender: "female",
  artSubsetKey: "Military"
});

await forge.createActor({
  cultureKey: "sangren",
  gender: "random",
  artSetKey: "humanByCultureGender",
  sourceModule: "fbl-tavern-generator",
  purpose: "tavernkeeper",
  folderName: "Тавернщики",
  createFolder: true,
  flags: {
    "fbl-tavern-generator": { role: "tavernkeeper" }
  }
});
```

`createActor` возвращает:

```js
{
  actor,
  nameDetails,
  nameSetKey,
  gender,
  artSetKey,
  art,
  artError,
  warnings
}
```

## Диагностика

Макрос:

```js
game.fblCharacterForge.openDiagnostics();
```

Окно проверяет:

- версии Foundry, системы и модуля;
- структуру наборов имён и артов;
- размер кеша;
- реестр занятости и записи-сироты.

## Совместимость и fallback

Модуль рассчитан на Foundry VTT 13.351 и Forbidden Lands 13.0.5.

Замена `Actor.createDialog` является совместимым входом, а не единственным способом запуска. Если Forge не может открыться, wrapper вызывает оригинальный диалог. При конфликте с другим модулем отключи замену стандартного создания и открывай Forge макросом.

## Документация разработки

- `REVIEW-AND-ROADMAP.md` — независимое ревью, оценка стороннего ревью, полный план и тесты.
- `CHANGELOG.md` — изменения версий 2.0.x.

## Generated NPC profiles

For `character` Actors, Character Forge can generate a Forbidden Lands NPC profile at creation time. Every generated profile receives exactly 14 total attribute points. The selected archetype controls which attributes and skills are favored, while competence affects skills only: ordinary profiles receive 5 skill points, capable profiles 8, and veterans 12.

The profession and `BIO → Notes` text are always generated in Russian, regardless of the Foundry interface language. BIO includes a voice, character, two habits, two small details, and a reaction under pressure. The tables contain 272 unique entries and full recent BIO repeats are suppressed within the current session.

The feature is enabled by default and can be disabled globally or per Actor in the forge. Existing non-zero data from a Compendium template is preserved unless API callers explicitly request profile overwrite.
