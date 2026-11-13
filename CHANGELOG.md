# Changelog

## 2.1.1

- All generated NPC profiles now receive exactly 14 total attribute points, regardless of competence tier.
- Competence now affects skills only: 5 points for ordinary, 8 for capable, and 12 for veteran profiles.
- Generated profession and BIO text are always written in Russian, independent of the Foundry interface language.
- Rebuilt BIO generation around five explicit sections: voice, character, habits, small details, and behavior under pressure.
- Expanded the Russian generation tables to 272 unique entries: 48 voices, 48 character profiles, 64 habits, 64 small details, and 48 pressure reactions.
- Each BIO uses two distinct habits and two distinct details. Exact full BIO repeats are suppressed across the last 250 profiles of the current session.

## 2.1.0

- Rerolling or manually changing a name no longer clears the selected portrait and token.
- Added optional automatic generation of Forbidden Lands attributes, skills, profession, and a short BIO roleplaying note.
- Added compact archetype and competence controls to Character Forge.
- Batch creation now generates an independent mechanical and BIO profile for every Actor.
- Added `generateNpcProfile` and `profileToSystemData` to the public API.

## 2.0.2

- Полностью переработано главное окно Character Forge: компактная двухколоночная компоновка без растянутых карточек и пустых областей.
- Пакетное создание и история перенесены в сворачиваемые секции.
- Убрана дублирующая крупная шапка внутри окна; диагностика перенесена в компактную кнопку секции персонажа.
- Превью портрета и токена уменьшены и собраны с действиями в единый рабочий блок.
- Нижняя панель больше не использует чужеродную тёмную подложку и не оставляет пустую полосу над resize handle.
- Исправлен ложный busy-overlay: атрибут `aria-busy` теперь присутствует только во время реальной операции, а не со значением `false`.
- Размер окна по умолчанию уменьшен с 920×760 до 780×460.
- Добавлены недостающие подписи и tooltips для действий с артами и историей.
- Стили ограничены namespace модуля и используют базовые цвета текущей темы Foundry без жёсткой светлой или тёмной палитры.

## 2.0.1

### Fixed

- Character Forge no longer assigns to the read-only `ApplicationV2.state` lifecycle accessor. Internal form data now uses the module-owned `forgeState` field, restoring the Actor creation window on Foundry VTT v13.

## 2.0.0

### Added

- Full ApplicationV2 Character Forge.
- Name suggestions and resolved-context preview.
- Independent art reroll, subset selection and art-set inspection.
- Batch Actor creation and local generation history.
- Name-set and art-set managers with validation, import, export and key renaming.
- ApplicationV2 token filename-pattern manager.
- Diagnostics center.
- Cached FilePicker asset browser with configurable TTL.
- Asset Registry 2.0 with queue, cleanup, synchronization and statistics.
- Actor template cloning through `templateUuid`.
- Russian and English localization.
- Expanded public API and macro entry points.
- Token-name preview, Alt random-culture reroll, Ctrl Actor-name restore.

### Fixed

- Manifest/API version mismatch.
- Stale resolved gender after manual name edits.
- Forge flags being written to non-character Actors.
- Premature reuse of a paired token.
- Portrait/token `kind` overwriting when both use the same file.
- Used assets remaining reserved after Actor deletion or art replacement.
- Race between art selection and used-asset registration on one client.
- Non-wildcard tokens retaining a stale random-name flag after wildcard mode was disabled.
- Successful batch Actors being reported as failed when a progress callback threw.
- Successful Actor creation being masked by a registry or history persistence failure.

### Changed

- Replaced the large DialogV2 UI with ApplicationV2.
- Reduced TokenHUD integration to public render hooks.
- Removed private TokenHUD method patches, MutationObserver and timer cascade.
- Added a setting to disable replacement of core Actor creation.
- Added safe fallback to the original Actor creation dialog.
- Moved all FilePicker browsing into one cacheable service.
- Migrated registry entries from `kind` to `kinds` and schema version 2.

### Removed

- Unused `templates/token-name-patterns-config.html`.
- Legacy string-built token-pattern settings form.
