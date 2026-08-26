# Constructions

Данные конструкций лежат в **`../Constructs.json`** (список, как `physi_formulas.json`).  
Реестр структур связей — **`../relation_types.json`** (как `AST.json`).

## Параллель

| Формулы | Конструкции |
|---------|-------------|
| `AST.json` structures **A*** , слоты **O*** | `relation_types.json` types **R_*** , слоты **S*** |
| `physi_formulas` law + `structure_ref` + `bindings` O*→Q* | `Constructs.json` construction + `relations[].structure_ref` + `bindings` S*→inst* |
| operands | elements: inst* → E* (+ role, quantities) |

## Форма одной конструкции

```json
{
  "id": "C1",
  "environment": "E0",
  "elements": [
    { "id": "inst1", "component": "E001", "role": "spring_1", "quantities": {} }
  ],
  "relations": [
    {
      "id": "L1",
      "structure_ref": "R_SERIES",
      "bindings": { "S1": "inst1", "S2": "inst2" }
    }
  ]
}
```

Вычислительный слой: берёт `structure_ref` → структура из `relation_types` → подставляет `bindings` (inst на слоты) → получает конкретную топологию; величины с `elements[].quantities` стыкует с формулами.
