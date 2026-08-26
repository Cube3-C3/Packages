# Constructions

Конкретная конструкция хранит два основных списка:

- `elements` — экземпляры визуальных элементов из `Fis_data/assets/registry.json`;
- `relations` — бинарные связи между экземплярами элементов.

На первом этапе связь не требует connection points: положение элементов и линии между ними вычисляются контейнером/layout-слоем.

Минимальная форма конструкции:

```json
{
  "schema_version": "0.1.0",
  "id": "C1",
  "elements": [
    {"id": "E1", "asset": "spring"},
    {"id": "E2", "asset": "spring"}
  ],
  "relations": [
    {"id": "L1", "type": "series", "from": "E1", "to": "E2"}
  ]
}
```
