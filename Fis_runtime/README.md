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


## PhysicalState: C001 checkpoint

Headless computation and addressed values are now separate from layout. The existing
`GeoCompute.applyConstructionLinks` keeps its legacy equilibrium/inverse behavior;
loading the new modules enables the physical-state path in the construction passport.

Load in this order:

1. `units.js`, `geo_compute.js`, `mechanics.js`
2. `../Geo_style/physical_geometry.js`
3. `law_executor.js`, `physical_state.js`
4. `construct_layout.js`, `presentation.js`, `projection.js`, `package.js`

Do not load the old `Geo_style/geo_compute.js` over `Fis_runtime/geo_compute.js`:
those two files still publish different implementations of `GeoCompute`.
The new geometry uses the separate `GeoGeometry` export and Geo_style sorts.
Rect dimensions are in metres; geometry rotation is in radians.
Named `attachment` references in E002/E003 currently coincide with their centres;
these are simplified attachments, not contact detection.

```js
const pack = { components, constructs, formulas, structures: AST,
  physi_quant, usages, units };
const physical = PhysicalState.compute(C001, pack);
const updated = PhysicalState.recompute(physical, {
  slotId: 'mass.radius_vector', value: [0.5, 0.65, 0]
});
const layout = ConstructLayout.fromPhysicalState(updated, {pxPerMeter: 300});
const svg = ConstructLayout.toSVG(layout);
// Or supply the same state to the existing passport:
Projection.render(container, {data: pack,
  projection: {kind: 'construction_passport'},
  state: {construction_id: 'C001', physical_state: updated}});
```

`compute` returns `ok`, `diagnostics`, `instances`, `occurrences`, `interactions`,
`dependencies`, `slot_addresses` and a resolved `construction` for existing consumers.
An occurrence carries its value, quantity, role, canonical membership/event address,
Frame for vectors, dimension and provenance. Dependency outputs are occurrence keys.
Recompute produces a new snapshot and accepts only input parameters; geometry/law
outputs cannot silently become editable inputs. The original JSON is not mutated.
A slot alias maps to the canonical key, so dotted instance IDs are never split.

The new path computes current geometry before delta/P014, resolves P291 against
current and rest length, orients the spring force, evaluates gravity through P005,
aggregates addressed forces and isolates acceleration in P005's existing AST.
It does not move a prescribed body into equilibrium. The initial C001 data still
places the mass at y=0.7 m; the numerical checkpoint uses y=0.65 m.

Supported checkpoint: C001, C002, C010 and repeated includes of these systems.
C003's intermediate spring junction reports `UNSUPPORTED_SERIES_JUNCTION` in the
new path. Contact detection, equilibrium constraints, time integration and general
EQ solving are subsequent checkpoints. Scalar/vector product ambiguity and missing
bindings/dimensions are explicit diagnostics, not first-match fallbacks.

Run without dependencies (Node 18+):

```sh
node --test tests/*.test.cjs
python -m http.server 8000
```

Open `http://localhost:8000/examples/c001.html` for the interactive checkpoint.
The test suite includes baseline legacy behavior, occurrence/Frame identity,
repeated includes, numerical state changes, AST-driven values/dimensions, explicit
blockers, SVG and a headless canvas/passport integration check.
