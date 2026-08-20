/**
 * geo_compute.js — вычислительный слой геометрии + пайплайн «формула → данные кривой» (v0.2)
 *
 * Кривая: explicit / parametric. Точки не хранятся.
 *
 * Базовый API:
 *   GeoCompute.eval(curve, u) → {x,y}|null
 *   GeoCompute.sample(curve, opts) → [{x,y}, …]
 *   GeoCompute.nearest(curve, point, opts) → {u, point, dist, ok}|null
 *
 * Пайплайн до данных для платформенного компонента графика:
 *   GeoCompute.curveFromAst(canonicalAst, { inputOperandId, outputOperandId, domain?, values? })
 *   → { curve, mapping, rebuilt, domain, values }
 *
 * Коэффициенты по умолчанию = 1 (пока). Уточнение под закономерности — позже.
 * Логика перестройки операндов — как в Packages/rebuild_ast.js:
 *   O1 = значение функции, On = аргумент.
 */
(function (global) {
  "use strict";

  // ── helpers ──────────────────────────────────────────────

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function dist2(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  }

  function dist(a, b) {
    return Math.sqrt(dist2(a, b));
  }

  function domainOf(curve) {
    const d = curve.domain;
    if (!Array.isArray(d) || d.length < 2) {
      return curve.form === "explicit" ? [0, 4] : [0, 1];
    }
    return [Number(d[0]), Number(d[1])];
  }

  // ── eval / sample / nearest (кривая) ─────────────────────

  function evalCurve(curve, u) {
    if (!curve || typeof u !== "number" || !isFinite(u)) return null;

    if (curve.form === "explicit") {
      const f = typeof curve.f === "function" ? curve.f : (curve.y || null);
      if (typeof f !== "function") return null;
      const y = f(u);
      if (!isFinite(y)) return null;
      return { x: u, y: y };
    }

    if (curve.form === "parametric") {
      if (typeof curve.x !== "function" || typeof curve.y !== "function") return null;
      const x = curve.x(u);
      const y = curve.y(u);
      if (!isFinite(x) || !isFinite(y)) return null;
      return { x: x, y: y };
    }

    return null;
  }

  function sample(curve, opts) {
    opts = opts || {};
    const n = Math.max(2, opts.n | 0 || 64);
    const [d0, d1] = domainOf(curve);
    const a = opts.min != null ? opts.min : d0;
    const b = opts.max != null ? opts.max : d1;
    if (!(b > a)) return [];

    const out = [];
    const closed = !!curve.closed && curve.form === "parametric";

    for (let i = 0; i <= n; i++) {
      const u = a + (b - a) * (i / n);
      const p = evalCurve(curve, u);
      if (p) out.push(p);
    }

    if (closed && out.length > 1) {
      const first = out[0];
      const last = out[out.length - 1];
      if (dist2(first, last) > 1e-12) out.push({ x: first.x, y: first.y });
    }

    return out;
  }

  function nearest(curve, point, opts) {
    if (!curve || !point || !isFinite(point.x) || !isFinite(point.y)) return null;
    opts = opts || {};
    const n = Math.max(8, opts.n | 0 || 128);
    const eps = opts.eps != null ? opts.eps : Infinity;

    const [a, b] = domainOf(curve);
    if (!(b > a)) return null;

    let bestU = a;
    let bestP = evalCurve(curve, a);
    let bestD2 = bestP ? dist2(bestP, point) : Infinity;

    for (let i = 1; i <= n; i++) {
      const u = a + (b - a) * (i / n);
      const p = evalCurve(curve, u);
      if (!p) continue;
      const d2 = dist2(p, point);
      if (d2 < bestD2) {
        bestD2 = d2;
        bestU = u;
        bestP = p;
      }
    }

    if (!bestP) return null;

    let step = (b - a) / n;
    for (let pass = 0; pass < 3; pass++) {
      step *= 0.5;
      for (const dir of [-1, 1]) {
        const u = clamp(bestU + dir * step, a, b);
        const p = evalCurve(curve, u);
        if (!p) continue;
        const d2 = dist2(p, point);
        if (d2 < bestD2) {
          bestD2 = d2;
          bestU = u;
          bestP = p;
        }
      }
    }

    const d = Math.sqrt(bestD2);
    return {
      u: bestU,
      point: bestP,
      dist: d,
      ok: d <= eps
    };
  }

  // ── rebuild AST (из Packages/rebuild_ast.js) ─────────────

  function collectOperandIds(ast) {
    const ids = new Set();

    function visit(node) {
      if (!node || typeof node !== "object") return;
      if (typeof node.operand_id === "string") {
        ids.add(node.operand_id);
      }
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      Object.values(node).forEach(visit);
    }

    visit(ast);
    return [...ids].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  }

  function remapOperands(ast, mapping) {
    if (Array.isArray(ast)) {
      return ast.map((node) => remapOperands(node, mapping));
    }
    if (!ast || typeof ast !== "object") return ast;
    if (typeof ast.operand_id === "string") {
      return {
        ...ast,
        operand_id: mapping.get(ast.operand_id) ?? ast.operand_id
      };
    }
    return Object.fromEntries(
      Object.entries(ast).map(([key, value]) => [key, remapOperands(value, mapping)])
    );
  }

  function buildOperandMapping(operandIds, inputOperandId, outputOperandId) {
    if (!operandIds.includes(inputOperandId)) {
      throw new Error("Unknown input operand: " + inputOperandId);
    }
    if (!operandIds.includes(outputOperandId)) {
      throw new Error("Unknown output operand: " + outputOperandId);
    }
    if (inputOperandId === outputOperandId) {
      throw new Error("Input and output operands must be different.");
    }

    const n = operandIds.length;
    const lastPosition = "O" + n;

    // output → O1, input → On, остальные → O2..O(n-1) в исходном порядке
    const mapping = new Map();
    mapping.set(outputOperandId, "O1");
    mapping.set(inputOperandId, lastPosition);

    const middleSlots = [];
    for (let i = 2; i < n; i++) middleSlots.push("O" + i);

    const remainingSource = operandIds.filter(
      (id) => id !== inputOperandId && id !== outputOperandId
    );

    remainingSource.forEach((sourceId, index) => {
      mapping.set(sourceId, middleSlots[index]);
    });

    return mapping;
  }

  function rebuildAst(canonicalAst, selection) {
    const inputOperandId = selection.inputOperandId;
    const outputOperandId = selection.outputOperandId;
    const operandIds = collectOperandIds(canonicalAst);

    if (operandIds.length < 2) {
      throw new Error("AST must contain at least two operands.");
    }

    const mapping = buildOperandMapping(operandIds, inputOperandId, outputOperandId);
    const rebuilt = outputOperandId !== "O1";
    const ast = remapOperands(canonicalAst, mapping);

    return {
      ast: ast,
      mapping: Object.fromEntries(mapping),
      rebuilt: rebuilt,
      operandIds: operandIds,
      lastOperandId: "O" + operandIds.length
    };
  }

  // ── простой вычислитель AST ──────────────────────────────

  function evalAstNode(node, env) {
    if (node == null) return NaN;

    if (typeof node.operand_id === "string") {
      const v = env[node.operand_id];
      return typeof v === "number" ? v : NaN;
    }

    if (typeof node.num === "number") return node.num;
    if (typeof node.value === "number") return node.value;

    if (!node.op) return NaN;

    const op = node.op;

    if (op === "eq") {
      // для графика берём rhs как значение функции
      return evalAstNode(node.rhs, env);
    }

    if (op === "delta") {
      // в школьном пакете delta пока как сам аргумент (приращение позже)
      return evalAstNode(node.arg != null ? node.arg : (node.args && node.args[0]), env);
    }

    const args = node.args || (node.arg != null ? [node.arg] : []);
    const vals = args.map((a) => evalAstNode(a, env));

    switch (op) {
      case "add":
        return vals.reduce((s, v) => s + v, 0);
      case "sub":
        return vals.length === 2 ? vals[0] - vals[1] : NaN;
      case "mul":
        return vals.reduce((p, v) => p * v, 1);
      case "div":
        return vals.length === 2 && vals[1] !== 0 ? vals[0] / vals[1] : NaN;
      case "pow":
        return vals.length === 2 ? Math.pow(vals[0], vals[1]) : NaN;
      case "sin":
        return vals.length === 1 ? Math.sin(vals[0]) : NaN;
      case "cos":
        return vals.length === 1 ? Math.cos(vals[0]) : NaN;
      case "neg":
        return vals.length === 1 ? -vals[0] : NaN;
      default:
        return NaN;
    }
  }

  /**
   * Собрать env: все операнды = 1, кроме аргумента (On) и, при желании, явных values.
   */
  function buildEnv(operandIds, lastOperandId, argValue, explicitValues) {
    const env = Object.create(null);
    for (let i = 0; i < operandIds.length; i++) {
      env[operandIds[i]] = 1;
    }
    if (explicitValues && typeof explicitValues === "object") {
      Object.keys(explicitValues).forEach((k) => {
        if (typeof explicitValues[k] === "number") env[k] = explicitValues[k];
      });
    }
    env[lastOperandId] = argValue;
    // O1 — результат, в env не нужен для вычисления rhs
    return env;
  }

  // ── формула → данные кривой ──────────────────────────────

  /**
   * Построить explicit-кривую из канонического AST.
   *
   * @param {object} canonicalAst  — узел AST (обычно structures[i].ast)
   * @param {object} opts
   * @param {string} opts.inputOperandId   — кто аргумент (станет On)
   * @param {string} opts.outputOperandId  — кто значение функции (станет O1)
   * @param {number[]} [opts.domain=[0,4]]
   * @param {object} [opts.values]         — явные числа для операндов (иначе всё = 1)
   * @returns {{
   *   curve: { form:"explicit", f:Function, domain:number[] },
   *   mapping: object,
   *   rebuilt: boolean,
   *   domain: number[],
   *   values: object,
   *   lastOperandId: string
   * }}
   */
  function curveFromAst(canonicalAst, opts) {
    opts = opts || {};
    const inputOperandId = opts.inputOperandId;
    const outputOperandId = opts.outputOperandId;
    if (!inputOperandId || !outputOperandId) {
      throw new Error("inputOperandId and outputOperandId are required");
    }

    const domain = Array.isArray(opts.domain) && opts.domain.length >= 2
      ? [Number(opts.domain[0]), Number(opts.domain[1])]
      : [0, 4];

    const rebuilt = rebuildAst(canonicalAst, {
      inputOperandId: inputOperandId,
      outputOperandId: outputOperandId
    });

    const operandIds = collectOperandIds(rebuilt.ast);
    const lastOperandId = rebuilt.lastOperandId;
    const explicitValues = opts.values || null;

    // фиксируем значения свободных операндов (по умолчанию 1)
    const fixedValues = Object.create(null);
    for (let i = 0; i < operandIds.length; i++) {
      const id = operandIds[i];
      if (id === lastOperandId) continue;
      if (id === "O1") continue;
      fixedValues[id] = 1;
    }
    if (explicitValues) {
      Object.keys(explicitValues).forEach((k) => {
        if (typeof explicitValues[k] === "number") fixedValues[k] = explicitValues[k];
      });
    }

    const rhs = rebuilt.ast.op === "eq" ? rebuilt.ast.rhs : rebuilt.ast;

    function f(u) {
      const env = buildEnv(operandIds, lastOperandId, u, fixedValues);
      return evalAstNode(rhs, env);
    }

    const curve = {
      form: "explicit",
      f: f,
      domain: domain
    };

    return {
      curve: curve,
      mapping: rebuilt.mapping,
      rebuilt: rebuilt.rebuilt,
      domain: domain,
      values: fixedValues,
      lastOperandId: lastOperandId,
      // готовые точки для компонента платформы (по желанию сразу)
      sample: function (n) {
        return sample(curve, { n: n || 64 });
      }
    };
  }

  /**
   * Удобная обёртка: structure из AST.json + ids операндов исходной формулы.
   * structure = { id, ast, ... } или сразу ast-узел.
   */
  function curveFromStructure(structure, opts) {
    const ast = structure && structure.ast ? structure.ast : structure;
    return curveFromAst(ast, opts);
  }

  // ── публичный API ────────────────────────────────────────

  const GeoCompute = {
    eval: evalCurve,
    sample: sample,
    nearest: nearest,

    explicit: function (f, domain) {
      return {
        form: "explicit",
        f: f,
        domain: domain || [0, 4]
      };
    },

    parametric: function (xFn, yFn, domain, closed) {
      return {
        form: "parametric",
        x: xFn,
        y: yFn,
        domain: domain || [0, 1],
        closed: !!closed
      };
    },

    // AST → кривая
    rebuildAst: rebuildAst,
    collectOperandIds: collectOperandIds,
    curveFromAst: curveFromAst,
    curveFromStructure: curveFromStructure
  };

  global.GeoCompute = GeoCompute;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = GeoCompute;
  }
})(typeof window !== "undefined" ? window : globalThis);
