# Fis_data — только данные

Скрипты вынесены в параллельную папку **`../Fis_runtime/`**.  
Геометрическая онтология (сорты, конструкторы, операции) — в **`../Geo_style/`** (данные). Runtime геометрии — только `Fis_runtime/geo_compute.js`.

| Модуль | Файл | Роль |
|--------|------|------|
| FisUnits | `Fis_runtime/units.js` | алгебра, единицы, AST→display |
| FisPresentation | `Fis_runtime/presentation.js` | слоты, клики |
| Projection | `Fis_runtime/projection.js` | паспорта |
| FisPackage | `Fis_runtime/package.js` | фильтры, списки, handlers |
| ConstructLayout | `Fis_runtime/construct_layout.js` | раскладка конструкций в Frame |
| GeoCompute | `Fis_runtime/geo_compute.js` | кривые, sample, **Frame** (toScreen/fromScreen), law-graph |
| Geo ontology | `Geo_style/geo_core.json`, `geo_ops.json` | сорта Point/Vec2/Frame…, конструкторы, ops |

**Порядок подключения (projections.html):**  
`units → presentation → projection → package → geo_compute → construct_layout`

(Frame используется при вызове layout/toSVG, не при загрузке скрипта; geo_compute должен быть уже в `window`.)

**Frame (единая координатная логика):**  
- Сорт `Frame` + `G0.frame` в `Geo_style/geo_core.json`.  
- Runtime: `GeoCompute.createFrame` / `frameFromEnv` / `toScreen` / `fromScreen` / `setScale` / `setViewport`.  
- `kind=environment` (E0) — провайдер Frame, не особый случай координат.  
- ConstructLayout кладёт `layoutModel.frame`; `toSVG` рисует через `toScreen`.  
- Масштаб = `scale_x` / `scale_y` (независимо).
