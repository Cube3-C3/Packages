# Constructions

Параллель с формульным слоем:

| Формулы | Конструкции |
|---------|-------------|
| `AST.json` → structures (A1…) | `relation_types.json` → types (R_SERIES…) |
| `physi_formulas` → law + structure_ref + bindings | `constructions/C*.json` → elements + relations + quantities |
| operand O* ← quantity Q* | inst* ← component E* + quantities{} |

## Слои

1. **E0** (`physi_comps`) — среда: origin, assumptions, initial_conditions.
2. **E*** — компоненты (физика + ссылка на M*).
3. **relation_types** — реестр логических связей (series / parallel / attach / junction…).
4. **C*** — конкретная конструкция: экземпляры элементов + экземпляры связей + величины на каждом элементе.

## Форма конструкции

```json
{
  "schema_version": "0.3.0",
  "id": "C1",
  "environment": "E0",
  "elements": [
    {
      "id": "inst1",
      "component": "E001",
      "quantities": { "k": "Q_xxx", "x": "Q_yyy" }
    }
  ],
  "relations": [
    { "id": "L1", "type": "R_SERIES", "from": "inst1", "to": "inst2" }
  ]
}
```

- `type` в relations — id из `relation_types.json`.
- `quantities` на элементе — набор величин, которые его описывают/измеряют в этой сборке (пока может быть `{}`).
- Позиции относительно `E0.origin` считает вычислительный слой (позже).
