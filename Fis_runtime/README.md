# Fis_runtime

Вычислительный и UI-слой пакета Fis, вынесенный из монолита `Fis_data/code.js`.

## Модули (4 критерия + geo)

| Файл | Host | Роль |
|------|------|------|
| `units.js` | `FisUnits` | Алгебра: размерности, единицы, AST → текст/HTML |
| `projection.js` | `Projection` | Паспорта величин и формул |
| `presentation.js` | `FisPresentation` | Слоты, чипы, таблицы, slot-action / клики |
| `package.js` | `FisPackage` | Фильтры, списки, ingest, handlers для платформы |
| `geo_compute.js` | GeoCompute | Геометрия / кривые (дублирует Geo_style) |

Данные остаются в `../Fis_data/` (JSON, assets, components, constructions).

Порядок загрузки: **units → presentation → projection → package** (+ geo по необходимости).

Дальше сюда же можно класть construction runtime (layout, primitives), не смешивая с данными.

## construct_layout.js

`ConstructLayout.layout(construction, pack)` → nodes/edges с координатами (E0: origin bottom-left, y up).  
`ConstructLayout.toSVG(layoutModel, { assetHrefPrefix })` → SVG.

Поддержка связей: `R_SERIES` / `R_ATTACH` (цепочка по +x), `R_PARALLEL` (ряды по +y).

Превью: `../construct_preview.html` (C1).
