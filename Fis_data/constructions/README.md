# Constructions

Трёхслойная модель:

1. **assets** (`Fis_data/assets/registry.json`) — только визуал. ID = **M***. SVG + геометрические параметры (anchor, scale, opacity…).
2. **components** (`Fis_data/components.json`) — физическая природа. ID = **E***. Ссылка на M* + kind, scale, quantities, ports.
3. **constructions** — сборки. Экземпляры компонентов (E*) + relations.

Конструкция хранит:

- `elements` — экземпляры компонентов (`component`: E*);
- `relations` — бинарные связи между экземплярами.

На первом этапе connection points не обязательны: положение и линии считает layout-слой.

Минимальная форма:

```json
{
  "schema_version": "0.2.0",
  "id": "C1",
  "elements": [
    { "id": "inst1", "component": "E001" },
    { "id": "inst2", "component": "E001" }
  ],
  "relations": [
    { "id": "L1", "type": "series", "from": "inst1", "to": "inst2" }
  ]
}
```

Расчёт и физические свойства берутся из компонентов (E*), не из ассетов (M*).
