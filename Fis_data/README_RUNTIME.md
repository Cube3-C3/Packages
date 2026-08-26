# Fis_data — только данные

Скрипты вынесены в параллельную папку **`../Fis_runtime/`**:

| Было в code.js | Файл |
|----------------|------|
| FisUnits (алгебра, единицы, AST→display) | `Fis_runtime/units.js` |
| Projection (паспорта) | `Fis_runtime/projection.js` |
| FisPresentation (слоты, клики) | `Fis_runtime/presentation.js` |
| FisPackage (фильтры, списки, handlers) | `Fis_runtime/package.js` |
| geo_compute | `Fis_runtime/geo_compute.js` (+ `Geo_style/`) |

Порядок подключения: units → presentation → projection → package → geo_compute.
