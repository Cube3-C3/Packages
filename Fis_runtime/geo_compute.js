/**
 * geo_compute.js — вычислительный слой геометрии (канон runtime).
 * Онтология сортов/ops: ../Geo_style/geo_core.json, geo_ops.json.
 *
 * ── Frame — единая основа (среда + график функций) ──────────────
 *   createFrame / frameFromEnv / frameForPlot / toScreen / fromScreen
 *   setScale / setViewport / plotInsets / mathToPlotScreen
 *   E0 и др. kind=environment только предоставляют Frame (не особый случай).
 *   origin = выбранная материальная точка однородной среды (сейчас [0,0]).
 *   origin_corner default bottom_left → положительный квадрант (x→right, y→up).
 *   Insets — отступы под шкалы/подписи; якоря осей позже наслоятся на тот же Frame.
 *   Конструкции / реальные среды / оси — только поверх этого Frame, без параллельной СК.
 *
 * Кривые:
 *   eval / sample / nearest
 *   curveFromAst → { curve, mapping, rebuilt, domain, values }
 *   buildLawGraphPayload / attachLawGraph / drawPointsOnCanvas (через Frame)
 *
 * Коэффициенты по умолчанию = 1 (пока).
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

  // ── law graph → патч для платформы ───────────────────────
  // Пакет (code.js) графиком не занимается. Платформа после
  // render_passport вызывает GeoCompute.attachLawGraph(...).

  function listStructures(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (Array.isArray(raw.structures)) return raw.structures;
    return [];
  }

  // AST.json (актуальная схема): без плоского списка structures — только
  // schemes + aliases, дерево строится на лету через FisUnits.buildSchemeAst.
  // units.js грузится раньше geo_compute.js (см. SCRIPTS в хосте), поэтому
  // window.FisUnits тут уже доступен — переиспользуем его сборку, не дублируем.
  function structFromAliases(raw, structureRef) {
    const entry = raw && raw.aliases && raw.aliases[structureRef];
    if (!entry) return null;
    const FU = global.FisUnits;
    if (!FU || typeof FU.buildSchemeAst !== "function") return null;
    const ast = FU.buildSchemeAst(entry.scheme, entry.arity);
    if (!ast) return null;
    return { id: structureRef, scheme: entry.scheme, arity: entry.arity, ast: ast };
  }

  /**
   * @returns {{ ok:boolean, status?:string, error?:string, points?:number[][], domain:number[] }}
   */
  function buildLawGraphPayload(structuresData, structureRef, opts) {
    opts = opts || {};
    const domain = Array.isArray(opts.domain) ? opts.domain : [0, 4];
    const n = opts.n || 64;

    if (!structureRef) {
      return { ok: false, error: "Нет structure_ref", domain: domain, points: null };
    }

    const structures = listStructures(structuresData);
    let struct = structures.find(function (s) {
      return s && s.id === structureRef;
    });
    if (!struct) struct = structFromAliases(structuresData, structureRef);
    if (!struct || !struct.ast) {
      return {
        ok: false,
        error: "Структура " + structureRef + " не найдена (" + structures.length + " шт.)",
        domain: domain,
        points: null
      };
    }

    let operandIds;
    try {
      operandIds = collectOperandIds(struct.ast);
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e), domain: domain, points: null };
    }
    if (!operandIds || operandIds.length < 2) {
      return { ok: false, error: "Мало операндов", domain: domain, points: null };
    }

    const inputOperandId = operandIds[operandIds.length - 1];
    const outputOperandId = "O1";

    try {
      const built = curveFromStructure(struct, {
        inputOperandId: inputOperandId,
        outputOperandId: outputOperandId,
        domain: domain,
        values: opts.values || null
      });
      const pts = (built.sample(n) || []).filter(function (p) {
        return p && isFinite(p.x) && isFinite(p.y);
      });
      if (!pts.length) {
        return { ok: false, error: "Пустая кривая / NaN", domain: domain, points: null };
      }
      const compact = pts.map(function (p) {
        return [Number(p.x.toFixed(4)), Number(p.y.toFixed(4))];
      });
      return {
        ok: true,
        status:
          structureRef +
          " · " +
          pts.length +
          " pts · " +
          inputOperandId +
          "→" +
          outputOperandId,
        points: compact,
        domain: domain
      };
    } catch (e) {
      return {
        ok: false,
        error: String(e && e.message ? e.message : e),
        domain: domain,
        points: null
      };
    }
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /** HTML-слот графика: лаконичное окно (canvas + тихая ошибка), без structure_ref/операндов. */
  function lawGraphSlotHtml(payload, meta) {
    meta = meta || {};
    const lawId = meta.lawId || "";
    const ok = payload && payload.ok;
    const pointsAttr =
      ok && payload.points ? escapeHtml(JSON.stringify(payload.points)) : "";
    const domainAttr = escapeHtml(JSON.stringify((payload && payload.domain) || [0, 4]));
    const xLabel = meta.xLabel != null ? String(meta.xLabel) : "";
    const yLabel = meta.yLabel != null ? String(meta.yLabel) : "";
    const unitX = meta.unitSymbolX != null ? String(meta.unitSymbolX) : "";
    const unitY = meta.unitSymbolY != null ? String(meta.unitSymbolY) : "";
    const errMsg =
      !ok && payload && payload.error
        ? escapeHtml(String(payload.error))
        : !ok
          ? "—"
          : "";

    return (
      '<div class="law-graph-slot" style="margin:0">' +
        '<div class="law-graph-host" data-law-graph="1"' +
          ' data-law-id="' +
          escapeHtml(String(lawId)) +
          '"' +
          (pointsAttr ? ' data-points="' + pointsAttr + '"' : "") +
          ' data-domain="' +
          domainAttr +
          '"' +
          (xLabel ? ' data-x-label="' + escapeHtml(xLabel) + '"' : "") +
          (yLabel ? ' data-y-label="' + escapeHtml(yLabel) + '"' : "") +
          (unitX ? ' data-unit-x="' + escapeHtml(unitX) + '"' : "") +
          (unitY ? ' data-unit-y="' + escapeHtml(unitY) + '"' : "") +
          ' style="background:#171a21;border-radius:8px;padding:0;width:560px;max-width:100%;height:320px;overflow:hidden;box-sizing:border-box;position:relative">' +
          '<canvas class="law-graph-canvas" width="560" height="320" style="display:block;width:100%;height:100%"></canvas>' +
          (errMsg
            ? '<div class="law-graph-msg" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--muted,#8b93a7);font-size:0.85rem;pointer-events:none">' +
              errMsg +
              "</div>"
            : "") +
        "</div>" +
      "</div>"
    );
  }

  /**
   * Рисует кривую на canvas через общий Frame (frameForPlot + mathToPlotScreen).
   * Та же СК, что у среды: origin = нижний левый угол видимого окна, y-up, bottom_left.
   */
  function drawPointsOnCanvas(canvas, points, domainX, opts) {
    opts = opts || {};
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width || 560;
    const H = canvas.height || 320;
    canvas.width = W;
    canvas.height = H;

    let yMin = Infinity;
    let yMax = -Infinity;
    for (let i = 0; i < points.length; i++) {
      const y = points[i].y;
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
    }
    if (!isFinite(yMin) || !isFinite(yMax)) {
      yMin = 0;
      yMax = 1;
    }
    if (yMax - yMin < 1e-9) {
      yMin -= 1;
      yMax += 1;
    }
    const yPad = (yMax - yMin) * 0.12;
    yMin -= yPad;
    yMax += yPad;
    if (yMin > 0 && yMin < (yMax - yMin) * 0.25) yMin = 0;

    const x0 = Array.isArray(domainX) ? Number(domainX[0]) : 0;
    const x1 = Array.isArray(domainX) ? Number(domainX[1]) : 1;

    // как frame_proto graph: полный canvas + origin shift под padL/padB
    const labeled = frameForLabeledPlot({
      domainX: [x0, x1],
      yMin: yMin,
      yMax: yMax,
      W: W,
      H: H,
      unitFactorX: opts.unitFactorX,
      unitFactorY: opts.unitFactorY,
      unit_factor_x: opts.unit_factor_x || opts.unitFactorX,
      unit_factor_y: opts.unit_factor_y || opts.unitFactorY
    });
    const frame = labeled.frame;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#171a21";
    ctx.fillRect(0, 0, W, H);

    drawAxes(ctx, frame, {
      xMin: x0,
      xMax: x1,
      yMin: yMin,
      yMax: yMax,
      unitFactorX: frame.unit_factor_x,
      unitFactorY: frame.unit_factor_y,
      unitSymbolX: opts.unitSymbolX || null,
      unitSymbolY: opts.unitSymbolY || null,
      xLabel: opts.xLabel || null,
      yLabel: opts.yLabel || null,
      targetTicksX: opts.targetTicksX || 8,
      targetTicksY: opts.targetTicksY || 6,
      grid: opts.grid !== false
    });

    ctx.strokeStyle = "#7c9cff";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (!p || !isFinite(p.x) || !isFinite(p.y)) continue;
      const scr = toScreen(frame, p);
      if (!scr) continue;
      if (!started) {
        ctx.moveTo(scr.x, scr.y);
        started = true;
      } else {
        ctx.lineTo(scr.x, scr.y);
      }
    }
    ctx.stroke();
  }

  function paintLawGraphHosts(root) {
    if (!root) return;
    const hosts = root.querySelectorAll("[data-law-graph]");
    hosts.forEach(function (host) {
      const canvas = host.querySelector("canvas.law-graph-canvas");
      if (!canvas) return;
      canvas.width = 560;
      canvas.height = 320;
      canvas.style.display = "block";
      canvas.style.width = "100%";
      canvas.style.height = "100%";

      const raw = host.getAttribute("data-points");
      if (!raw) return;
      let pairs;
      try {
        pairs = JSON.parse(raw);
      } catch (e) {
        return;
      }
      const points = (pairs || []).map(function (xy) {
        return { x: xy[0], y: xy[1] };
      });
      if (!points.length) return;

      let domain = [0, 4];
      try {
        const d = host.getAttribute("data-domain");
        if (d) domain = JSON.parse(d);
      } catch (e) { /* */ }

      drawPointsOnCanvas(canvas, points, domain, {
        xLabel: host.getAttribute("data-x-label") || null,
        yLabel: host.getAttribute("data-y-label") || null,
        unitSymbolX: host.getAttribute("data-unit-x") || null,
        unitSymbolY: host.getAttribute("data-unit-y") || null
      });
    });
  }

  /**
   * params[] шаблона E* + instance → [{ id, quantity, role, value, index, element }].
   * id: явный или {elementId}.{role}; value instance перекрывает default.
   */
  /**
   * Merge E*.params defaults + instance overrides/params.
   * Thin instance: { id, component, overrides:{ role: value } }
   * Legacy: full params[] still supported; overrides win by role.
   */
  function resolveElementParams(el, componentTemplate) {
    const tmpl = componentTemplate || {};
    const base = Array.isArray(tmpl.params) ? tmpl.params : [];
    const elId = (el && el.id) || "el";
    const overrides =
      (el && el.overrides && typeof el.overrides === "object" && !Array.isArray(el.overrides))
        ? el.overrides
        : null;
    const instList = Array.isArray(el && el.params) ? el.params : [];
    const byRole = Object.create(null);
    instList.forEach(function (p) {
      if (!p) return;
      const role = p.role || null;
      if (role) byRole[role] = p;
    });
    const out = [];
    const seen = Object.create(null);
    base.forEach(function (b, i) {
      if (!b || !b.quantity) return;
      const role = b.role || null;
      const inst = role && byRole[role] ? byRole[role] : null;
      let val = b.default;
      if (inst && inst.value !== undefined) val = inst.value;
      if (overrides && role && Object.prototype.hasOwnProperty.call(overrides, role)) {
        val = overrides[role];
      }
      const id =
        (inst && inst.id) ||
        (role ? elId + "." + role : elId + ".p" + i);
      if (role) seen[role] = true;
      out.push({
        id: String(id),
        quantity: String(b.quantity),
        role: role ? String(role) : null,
        value: Array.isArray(val) ? val.slice() : val,
        index: i,
        element: elId
      });
    });
    // instance-only params not in template
    instList.forEach(function (p, i) {
      if (!p || !p.quantity) return;
      const role = p.role || null;
      if (role && seen[role]) return;
      out.push({
        id: String(p.id || (role ? elId + "." + role : elId + ".extra" + i)),
        quantity: String(p.quantity),
        role: role ? String(role) : null,
        value: Array.isArray(p.value) ? p.value.slice() : p.value,
        index: base.length + i,
        element: elId
      });
    });
    if (overrides) {
      Object.keys(overrides).forEach(function (role) {
        if (seen[role]) return;
        // orphan override without template row — keep as Q-less only if needed later
        out.push({
          id: elId + "." + role,
          quantity: null,
          role: String(role),
          value: Array.isArray(overrides[role])
            ? overrides[role].slice()
            : overrides[role],
          index: out.length,
          element: elId
        });
      });
    }
    return out;
  }

  /** Индекс всех слотов конструкции по id (elements + observer). */
  function indexConstructionSlots(construction, componentsData) {
    const comps =
      (componentsData && (componentsData.components || componentsData)) || {};
    const byId = Object.create(null);
    function addEl(el) {
      if (!el) return;
      const list = resolveElementParams(el, comps[el.component] || {});
      list.forEach(function (p) {
        byId[p.id] = p;
      });
    }
    (construction.elements || []).forEach(addEl);
    if (construction.observer) addEl(construction.observer);
    return byId;
  }

  /**
   * Совпадение binding {quantity, role} со слотом из pool (по id link.params).
   * role "length" принимает и "extension". Без role — первый quantity.
   */
  function matchSlot(binding, poolSlots, usedIds) {
    if (!binding || typeof binding !== "object") return null;
    const q = binding.quantity ? String(binding.quantity) : null;
    if (!q) return null;
    const wantRole = binding.role ? String(binding.role) : null;
    const rolesOk = function (slotRole) {
      if (!wantRole) return true;
      if (slotRole === wantRole) return true;
      if (wantRole === "length" && slotRole === "extension") return true;
      if (wantRole === "extension" && slotRole === "length") return true;
      return false;
    };
    // 1) exact quantity+role
    for (let i = 0; i < poolSlots.length; i++) {
      const s = poolSlots[i];
      if (usedIds[s.id]) continue;
      if (s.quantity === q && rolesOk(s.role)) return s;
    }
    // 2) quantity only if binding has no role
    if (!wantRole) {
      for (let i = 0; i < poolSlots.length; i++) {
        const s = poolSlots[i];
        if (usedIds[s.id]) continue;
        if (s.quantity === q) return s;
      }
    }
    return null;
  }

  /**
   * law.bindings → values по pool слотов (quantity+role). Вложенные {law} рекурсивно.
   * returns { values: {O2: n, …}, meta, nested }
   */
  function matchLawToSlots(law, poolSlots, formulasById, usedIds) {
    usedIds = usedIds || Object.create(null);
    const out = { values: Object.create(null), meta: [], nested: [] };
    if (!law || !law.bindings) return out;
    const formulas = formulasById || {};

    Object.keys(law.bindings)
      .filter(function (k) {
        return /^O\d+$/.test(k);
      })
      .sort(function (a, b) {
        return Number(a.slice(1)) - Number(b.slice(1));
      })
      .forEach(function (oid) {
        if (oid === "O1") return; // result
        const b = law.bindings[oid];
        if (!b || typeof b !== "object") return;
        if (b.num != null && isFinite(Number(b.num))) {
          out.values[oid] = Number(b.num);
          out.meta.push({ operand: oid, source: "literal", value: out.values[oid] });
          return;
        }
        if (b.law || b.law_id) {
          const nestedId = b.law || b.law_id;
          const nestedLaw = formulas[nestedId] || formulas[String(nestedId)];
          if (nestedLaw) {
            const nested = matchLawToSlots(nestedLaw, poolSlots, formulas, usedIds);
            out.nested.push({ law: nestedId, result: nested });
            // scalar from nested if single matched input used as Δl etc.
            const keys = Object.keys(nested.values);
            if (keys.length === 1) {
              out.values[oid] = nested.values[keys[0]];
              out.meta.push({
                operand: oid,
                source: "law:" + nestedId,
                value: out.values[oid],
                via: nested.meta
              });
            }
          }
          return;
        }
        if (b.quantity) {
          const slot = matchSlot(b, poolSlots, usedIds);
          if (slot) {
            usedIds[slot.id] = true;
            const num = scalarFromParamValue(slot.value);
            if (num != null) {
              out.values[oid] = num;
              out.meta.push({
                operand: oid,
                source: "slot:" + slot.id,
                quantity: slot.quantity,
                role: slot.role,
                value: num
              });
            }
          }
        }
      });
    return out;
  }

  function scalarFromParamValue(val) {
    if (val == null) return null;
    if (typeof val === "number" && isFinite(val)) return val;
    if (Array.isArray(val) && val.length && isFinite(Number(val[0]))) return Number(val[0]);
    return null;
  }

  function asVec3(val) {
    if (Array.isArray(val) && val.length >= 3)
      return [Number(val[0]) || 0, Number(val[1]) || 0, Number(val[2]) || 0];
    if (Array.isArray(val) && val.length === 2)
      return [Number(val[0]) || 0, Number(val[1]) || 0, 0];
    if (typeof val === "number" && isFinite(val)) return [val, 0, 0];
    return [0, 0, 0];
  }

  /**
   * Собрать числовые величины конструкции (элементы + E0) → {quantity, role, value, element?}.
   * Поддерживает Componovka params[] и legacy quantities{}.
   */
  function collectConstructionQuantityEntries(construction, componentsData) {
    const entries = [];
    if (!construction) return entries;
    const comps =
      (componentsData && (componentsData.components || componentsData)) || {};

    const envId = construction.environment || "E0";
    const envComp = comps[envId] || comps.E0 || {};
    // g from params (new) or legacy g/quantities
    let gVal = 9.8;
    const envParams = resolveElementParams({ params: envComp.params }, envComp);
    envParams.forEach(function (p) {
      if (p.quantity === "Q006") {
        const s = scalarFromParamValue(p.value);
        if (s != null) gVal = s;
      }
    });
    if (envComp.g && envComp.g.value != null) gVal = Number(envComp.g.value);
    entries.push({
      key: "env.g",
      quantity: "Q006",
      role: "free_fall_acceleration",
      value: gVal
    });

    (construction.elements || []).forEach(function (el) {
      if (!el) return;
      const comp = comps[el.component] || {};
      // New Componovka path
      if (Array.isArray(comp.params) || Array.isArray(el.params)) {
        const resolved = resolveElementParams(el, comp);
        resolved.forEach(function (p) {
          const num = scalarFromParamValue(p.value);
          if (num == null && !Array.isArray(p.value)) return;
          entries.push({
            key: p.id || ((el.id || "?") + ".p" + p.index),
            quantity: p.quantity,
            role: p.role || (Array.isArray(p.value) ? "radius_vector" : p.quantity),
            value: num != null ? num : p.value,
            element: el.id,
            index: p.index,
            id: p.id,
            raw: p.value
          });
        });
        return;
      }
      // Legacy quantities path
      const defaults = (comp && comp.quantities) || {};
      const inst = el.quantities || {};
      const keys = Object.keys(defaults).concat(Object.keys(inst));
      const seen = Object.create(null);
      keys.forEach(function (k) {
        if (seen[k]) return;
        seen[k] = true;
        const d = defaults[k] || {};
        const v = inst[k] || {};
        const qid = v.quantity || d.quantity;
        if (!qid) return;
        let num = null;
        if (v.value != null && isFinite(Number(v.value))) num = Number(v.value);
        else if (d.default_value != null && isFinite(Number(d.default_value)))
          num = Number(d.default_value);
        if (num == null) return;
        entries.push({
          key: (el.id || "?") + "." + k,
          quantity: String(qid),
          role: v.role || d.role || k,
          value: num,
          element: el.id
        });
      });
    });
    return entries;
  }

  /**
   * Links: { law, params: [slotId…] }. Runtime match (quantity,role) → law bindings.
   * change: { slotId, value } | { role: "extension", value } | { force }
   * Геометрия: radius_vector / natural_length / extension из тех же slot ids.
   * returns { construction, derived, matched }
   */
  /**
   * Resolve link instance → { law, params:[slotId…] }.
   * Supports:
   *   legacy: { law, params }
   *   bindings: { port: elId | [elId…] }
   *   of[]:    order = scheme.port_order; multi-port accepts elId | [elId…]
   * LINK: schemes + aliases; chain L* → scheme.law (P*) → AST via formulas.
   */
  function resolveLinkInstance(link, linkPack, construction) {
    if (!link) return null;
    if (link.law && Array.isArray(link.params)) {
      return { law: link.law, params: link.params.slice(), id: link.id || null };
    }
    const ref = link.structure_ref || link.link || link.scheme || null;
    if (!ref) return null;
    const pack = linkPack || {};
    const schemes = pack.schemes || {};
    const aliases = pack.aliases || {};
    let schemeId = ref;
    let scheme = schemes[ref] || null;
    if (!scheme && aliases[ref]) {
      schemeId = aliases[ref].scheme || aliases[ref];
      scheme = schemes[schemeId] || null;
    }
    if (!scheme && (ref === "L_hooke" || schemeId === "hooke_segment")) {
      scheme = {
        law: "P014",
        port_order: ["anchor", "spring", "end"],
        ports: {
          anchor: { param_roles: ["radius_vector"] },
          spring: {
            param_roles: [
              "spring_constant",
              "extension",
              "natural_length",
              "radius_vector"
            ]
          },
          end: { param_roles: ["radius_vector"] }
        }
      };
    }
    if (!scheme && (ref === "L_newton" || schemeId === "newton_ii")) {
      scheme = {
        law: "P005",
        port_order: ["mass", "springs"],
        ports: {
          mass: {
            param_roles: ["mass", "acceleration", "force"]
          },
          springs: {
            multi: true,
            param_roles: ["spring_constant", "extension"]
          }
        }
      };
    }
    if (!scheme || !scheme.law) return null;

    const ports = scheme.ports || {};
    const portOrder =
      Array.isArray(scheme.port_order) && scheme.port_order.length
        ? scheme.port_order.slice()
        : Object.keys(ports);

    // Build port → elId | [elId…] from of[] or bindings
    const wiring = Object.create(null);
    if (Array.isArray(link.of) && link.of.length) {
      let oi = 0;
      for (let pi = 0; pi < portOrder.length; pi++) {
        const pname = portOrder[pi];
        const spec = ports[pname] || {};
        if (oi >= link.of.length) break;
        if (spec.multi) {
          const rest = link.of.slice(oi);
          if (rest.length === 1 && Array.isArray(rest[0])) {
            wiring[pname] = rest[0].slice();
            oi += 1;
          } else if (rest.length === 1 && typeof rest[0] === "string") {
            wiring[pname] = [rest[0]];
            oi += 1;
          } else {
            wiring[pname] = rest.filter(function (x) {
              return typeof x === "string";
            });
            oi = link.of.length;
          }
        } else {
          const v = link.of[oi++];
          wiring[pname] = Array.isArray(v) ? v[0] : v;
        }
      }
    } else if (link.bindings && typeof link.bindings === "object") {
      Object.keys(link.bindings).forEach(function (k) {
        wiring[k] = link.bindings[k];
      });
    }

    // Emit slot ids: for P014 keep spring roles then radius chain (legacy order)
    const params = [];
    function pushRoles(elId, roles) {
      if (!elId || !roles) return;
      roles.forEach(function (role) {
        params.push(elId + "." + role);
      });
    }
    if (scheme.law === "P014") {
      const springId = wiring.spring;
      const anchorId = wiring.anchor;
      const endId = wiring.end;
      pushRoles(springId, (ports.spring && ports.spring.param_roles) || [
        "spring_constant",
        "extension",
        "natural_length",
        "radius_vector"
      ]);
      pushRoles(anchorId, (ports.anchor && ports.anchor.param_roles) || [
        "radius_vector"
      ]);
      pushRoles(endId, (ports.end && ports.end.param_roles) || ["radius_vector"]);
    } else if (scheme.law === "P005") {
      const massId = wiring.mass;
      pushRoles(massId, (ports.mass && ports.mass.param_roles) || [
        "mass",
        "acceleration",
        "force"
      ]);
      let springs = wiring.springs;
      if (springs == null && wiring.spring) springs = [wiring.spring];
      if (!Array.isArray(springs)) springs = springs ? [springs] : [];
      const sRoles =
        (ports.springs && ports.springs.param_roles) ||
        ["spring_constant", "extension"];
      springs.forEach(function (sid) {
        pushRoles(sid, sRoles);
      });
    } else {
      portOrder.forEach(function (pname) {
        const spec = ports[pname] || {};
        const roles = spec.param_roles || [];
        let targets = wiring[pname];
        if (targets == null) return;
        if (!Array.isArray(targets)) targets = [targets];
        targets.forEach(function (elId) {
          pushRoles(elId, roles);
        });
      });
    }

    return {
      law: scheme.law,
      params: params,
      id: link.id || ref,
      structure_ref: ref,
      scheme: schemeId
    };
  }

  /**
   * Prefix element id in of[] / bindings entries.
   */
  function prefixOfEntry(entry, prefix) {
    if (entry == null) return entry;
    if (typeof entry === "string") return prefix + entry;
    if (Array.isArray(entry)) {
      return entry.map(function (x) {
        return prefixOfEntry(x, prefix);
      });
    }
    if (typeof entry === "object") {
      // nested construction ref — leave for expandConstruction
      if (entry.construction || entry.c) return entry;
      const out = {};
      Object.keys(entry).forEach(function (k) {
        out[k] = prefixOfEntry(entry[k], prefix);
      });
      return out;
    }
    return entry;
  }

  /**
   * Recursive flatten: include[] / elements[{construction, as, overrides}]
   * → flat elements + links (ids prefixed). Like nested law in formulas.
   * constructions index: opts.constructions | pack.constructs
   */
  function expandConstruction(construction, opts, stack) {
    opts = opts || {};
    stack = stack || [];
    if (!construction) return construction;
    const cid = construction.id || construction.construction || "?";
    if (stack.indexOf(cid) >= 0) {
      return {
        id: cid,
        name: construction.name,
        layout: construction.layout,
        environment: construction.environment || "E0",
        elements: [],
        links: [],
        _cycle: true
      };
    }
    const nextStack = stack.concat([cid]);

    let list = null;
    const raw =
      opts.constructions ||
      opts.constructs ||
      (opts.pack && (opts.pack.constructs || opts.pack.constructions)) ||
      null;
    if (raw) {
      list = Array.isArray(raw)
        ? raw
        : raw.constructions || raw.list || null;
    }
    const byId = Object.create(null);
    if (Array.isArray(list)) {
      list.forEach(function (c) {
        if (c && c.id) byId[c.id] = c;
      });
    }

    function findC(id) {
      return byId[id] || null;
    }

    function applyOverridesToEl(el, ovAll) {
      if (!el) return el;
      const local = Object.create(null);
      // ovAll keys: "elId.role" or "elId" → {role:value} or role on this el
      if (!ovAll) return el;
      const id = el.id;
      const overrides = Object.assign({}, el.overrides || {});
      Object.keys(ovAll).forEach(function (k) {
        if (k === id && ovAll[k] && typeof ovAll[k] === "object" && !Array.isArray(ovAll[k])) {
          Object.assign(overrides, ovAll[k]);
          return;
        }
        const dot = k.indexOf(".");
        if (dot > 0 && k.slice(0, dot) === id) {
          overrides[k.slice(dot + 1)] = ovAll[k];
        }
      });
      return {
        id: el.id,
        component: el.component,
        construction: el.construction,
        overrides: overrides,
        params: el.params
      };
    }

    const flatEls = [];
    const flatLinks = [];
    let environment = construction.environment || "E0";
    let layout = construction.layout || "series_vertical";
    let observer = construction.observer || null;

    function ingest(src, prefix, ov) {
      if (!src) return;
      const expanded = expandConstruction(src, opts, nextStack);
      if (expanded.environment) environment = expanded.environment;
      if (expanded.layout) layout = expanded.layout;
      (expanded.elements || []).forEach(function (el) {
        let e = {
          id: prefix + el.id,
          component: el.component,
          overrides: el.overrides ? Object.assign({}, el.overrides) : undefined,
          params: el.params
        };
        e = applyOverridesToEl(
          { id: el.id, component: e.component, overrides: e.overrides, params: e.params },
          ov
        );
        e.id = prefix + el.id;
        flatEls.push(e);
      });
      (expanded.links || []).forEach(function (lnk) {
        const copy = {
          id: lnk.id ? prefix + lnk.id : undefined,
          structure_ref: lnk.structure_ref,
          law: lnk.law,
          params: lnk.params
        };
        if (Array.isArray(lnk.of)) {
          copy.of = lnk.of.map(function (x) {
            return prefixOfEntry(x, prefix);
          });
        }
        if (lnk.bindings) {
          copy.bindings = prefixOfEntry(lnk.bindings, prefix);
        }
        flatLinks.push(copy);
      });
      if (!observer && expanded.observer) {
        observer = {
          id: prefix + (expanded.observer.id || "obs"),
          component: expanded.observer.component,
          overrides: expanded.observer.overrides,
          params: expanded.observer.params
        };
      }
    }

    // include[] at top level
    (construction.include || []).forEach(function (inc) {
      if (!inc) return;
      const ref = inc.construction || inc.c || inc.id;
      const as = inc.as != null ? String(inc.as) : ref ? ref + "_" : "u_";
      const prefix = as && as.slice(-1) !== "_" ? as + "_" : as;
      const src = findC(ref);
      if (src) ingest(src, prefix, inc.overrides || null);
    });

    // elements: plain E* or nested construction
    (construction.elements || []).forEach(function (el) {
      if (!el) return;
      const ref = el.construction || el.c || null;
      if (ref) {
        const as = el.as != null ? String(el.as) : el.id != null ? String(el.id) : ref;
        const prefix = as && as.slice(-1) !== "_" ? as + "_" : as + "_";
        const src = findC(ref);
        if (src) ingest(src, prefix, el.overrides || null);
        return;
      }
      flatEls.push({
        id: el.id,
        component: el.component,
        overrides: el.overrides,
        params: el.params
      });
    });

    (construction.links || []).forEach(function (lnk) {
      flatLinks.push(lnk);
    });

    return {
      id: construction.id,
      name: construction.name,
      layout: layout,
      environment: environment,
      observer: observer,
      elements: flatEls,
      links: flatLinks
    };
  }

  function applyConstructionLinks(construction, opts) {
    opts = opts || {};
    // full recursive flatten before physics
    construction = expandConstruction(construction, opts, []);
    const comps =
      (opts.components && (opts.components.components || opts.components)) || {};
    const change = opts.change || null;
    const outDerived = [];
    const formulasRaw = opts.formulas || opts.formulasData || null;
    const formulasById = Object.create(null);
    if (formulasRaw) {
      const list = Array.isArray(formulasRaw)
        ? formulasRaw
        : formulasRaw.formulas || [];
      list.forEach(function (law) {
        if (!law) return;
        const id = law.law_id || law.id;
        if (id) formulasById[id] = law;
      });
    }
    const linkPack =
      opts.links ||
      opts.LINK ||
      (opts.pack && (opts.pack.links || opts.pack.LINK)) ||
      null;

    function expandEl(el) {
      if (!el) return null;
      const resolved = resolveElementParams(el, comps[el.component] || {});
      return {
        id: el.id,
        component: el.component,
        params: resolved.map(function (p) {
          return {
            id: p.id,
            quantity: p.quantity,
            role: p.role,
            value: Array.isArray(p.value) ? p.value.slice() : p.value
          };
        })
      };
    }

    const c = {
      id: construction.id,
      name: construction.name,
      layout: construction.layout || "series_vertical",
      environment: construction.environment || "E0",
      observer: construction.observer ? expandEl(construction.observer) : null,
      elements: (construction.elements || []).map(expandEl).filter(Boolean),
      links: construction.links || []
    };

    function cloneParam(p) {
      return {
        id: p.id,
        quantity: p.quantity,
        role: p.role,
        value: Array.isArray(p.value) ? p.value.slice() : p.value
      };
    }

    function findEl(id) {
      for (let i = 0; i < c.elements.length; i++) {
        if (c.elements[i].id === id) return c.elements[i];
      }
      return null;
    }

    function setSlotValue(slotId, value) {
      function patch(el) {
        if (!el || !el.params) return false;
        for (let i = 0; i < el.params.length; i++) {
          const p = el.params[i];
          const pid = p.id || (p.role ? el.id + "." + p.role : null);
          if (pid === slotId || (p.role && el.id + "." + p.role === slotId)) {
            el.params[i] = {
              id: pid || p.id,
              quantity: p.quantity,
              role: p.role,
              value: Array.isArray(value) ? value.slice() : value
            };
            return true;
          }
        }
        return false;
      }
      for (let i = 0; i < c.elements.length; i++) {
        if (patch(c.elements[i])) return true;
      }
      return patch(c.observer);
    }

    // apply change by slotId / role extension / force
    if (change) {
      if (change.slotId != null && change.value !== undefined) {
        setSlotValue(change.slotId, change.value);
      } else if (change.role === "extension" || change.delta_extension != null) {
        const v =
          change.value != null ? change.value : change.delta_extension;
        // first extension slot in links or elements
        const slots = indexConstructionSlots(c, comps);
        Object.keys(slots).forEach(function (id) {
          if (slots[id].role === "extension") setSlotValue(id, Number(v));
        });
      }
    }

    const layout = String(c.layout || "series_vertical");
    const vertical =
      layout === "series_vertical" ||
      layout === "vertical" ||
      layout === "parallel" ||
      layout.indexOf("vertical") >= 0;

    (c.links || []).forEach(function (rawLink) {
      const link = resolveLinkInstance(rawLink, linkPack, c);
      if (!link || !link.law) return;
      const slotIds = Array.isArray(link.params) ? link.params : [];
      const allSlots = indexConstructionSlots(c, comps);
      const pool = slotIds
        .map(function (id) {
          return allSlots[id];
        })
        .filter(Boolean);

      const law = formulasById[link.law] || null;
      let matched = { values: {}, meta: [], nested: [] };
      if (law) {
        matched = matchLawToSlots(law, pool, formulasById, Object.create(null));
      }

      function elOf(slotId) {
        if (!slotId) return null;
        const i = String(slotId).indexOf(".");
        return i > 0 ? slotId.slice(0, i) : slotId;
      }

      // g from environment E0
      let g = 9.8;
      const envComp = comps[c.environment || "E0"] || comps.E0 || {};
      if (Array.isArray(envComp.params)) {
        envComp.params.forEach(function (p) {
          if (p.role === "free_fall_acceleration" || p.quantity === "Q006") {
            const n = scalarFromParamValue(p.default != null ? p.default : p.value);
            if (n != null) g = n;
          }
        });
      }

      // ── P014 Гук + геометрия от потолка ─────────────────
      if (link.law === "P014") {
        let k = null;
        let L0 = null;
        let deltaL = 0;
        let extensionId = null;
        const radiusSlots = [];
        pool.forEach(function (s) {
          if (s.role === "spring_constant") {
            const n = scalarFromParamValue(s.value);
            if (n != null) k = n;
          } else if (s.role === "natural_length") {
            const n = scalarFromParamValue(s.value);
            if (n != null) L0 = n;
          } else if (s.role === "extension" || s.role === "length") {
            const n = scalarFromParamValue(s.value);
            if (n != null) deltaL = n;
            extensionId = s.id;
          } else if (s.role === "radius_vector") {
            radiusSlots.push(s);
          }
        });
        if (matched.values.O3 != null && isFinite(matched.values.O3)) deltaL = matched.values.O3;
        if (matched.values.O2 != null) k = matched.values.O2;
        if (L0 == null) L0 = 0.2;

        // equilibrium: Δl = mg/k (needs mass in construction, not only pool)
        if (opts.equilibrium || (change && change.equilibrium)) {
          const all = indexConstructionSlots(c, comps);
          let m = null;
          Object.keys(all).forEach(function (id) {
            if (all[id].role === "mass") {
              const n = scalarFromParamValue(all[id].value);
              if (n != null) m = n;
            }
          });
          if (m != null && k != null && k !== 0) {
            deltaL = (m * g) / k;
            if (extensionId) setSlotValue(extensionId, deltaL);
          }
        }

        let forceOverride =
          opts.force != null
            ? Number(opts.force)
            : change && change.force != null
              ? Number(change.force)
              : null;
        if (forceOverride != null && k != null && k !== 0) {
          deltaL = forceOverride / k;
          if (extensionId) setSlotValue(extensionId, deltaL);
        }

        const F = k != null && isFinite(deltaL) ? k * deltaL : null;

        // radius order in link.params: [ceiling?, spring.r…, end.r]
        // anchor = ceiling || first; to = last (series: стык или mass)
        let ceilingS = null;
        const springSlots = [];
        radiusSlots.forEach(function (s) {
          const e = elOf(s.id);
          if (e === "ceiling") ceilingS = s;
          else if (e && String(e).indexOf("spring") === 0) springSlots.push(s);
        });
        const anchorS = ceilingS || radiusSlots[0] || null;
        const endS =
          radiusSlots.length > 0 ? radiusSlots[radiusSlots.length - 1] : null;
        const fromR = anchorS ? asVec3(anchorS.value) : [0, 0, 0];
        const fromRId = anchorS ? anchorS.id : null;
        const toRId = endS && endS !== anchorS ? endS.id : null;
        let toR = endS ? asVec3(endS.value) : [0, 0, 0];

        if (springSlots.length && anchorS) {
          const topSpring = springSlots[0];
          if (topSpring.id !== toRId) setSlotValue(topSpring.id, fromR.slice());
        }

        if (toRId && fromRId) {
          const newR = fromR.slice();
          if (vertical) {
            newR[0] = fromR[0];
            newR[1] = fromR[1] - (L0 + deltaL);
            newR[2] = fromR[2] || 0;
          } else {
            newR[0] = fromR[0] + (L0 + deltaL);
            newR[1] = fromR[1];
          }
          setSlotValue(toRId, newR);
          if (allSlots[toRId]) allSlots[toRId].value = newR.slice();
          if (anchorS && allSlots[fromRId]) allSlots[fromRId].value = fromR.slice();
          toR = newR;
        }

        outDerived.push({
          link: link.id || link.law,
          law: link.law,
          from: elOf(fromRId) || "ceiling",
          to: elOf(toRId) || "mass",
          k: k,
          L0: L0,
          delta_l: deltaL,
          F: F,
          F_elastic: F,
          axis: vertical ? "y" : "x",
          slots: slotIds.slice(),
          match: matched.meta
        });
        return;
      }

      // ── P005 Ньютон: F_net = mg − Σ k·Δl → a = F_net/m ──
      if (link.law === "P005") {
        let m = null;
        let accelId = null;
        let forceId = null;
        let F_elastic = 0;
        const ks = [];
        const dls = [];
        pool.forEach(function (s) {
          if (s.role === "mass") {
            const n = scalarFromParamValue(s.value);
            if (n != null) m = n;
          } else if (s.role === "acceleration") {
            accelId = s.id;
          } else if (s.role === "force") {
            forceId = s.id;
          } else if (s.role === "spring_constant") {
            ks.push(scalarFromParamValue(s.value));
          } else if (s.role === "extension" || s.role === "length") {
            dls.push(scalarFromParamValue(s.value));
          }
        });
        // pair k with dl in order
        const nPair = Math.min(ks.length, dls.length);
        const parallel = layout === "parallel";
        if (nPair > 0) {
          if (parallel) {
            for (let i = 0; i < nPair; i++) {
              if (ks[i] != null && dls[i] != null) F_elastic += ks[i] * dls[i];
            }
          } else {
            // series: сила на груз = натяжение нижней пружины (последняя пара)
            const i = nPair - 1;
            if (ks[i] != null && dls[i] != null) F_elastic = ks[i] * dls[i];
          }
        } else {
          const hookes = outDerived.filter(function (d) {
            return d.law === "P014" && d.F_elastic != null;
          });
          if (parallel) {
            hookes.forEach(function (d) {
              F_elastic += d.F_elastic;
            });
          } else if (hookes.length) {
            F_elastic = hookes[hookes.length - 1].F_elastic;
          }
        }
        if (m == null || m === 0) {
          outDerived.push({
            link: link.id || link.law,
            law: link.law,
            error: "no mass",
            slots: slotIds.slice(),
            match: matched.meta
          });
          return;
        }
        const weight = m * g;
        // вниз + : растяжение пружины растёт, когда weight > F_elastic
        const F_net = weight - F_elastic;
        const a = F_net / m;
        if (forceId) setSlotValue(forceId, F_net);
        if (accelId) setSlotValue(accelId, a);

        outDerived.push({
          link: link.id || link.law,
          law: link.law,
          from: "mass",
          to: "mass",
          m: m,
          g: g,
          weight: weight,
          F_elastic: F_elastic,
          F_net: F_net,
          F: F_net,
          a: a,
          axis: "y",
          slots: slotIds.slice(),
          match: matched.meta
        });
        return;
      }

      // generic law: only match meta
      outDerived.push({
        link: link.id || link.law,
        law: link.law,
        slots: slotIds.slice(),
        match: matched.meta,
        values: matched.values
      });
    });

    return { construction: c, derived: outDerived };
  }

  /**
   * По law.bindings + construction → { values: {O2: number, …}, domain?, meta }.
   * Свободный аргумент графика (последний O*) и O1 (результат) в values не кладём.
   * Константы M* и C* — из physiQuant.value, если есть.
   */
  function valuesFromLawAndConstruction(law, construction, opts) {
    opts = opts || {};
    const out = { values: Object.create(null), domain: null, meta: [] };
    if (!law || !law.bindings) return out;

    // recursive flatten before reading slots
    if (construction && typeof expandConstruction === "function") {
      construction = expandConstruction(construction, {
        constructions: opts.constructions,
        constructs: opts.constructs,
        pack: opts.pack
      });
    }

    const entries = collectConstructionQuantityEntries(
      construction,
      opts.components
    );
    const byQ = Object.create(null);
    entries.forEach(function (e) {
      if (!byQ[e.quantity]) byQ[e.quantity] = [];
      byQ[e.quantity].push(e);
    });

    const physi =
      (opts.physiQuant && (opts.physiQuant.quantities || opts.physiQuant)) ||
      {};

    const operandIds = Object.keys(law.bindings)
      .filter(function (k) {
        return /^O\d+$/.test(k);
      })
      .sort(function (a, b) {
        return Number(a.slice(1)) - Number(b.slice(1));
      });
    if (operandIds.length < 2) return out;

    const inputOperandId = operandIds[operandIds.length - 1];
    const outputOperandId = "O1";

    let lengthHint = null;

    operandIds.forEach(function (oid) {
      if (oid === inputOperandId || oid === outputOperandId) return;
      const b = law.bindings[oid];
      if (!b || typeof b !== "object") return;

      if (b.num != null && isFinite(Number(b.num))) {
        out.values[oid] = Number(b.num);
        out.meta.push({ operand: oid, source: "literal", value: out.values[oid] });
        return;
      }

      const qid = b.quantity ? String(b.quantity) : null;
      if (!qid) return;

      // math / physical constants in physi_quant
      if (/^[MC]\d+/.test(qid) && physi[qid] && physi[qid].value != null) {
        const cv = Number(physi[qid].value);
        if (isFinite(cv)) {
          out.values[oid] = cv;
          out.meta.push({ operand: oid, source: "const:" + qid, value: cv });
          return;
        }
      }

      const cands = byQ[qid] || [];
      let pick = null;
      if (b.role) {
        for (let i = 0; i < cands.length; i++) {
          if (cands[i].role === b.role) {
            pick = cands[i];
            break;
          }
        }
      }
      if (!pick && cands.length) pick = cands[0];
      if (pick && isFinite(pick.value)) {
        out.values[oid] = pick.value;
        out.meta.push({
          operand: oid,
          source: pick.key,
          quantity: qid,
          role: pick.role,
          value: pick.value
        });
      }
    });

    // domain hint: если аргумент — длина/координата, возьмём масштаб от L в конструкции
    const inBind = law.bindings[inputOperandId];
    if (inBind && inBind.quantity === "Q008") {
      const lens = byQ["Q008"] || [];
      let maxL = 0;
      lens.forEach(function (e) {
        if (e.value > maxL) maxL = e.value;
      });
      if (maxL > 0) {
        lengthHint = [0, Number((maxL * 2).toFixed(4))];
      } else {
        lengthHint = [0, 0.5];
      }
      out.domain = lengthHint;
    }

    return out;
  }

  function findLawById(formulas, lawId) {
    if (!lawId || !formulas) return null;
    const laws = Array.isArray(formulas)
      ? formulas
      : formulas.formulas || formulas.laws || [];
    for (let i = 0; i < laws.length; i++) {
      const l = laws[i];
      if ((l.law_id || l.id) === lawId) return l;
    }
    return null;
  }

  /**
   * Главный вход для платформы.
   * Находит structure_ref по law_id, считает точки, вставляет HTML-патч, рисует.
   *
   * @param {HTMLElement} container — passport container
   * @param {object} opts
   * @param {object} opts.structures — AST pack (data.structures)
   * @param {object|array} opts.formulas — formulas pack
   * @param {string} opts.lawId
   * @param {string} [opts.structureRef] — если уже известен
   * @param {object} [opts.construction] — pack.constructs item → values из величин
   * @param {object} [opts.components] — Componovka/components (pack.components)
   * @param {object} [opts.physiQuant] — physi_quant (константы)
   * @param {object} [opts.values] — явный override операндов
   * @param {number[]} [opts.domain]
   * @param {string} [opts.lang]
   */
  function attachLawGraph(container, opts) {
    if (!container) return null;
    opts = opts || {};

    // убрать старый слот, если был
    const old = container.querySelectorAll(".law-graph-slot");
    for (let i = 0; i < old.length; i++) {
      old[i].parentNode && old[i].parentNode.removeChild(old[i]);
    }

    const law = opts.lawId ? findLawById(opts.formulas, opts.lawId) : null;
    let structureRef = opts.structureRef || "";
    if (!structureRef && law) structureRef = law.structure_ref || "";

    let values = opts.values ? Object.assign({}, opts.values) : null;
    let domain = opts.domain || null;
    let valueMeta = null;

    if (law && opts.construction) {
      const auto = valuesFromLawAndConstruction(law, opts.construction, {
        components: opts.components,
        physiQuant: opts.physiQuant
      });
      valueMeta = auto.meta;
      if (auto.values && Object.keys(auto.values).length) {
        values = Object.assign({}, auto.values, values || {});
      }
      if (!domain && auto.domain) domain = auto.domain;
    }
    if (!domain) domain = [0, 4];

    const payload = buildLawGraphPayload(opts.structures, structureRef, {
      domain: domain,
      values: values
    });
    if (payload && valueMeta) payload.valueMeta = valueMeta;
    if (payload && values) payload.values = values;

    // axis captions (explicit or soft defaults); units — SI length unless overridden
    let xLabel = opts.xLabel || null;
    let yLabel = opts.yLabel || null;
    if ((!xLabel || !yLabel) && law && law.bindings && typeof law.bindings === "object") {
      const roles = [];
      Object.keys(law.bindings).forEach(function (k) {
        const b = law.bindings[k];
        if (b && b.role) roles.push(String(b.role));
      });
      if (!xLabel && roles.length) xLabel = roles[roles.length - 1];
      if (!yLabel) yLabel = "f";
    }
    if (!xLabel) xLabel = "x";
    if (!yLabel) yLabel = "y";

    const html = lawGraphSlotHtml(payload, {
      lawId: opts.lawId || "",
      lang: opts.lang || "ru",
      xLabel: xLabel,
      yLabel: yLabel,
      unitSymbolX: opts.unitSymbolX || null,
      unitSymbolY: opts.unitSymbolY || null
    });

    // вставить в конец паспорта или контейнера (construction-graph host предпочтителен)
    const passport =
      container.getAttribute && container.getAttribute("data-construction-graph")
        ? container
        : container.querySelector("[data-construction-graph]") ||
          container.querySelector(".passport") ||
          container;
    const wrap = document.createElement("div");
    wrap.innerHTML = html;
    while (wrap.firstChild) {
      passport.appendChild(wrap.firstChild);
    }

    paintLawGraphHosts(container);
    return payload;
  }

  // ── Frame — единая основа СК (среда + график функций) ──
  // Math-space y-up ↔ screen y-down.
  // origin = выбранная материальная точка однородной среды.
  // origin_corner bottom_left → положительный квадрант.
  // Дальнейшие наслоения (конструкции, реальные среды, оси/якоря) только поверх этого Frame.

  /** Отступы plot-area под шкалы и подписи (screen px). Общие для среды и графиков. */
  /** Как frame_proto graph: место под подписи осей и деления (не резать ticks). */
  const DEFAULT_PLOT_INSETS = { left: 72, right: 40, top: 28, bottom: 40 };

  function plotInsets(overrides) {
    const d = DEFAULT_PLOT_INSETS;
    if (!overrides) return { left: d.left, right: d.right, top: d.top, bottom: d.bottom };
    return {
      left: overrides.left != null ? Number(overrides.left) : d.left,
      right: overrides.right != null ? Number(overrides.right) : d.right,
      top: overrides.top != null ? Number(overrides.top) : d.top,
      bottom: overrides.bottom != null ? Number(overrides.bottom) : d.bottom
    };
  }

  /**
   * Шкалы отображения (как frame_proto): геометрия Frame всегда SI;
   * unitFactor = SI на 1 ед. подписи (1 → m, 0.01 → cm).
   * Программно — абсолютные SI; человеку — relative к origin + toScale.
   */
  function niceStep(min, max, targetTicks) {
    const span = Math.abs(max - min);
    if (!(span > 0) || !isFinite(span)) return 1;
    const raw = span / Math.max(2, targetTicks || 6);
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / pow;
    let step;
    if (n <= 1.5) step = 1;
    else if (n <= 3) step = 2;
    else if (n <= 7) step = 5;
    else step = 10;
    return step * pow;
  }

  function formatTick(v, step, unitSym) {
    if (!isFinite(v)) return "—";
    if (Math.abs(v) < 1e-12) {
      return unitSym ? "0 " + unitSym : "0";
    }
    const a = Math.abs(v);
    let num;
    if (a >= 1e4 || (a > 0 && a < 1e-3)) {
      num = v.toExponential(1);
    } else {
      let d = 0;
      if (step > 0 && isFinite(step)) {
        const ls = Math.log10(step);
        if (ls < 0) d = Math.min(4, Math.ceil(-ls));
        const mant = step / Math.pow(10, Math.floor(ls));
        if (mant < 1.5 && ls < 0) d = Math.min(4, d + 1);
      }
      num = d === 0 ? String(Math.round(v)) : v.toFixed(d).replace(/\.?0+$/, "") || "0";
    }
    return unitSym ? num + " " + unitSym : num;
  }

  /** Символ длины по unit_factor (SI м на 1 ед. подписи). */
  function lengthUnitSymbol(unitFactor) {
    const f = unitFactor != null ? Number(unitFactor) : 1;
    if (!isFinite(f) || f <= 0) return "m";
    if (Math.abs(f - 0.01) < 1e-12) return "cm";
    if (Math.abs(f - 0.001) < 1e-12) return "mm";
    if (Math.abs(f - 1000) < 1e-9) return "km";
    if (Math.abs(f - 1) < 1e-12) return "m";
    return "";
  }

  function ticksInRange(min, max, step) {
    const out = [];
    if (!(step > 0)) return out;
    const start = Math.ceil((min - 1e-12) / step) * step;
    for (let v = start; v <= max + 1e-9; v += step) {
      if (v >= min - 1e-9 && v <= max + 1e-9) out.push(Number(v.toPrecision(12)));
    }
    return out;
  }

  /** SI → число в шкале (value_si / factor). factor = м на 1 ед. (0.01 для cm). */
  function toScale(valueSi, unitFactor) {
    const f = unitFactor != null && unitFactor > 0 ? unitFactor : 1;
    const v = Number(valueSi);
    if (!isFinite(v)) return v;
    return v / f;
  }

  /** Число в шкале → SI. */
  function fromScale(valueDisplay, unitFactor) {
    const f = unitFactor != null && unitFactor > 0 ? unitFactor : 1;
    const v = Number(valueDisplay);
    if (!isFinite(v)) return v;
    return v * f;
  }

  /**
   * Абсолютная точка SI → относительная к origin Frame (математика СК).
   * p: {x,y} | [x,y] | [x,y,z]
   */
  function relativeToFrame(frame, p) {
    if (!frame || p == null) return null;
    const ox = frame.origin ? Number(frame.origin[0]) || 0 : 0;
    const oy = frame.origin ? Number(frame.origin[1]) || 0 : 0;
    let x, y;
    if (Array.isArray(p)) {
      x = Number(p[0]) || 0;
      y = Number(p[1]) || 0;
    } else {
      x = Number(p.x != null ? p.x : p[0]) || 0;
      y = Number(p.y != null ? p.y : p[1]) || 0;
    }
    return { x: x - ox, y: y - oy };
  }

  /** Относительная точка СК → абсолютная SI. */
  function absoluteFromFrame(frame, pRel) {
    if (!frame || pRel == null) return null;
    const ox = frame.origin ? Number(frame.origin[0]) || 0 : 0;
    const oy = frame.origin ? Number(frame.origin[1]) || 0 : 0;
    let x, y;
    if (Array.isArray(pRel)) {
      x = Number(pRel[0]) || 0;
      y = Number(pRel[1]) || 0;
    } else {
      x = Number(pRel.x != null ? pRel.x : 0) || 0;
      y = Number(pRel.y != null ? pRel.y : 0) || 0;
    }
    return { x: x + ox, y: y + oy };
  }

  /**
   * Пространственная величина для человека: relative к СК + шкала.
   * scalar SI → { value, unitFactor, kind:"scalar" }
   * vector SI → { x, y, unitFactor, kind:"vector" }  (relative)
   */
  function spatialForHuman(frame, valueSi, opts) {
    opts = opts || {};
    const uf =
      opts.unitFactor != null && opts.unitFactor > 0
        ? opts.unitFactor
        : frame && frame.unit_factor_x != null
          ? frame.unit_factor_x
          : 1;
    if (valueSi == null) return null;
    if (typeof valueSi === "number" || (typeof valueSi === "string" && isFinite(Number(valueSi)))) {
      const abs = Number(valueSi);
      // скаляр длины: без вычитания origin (это не точка), только шкала
      return {
        kind: "scalar",
        value_si: abs,
        value: toScale(abs, uf),
        unitFactor: uf
      };
    }
    const rel = relativeToFrame(frame, valueSi) || { x: 0, y: 0 };
    return {
      kind: "vector",
      value_si: Array.isArray(valueSi)
        ? valueSi.slice()
        : [valueSi.x, valueSi.y, valueSi.z],
      x: toScale(rel.x, uf),
      y: toScale(rel.y, uf),
      unitFactor: uf
    };
  }

  /**
   * Полноценные оси — 1:1 с frame_proto.html drawAxes.
   * Frame = весь canvas (viewportW/H = CSS size); отступы подписи за счёт
   * origin shift (см. frameForLabeledPlot), не clip plot-local.
   * Геометрия SI; подписи = SI / unitFactor.
   */
  function drawAxes(ctx, frame, opts) {
    opts = opts || {};
    if (!ctx || !frame) return;
    const W = frame.viewportW;
    const H = frame.viewportH;
    if (W == null || H == null) return;
    const o = toScreen(frame, { x: 0, y: 0 });
    if (!o) return;

    function fromS(px, py) {
      let sy = py;
      if (frame.axes && frame.axes.y === "up" && frame.viewportH != null) {
        sy = frame.viewportH - py;
      }
      return {
        x: frame.origin[0] + px / frame.scale_x,
        y: frame.origin[1] + sy / frame.scale_y
      };
    }
    let xMin = Infinity,
      xMax = -Infinity,
      yMin = Infinity,
      yMax = -Infinity;
    [
      { x: 0, y: 0 },
      { x: W, y: 0 },
      { x: 0, y: H },
      { x: W, y: H }
    ].forEach(function (c) {
      const m = fromS(c.x, c.y);
      if (m.x < xMin) xMin = m.x;
      if (m.x > xMax) xMax = m.x;
      if (m.y < yMin) yMin = m.y;
      if (m.y > yMax) yMax = m.y;
    });
    if (opts.xMin != null) xMin = opts.xMin;
    if (opts.xMax != null) xMax = opts.xMax;
    if (opts.yMin != null) yMin = opts.yMin;
    if (opts.yMax != null) yMax = opts.yMax;

    // unitFactor: м на 1 ед. подписи (1 для m, 0.01 для cm).
    const ufx =
      opts.unitFactorX != null && opts.unitFactorX > 0
        ? opts.unitFactorX
        : frame.unit_factor_x != null && frame.unit_factor_x > 0
          ? frame.unit_factor_x
          : 1;
    const ufy =
      opts.unitFactorY != null && opts.unitFactorY > 0
        ? opts.unitFactorY
        : frame.unit_factor_y != null && frame.unit_factor_y > 0
          ? frame.unit_factor_y
          : 1;

    const stepXdisp = niceStep(xMin / ufx, xMax / ufx, opts.targetTicksX || 8);
    const stepYdisp = niceStep(yMin / ufy, yMax / ufy, opts.targetTicksY || 6);
    const stepX = stepXdisp * ufx;
    const stepY = stepYdisp * ufy;
    const minorX = stepX / 5;
    const minorY = stepY / 5;
    const majorsX = ticksInRange(xMin, xMax, stepX);
    const majorsY = ticksInRange(yMin, yMax, stepY);
    const minorsX = ticksInRange(xMin, xMax, minorX);
    const minorsY = ticksInRange(yMin, yMax, minorY);

    // grid
    if (opts.grid !== false) {
      ctx.strokeStyle = "rgba(46,53,69,0.55)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      majorsX.forEach(function (xv) {
        if (Math.abs(xv) < stepX * 1e-9) return;
        const a = toScreen(frame, { x: xv, y: yMin });
        const b = toScreen(frame, { x: xv, y: yMax });
        if (a && b) {
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        }
      });
      majorsY.forEach(function (yv) {
        if (Math.abs(yv) < stepY * 1e-9) return;
        const a = toScreen(frame, { x: xMin, y: yv });
        const b = toScreen(frame, { x: xMax, y: yv });
        if (a && b) {
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        }
      });
      ctx.stroke();
    }

    // axis lines through origin (clipped to plot domain)
    const x0 = toScreen(frame, { x: xMin, y: 0 });
    const x1 = toScreen(frame, { x: xMax, y: 0 });
    const y0 = toScreen(frame, { x: 0, y: yMin });
    const y1 = toScreen(frame, { x: 0, y: yMax });
    ctx.strokeStyle = "#9aa3b5";
    ctx.fillStyle = "#9aa3b5";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (x0 && x1) {
      ctx.moveTo(x0.x, x0.y);
      ctx.lineTo(x1.x, x1.y);
    }
    if (y0 && y1) {
      ctx.moveTo(y0.x, y0.y);
      ctx.lineTo(y1.x, y1.y);
    }
    ctx.stroke();

    function axisArrow(from, to) {
      if (!from || !to) return;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 4) return;
      const ux = dx / len;
      const uy = dy / len;
      const head = 9;
      ctx.beginPath();
      ctx.moveTo(to.x, to.y);
      ctx.lineTo(
        to.x - head * ux + head * 0.4 * uy,
        to.y - head * uy - head * 0.4 * ux
      );
      ctx.lineTo(
        to.x - head * ux - head * 0.4 * uy,
        to.y - head * uy + head * 0.4 * ux
      );
      ctx.closePath();
      ctx.fill();
    }
    if (x0 && x1) axisArrow(x0, x1);
    if (y0 && y1) axisArrow(y0, y1);

    // minor ticks
    ctx.strokeStyle = "#6b7385";
    ctx.lineWidth = 1;
    ctx.beginPath();
    const tickMinor = 4;
    const tickMajor = 8;
    minorsX.forEach(function (xv) {
      if (
        majorsX.some(function (m) {
          return Math.abs(m - xv) < minorX * 0.1;
        })
      )
        return;
      const p = toScreen(frame, { x: xv, y: 0 });
      if (!p) return;
      ctx.moveTo(p.x, p.y - tickMinor);
      ctx.lineTo(p.x, p.y + tickMinor);
    });
    minorsY.forEach(function (yv) {
      if (
        majorsY.some(function (m) {
          return Math.abs(m - yv) < minorY * 0.1;
        })
      )
        return;
      const p = toScreen(frame, { x: 0, y: yv });
      if (!p) return;
      ctx.moveTo(p.x - tickMinor, p.y);
      ctx.lineTo(p.x + tickMinor, p.y);
    });
    ctx.stroke();

    // unit symbols on scale numbers (explicit or derived from length factor)
    const unitSymX =
      opts.unitSymbolX != null && String(opts.unitSymbolX)
        ? String(opts.unitSymbolX)
        : lengthUnitSymbol(ufx);
    const unitSymY =
      opts.unitSymbolY != null && String(opts.unitSymbolY)
        ? String(opts.unitSymbolY)
        : lengthUnitSymbol(ufy);

    // major ticks + numeric labels (+ units)
    ctx.strokeStyle = "#c5c9d1";
    ctx.fillStyle = "#c5c9d1";
    ctx.lineWidth = 1.25;
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.beginPath();
    majorsX.forEach(function (xv) {
      const p = toScreen(frame, { x: xv, y: 0 });
      if (!p) return;
      ctx.moveTo(p.x, p.y - tickMajor);
      ctx.lineTo(p.x, p.y + tickMajor);
      if (Math.abs(xv) < stepX * 1e-9) return;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const ty = Math.min(H - 2, p.y + tickMajor + 3);
      ctx.fillText(formatTick(xv / ufx, stepXdisp, unitSymX), p.x, ty);
    });
    majorsY.forEach(function (yv) {
      const p = toScreen(frame, { x: 0, y: yv });
      if (!p) return;
      ctx.moveTo(p.x - tickMajor, p.y);
      ctx.lineTo(p.x + tickMajor, p.y);
      if (Math.abs(yv) < stepY * 1e-9) return;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      const tx = Math.max(36, p.x - tickMajor - 6);
      ctx.fillText(formatTick(yv / ufy, stepYdisp, unitSymY), tx, p.y);
    });
    ctx.stroke();

    // origin «0» (+ unit if any)
    if (o) {
      ctx.fillStyle = "#8b93a7";
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      const zeroLabel = unitSymX ? "0 " + unitSymX : "0";
      ctx.fillText(zeroLabel, Math.max(36, o.x - 6), o.y + 4);
    }

    // axis name labels (name · unit)
    ctx.fillStyle = "#e6e8ee";
    ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
    function axisCaption(name, unitSym) {
      const n = name != null && String(name) ? String(name) : "";
      const u = unitSym != null && String(unitSym) ? String(unitSym) : "";
      if (n && u) return n + ", " + u;
      return n || (u ? u : "");
    }
    const xCap = axisCaption(opts.xLabel, unitSymX);
    const yCap = axisCaption(opts.yLabel, unitSymY);
    if (xCap && x1) {
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText(xCap, Math.min(W - 8, x1.x - 4), Math.max(14, x1.y - 10));
    }
    if (yCap && y1) {
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText(yCap, Math.min(W - 8, y1.x + 10), Math.max(14, y1.y + 4));
    }
  }

  /**
   * Frame на весь canvas с отступами под подписи — как graph в frame_proto:
   *   padL=64, padR=36, padT=26, padB=36
   *   origin = [domain[0] - padL/scaleX, yMin - padB/scaleY]
   *   viewport = (W, H) целиком → drawAxes не режет labels.
   *
   * returns { frame, insets, plotW, plotH, x0, x1, yMin, yMax, scaleX, scaleY }
   */
  function frameForLabeledPlot(opts) {
    opts = opts || {};
    const W = opts.W != null ? Number(opts.W) : 560;
    const H = opts.H != null ? Number(opts.H) : 320;
    const insets = plotInsets(opts.insets);
    const padL = insets.left;
    const padR = insets.right;
    const padT = insets.top;
    const padB = insets.bottom;
    const plotW = Math.max(1, W - padL - padR);
    const plotH = Math.max(1, H - padT - padB);

    let x0 = 0;
    let x1 = 1;
    if (Array.isArray(opts.domainX) && opts.domainX.length >= 2) {
      x0 = Number(opts.domainX[0]);
      x1 = Number(opts.domainX[1]);
      if (!isFinite(x0) || !isFinite(x1) || x1 === x0) {
        x0 = 0;
        x1 = 1;
      }
    }
    let yMin = opts.yMin != null ? Number(opts.yMin) : 0;
    let yMax = opts.yMax != null ? Number(opts.yMax) : 1;
    if (!isFinite(yMin) || !isFinite(yMax) || yMax === yMin) {
      yMin = 0;
      yMax = 1;
    }

    const scaleX = plotW / (x1 - x0);
    const scaleY = plotH / (yMax - yMin);
    // proto: origin shifts so domain maps into padded plot area
    const frame = createFrame({
      origin: [x0 - padL / scaleX, yMin - padB / scaleY],
      axes: { x: "right", y: "up" },
      origin_corner: "bottom_left",
      scale_x: scaleX,
      scale_y: scaleY,
      viewportW: W,
      viewportH: H,
      unit_factor_x: opts.unit_factor_x != null ? opts.unit_factor_x : opts.unitFactorX,
      unit_factor_y: opts.unit_factor_y != null ? opts.unit_factor_y : opts.unitFactorY,
      unit_scale_id_x: opts.unit_scale_id_x || opts.scaleIdX,
      unit_scale_id_y: opts.unit_scale_id_y || opts.scaleIdY
    });
    return {
      frame: frame,
      insets: insets,
      plotW: plotW,
      plotH: plotH,
      x0: x0,
      x1: x1,
      yMin: yMin,
      yMax: yMax,
      scaleX: scaleX,
      scaleY: scaleY
    };
  }

  function createFrame(opts) {
    opts = opts || {};
    const origin = Array.isArray(opts.origin)
      ? [Number(opts.origin[0]) || 0, Number(opts.origin[1]) || 0]
      : [0, 0];
    const axes = opts.axes || { x: "right", y: "up" };
    const scale_x = opts.scale_x != null ? Number(opts.scale_x) : 1;
    const scale_y = opts.scale_y != null ? Number(opts.scale_y) : 1;
    const viewportW = opts.viewportW != null ? Number(opts.viewportW) : null;
    const viewportH = opts.viewportH != null ? Number(opts.viewportH) : null;
    const unit_factor_x =
      opts.unit_factor_x != null
        ? Number(opts.unit_factor_x)
        : opts.unitFactorX != null
          ? Number(opts.unitFactorX)
          : 1;
    const unit_factor_y =
      opts.unit_factor_y != null
        ? Number(opts.unit_factor_y)
        : opts.unitFactorY != null
          ? Number(opts.unitFactorY)
          : unit_factor_x;
    return {
      sort: "Frame",
      origin: origin,
      axes: { x: axes.x || "right", y: axes.y || "up" },
      angle_ref: Array.isArray(opts.angle_ref) ? opts.angle_ref.slice() : [1, 0],
      angle_convention: opts.angle_convention || "ccw_from_ref",
      origin_corner: opts.origin_corner || "bottom_left",
      scale_x: isFinite(scale_x) && scale_x !== 0 ? scale_x : 1,
      scale_y: isFinite(scale_y) && scale_y !== 0 ? scale_y : 1,
      viewportW: viewportW,
      viewportH: viewportH,
      // display unit: SI meters per 1 label unit (1=m, 0.01=cm). Geometry stays SI.
      unit_factor_x: isFinite(unit_factor_x) && unit_factor_x > 0 ? unit_factor_x : 1,
      unit_factor_y: isFinite(unit_factor_y) && unit_factor_y > 0 ? unit_factor_y : 1,
      unit_scale_id_x: opts.unit_scale_id_x || opts.scaleIdX || null,
      unit_scale_id_y: opts.unit_scale_id_y || opts.scaleIdY || null
    };
  }

  /** Frame из данных environment-компонента (E0 и т.п.). Не особый случай — провайдер Frame. */
  function frameFromEnv(env, opts) {
    opts = opts || {};
    const e = env || {};
    return createFrame({
      origin: e.origin,
      axes: e.axes,
      angle_ref: e.angle_ref,
      angle_convention: e.angle_convention,
      origin_corner: e.origin_corner,
      scale_x: opts.scale_x != null ? opts.scale_x : e.scale_x,
      scale_y: opts.scale_y != null ? opts.scale_y : e.scale_y,
      viewportW: opts.viewportW,
      viewportH: opts.viewportH,
      unit_factor_x: opts.unit_factor_x != null ? opts.unit_factor_x : e.unit_factor_x,
      unit_factor_y: opts.unit_factor_y != null ? opts.unit_factor_y : e.unit_factor_y,
      unit_scale_id_x: opts.unit_scale_id_x || e.unit_scale_id_x,
      unit_scale_id_y: opts.unit_scale_id_y || e.unit_scale_id_y
    });
  }

  /**
   * Frame для plot-area (график функции или вид среды на canvas).
   * origin math = нижний левый угол видимого окна (x0, yMin) — положительные значения вправо/вверх.
   * scale подгоняется под W×H и insets. Тот же сорт Frame, что и у E0.
   *
   * opts: { domainX:[x0,x1], yMin, yMax, W, H, insets?, origin? }
   *   origin — если задан, используется вместо [domainX[0], yMin] (смена материальной точки).
   * returns { frame, insets, plotW, plotH, x0, x1, yMin, yMax }
   */
  function frameForPlot(opts) {
    opts = opts || {};
    const W = opts.W != null ? Number(opts.W) : 320;
    const H = opts.H != null ? Number(opts.H) : 200;
    const insets = plotInsets(opts.insets);
    const plotW = Math.max(1, W - insets.left - insets.right);
    const plotH = Math.max(1, H - insets.top - insets.bottom);

    let x0 = 0;
    let x1 = 1;
    if (Array.isArray(opts.domainX) && opts.domainX.length >= 2) {
      x0 = Number(opts.domainX[0]);
      x1 = Number(opts.domainX[1]);
      if (!isFinite(x0) || !isFinite(x1) || x1 === x0) {
        x0 = 0;
        x1 = 1;
      }
    }
    let yMin = opts.yMin != null ? Number(opts.yMin) : 0;
    let yMax = opts.yMax != null ? Number(opts.yMax) : 1;
    if (!isFinite(yMin) || !isFinite(yMax) || yMax === yMin) {
      yMin = 0;
      yMax = 1;
    }

    const origin = Array.isArray(opts.origin)
      ? [Number(opts.origin[0]) || 0, Number(opts.origin[1]) || 0]
      : [x0, yMin];

    const scale_x = plotW / (x1 - x0);
    const scale_y = plotH / (yMax - yMin);

    // viewport = plot-area size; toScreen даёт координаты относительно plot (0..plotW, plotH..0).
    // mathToPlotScreen добавляет insets.left / insets.top.
    const frame = createFrame({
      origin: origin,
      axes: { x: "right", y: "up" },
      origin_corner: "bottom_left",
      scale_x: scale_x,
      scale_y: scale_y,
      viewportW: plotW,
      viewportH: plotH,
      unit_factor_x: opts.unit_factor_x != null ? opts.unit_factor_x : opts.unitFactorX,
      unit_factor_y: opts.unit_factor_y != null ? opts.unit_factor_y : opts.unitFactorY,
      unit_scale_id_x: opts.unit_scale_id_x || opts.scaleIdX,
      unit_scale_id_y: opts.unit_scale_id_y || opts.scaleIdY
    });

    return {
      frame: frame,
      insets: insets,
      plotW: plotW,
      plotH: plotH,
      x0: x0,
      x1: x1,
      yMin: yMin,
      yMax: yMax,
      W: W,
      H: H
    };
  }

  /**
   * math Point → screen {x,y}.
   * y-up + bottom_left + viewportH → sy = viewportH - (y - oy)*scale_y.
   * Без viewportH — инверсия знака scale_y (относительные смещения).
   * Insets не применяет — для plot используйте mathToPlotScreen.
   */
  function toScreen(frame, p) {
    if (!frame || !p) return null;
    const ox = frame.origin[0];
    const oy = frame.origin[1];
    const mx = Number(p.x != null ? p.x : p[0]);
    const my = Number(p.y != null ? p.y : p[1]);
    if (!isFinite(mx) || !isFinite(my)) return null;
    const sx = (mx - ox) * frame.scale_x;
    let sy = (my - oy) * frame.scale_y;
    if (frame.axes && frame.axes.y === "up") {
      if (frame.viewportH != null && isFinite(frame.viewportH)) {
        sy = frame.viewportH - sy;
      } else {
        sy = -sy;
      }
    }
    return { x: sx, y: sy };
  }

  /**
   * math → полный canvas screen с учётом insets (plot-area offset).
   * plotCtx — результат frameForPlot (frame + insets).
   */
  function mathToPlotScreen(plotCtx, p) {
    if (!plotCtx || !plotCtx.frame) return null;
    const s = toScreen(plotCtx.frame, p);
    if (!s) return null;
    const ins = plotCtx.insets || DEFAULT_PLOT_INSETS;
    return { x: s.x + ins.left, y: s.y + ins.top };
  }

  /** screen Point → math {x,y}. Insets не учитывает (plot-local screen). */
  function fromScreen(frame, px) {
    if (!frame || !px) return null;
    const ox = frame.origin[0];
    const oy = frame.origin[1];
    const sx = Number(px.x != null ? px.x : px[0]);
    const syIn = Number(px.y != null ? px.y : px[1]);
    if (!isFinite(sx) || !isFinite(syIn)) return null;
    let sy = syIn;
    if (frame.axes && frame.axes.y === "up") {
      if (frame.viewportH != null && isFinite(frame.viewportH)) {
        sy = frame.viewportH - syIn;
      } else {
        sy = -syIn;
      }
    }
    return {
      x: ox + sx / frame.scale_x,
      y: oy + sy / frame.scale_y
    };
  }

  function setScale(frame, scaleX, scaleY) {
    if (!frame) return frame;
    if (scaleX != null && isFinite(Number(scaleX)) && Number(scaleX) !== 0) frame.scale_x = Number(scaleX);
    if (scaleY != null && isFinite(Number(scaleY)) && Number(scaleY) !== 0) frame.scale_y = Number(scaleY);
    return frame;
  }

  function setViewport(frame, w, h) {
    if (!frame) return frame;
    if (w != null && isFinite(Number(w))) frame.viewportW = Number(w);
    if (h != null && isFinite(Number(h))) frame.viewportH = Number(h);
    return frame;
  }

  // ── публичный API ────────────────────────────────────────

  const GeoCompute = {
    resolveLinkInstance: resolveLinkInstance,
    expandConstruction: expandConstruction,
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

    rebuildAst: rebuildAst,
    collectOperandIds: collectOperandIds,
    curveFromAst: curveFromAst,
    curveFromStructure: curveFromStructure,

    // Frame — единая основа СК (среда + график функций)
    createFrame: createFrame,
    frameFromEnv: frameFromEnv,
    frameForPlot: frameForPlot,
    frameForLabeledPlot: frameForLabeledPlot,
    plotInsets: plotInsets,
    DEFAULT_PLOT_INSETS: DEFAULT_PLOT_INSETS,
    toScreen: toScreen,
    fromScreen: fromScreen,
    mathToPlotScreen: mathToPlotScreen,
    setScale: setScale,
    setViewport: setViewport,
    // шкалы / оси (как frame_proto): SI absolute programmatically; display = relative + unit
    toScale: toScale,
    fromScale: fromScale,
    niceStep: niceStep,
    formatTick: formatTick,
    ticksInRange: ticksInRange,
    relativeToFrame: relativeToFrame,
    absoluteFromFrame: absoluteFromFrame,
    spatialForHuman: spatialForHuman,
    drawAxes: drawAxes,

    // патч кривой для платформы
    buildLawGraphPayload: buildLawGraphPayload,
    lawGraphSlotHtml: lawGraphSlotHtml,
    paintLawGraphHosts: paintLawGraphHosts,
    attachLawGraph: attachLawGraph,
    drawPointsOnCanvas: drawPointsOnCanvas,
    collectConstructionQuantityEntries: collectConstructionQuantityEntries,
    valuesFromLawAndConstruction: valuesFromLawAndConstruction,
    resolveElementParams: resolveElementParams,
    indexConstructionSlots: indexConstructionSlots,
    matchLawToSlots: matchLawToSlots,
    applyConstructionLinks: applyConstructionLinks
  };

  global.GeoCompute = GeoCompute;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = GeoCompute;
  }
})(typeof window !== "undefined" ? window : globalThis);
