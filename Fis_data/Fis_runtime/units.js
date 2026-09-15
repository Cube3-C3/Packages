/**
 * units.js — FisUnits: размерности, единицы, AST → алгебра/HTML.
 * Host: window.FisUnits
 *
 * formatUnit(dim, unitsData, lang):
 *  1. Точное совпадение dim с named → атомарное имя/символ
 *  2. Жадное покрытие named-кусками, остаток — base_components
 *  3. Чистый base → м/с, кг·м/с² …
 *
 * Бывший первый блок code.js (монолит Fis_data).
 */

(function (global) {
  "use strict";

  const BASE_ORDER = ["M", "L", "T", "I", "Θ", "N", "J"];

  /** "[M L^2 T^{-2}]" → { M:1, L:2, T:-2 } */
  function parseDimension(dim) {
    const vec = Object.create(null);
    if (!dim || typeof dim !== "string") return vec;
    const inner = dim.replace(/^\[|\]$/g, "").trim();
    if (!inner || inner === "1") return vec;
    const re = /([A-Za-zΘμ])(?:\^\{([^{}]+)\}|\^([^\sA-Za-zΘμ]+))?/g;
    let m;
    while ((m = re.exec(inner)) !== null) {
      const base = m[1];
      const pRaw = m[2] != null ? m[2] : m[3];
      const power = pRaw != null ? Number(pRaw) : 1;
      if (!Number.isNaN(power) && power !== 0) {
        vec[base] = (vec[base] || 0) + power;
      }
    }
    return vec;
  }

  function vecToKey(vec) {
    const parts = [];
    for (const b of BASE_ORDER) {
      const p = vec[b];
      if (!p) continue;
      if (p === 1) parts.push(b);
      else parts.push(b + "^{" + p + "}");
    }
    // any extra keys
    for (const b of Object.keys(vec)) {
      if (BASE_ORDER.includes(b)) continue;
      const p = vec[b];
      if (!p) continue;
      if (p === 1) parts.push(b);
      else parts.push(b + "^{" + p + "}");
    }
    if (!parts.length) return "[1]";
    return "[" + parts.join(" ") + "]";
  }

  function vecIsEmpty(vec) {
    return Object.keys(vec).every((k) => !vec[k]);
  }

  function vecClone(vec) {
    const o = Object.create(null);
    for (const k of Object.keys(vec)) if (vec[k]) o[k] = vec[k];
    return o;
  }

  function vecComplexity(vec) {
    let n = 0;
    for (const k of Object.keys(vec)) n += Math.abs(vec[k] || 0);
    return n;
  }

  /**
   * named: единый массив [{ dimension, name, symbol, … }].
   * Обратная совместимость: если пришёл старый объект { "[dim]": [units…] } — разворачиваем.
   */
  function namedAsArray(unitsData) {
    const raw = unitsData?.named;
    if (Array.isArray(raw)) return raw;
    if (!raw || typeof raw !== "object") return [];
    const out = [];
    for (const [dim, units] of Object.entries(raw)) {
      if (!Array.isArray(units)) continue;
      for (const u of units) {
        if (!u || typeof u !== "object") continue;
        out.push(Object.assign({ dimension: dim }, u));
      }
    }
    return out;
  }

  /** Все варианты с точным dimension (K / °C / rad…). */
  function namedForDimension(unitsData, dim) {
    return namedAsArray(unitsData).filter(function (u) {
      return u && u.dimension === dim;
    });
  }

  /** named catalog → list of { key, vec, unit, complexity } sorted large→small */
  function buildNamedCatalog(unitsData) {
    const list = [];
    const seen = Object.create(null);
    for (const unit of namedAsArray(unitsData)) {
      const key = unit.dimension;
      if (!key || key === "[1]") continue;
      // один представитель на dimension (первый в массиве)
      if (seen[key]) continue;
      const vec = parseDimension(key);
      if (vecIsEmpty(vec)) continue;
      // Pure single-base (m², m⁻¹, …) → always base remainder so L^3 stays м³, not м²·м
      const keys = Object.keys(vec).filter(function (k) { return vec[k]; });
      if (keys.length === 1) continue;
      seen[key] = true;
      list.push({
        key,
        vec,
        unit,
        complexity: vecComplexity(vec)
      });
    }
    list.sort((a, b) => b.complexity - a.complexity || b.key.length - a.key.length);
    return list;
  }

  function powerToSup(p) {
    if (p === 1) return "";
    const map = {
      "-": "⁻",
      "0": "⁰",
      "1": "¹",
      "2": "²",
      "3": "³",
      "4": "⁴",
      "5": "⁵",
      "6": "⁶",
      "7": "⁷",
      "8": "⁸",
      "9": "⁹"
    };
    return String(p)
      .split("")
      .map((c) => map[c] || c)
      .join("");
  }

  function pick(arr, lang) {
    if (!Array.isArray(arr)) return arr != null ? String(arr) : "";
    const idx = lang === "ru" ? 1 : 0;
    return arr[idx] != null ? arr[idx] : arr[0];
  }

  /**
   * Попытка вычесть named-вектор из текущего.
   * k > 0 — named в числителе (знаки совпадают);
   * k < 0 — named в знаменателе: знаменатели вида N^{-2} временно как N^{2},
   *         находим крупный блок, сохраняем k и откатываем (power отрицательный).
   * Смешанные знаки по базам named → отказ (нечистый фактор).
   */
  function trySubtract(remaining, namedVec) {
    let kMaxPos = Infinity;
    let kMaxNeg = Infinity;
    let sawPos = false;
    let sawNeg = false;
    for (const b of Object.keys(namedVec)) {
      const nv = namedVec[b];
      if (!nv) continue;
      const rv = remaining[b] || 0;
      if (rv === 0) return null;
      if (Math.sign(rv) === Math.sign(nv)) {
        sawPos = true;
        kMaxPos = Math.min(kMaxPos, Math.floor(Math.abs(rv) / Math.abs(nv)));
      } else {
        sawNeg = true;
        kMaxNeg = Math.min(kMaxNeg, Math.floor(Math.abs(rv) / Math.abs(nv)));
      }
    }
    // только чисто same-sign или чисто opposite-sign
    if (sawPos && sawNeg) return null;
    let k = 0;
    if (sawPos && Number.isFinite(kMaxPos) && kMaxPos >= 1) k = kMaxPos;
    else if (sawNeg && Number.isFinite(kMaxNeg) && kMaxNeg >= 1) k = -kMaxNeg;
    else return null;
    const next = vecClone(remaining);
    for (const b of Object.keys(namedVec)) {
      next[b] = (next[b] || 0) - k * namedVec[b];
      if (next[b] === 0) delete next[b];
    }
    return { k: k, next: next };
  }

  /**
   * Жадное покрытие: крупные named, затем base.
   * На каждом шаге выбираем кандидата с максимальным снижением complexity;
   * при равенстве — полный обнуление remaining, затем больший |k| * complexity.
   * Opposite-sign (знаменатель) допускается через trySubtract.
   * parts: [{ kind, symbol, name, power }]
   */
  function factorDimension(dim, unitsData) {
    let remaining = parseDimension(dim);
    if (vecIsEmpty(remaining)) return { parts: [], exact: true };

    const catalog = buildNamedCatalog(unitsData);
    const parts = [];

    let progress = true;
    while (progress && !vecIsEmpty(remaining)) {
      progress = false;
      const remC = vecComplexity(remaining);
      let best = null;
      for (const entry of catalog) {
        const sub = trySubtract(remaining, entry.vec);
        if (!sub) continue;
        const nextC = vecComplexity(sub.next);
        const reduction = remC - nextC;
        if (reduction <= 0) continue;
        const empties = vecIsEmpty(sub.next) ? 1 : 0;
        const score = reduction * 1000 + empties * 100 + Math.abs(sub.k) * entry.complexity;
        if (!best || score > best.score) {
          best = { entry: entry, sub: sub, score: score };
        }
      }
      if (!best) break;
      parts.push({
        kind: "named",
        key: best.entry.key,
        symbol: best.entry.unit.symbol,
        name: best.entry.unit.name,
        power: best.sub.k
      });
      remaining = best.sub.next;
      progress = true;
    }

    // remainder → base atoms
    for (const b of BASE_ORDER) {
      const p = remaining[b];
      if (!p) continue;
      const baseInfo = unitsData?.base_components?.[b];
      parts.push({
        kind: "base",
        key: b,
        symbol: baseInfo?.si_symbol || [b, b],
        name: baseInfo?.name || [b, b],
        power: p
      });
      delete remaining[b];
    }
    for (const b of Object.keys(remaining)) {
      if (!remaining[b]) continue;
      parts.push({
        kind: "base",
        key: b,
        symbol: [b, b],
        name: [b, b],
        power: remaining[b]
      });
    }

    return { parts, exact: false };
  }

  function formatPartsSymbol(parts, lang) {
    if (!parts.length) return "1";
    const num = parts.filter((p) => p.power > 0);
    const den = parts.filter((p) => p.power < 0);

    function atom(p) {
      const sym = pick(p.symbol, lang);
      const ap = Math.abs(p.power);
      return ap === 1 ? sym : sym + powerToSup(ap);
    }

    const numStr = num.map(atom).join("·") || "1";
    if (!den.length) return numStr;
    const denStr = den.map(atom).join("·");
    const denWrapped = den.length > 1 ? "(" + denStr + ")" : denStr;
    return numStr + "/" + denWrapped;
  }

  function formatPartsName(parts, lang) {
    if (!parts.length) return lang === "ru" ? "единица" : "one";
    const num = parts.filter((p) => p.power > 0);
    const den = parts.filter((p) => p.power < 0);
    const mul = " · ";

    function atom(p) {
      const n = pick(p.name, lang);
      const ap = Math.abs(p.power);
      return ap === 1 ? n : n + powerToSup(ap);
    }

    const numStr = num.map(atom).join(mul) || (lang === "ru" ? "единица" : "one");
    if (!den.length) return numStr;
    const denStr = den.map(atom).join(mul);
    // Same division norm as symbols: a/(b·c), not a · b⁻¹ · c⁻¹
    const denWrapped = den.length > 1 ? "(" + denStr + ")" : denStr;
    return numStr + " / " + denWrapped;
  }

  /**
   * Главный API
   * @param {string} dim - "[M L^2 T^{-2}]"
   * @param {object} unitsData - содержимое units.json
   * @param {string} lang - "ru" | "en"
   * @param {object} [opts]
   * @param {string} [opts.preferRole] - role для выбора среди named (опционально)
   * @returns {{ symbol: string, name: string, kind: string, units?: array, parts?: array }}
   */
  function formatUnit(dim, unitsData, lang, opts) {
    opts = opts || {};
    lang = lang === "en" ? "en" : "ru";

    if (!dim || dim === "[1]") {
      const exact1 = namedForDimension(unitsData, "[1]");
      const u = exact1[0];
      return {
        symbol: u ? pick(u.symbol, lang) : "1",
        name: u ? pick(u.name, lang) : lang === "ru" ? "единица" : "one",
        kind: "dimensionless",
        units: exact1
      };
    }

    // 1) exact named match (единый массив named → filter by dimension)
    const exactList = namedForDimension(unitsData, dim);
    if (exactList.length) {
      let chosen = exactList[0];
      if (opts.preferRole) {
        const hit = exactList.find(
          (u) => Array.isArray(u.roles) && u.roles.includes(opts.preferRole)
        );
        if (hit) chosen = hit;
      }
      return {
        symbol: pick(chosen.symbol, lang),
        name: pick(chosen.name, lang),
        kind: "named",
        units: exactList,
        offset: chosen.offset,
        factor: chosen.factor
      };
    }

    // exact base single (из base_components; чистые SI-базы в named больше не дублируются)
    const vec = parseDimension(dim);
    const vKeys = Object.keys(vec).filter((k) => vec[k]);
    if (vKeys.length === 1 && Math.abs(vec[vKeys[0]]) === 1) {
      const b = vKeys[0];
      const power = vec[b];
      const baseInfo = unitsData?.base_components?.[b];
      if (baseInfo && power === 1) {
        return {
          symbol: pick(baseInfo.si_symbol, lang),
          name: pick(baseInfo.name, lang),
          kind: "named",
          units: [
            { dimension: "[" + b + "]", name: baseInfo.name, symbol: baseInfo.si_symbol, factor: 1 }
          ]
        };
      }
    }

    // 2–3) greedy named chunks + base remainder
    const { parts } = factorDimension(dim, unitsData);
    return {
      symbol: formatPartsSymbol(parts, lang),
      name: formatPartsName(parts, lang),
      kind: "composed",
      parts
    };
  }

  /**
   * Все именованные варианты для точного dim (K, °C, °F…)
   */
  function listNamedUnits(dim, unitsData, lang) {
    const list = namedForDimension(unitsData, dim);
    return list.map((u) => ({
      symbol: pick(u.symbol, lang),
      name: pick(u.name, lang),
      factor: u.factor,
      offset: u.offset,
      roles: u.roles,
      notes: u.notes,
      dimension: u.dimension
    }));
  }

  // ─────────────────────────────────────────────────────────────
  // Unit from defining formula (defines_unit on binding)
  // ─────────────────────────────────────────────────────────────

  /** Плоский id→quantity из physi_quant.json */
  function indexQuantities(quantData) {
    const map = Object.create(null);
    function walk(o) {
      if (!o || typeof o !== "object") return;
      if (typeof o.id === "string" && o.dimension != null) map[o.id] = o;
      for (const k of Object.keys(o)) {
        if (k === "meta") continue;
        const v = o[k];
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === "object") walk(v);
      }
    }
    walk(quantData);
    return map;
  }

  /**
   * Закон, где у binding с quantity=qid стоит defines_unit: true.
   * @returns {{ law, operandId } | null}
   */
  function findDefiningUnitLaw(qid, formulasData) {
    if (!qid) return null;
    const laws = getLawsList(formulasData);
    for (let i = 0; i < laws.length; i++) {
      const law = laws[i];
      const bindings = law && law.bindings;
      if (!bindings) continue;
      for (const oid of Object.keys(bindings)) {
        const b = bindings[oid];
        if (b && b.defines_unit === true && b.quantity === qid) {
          return { law: law, operandId: oid };
        }
      }
    }
    return null;
  }

  /**
   * Собрать mul/div/pow факторы: { operand_id, power }.
   * bindings — для числовых показателей степени (O6: {num: -2}).
   */
  function collectMulDivFactors(node, sign, out, bindings) {
    if (!node || typeof node !== "object") return;
    if (node.operand_id) {
      out.push({ operand_id: node.operand_id, power: sign });
      return;
    }
    if (node.op === "mul") {
      const args = node.args || [];
      for (let i = 0; i < args.length; i++) collectMulDivFactors(args[i], sign, out, bindings);
      return;
    }
    if (node.op === "div") {
      const args = node.args || [];
      if (args[0]) collectMulDivFactors(args[0], sign, out, bindings);
      for (let i = 1; i < args.length; i++) collectMulDivFactors(args[i], -sign, out, bindings);
      return;
    }
    if (node.op === "pow") {
      const args = node.args || [];
      const base = args[0];
      const expNode = args[1];
      let exp = null;
      if (expNode && typeof expNode.num === "number") exp = expNode.num;
      else if (expNode && expNode.operand_id && bindings) {
        const b = bindings[expNode.operand_id];
        if (b && typeof b.num === "number") exp = b.num;
      }
      if (exp == null || !Number.isFinite(exp)) return;
      if (base) collectMulDivFactors(base, sign * exp, out, bindings);
      return;
    }
    // sqrt / sin … — не поддерживаем в unit-recovery v1
  }

  /**
   * Части единицы для dim через обычный formatUnit (без formula-контура).
   * Всегда возвращает массив { kind, symbol[], name[], power }.
   */
  function unitPartsForDim(dim, unitsData, lang) {
    const r = formatUnit(dim, unitsData, lang);
    if (r && Array.isArray(r.parts) && r.parts.length) {
      return r.parts.map(function (p) {
        return {
          kind: p.kind,
          key: p.key,
          symbol: p.symbol,
          name: p.name,
          power: p.power
        };
      });
    }
    if (r && (r.kind === "named" || r.kind === "dimensionless")) {
      const exact = namedForDimension(unitsData, dim);
      if (exact[0] && exact[0].symbol) {
        return [
          {
            kind: "named",
            key: dim,
            symbol: exact[0].symbol,
            name: exact[0].name,
            power: 1
          }
        ];
      }
      const vec = parseDimension(dim);
      const keys = Object.keys(vec).filter(function (k) {
        return vec[k];
      });
      if (keys.length === 1 && Math.abs(vec[keys[0]]) === 1 && vec[keys[0]] > 0) {
        const b = keys[0];
        const baseInfo = unitsData && unitsData.base_components && unitsData.base_components[b];
        if (baseInfo) {
          return [
            {
              kind: "base",
              key: b,
              symbol: baseInfo.si_symbol,
              name: baseInfo.name,
              power: 1
            }
          ];
        }
      }
      // fallback: уже локализованные строки как «символ»
      return [
        {
          kind: "named",
          key: dim,
          symbol: [r.symbol, r.symbol],
          name: [r.name, r.name],
          power: 1
        }
      ];
    }
    return [];
  }

  function mergeUnitParts(parts) {
    const map = Object.create(null);
    const order = [];
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (!p || !p.power) continue;
      const sk = (p.kind || "") + "|" + (p.key || "") + "|" + pick(p.symbol, "en");
      if (!map[sk]) {
        map[sk] = {
          kind: p.kind,
          key: p.key,
          symbol: p.symbol,
          name: p.name,
          power: 0
        };
        order.push(sk);
      }
      map[sk].power += p.power;
    }
    return order
      .map(function (sk) {
        return map[sk];
      })
      .filter(function (p) {
        return p.power;
      });
  }

  /**
   * Выразить единицу qid из закона с defines_unit.
   * Уравнение → все факторы в одну сторону; изолируем operand с ±1.
   * Единицы остальных операндов — через formatUnit(dim) (без рекурсии formula).
   */
  function unitFromDefiningLaw(qid, ctx) {
    ctx = ctx || {};
    const hit = findDefiningUnitLaw(qid, ctx.formulasData);
    if (!hit) return null;
    const law = hit.law;
    const targetOid = hit.operandId;
    const resolved = resolveLawStructure(law, ctx.structuresData);
    if (!resolved || !resolved.ast || resolved.ast.op !== "eq") return null;

    const factors = [];
    const bindMap = law.bindings || {};
    collectMulDivFactors(resolved.ast.lhs, +1, factors, bindMap);
    collectMulDivFactors(resolved.ast.rhs, -1, factors, bindMap);

    const byOid = Object.create(null);
    for (let i = 0; i < factors.length; i++) {
      const f = factors[i];
      if (!f.operand_id) continue;
      byOid[f.operand_id] = (byOid[f.operand_id] || 0) + f.power;
    }
    const tp = byOid[targetOid];
    if (!tp || Math.abs(tp) !== 1) return null;

    const quantById = indexQuantities(ctx.quantData);
    const lang = ctx.lang === "en" ? "en" : "ru";
    const unitsData = ctx.unitsData;
    const bindings = law.bindings || {};
    const scaled = [];

    for (const oid of Object.keys(byOid)) {
      if (oid === targetOid) continue;
      const pow = byOid[oid];
      if (!pow) continue;
      const b = bindings[oid];
      if (!b || !b.quantity) continue;
      const q = quantById[b.quantity];
      if (!q || !q.dimension) continue;
      const scale = -pow / tp;
      const parts = unitPartsForDim(q.dimension, unitsData, lang);
      for (let j = 0; j < parts.length; j++) {
        const p = parts[j];
        scaled.push({
          kind: p.kind,
          key: p.key,
          symbol: p.symbol,
          name: p.name,
          power: p.power * scale
        });
      }
    }

    const merged = mergeUnitParts(scaled);
    if (!merged.length) return null;
    return {
      symbol: formatPartsSymbol(merged, lang),
      name: formatPartsName(merged, lang),
      kind: "from_formula",
      parts: merged,
      law_id: law.law_id,
      structure_ref: law.structure_ref || resolved.id,
      scheme: resolved.scheme,
      arity: resolved.arity
    };
  }

  /**
   * Единица величины: defines_unit-формула → иначе сухой dim (formatUnit).
   * ctx: { unitsData, formulasData, structuresData, quantData, lang, preferRole }
   */
  function formatUnitForQuantity(qid, dim, ctx) {
    ctx = ctx || {};
    const lang = ctx.lang === "en" ? "en" : "ru";
    if (qid && ctx.formulasData && ctx.structuresData && ctx.quantData) {
      const fromLaw = unitFromDefiningLaw(qid, {
        formulasData: ctx.formulasData,
        structuresData: ctx.structuresData,
        quantData: ctx.quantData,
        unitsData: ctx.unitsData,
        lang: lang
      });
      if (fromLaw) return fromLaw;
    }
    return formatUnit(dim, ctx.unitsData, lang, { preferRole: ctx.preferRole });
  }


  // ─────────────────────────────────────────────────────────────
  // Formula display: AST → text/HTML, mulStyle / divStyle
  // ─────────────────────────────────────────────────────────────

  /**
   * AST → отображаемая формула (без LaTeX).
   * options.mulStyle: "implicit" | "dot"
   * options.divStyle: "bar" | "slash"
   * options.format: "html" | "text"  (bar-дробь только в html)
   *
   * Повторяющиеся величины НЕ сворачиваются в степень (m·m, не m²).
   * Нейтрали / пустые операнды пропускаются.
   * Множитель 1/x → деление на x (в т.ч. 1/2 → /2).
   */
  function astToDisplay(node, ctx, parentPrec, options) {
    ctx = ctx || {};
    options = options || {};
    const opt = Object.assign(
      { mulStyle: "implicit", divStyle: "bar", format: "html" },
      options
    );
    const usagesData = ctx.usagesData;
    const physiQuant = ctx.physiQuant;
    const isHtml = opt.format !== "text";

    function esc(s) {
      s = String(s);
      if (!isHtml) return s;
      return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function isEmptyNode(n) {
      if (n == null) return true;
      if (n === "") return true;
      if (typeof n === "object" && n.empty === true) return true;
      if (typeof n === "object" && n.unset === true) return true;
      if (typeof n === "object" && n.operand_id && !n.ref && n.op == null &&
          n.num == null && n.value == null && n.const == null) {
        // незанятый слот структуры
        return true;
      }
      return false;
    }

    function isNeutralOne(n) {
      const v = leafNumber(n);
      return v === 1;
    }

    function leafNumber(n) {
      if (typeof n === "number") return n;
      if (typeof n === "string" && n.trim() !== "" && !isNaN(Number(n))) return Number(n);
      if (n && typeof n === "object") {
        if (typeof n.value === "number") return n.value;
        if (typeof n.const === "number") return n.const;
        if (typeof n.num === "number") return n.num;
      }
      return null;
    }

    function primarySymbol(qid, preferRole) {
      const list = usagesData && usagesData.usages && usagesData.usages[qid];
      if (!Array.isArray(list) || !list.length) return qid || "?";
      if (preferRole) {
        for (let i = 0; i < list.length; i++) {
          if (list[i] && list[i].role === preferRole && list[i].symbol != null) {
            return String(list[i].symbol);
          }
        }
      }
      if (list[0] && list[0].symbol != null) return String(list[0].symbol);
      return qid || "?";
    }

    /**
     * Emit quantity symbol. Core only escapes text; optional options.wrapSym(id, body)
     * is a UI-adapter hook (package may attach navigate attrs without polluting AST logic).
     */
    function emitSym(qid, body) {
      let out = body;
      if (isHtml && qid && typeof opt.wrapSym === "function") {
        try {
          const wrapped = opt.wrapSym(qid, body);
          if (wrapped != null && wrapped !== "") out = String(wrapped);
        } catch (e) { /* keep plain body */ }
      }
      return out;
    }

    function isAtomicText(t) {
      if (!t) return true;
      const plain = String(t).replace(/<[^>]+>/g, "");
      if (/^[\d.½¼¾]+$/.test(plain)) return true;
      // 2π, τ, √2 и т.п. — один операнд, без скобок
      if (/^[^<>+\−·/=^()\s]{1,8}$/.test(plain)) return true;
      // готовая дробь a/b как множитель (2/3, m/μ) — не оборачивать в скобки
      if (/^[^<>+\−·^=()\s]+\/[^<>+\−·^=()\s]+$/.test(plain)) return true;
      // HTML bar-дробь
      if (String(t).indexOf('class="frac"') >= 0 || String(t).indexOf("class='frac'") >= 0) return true;
      if (plain.startsWith("(") && plain.endsWith(")")) return true;
      return false;
    }

    function getArgs(n) {
      if (!n || typeof n !== "object") return [];
      if (Array.isArray(n.args)) return n.args;
      if (n.arg !== undefined) return [n.arg];
      return [];
    }

    function wrap(s, need) {
      if (!need) return s;
      return "(" + s + ")";
    }

    function renderFrac(num, den) {
      if (opt.divStyle === "bar" && isHtml) {
        return (
          '<span class="frac"><span class="num">' +
          num +
          '</span><span class="den">' +
          den +
          "</span></span>"
        );
      }
      const nNeed = !isAtomicText(num);
      const dNeed = !isAtomicText(den);
      return (nNeed ? "(" + num + ")" : num) + "/" + (dNeed ? "(" + den + ")" : den);
    }

    /**
     * Сбор мультипликативных факторов без свёртки в степени.
     * factors: [{ html, text, isNum, isOne, isDiv }]
     * isDiv=true → фактор из знаменателя
     */
    function collectMulFactors(n, inverted) {
      inverted = !!inverted;
      if (isEmptyNode(n)) return [];

      // div как множитель: развернуть в числитель/знаменатель без скобок
      // 1/x → только x в знаменателе; a/b → факторы a и (inv) b
      if (n && typeof n === "object" && n.op === "div") {
        const args = getArgs(n);
        if (args.length >= 2) {
          if (isNeutralOne(args[0]) && !isEmptyNode(args[1])) {
            return collectMulFactors(args[1], !inverted);
          }
          let out = [];
          out = out.concat(collectMulFactors(args[0], inverted));
          for (let i = 1; i < args.length; i++) {
            if (!isEmptyNode(args[i])) {
              out = out.concat(collectMulFactors(args[i], !inverted));
            }
          }
          return out;
        }
      }

      if (n && typeof n === "object" && n.op === "mul") {
        let out = [];
        const args = getArgs(n);
        for (let i = 0; i < args.length; i++) {
          if (isEmptyNode(args[i])) continue;
          out = out.concat(collectMulFactors(args[i], inverted));
        }
        return out;
      }

      if (n && typeof n === "object" && n.op === "pow") {
        const pargs = getArgs(n);
        const expN = leafNumber(pargs[1]);
        // x^(-k) → divisor x^k ; x^1 → x ; x^0 → drop
        if (expN !== null) {
          if (expN === 0) return [];
          if (expN === 1) return collectMulFactors(pargs[0], inverted);
          if (expN === -1) return collectMulFactors(pargs[0], !inverted);
          if (expN < 0) {
            // base^{|exp|} in opposite side
            const absNode = { op: "pow", args: [pargs[0], -expN] };
            return collectMulFactors(absNode, !inverted);
          }
        }
        const s = render(n, 0);
        if (!s) return [];
        return [{ html: s, isNum: false, isOne: false, isDiv: inverted }];
      }

      const num = leafNumber(n);
      if (num !== null && (typeof n !== "object" || (!n.op && !n.ref && !n.lhs))) {
        if (num === 1 && !inverted) return []; // нейтральный множитель 1
        if (num === 1 && inverted) return []; // 1 в знаменателе = нейтраль
        const s = esc(String(num));
        return [{ html: s, isNum: true, isOne: num === 1, isDiv: inverted }];
      }

      if (n && typeof n === "object" && n.ref) {
        const body = n.symbol != null ? String(n.symbol) : primarySymbol(n.ref, n.role);
        const s = emitSym(n.ref, esc(body));
        return [{ html: s, isNum: false, isOne: false, isDiv: inverted }];
      }

      // parentP = PREC.mul (3): add/sub получают скобки как множители ((2k+1)·λ),
      // div (prec=3) — без лишних скобок вокруг a/b.
      const s = render(n, PREC.mul);
      if (!s) return [];
      return [{ html: s, isNum: false, isOne: false, isDiv: inverted }];
    }

    function joinMul(factors, parentPrec) {
      // split num / den
      const nums = [];
      const dens = [];
      for (let i = 0; i < factors.length; i++) {
        const f = factors[i];
        if (!f || !f.html) continue;
        if (f.isDiv) dens.push(f);
        else nums.push(f);
      }

      function joinProduct(list) {
        if (!list.length) return isHtml ? "1" : "1";
        let out = list[0].html;
        for (let i = 1; i < list.length; i++) {
          const prev = list[i - 1];
          const cur = list[i];
          const prevT = String(prev.html).replace(/<[^>]+>/g, "");
          const curT = String(cur.html).replace(/<[^>]+>/g, "");
          const bothNumeric = prev.isNum && cur.isNum;
          if (opt.mulStyle === "dot") {
            const needDot =
              /[A-Za-zα-ωΑ-ΩёЁа-яА-Я0-9½¼¾)]$/.test(prevT) &&
              /^[A-Za-zα-ωΑ-ΩёЁа-яА-Я0-9]/.test(curT);
            out += needDot ? "·" : "";
          } else {
            if (bothNumeric) out += "·";
            // implicit juxtaposition otherwise
          }
          out += cur.html;
        }
        return out;
      }

      const numStr = joinProduct(nums);
      if (!dens.length) return numStr;

      // ½ special
      if (
        nums.length === 0 &&
        dens.length === 1 &&
        dens[0].isNum &&
        dens[0].html === "2"
      ) {
        // bare 1/2
        return isHtml ? "½" : "1/2";
      }
      if (
        nums.length === 1 &&
        nums[0].isOne &&
        dens.length === 1 &&
        dens[0].isNum &&
        dens[0].html === "2"
      ) {
        return isHtml ? "½" : "1/2";
      }

      const denStr = joinProduct(dens);
      const numFinal = nums.length ? numStr : "1";
      return renderFrac(numFinal, denStr);
    }

    const PREC = {
      eq: 1,
      add: 2,
      sub: 2,
      mul: 3,
      div: 3,
      pow: 4,
      neg: 5,
      sin: 6,
      cos: 6,
      tan: 6,
      log: 6,
      ln: 6,
      exp: 6,
      sqrt: 6,
      root: 6,
      abs: 6,
      delta: 6,
      log: 6,
      ln: 6
    };

    function render(node, parentP) {
      if (isEmptyNode(node)) return "";

      const asNum = leafNumber(node);
      if (
        asNum !== null &&
        (typeof node !== "object" || (!node.op && !node.ref && !node.lhs && node.operand_id == null))
      ) {
        if (typeof node === "object" && (node.op || node.ref || node.lhs)) {
          /* fallthrough */
        } else {
          return esc(String(asNum));
        }
      }
      if (typeof node === "number") return esc(String(node));
      if (typeof node === "string") return esc(node);
      if (typeof node !== "object") return esc(String(node));

      if (node.ref) {
        const body = node.symbol != null ? String(node.symbol) : primarySymbol(node.ref, node.role);
        return emitSym(node.ref, esc(body));
      }

      if (!node.op && (node.value != null || node.const != null || node.num != null)) {
        const v = node.value != null ? node.value : node.const != null ? node.const : node.num;
        return esc(String(v));
      }

      const op = node.op;
      if (!op) return "";

      const prec = PREC[op] != null ? PREC[op] : 0;
      const parent = parentP != null ? parentP : 0;

      if (node.lhs !== undefined || node.rhs !== undefined) {
        const L = render(node.lhs, prec);
        const R = render(node.rhs, prec);
        if (!L && !R) return "";
        if (!L) return R;
        if (!R) return L;
        const sym = op === "eq" ? " = " : " " + esc(op) + " ";
        return wrap(L + sym + R, prec < parent);
      }

      const args = getArgs(node).filter(function (a) {
        return !isEmptyNode(a);
      });

      if (op === "add") {
        const parts = args.map(function (a) {
          return render(a, prec);
        }).filter(Boolean);
        if (!parts.length) return "";
        return wrap(parts.join(" + "), prec < parent);
      }
      if (op === "sub") {
        if (args.length === 1) return wrap("−" + render(args[0], prec), prec < parent);
        const parts = args.map(function (a) {
          return render(a, prec);
        }).filter(Boolean);
        if (!parts.length) return "";
        return wrap(parts[0] + " − " + parts.slice(1).join(" − "), prec < parent);
      }

      if (op === "mul" || op === "div") {
        // единый сбор факторов: div(a,b) = a * b^{-1} без свёртки
        let factors = [];
        if (op === "mul") {
          for (let i = 0; i < args.length; i++) {
            factors = factors.concat(collectMulFactors(args[i], false));
          }
        } else {
          if (args.length < 1) return "";
          // 1/x → только x в знаменателе
          if (args.length >= 2 && isNeutralOne(args[0])) {
            factors = factors.concat(collectMulFactors(args[1], true));
          } else {
            factors = factors.concat(collectMulFactors(args[0], false));
            for (let i = 1; i < args.length; i++) {
              factors = factors.concat(collectMulFactors(args[i], true));
            }
          }
        }
        // filter neutral ones again
        factors = factors.filter(function (f) {
          return f && f.html && !(f.isOne && !f.isDiv);
        });
        if (!factors.length) return "";
        const body = joinMul(factors, parent);
        return wrap(body, prec < parent && factors.length > 1);
      }

      if (op === "pow") {
        if (args.length < 2) return render(args[0], parent) || "";
        // x^1 → x; x^0 → 1 (нейтраль)
        const expN = leafNumber(args[1]);
        if (expN === 1) return render(args[0], parent);
        if (expN === 0) return "1";
        const base = render(args[0], prec);
        const exp = render(args[1], 0);
        if (!base) return "";
        const baseNeeds = !isAtomicText(base);
        if (isHtml) {
          return wrap(
            (baseNeeds ? "(" + base + ")" : base) + "<sup>" + exp + "</sup>",
            prec < parent
          );
        }
        return wrap(
          (baseNeeds ? "(" + base + ")" : base) + "^" + (isAtomicText(exp) ? exp : "(" + exp + ")"),
          prec < parent
        );
      }

      if (op === "neg") {
        const inner = render(args[0], prec);
        if (!inner) return "";
        return wrap("−" + inner, prec < parent);
      }

      if (op === "delta") {
        const inner = render(args[0], 0);
        if (!inner) return "";
        const needPar = !isAtomicText(inner);
        return wrap("Δ" + (needPar ? "(" + inner + ")" : inner), prec < parent);
      }

      if (op === "sqrt") {
        const inner = render(args[0], 0);
        if (!inner) return "";
        if (isHtml) {
          return wrap(
            '<span class="radical"><span class="rad-index"></span>√<span class="rad-body">' +
              inner +
              "</span></span>",
            prec < parent
          );
        }
        return wrap("√(" + inner + ")", prec < parent);
      }

      // root(radicand, index) — индекс слева сверху у радикала
      if (op === "root") {
        const radicand = render(args[0], 0);
        const index = args.length > 1 ? render(args[1], 0) : "";
        if (!radicand) return "";
        // √ is default for index 2
        const idxNum = leafNumber(args[1]);
        if (idxNum === 2 || (!args[1] && !index)) {
          if (isHtml) {
            return wrap(
              '<span class="radical">√<span class="rad-body">' + radicand + '</span></span>',
              prec < parent
            );
          }
          return wrap("√(" + radicand + ")", prec < parent);
        }
        if (isHtml) {
          return wrap(
            '<span class="radical"><sup class="rad-index">' +
              (index || "") +
              '</sup>√<span class="rad-body">' +
              radicand +
              '</span></span>',
            prec < parent
          );
        }
        return wrap((index ? index : "") + "√(" + radicand + ")", prec < parent);
      }

      // ln(x) — натуральный
      if (op === "ln") {
        const inner = render(args[0], 0);
        if (!inner) return "";
        return wrap("ln(" + inner + ")", prec < parent);
      }

      // log(x) | log(x, base) — основание как нижний индекс
      if (op === "log") {
        const arg = render(args[0], 0);
        if (!arg) return "";
        const base = args.length > 1 ? render(args[1], 0) : "";
        if (!base) {
          return wrap("log(" + arg + ")", prec < parent);
        }
        if (isHtml) {
          return wrap(
            'log<sub class="log-base">' + base + '</sub>(' + arg + ')',
            prec < parent
          );
        }
        return wrap("log_" + (isAtomicText(base) ? base : "(" + base + ")") + "(" + arg + ")", prec < parent);
      }

      // generic call-like
      const rendered = args.map(function (a) {
        return render(a, 0);
      }).filter(Boolean);
      return wrap(esc(op) + "(" + rendered.join(", ") + ")", prec < parent);
    }

    return render(node, parentPrec);
  }

  // ── Symbol normalization (формулы + конструкции) ─────────────────
  // Повторяющиеся (quantity + role) → индекс; роль initial/natural →₀.
  // Разные роли при одном Qid могут дать разный base-symbol (usages).

  const SUB_DIGITS = "₀₁₂₃₄₅₆₇₈₉";

  function toSubscript(n) {
    if (n == null || n === "") return "";
    const s = String(n);
    let out = "";
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch >= "0" && ch <= "9") out += SUB_DIGITS[ch.charCodeAt(0) - 48];
      else if (ch === "-") out += "₋";
      else out += ch;
    }
    return out;
  }

  function isZeroIndexRole(role) {
    if (!role) return false;
    const r = String(role).toLowerCase();
    return (
      /^(natural|initial|rest|equilibrium|zero|unloaded|undeformed|common|total|equivalent)/.test(r) ||
      /_(0|init|natural|rest|eq)$/.test(r) ||
      r.indexOf("natural_") === 0 ||
      r.indexOf("initial_") === 0 ||
      r.indexOf("rest_") === 0 ||
      r.indexOf("common_") === 0 ||
      r.indexOf("total_") === 0
    );
  }

  function lookupBaseSymbol(qid, role, usagesData) {
    const list =
      usagesData && usagesData.usages && usagesData.usages[qid]
        ? usagesData.usages[qid]
        : null;
    if (Array.isArray(list) && list.length) {
      if (role) {
        for (let i = 0; i < list.length; i++) {
          if (list[i] && list[i].role === role && list[i].symbol != null) {
            return String(list[i].symbol);
          }
        }
      }
      if (list[0] && list[0].symbol != null) return String(list[0].symbol);
    }
    // fallback: short key from role or qid
    if (role) {
      const short = String(role).split(/[_\s]/)[0];
      if (short && short.length <= 3) return short;
    }
    return qid || "?";
  }

  /**
   * Нормализация символов для набора записей величин.
   * entries: [{ key, quantity, role, ... }]
   * Возвращает map key → { base, index, symbol, quantity, role }
   *   index: null | 0 | 1 | 2…
   *   symbol: base + subscript(index) если index != null
   *
   * Правила:
   * 1) base = usages[quantity] по role (иначе первый symbol).
   * 2) role initial/natural/… → index = 0 (даже если единственный).
   * 3) группа (quantity, role) с count>1 → индексы 1..n в порядке появления
   *    (элемент с zero-role в группе получает 0, остальные 1..).
   * 4) если после (1–3) base-символы всё ещё сталкиваются между разными
   *    группами — доиндексируем по порядку появления символа.
   */
  function normalizeQuantitySymbols(entries, usagesData) {
    const list = Array.isArray(entries) ? entries : [];
    const result = Object.create(null);

    // group by quantity + role
    const groups = Object.create(null);
    const order = [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e || e.quantity == null) continue;
      const key = e.key != null ? String(e.key) : "e" + i;
      const qid = String(e.quantity);
      const role = e.role != null ? String(e.role) : "";
      const gkey = qid + "\0" + role;
      if (!groups[gkey]) {
        groups[gkey] = [];
        order.push(gkey);
      }
      groups[gkey].push({
        key: key,
        quantity: qid,
        role: role,
        zero: isZeroIndexRole(role),
        base: lookupBaseSymbol(qid, role || null, usagesData)
      });
    }

    // assign within groups
    const pending = []; // { key, base, index, quantity, role }
    for (let gi = 0; gi < order.length; gi++) {
      const members = groups[order[gi]];
      const needIndex = members.length > 1 || members.some(function (m) { return m.zero; });
      if (!needIndex) {
        const m = members[0];
        pending.push({
          key: m.key,
          base: m.base,
          index: null,
          quantity: m.quantity,
          role: m.role
        });
        continue;
      }
      // alone + zero-role → 0 (L₀);
      // repeats + zero-role → 01, 02… (L₀₁, L₀₂);
      // repeats без zero → 1, 2…
      let next = 1;
      for (let mi = 0; mi < members.length; mi++) {
        const m = members[mi];
        let idx;
        if (members.length === 1) {
          idx = m.zero ? 0 : null;
        } else if (m.zero) {
          idx = "0" + next++;
        } else {
          idx = next++;
        }
        pending.push({
          key: m.key,
          base: m.base,
          index: idx,
          quantity: m.quantity,
          role: m.role
        });
      }
    }

    // collide by base symbol across groups: if same base appears with null index multiple times, index them
    const byBase = Object.create(null);
    for (let i = 0; i < pending.length; i++) {
      const p = pending[i];
      if (!byBase[p.base]) byBase[p.base] = [];
      byBase[p.base].push(p);
    }
    Object.keys(byBase).forEach(function (b) {
      const arr = byBase[b];
      if (arr.length <= 1) return;
      const unindexed = arr.filter(function (p) { return p.index == null; });
      if (unindexed.length <= 1 && arr.some(function (p) { return p.index != null; })) {
        // already some indexed; give remaining sequential after max
        let max = 0;
        arr.forEach(function (p) {
          if (typeof p.index === "number" && p.index > max) max = p.index;
        });
        unindexed.forEach(function (p) {
          max += 1;
          p.index = max;
        });
        return;
      }
      if (unindexed.length > 1) {
        let n = 1;
        unindexed.forEach(function (p) {
          p.index = n++;
        });
      }
    });

    for (let i = 0; i < pending.length; i++) {
      const p = pending[i];
      const symbol =
        p.index != null ? p.base + toSubscript(p.index) : p.base;
      result[p.key] = {
        base: p.base,
        index: p.index,
        symbol: symbol,
        quantity: p.quantity,
        role: p.role
      };
    }
    return result;
  }

  /**
   * Удобная обёртка для bindings формулы { O1: {quantity, role}, ... }.
   * Возвращает map operand_id → { base, index, symbol, ... }.
   */
  function normalizeFormulaBindings(bindings, usagesData) {
    const entries = [];
    if (!bindings || typeof bindings !== "object") return Object.create(null);
    Object.keys(bindings).forEach(function (oid) {
      const b = bindings[oid];
      if (!b || typeof b !== "object") return;
      const qid = b.quantity || b.ref || b.quantity_id;
      if (qid == null || b.num != null || b.value != null || b.const != null) return;
      entries.push({
        key: oid,
        quantity: String(qid),
        role: b.role || ""
      });
    });
    return normalizeQuantitySymbols(entries, usagesData);
  }

  /**
   * Для конструкции: все element.quantities + env g → плоский список с ключом elementId.key
   * Возвращает map "elementId.key" → { base, index, symbol, ... }.
   */
  function normalizeConstructionQuantities(elements, envQuantities, usagesData) {
    const entries = [];
    if (envQuantities && typeof envQuantities === "object") {
      Object.keys(envQuantities).forEach(function (k) {
        const q = envQuantities[k];
        if (!q || q.quantity == null) return;
        entries.push({
          key: "env." + k,
          quantity: String(q.quantity),
          role: q.role || k
        });
      });
    }
    (elements || []).forEach(function (el) {
      if (!el || !el.quantities) return;
      Object.keys(el.quantities).forEach(function (k) {
        const q = el.quantities[k];
        if (!q || q.quantity == null) return;
        entries.push({
          key: el.id + "." + k,
          quantity: String(q.quantity),
          role: q.role || k
        });
      });
    });
    return normalizeQuantitySymbols(entries, usagesData);
  }

  // ── Package prep (данные → готовый пакет для UI-рендера) ──────────

  function bindingToLeaf(binding) {
    if (binding == null) return { empty: true };
    if (typeof binding === "string") return { ref: binding };
    if (typeof binding === "number") return binding;
    if (typeof binding === "object") {
      if (binding.empty || binding.unset) return { empty: true };
      if (binding.num != null) return Number(binding.num);
      if (binding.value != null) return Number(binding.value);
      if (binding.const != null) return Number(binding.const);
      // { quantity, role } — новый формат bindings в physi_formulas
      if (binding.quantity != null) {
        const leaf = { ref: String(binding.quantity) };
        if (binding.role) leaf.role = String(binding.role);
        return leaf;
      }
      if (binding.ref) {
        const leaf = { ref: binding.ref };
        if (binding.role) leaf.role = String(binding.role);
        return leaf;
      }
      if (binding.quantity_id) {
        const leaf = { ref: binding.quantity_id };
        if (binding.role) leaf.role = String(binding.role);
        return leaf;
      }
    }
    return { ref: String(binding) };
  }

  function resolveAst(node, bindings, symbolByOperand) {
    if (node == null) return node;
    if (typeof node !== "object") return node;
    if (Array.isArray(node)) {
      return node.map(function (n) {
        return resolveAst(n, bindings, symbolByOperand);
      });
    }
    if (node.operand_id) {
      const oid = node.operand_id;
      const b = bindings ? bindings[oid] : undefined;
      if (b === undefined) return { empty: true };
      const leaf = bindingToLeaf(b);
      if (leaf && typeof leaf === "object" && symbolByOperand && symbolByOperand[oid]) {
        const sm = symbolByOperand[oid];
        if (sm.symbol != null) leaf.symbol = sm.symbol;
        if (sm.index != null) leaf.index = sm.index;
        if (sm.base != null) leaf.base = sm.base;
      }
      return leaf;
    }
    const out = {};
    for (const k of Object.keys(node)) {
      out[k] = resolveAst(node[k], bindings, symbolByOperand);
    }
    return out;
  }

  function getStructuresList(structuresData) {
    if (!structuresData) return [];
    if (Array.isArray(structuresData)) return structuresData;
    if (Array.isArray(structuresData.structures)) return structuresData.structures;
    return [];
  }

  function getSchemesMap(structuresData) {
    if (!structuresData || typeof structuresData !== "object") return {};
    return structuresData.schemes || {};
  }

  function getAliasesMap(structuresData) {
    if (!structuresData || typeof structuresData !== "object") return {};
    return structuresData.aliases || {};
  }

  function getLawsList(formulasData) {
    if (!formulasData) return [];
    if (Array.isArray(formulasData)) return formulasData;
    if (Array.isArray(formulasData.formulas)) return formulasData.formulas;
    if (Array.isArray(formulasData.laws)) return formulasData.laws;
    if (typeof formulasData === "object") {
      const vals = Object.keys(formulasData)
        .filter(function (k) {
          return k !== "meta";
        })
        .map(function (k) {
          return formulasData[k];
        })
        .filter(function (x) {
          return x && (x.law_id || x.bindings);
        });
      if (vals.length) return vals;
    }
    return [];
  }

  function leafOperand(n) {
    return { operand_id: "O" + n };
  }

  /**
   * AST из схемы + arity.
   * product/sum/reciprocal_sum: arity = число факторов/слагаемых справа; слоты O1…O_{arity+1}.
   * ratio: O1 = O2/O3 (arity не нужен).
   */
  function buildSchemeAst(schemeId, arity) {
    const n = arity != null ? Number(arity) : 2;
    if (!schemeId) return null;

    if (schemeId === "ratio") {
      return {
        op: "eq",
        lhs: leafOperand(1),
        rhs: { op: "div", args: [leafOperand(2), leafOperand(3)] }
      };
    }

    if (schemeId === "product" || schemeId === "sum") {
      if (!(n >= 2)) return null;
      const args = [];
      for (let i = 2; i <= n + 1; i++) args.push(leafOperand(i));
      return {
        op: "eq",
        lhs: leafOperand(1),
        rhs: { op: schemeId === "product" ? "mul" : "add", args: args }
      };
    }

    if (schemeId === "reciprocal_sum") {
      if (!(n >= 2)) return null;
      function inv(k) {
        return { op: "div", args: [{ num: 1 }, leafOperand(k)] };
      }
      const args = [];
      for (let i = 2; i <= n + 1; i++) args.push(inv(i));
      return {
        op: "eq",
        lhs: inv(1),
        rhs: { op: "add", args: args }
      };
    }

    return null;
  }

  /** arity из O1..Ok в bindings (для product/sum: k−1). */
  function arityFromBindings(bindings, schemeId) {
    if (!bindings || typeof bindings !== "object") return null;
    let max = 0;
    for (const k of Object.keys(bindings)) {
      const m = /^O(\d+)$/.exec(k);
      if (m) max = Math.max(max, Number(m[1]));
    }
    if (max < 2) return null;
    if (schemeId === "ratio") return 2;
    return max - 1;
  }

  /**
   * Резолв закона → { id, scheme, arity, ast, source, structure_name }.
   * law.ast → law.scheme → structure_ref alias → structures[].
   */
  function resolveLawStructure(law, structuresData) {
    if (!law) return null;

    if (law.ast && typeof law.ast === "object") {
      return {
        id: law.structure_ref || null,
        scheme: law.scheme || null,
        arity: law.arity != null ? law.arity : null,
        ast: law.ast,
        source: "law.ast",
        structure_name: null
      };
    }

    const schemes = getSchemesMap(structuresData);
    const aliases = getAliasesMap(structuresData);

    function fromScheme(schemeId, arityHint, id, source) {
      if (!schemeId || !schemes[schemeId]) return null;
      let arity = arityHint != null ? Number(arityHint) : null;
      if (arity == null) arity = arityFromBindings(law.bindings, schemeId);
      if (arity == null && schemes[schemeId].fixed_arity != null) {
        arity = schemes[schemeId].fixed_arity;
      }
      if (arity == null) arity = 2;
      const ast = buildSchemeAst(schemeId, arity);
      if (!ast) return null;
      const meta = schemes[schemeId];
      const sname = Array.isArray(meta.name) ? meta.name[0] : meta.name || schemeId;
      return {
        id: id || schemeId,
        scheme: schemeId,
        arity: arity,
        ast: ast,
        source: source,
        structure_name: sname
      };
    }

    if (law.scheme) {
      const hit = fromScheme(law.scheme, law.arity, law.structure_ref || law.scheme, "scheme");
      if (hit) return hit;
    }

    const ref = law.structure_ref;
    if (ref && aliases[ref]) {
      const a = aliases[ref];
      const hit = fromScheme(a.scheme, a.arity != null ? a.arity : law.arity, ref, "alias");
      if (hit) return hit;
    }

    const structures = getStructuresList(structuresData);
    const struct = structures.find(function (s) {
      return s && s.id === ref;
    });
    if (struct && struct.ast) {
      return {
        id: ref,
        scheme: null,
        arity: null,
        ast: struct.ast,
        source: "structure",
        structure_name: struct.name || null
      };
    }

    return null;
  }

  /**
   * law + structures → готовый пакет формулы (ast уже с ref/num).
   * UI только рисует пакет, не резолвит bindings.
   * structure_ref A1/A2/A3/A5/A18 → scheme+arity; либо law.scheme.
   */
  function instantiateLaw(law, structuresData, usagesData) {
    if (!law) return null;
    if (law.ast && !law.structure_ref && !law.scheme) {
      return {
        id: law.id || law.law_id,
        name: law.name,
        description: law.description || law.notes,
        ast: law.ast,
        structure_ref: null,
        scheme: null,
        arity: null,
        bindings: null
      };
    }
    const resolved = resolveLawStructure(law, structuresData);
    if (!resolved || !resolved.ast) {
      return {
        id: law.law_id || law.id,
        name: law.name,
        description: law.description,
        ast: null,
        structure_ref: law.structure_ref,
        scheme: law.scheme || null,
        arity: law.arity != null ? law.arity : null,
        bindings: law.bindings || null,
        error: "structure_not_found"
      };
    }
    const bindings = law.bindings || {};
    const symbolMap = normalizeFormulaBindings(bindings, usagesData);
    return {
      id: law.law_id || law.id,
      name: law.name,
      description: law.description,
      structure_ref: law.structure_ref || resolved.id,
      scheme: resolved.scheme,
      arity: resolved.arity,
      structure_name: resolved.structure_name,
      bindings: bindings,
      symbols: symbolMap,
      ast: resolveAst(resolved.ast, bindings, symbolMap)
    };
  }

  function formulasUsing(formulasData, qid, structuresData, usagesData) {
    const laws = getLawsList(formulasData);
    const result = [];
    function walkRefs(node, acc) {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) walkRefs(node[i], acc);
        return;
      }
      if (node.ref) acc[node.ref] = true;
      for (const k of Object.keys(node)) walkRefs(node[k], acc);
    }
    for (let i = 0; i < laws.length; i++) {
      const law = laws[i];
      // usagesData → нормализованные символы (R₁, m₁, …) на листьях AST
      const inst = instantiateLaw(law, structuresData, usagesData);
      if (!inst || !inst.ast) continue;
      const refs = Object.create(null);
      walkRefs(inst.ast, refs);
      if (refs[qid]) result.push(inst);
    }
    return result;
  }

  /**
   * Свод needs конструкции: formula_needs или вывод из elements[].quantities.
   * count ≥ 2 — явные общие узлы (k₁, k₂…).
   */
  function collectConstructionNeeds(construction) {
    const byQid = Object.create(null);
    function add(qid, role, count) {
      if (!qid) return;
      const n = count != null && count >= 1 ? Number(count) : 1;
      if (!byQid[qid]) byQid[qid] = { count: 0, roles: [] };
      byQid[qid].count = Math.max(byQid[qid].count, n);
      if (role && byQid[qid].roles.indexOf(role) < 0) byQid[qid].roles.push(role);
    }

    const declared = construction && construction.formula_needs;
    if (Array.isArray(declared) && declared.length) {
      for (let i = 0; i < declared.length; i++) {
        const d = declared[i];
        if (!d) continue;
        const cnt = d.count != null ? d.count : 1;
        if (Array.isArray(d.roles)) {
          if (!d.roles.length) add(d.quantity, null, cnt);
          for (let r = 0; r < d.roles.length; r++) add(d.quantity, d.roles[r], cnt);
        } else {
          add(d.quantity, d.role, cnt);
        }
      }
    } else if (construction && Array.isArray(construction.elements)) {
      const tallies = Object.create(null);
      for (let i = 0; i < construction.elements.length; i++) {
        const qs = (construction.elements[i] && construction.elements[i].quantities) || {};
        for (const k of Object.keys(qs)) {
          const q = qs[k];
          if (!q || !q.quantity) continue;
          if (!tallies[q.quantity]) tallies[q.quantity] = { count: 0, roles: [] };
          tallies[q.quantity].count += 1;
          if (q.role && tallies[q.quantity].roles.indexOf(q.role) < 0) {
            tallies[q.quantity].roles.push(q.role);
          }
        }
      }
      for (const qid of Object.keys(tallies)) {
        add(qid, null, tallies[qid].count);
        for (let r = 0; r < tallies[qid].roles.length; r++) {
          add(qid, tallies[qid].roles[r], tallies[qid].count);
        }
      }
    }

    const list = Object.keys(byQid).map(function (qid) {
      return {
        quantity: qid,
        count: byQid[qid].count,
        roles: byQid[qid].roles.slice()
      };
    });
    return { byQid: byQid, list: list };
  }

  /**
   * Формулы для конструкции по formula_needs (quantity + role + count).
   * Закон: все quantity-binding ⊆ needs; score по совпадению role;
   * count≥2 — бонус за мульти-слоты / scheme sum|reciprocal_sum.
   */
  function formulasForConstruction(construction, formulasData, structuresData, usagesData) {
    const needs = collectConstructionNeeds(construction);
    const needQ = needs.byQid;
    if (!Object.keys(needQ).length) return [];

    const laws = getLawsList(formulasData);
    const scored = [];

    for (let i = 0; i < laws.length; i++) {
      const law = laws[i];
      const bindings = law.bindings || {};
      const used = [];
      let ok = true;
      for (const oid of Object.keys(bindings)) {
        const b = bindings[oid];
        if (!b || !b.quantity) continue;
        const qid = b.quantity;
        // M* / C* — константы, в needs конструкции не требуются
        if (/^[MC]\d+/.test(qid)) continue;
        if (!needQ[qid]) {
          ok = false;
          break;
        }
        used.push({ quantity: qid, role: b.role || "" });
      }
      if (!ok || !used.length) continue;

      let roleHits = 0;
      let roleMiss = 0;
      const qCountInLaw = Object.create(null);
      for (let u = 0; u < used.length; u++) {
        const qid = used[u].quantity;
        qCountInLaw[qid] = (qCountInLaw[qid] || 0) + 1;
        const roles = needQ[qid].roles || [];
        if (!used[u].role || !roles.length) continue;
        if (roles.indexOf(used[u].role) >= 0) roleHits++;
        else roleMiss++;
      }
      // чужая role при объявленных needs.roles → отсев (radius_vector vs natural_length)
      if (roleMiss > 0) continue;

      let multiBonus = 0;
      for (const qid of Object.keys(qCountInLaw)) {
        const needC = needQ[qid].count || 1;
        if (needC >= 2 && qCountInLaw[qid] >= 2) multiBonus += 2;
      }

      const resolved = resolveLawStructure(law, structuresData);
      if (
        resolved &&
        (resolved.scheme === "sum" || resolved.scheme === "reciprocal_sum")
      ) {
        const anyMulti = Object.keys(needQ).some(function (qid) {
          return needQ[qid].count >= 2;
        });
        if (anyMulti) multiBonus += 1;
      }

      const score = used.length * 10 + roleHits * 5 - roleMiss * 3 + multiBonus;
      const inst = instantiateLaw(law, structuresData, usagesData);
      if (!inst || !inst.ast) continue;
      scored.push({ inst: inst, score: score });
    }

    scored.sort(function (a, b) {
      return b.score - a.score;
    });
    return scored.map(function (s) {
      return s.inst;
    });
  }


  /**
   * Метаданные величины (символ, константа?).
   */
  function quantityMeta(qid, physiQuant, usagesData) {
    const meta = { id: qid, symbol: qid, isConstant: false, value: null };
    if (!qid || typeof qid !== "string") return meta;
    const ulist = usagesData && usagesData.usages ? usagesData.usages[qid] : null;
    if (Array.isArray(ulist) && ulist[0] && ulist[0].symbol != null) {
      meta.symbol = String(ulist[0].symbol);
    }
    function walk(node) {
      if (!node) return;
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) walk(node[i]);
        return;
      }
      if (typeof node !== "object") return;
      if (node.id === qid) {
        if (node.value != null) {
          meta.value = node.value;
          meta.isConstant = true;
        }
        return;
      }
      for (const k of Object.keys(node)) walk(node[k]);
    }
    if (physiQuant) walk(physiQuant);
    if (/^[CM]\d+/.test(qid)) meta.isConstant = true;
    return meta;
  }

  /**
   * Мономиальный вектор БЕЗ consolidate (повторы сохраняются).
   * 1/x → { op:x, power:-1 }
   */
  function astToMonomialVector(node, ctx) {
    ctx = ctx || {};
    const usagesData = ctx.usagesData;
    const physiQuant = ctx.physiQuant;

    function isEmptyNode(n) {
      if (n == null || n === "") return true;
      if (typeof n === "object" && (n.empty || n.unset)) return true;
      return false;
    }

    function leafNumber(n) {
      if (typeof n === "number") return n;
      if (typeof n === "string" && n.trim() !== "" && !isNaN(Number(n))) return Number(n);
      if (n && typeof n === "object") {
        if (typeof n.num === "number") return n.num;
        if (typeof n.value === "number") return n.value;
        if (typeof n.const === "number") return n.const;
      }
      return null;
    }

    function leafFromRef(ref) {
      const meta = quantityMeta(ref, physiQuant, usagesData);
      return {
        op: meta.symbol,
        power: 1,
        isConstant: meta.isConstant,
        qid: ref
      };
    }

    function expand(n, scale) {
      if (scale === undefined) scale = 1;
      if (isEmptyNode(n)) return [];

      if (n && typeof n === "object" && n.op === "div") {
        const args = Array.isArray(n.args) ? n.args : [];
        // 1/x → x^{-1}
        if (args.length >= 2 && leafNumber(args[0]) === 1) {
          return expand(args[1], -scale);
        }
      }

      const asNum = leafNumber(n);
      if (
        asNum !== null &&
        (typeof n !== "object" || (!n.op && !n.ref && !n.lhs && !n.operand_id))
      ) {
        if (asNum === 1 && scale > 0) return []; // нейтральный множитель
        return [{ op: asNum, power: scale, isConstant: true }];
      }

      if (typeof n !== "object") {
        const ln = leafNumber(n);
        if (ln !== null) {
          if (ln === 1 && scale > 0) return [];
          return [{ op: ln, power: scale, isConstant: true }];
        }
        return [{ op: String(n), power: scale }];
      }

      if (n.ref) {
        const L = leafFromRef(n.ref);
        L.power *= scale;
        return [L];
      }

      if (!n.op && (n.num != null || n.value != null || n.const != null)) {
        const ln = leafNumber(n);
        if (ln === null) return [];
        if (ln === 1 && scale > 0) return [];
        return [{ op: ln, power: scale, isConstant: true }];
      }

      const op = n.op;
      if (!op) return null;

      if (
        op === "add" ||
        op === "sub" ||
        op === "eq" ||
        op === "delta" ||
        op === "sin" ||
        op === "cos"
      ) {
        return null;
      }

      const args = Array.isArray(n.args)
        ? n.args
        : n.arg !== undefined
          ? [n.arg]
          : [];

      if (op === "mul") {
        let out = [];
        for (let i = 0; i < args.length; i++) {
          if (isEmptyNode(args[i])) continue;
          const part = expand(args[i], scale);
          if (part === null) return null;
          out = out.concat(part);
        }
        return out;
      }

      if (op === "div") {
        if (args.length < 2) return null;
        let out = [];
        if (!(leafNumber(args[0]) === 1)) {
          const num = expand(args[0], scale);
          if (num === null) return null;
          out = out.concat(num);
        }
        for (let i = 1; i < args.length; i++) {
          if (isEmptyNode(args[i])) continue;
          const den = expand(args[i], -scale);
          if (den === null) return null;
          out = out.concat(den);
        }
        return out;
      }

      if (op === "pow") {
        if (args.length < 2) return null;
        const expLeaf = leafNumber(args[1]);
        if (expLeaf === null) return null;
        if (expLeaf === 0) return []; // x^0 нейтраль
        if (expLeaf === 1) return expand(args[0], scale);
        return expand(args[0], scale * expLeaf);
      }

      if (op === "neg") {
        const body = expand(args[0] !== undefined ? args[0] : n.arg, scale);
        if (body === null) return null;
        return [{ op: -1, power: 1, isConstant: true }].concat(body);
      }

      return null;
    }

    return expand(node, 1);
  }

  /**
   * Текст формулы из мономиального вектора (без LaTeX, без consolidate).
   * 1/x уже в векторе как power:-1 → уходит в знаменатель.
   */
  function canonicalToPretty(vector, targetSymbol, options) {
    options = options || {};
    const config = Object.assign(
      {
        omitNeutrals: true,
        useFractions: true,
        mulStyle: "dot", // text: always visible separator safer
        divStyle: "slash",
        format: "text"
      },
      options
    );
    if (targetSymbol === undefined) targetSymbol = "";

    if (!Array.isArray(vector)) {
      return targetSymbol ? targetSymbol + " = ?" : "?";
    }

    const nums = [];
    const dens = [];

    for (let i = 0; i < vector.length; i++) {
      const item = vector[i];
      if (!item) continue;
      let power = item.power;
      if (power == null) power = 1;
      if (config.omitNeutrals && power === 0) continue;
      // нейтральный множитель 1
      if (config.omitNeutrals && item.op === 1 && power > 0) continue;
      if (config.omitNeutrals && item.op === 1 && power < 0) continue;

      const absP = Math.abs(power);
      let token = String(item.op);
      // явная степень только если power пришёл из pow, |p|≠1
      // НО одинаковые величины с power 1 каждый — отдельные токены (не свёрнуты)
      if (absP !== 1) {
        token = token + "^" + absP;
      }

      if (config.useFractions && power < 0) dens.push(token);
      else nums.push(token);
    }

    const sep = config.mulStyle === "implicit" ? "" : " · ";
    let numStr = nums.length ? nums.join(sep || " · ") : "1";
    // for implicit letters, join carefully
    if (config.mulStyle === "implicit" && nums.length) {
      numStr = nums[0];
      for (let i = 1; i < nums.length; i++) {
        const a = nums[i - 1];
        const b = nums[i];
        if (/^\d/.test(b) && /\d$/.test(a)) numStr += " · " + b;
        else numStr += b;
      }
    }

    let rhs;
    if (config.useFractions && dens.length) {
      let denStr;
      if (config.mulStyle === "implicit") {
        denStr = dens[0];
        for (let i = 1; i < dens.length; i++) {
          const a = dens[i - 1];
          const b = dens[i];
          if (/^\d/.test(b) && /\d$/.test(a)) denStr += " · " + b;
          else denStr += b;
        }
      } else {
        denStr = dens.join(sep);
      }
      if (dens.length === 1 && dens[0] === "2" && nums.length === 0) {
        rhs = "½";
      } else {
        rhs = numStr + "/" + (dens.length > 1 ? "(" + denStr + ")" : denStr);
      }
    } else {
      rhs = nums.length ? numStr : "1";
    }

    if (!targetSymbol) return rhs;
    return targetSymbol + " = " + rhs;
  }

  /**
   * Высокоуровневый мост resolved AST → отображение.
   * Всегда предпочитает astToDisplay (полный AST, mul/div style).
   * formulaToPretty оставлен для мономиального text-снимка.
   */
  function formulaToPretty(ast, ctx) {
    ctx = ctx || {};
    if (!ast || typeof ast !== "object") return null;

    let targetSym = "";
    let body = ast;
    if (ast.op === "eq" && ast.lhs != null && ast.rhs != null) {
      if (ast.lhs.ref) {
        targetSym = quantityMeta(ast.lhs.ref, ctx.physiQuant, ctx.usagesData).symbol;
      } else {
        targetSym = "Y";
      }
      body = ast.rhs;
    }

    const vector = astToMonomialVector(body, ctx);
    // ВАЖНО: без consolidateVector — повторы не сливаются в степень
    if (!vector) return null;

    const text = canonicalToPretty(vector, targetSym, {
      mulStyle: (ctx.options && ctx.options.mulStyle) || "dot",
      divStyle: "slash",
      format: "text"
    });

    return { text: text, vector: vector, target: targetSym };
  }

  /**
   * Полный рендер формулы для UI (html/text) с опциями mulStyle/divStyle.
   */
  function formatFormula(ast, ctx, options) {
    options = options || {};
    const html = astToDisplay(ast, ctx, 0, Object.assign({ format: "html" }, options));
    const text = astToDisplay(ast, ctx, 0, Object.assign({}, options, { format: "text", divStyle: options.divStyle === "bar" ? "slash" : options.divStyle || "slash" }));
    const pretty = formulaToPretty(ast, Object.assign({}, ctx, { options: options }));
    return { html: html, text: text, pretty: pretty };
  }

  const api = {
    parseDimension: parseDimension,
    vecToKey: vecToKey,
    formatUnit: formatUnit,
    formatUnitForQuantity: formatUnitForQuantity,
    findDefiningUnitLaw: findDefiningUnitLaw,
    unitFromDefiningLaw: unitFromDefiningLaw,
    listNamedUnits: listNamedUnits,
    factorDimension: factorDimension,
    pick: pick,
    astToDisplay: astToDisplay,
    formatFormula: formatFormula,
    canonicalToPretty: canonicalToPretty,
    astToMonomialVector: astToMonomialVector,
    quantityMeta: quantityMeta,
    formulaToPretty: formulaToPretty,
    bindingToLeaf: bindingToLeaf,
    resolveAst: resolveAst,
    getStructuresList: getStructuresList,
    getSchemesMap: getSchemesMap,
    getAliasesMap: getAliasesMap,
    buildSchemeAst: buildSchemeAst,
    resolveLawStructure: resolveLawStructure,
    getLawsList: getLawsList,
    instantiateLaw: instantiateLaw,
    formulasUsing: formulasUsing,
    collectConstructionNeeds: collectConstructionNeeds,
    formulasForConstruction: formulasForConstruction,
    collectConstructionNeeds: collectConstructionNeeds,
    formulasForConstruction: formulasForConstruction,
    toSubscript: toSubscript,
    isZeroIndexRole: isZeroIndexRole,
    normalizeQuantitySymbols: normalizeQuantitySymbols,
    normalizeFormulaBindings: normalizeFormulaBindings,
    normalizeConstructionQuantities: normalizeConstructionQuantities
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  global.FisUnits = api;
})(typeof window !== "undefined" ? window : globalThis);
