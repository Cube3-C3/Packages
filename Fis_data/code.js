/**
 * projection.js — вычислительный + UI-слой рендера пакета Fis_data.
 * Единый файл: FisUnits (размерности, единицы, AST→алгебра) + Projection (паспорта).
 * Host: window.FisUnits, window.Projection
 */
/**
 * code.js — генератор единиц измерения из dimension expr
 *
 * Алгоритм formatUnit(dim, unitsData, lang):
 *  1. Точное совпадение dim с named (джоуль, ньютон, …) → атомарное имя/символ
 *  2. Жадное покрытие: вычитаем из вектора размерности «крупные» named-куски
 *     (J, N, W, Pa…), остаток — base_components
 *  3. Чистый набор base → м/с, кг·м/с² …
 *
 * lang: "ru" | "en"
 * Возвращает { symbol, name, kind: "named"|"composed"|"dimensionless", parts? }
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

  /** named catalog → list of { key, vec, unit, complexity } sorted large→small */
  function buildNamedCatalog(unitsData) {
    const named = unitsData?.named || {};
    const list = [];
    for (const [key, units] of Object.entries(named)) {
      if (key === "[1]") continue;
      const vec = parseDimension(key);
      if (vecIsEmpty(vec)) continue;
      const unit = Array.isArray(units) && units.length ? units[0] : null;
      if (!unit) continue;
      // skip pure single-base (handled as base)
      const keys = Object.keys(vec);
      if (keys.length === 1 && Math.abs(vec[keys[0]]) === 1) continue;
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
   * Попытка вычесть named-вектор из текущего (только если все знаки согласованы
   * и |остаток| уменьшается). k — целое (сколько раз «входит»).
   */
  function trySubtract(remaining, namedVec) {
    // find max positive integer k such that remaining - k*named still same-sign per component
    // where named has non-zero
    let kMax = Infinity;
    for (const b of Object.keys(namedVec)) {
      const nv = namedVec[b];
      if (!nv) continue;
      const rv = remaining[b] || 0;
      // same sign required for clean factoring
      if (rv === 0 || Math.sign(rv) !== Math.sign(nv)) return null;
      kMax = Math.min(kMax, Math.floor(Math.abs(rv) / Math.abs(nv)));
    }
    if (!Number.isFinite(kMax) || kMax < 1) return null;
    const next = vecClone(remaining);
    for (const b of Object.keys(namedVec)) {
      next[b] = (next[b] || 0) - kMax * namedVec[b];
      if (next[b] === 0) delete next[b];
    }
    return { k: kMax, next };
  }

  /**
   * Жадное покрытие: крупные named, затем base.
   * parts: [{ kind, symbol, name, power }]
   */
  function factorDimension(dim, unitsData) {
    let remaining = parseDimension(dim);
    if (vecIsEmpty(remaining)) return { parts: [], exact: true };

    const catalog = buildNamedCatalog(unitsData);
    const parts = [];

    // greedy named
    let progress = true;
    while (progress && !vecIsEmpty(remaining)) {
      progress = false;
      for (const entry of catalog) {
        const sub = trySubtract(remaining, entry.vec);
        if (!sub) continue;
        parts.push({
          kind: "named",
          key: entry.key,
          symbol: entry.unit.symbol,
          name: entry.unit.name,
          power: sub.k
        });
        remaining = sub.next;
        progress = true;
        break; // restart from largest
      }
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
    const mul = lang === "ru" ? " · " : " · ";
    const div = lang === "ru" ? " / " : " / ";

    function atom(p) {
      const n = pick(p.name, lang);
      const ap = Math.abs(p.power);
      return ap === 1 ? n : n + powerToSup(ap);
    }

    const numStr = num.map(atom).join(mul);
    if (!den.length) return numStr || (lang === "ru" ? "единица" : "one");
    const denStr = den.map(atom).join(mul);
    return (numStr || (lang === "ru" ? "единица" : "one")) + div + denStr;
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
      const u = unitsData?.named?.["[1]"]?.[0];
      return {
        symbol: u ? pick(u.symbol, lang) : "1",
        name: u ? pick(u.name, lang) : lang === "ru" ? "единица" : "one",
        kind: "dimensionless",
        units: unitsData?.named?.["[1]"] || []
      };
    }

    // 1) exact named match
    const exactList = unitsData?.named?.[dim];
    if (Array.isArray(exactList) && exactList.length) {
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

    // exact base single
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
          units: unitsData?.named?.["[" + b + "]"] || [
            { name: baseInfo.name, symbol: baseInfo.si_symbol, factor: 1 }
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
    const list = unitsData?.named?.[dim] || [];
    return list.map((u) => ({
      symbol: pick(u.symbol, lang),
      name: pick(u.name, lang),
      factor: u.factor,
      offset: u.offset,
      roles: u.roles,
      notes: u.notes
    }));
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
        const s = emitSym(n.ref, esc(primarySymbol(n.ref, n.role)));
        return [{ html: s, isNum: false, isOne: false, isDiv: inverted }];
      }

      // parentP=0: дробь/сложный множитель без внешних скобок
      // (раньше parentP=4 → prec(div)=3 < 4 → лишние (2/3) вокруг дроби-множителя)
      const s = render(n, 0);
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

      if (node.ref) return emitSym(node.ref, esc(primarySymbol(node.ref, node.role)));

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

  function resolveAst(node, bindings) {
    if (node == null) return node;
    if (typeof node !== "object") return node;
    if (Array.isArray(node)) {
      return node.map(function (n) {
        return resolveAst(n, bindings);
      });
    }
    if (node.operand_id) {
      const b = bindings ? bindings[node.operand_id] : undefined;
      if (b === undefined) return { empty: true };
      return bindingToLeaf(b);
    }
    const out = {};
    for (const k of Object.keys(node)) {
      out[k] = resolveAst(node[k], bindings);
    }
    return out;
  }

  function getStructuresList(structuresData) {
    if (!structuresData) return [];
    if (Array.isArray(structuresData)) return structuresData;
    if (Array.isArray(structuresData.structures)) return structuresData.structures;
    return [];
  }

  function getLawsList(formulasData) {
    if (!formulasData) return [];
    if (Array.isArray(formulasData)) return formulasData;
    if (Array.isArray(formulasData.formulas)) return formulasData.formulas;
    if (Array.isArray(formulasData.laws)) return formulasData.laws;
    return [];
  }

  /**
   * law + structures → готовый пакет формулы (ast уже с ref/num).
   * UI только рисует пакет, не резолвит bindings.
   */
  function instantiateLaw(law, structuresData) {
    if (!law) return null;
    if (law.ast && !law.structure_ref) {
      return {
        id: law.id || law.law_id,
        name: law.name,
        description: law.description || law.notes,
        ast: law.ast,
        structure_ref: null,
        bindings: null
      };
    }
    const structures = getStructuresList(structuresData);
    const struct = structures.find(function (s) {
      return s.id === law.structure_ref;
    });
    if (!struct || !struct.ast) {
      return {
        id: law.law_id || law.id,
        name: law.name,
        description: law.description,
        ast: null,
        structure_ref: law.structure_ref,
        bindings: law.bindings || null,
        error: "structure_not_found"
      };
    }
    return {
      id: law.law_id || law.id,
      name: law.name,
      description: law.description,
      structure_ref: law.structure_ref,
      structure_name: struct.name,
      bindings: law.bindings || {},
      ast: resolveAst(struct.ast, law.bindings || {})
    };
  }

  function formulasUsing(formulasData, qid, structuresData) {
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
      const inst = instantiateLaw(law, structuresData);
      if (!inst || !inst.ast) continue;
      const refs = Object.create(null);
      walkRefs(inst.ast, refs);
      if (refs[qid]) result.push(inst);
    }
    return result;
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
    getLawsList: getLawsList,
    instantiateLaw: instantiateLaw,
    formulasUsing: formulasUsing
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  global.FisUnits = api;
})(typeof window !== "undefined" ? window : globalThis);

/* ---- UI Projection (паспорта) ---- */
(function () {
  "use strict";

  const LANG_INDEX = { en: 0, ru: 1 };

  function pickName(arr, lang) {
    if (!Array.isArray(arr) || !arr.length) return "—";
    const i = LANG_INDEX[lang] ?? 1;
    return arr[i] ?? arr[0] ?? "—";
  }

  function flattenQuantities(physi) {
    const out = [];
    if (!physi || !physi.quantities) return out;
    for (const [type, statuses] of Object.entries(physi.quantities)) {
      for (const [status, items] of Object.entries(statuses)) {
        for (const q of items) {
          out.push({ ...q, _type: type, _status: status });
        }
      }
    }
    return out;
  }

  function domainName(domainsData, id, lang) {
    const d = domainsData?.domains?.[id];
    if (!d) return id;
    return pickName(d.name, lang);
  }

  function filterVal(filters, key) {
    if (!filters) return null;
    const entry = filters[key];
    if (entry == null) return null;
    if (typeof entry === "object") return entry.value || null;
    return entry;
  }

  function bindingQuantityIds(law) {
    const ids = [];
    const b = law && law.bindings;
    if (!b || typeof b !== "object") return ids;
    Object.keys(b).forEach(function (k) {
      const v = b[k];
      if (typeof v === "string" && v) ids.push(v);
      else if (v && typeof v === "object" && v.quantity) ids.push(String(v.quantity));
    });
    return ids;
  }

  /** Domains of a formula = union of operand quantities' usage domains. */
  function formulaDomains(data, law) {
    const set = Object.create(null);
    bindingQuantityIds(law).forEach(function (qid) {
      const usages = data.usages && data.usages.usages && data.usages.usages[qid];
      (usages || []).forEach(function (u) {
        (u.domains || []).forEach(function (d) {
          if (d != null && d !== "") set[String(d)] = true;
        });
      });
    });
    return Object.keys(set);
  }

  function sectionMatchDomainList(data, subjectId, sectionId) {
    const fo = data && data.filter_ontology;
    if (!fo || !Array.isArray(fo.subjects) || !sectionId) return null;
    const sub = fo.subjects.find(function (s) { return s && s.id === subjectId; });
    if (!sub || !Array.isArray(sub.sections)) return null;
    const sec = sub.sections.find(function (s) { return s && s.id === sectionId; });
    if (!sec) return null;
    return Array.isArray(sec.match_domains) ? sec.match_domains.map(String) : [String(sectionId)];
  }

  function usageMatchesSection(data, usage, subjectId, sectionId) {
    if (!sectionId) return true;
    const allowed = sectionMatchDomainList(data, subjectId, sectionId);
    if (!allowed || !allowed.length) return true;
    const doms = (usage && usage.domains) || [];
    if (!doms.length) return false;
    return doms.some(function (d) { return allowed.indexOf(String(d)) >= 0; });
  }

  function formulaMatchesSection(data, law, subjectId, sectionId) {
    if (!sectionId) return true;
    const allowed = sectionMatchDomainList(data, subjectId, sectionId);
    if (!allowed || !allowed.length) return true;
    const doms = formulaDomains(data, law);
    if (!doms.length) return false;
    return doms.some(function (d) { return allowed.indexOf(d) >= 0; });
  }

  function unitsForDimension(unitsData, dim) {
    if (!unitsData) return null;
    // v0.12+: named[dim]; legacy: dimensions[dim]
    if (unitsData.named && unitsData.named[dim]) {
      return { units: { SI: unitsData.named[dim] } };
    }
    if (unitsData.dimensions) return unitsData.dimensions[dim] || null;
    return null;
  }

  function parseDimension(dim) {
    if (window.FisUnits) return Object.entries(window.FisUnits.parseDimension(dim)).map(([base, power]) => ({ base, power }));
    if (!dim || typeof dim !== "string") return [];
    const inner = dim.replace(/^\[|\]$/g, "").trim();
    if (!inner || inner === "1") return [];
    const parts = [];
    const re = /([A-Za-zΘμ])(?:\^\{([^{}]+)\}|\^([^\sA-Za-zΘμ]+))?/g;
    let m;
    while ((m = re.exec(inner)) !== null) {
      const base = m[1];
      const pRaw = m[2] != null ? m[2] : m[3];
      const power = pRaw != null ? Number(pRaw) : 1;
      if (!Number.isNaN(power) && power !== 0) parts.push({ base, power });
    }
    return parts;
  }

  function powerToSup(p) {
    if (p === 1) return "";
    const map = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
    return String(p).split("").map((c) => map[c] || c).join("");
  }

  /** Символ единицы через code.js (FisUnits.formatUnit) */
  function composeUnitSymbol(dim, unitsData, lang) {
    if (window.FisUnits) {
      const r = window.FisUnits.formatUnit(dim, unitsData, lang);
      return r.symbol;
    }
    return dim || "";
  }

  function composeUnitName(dim, unitsData, lang) {
    if (window.FisUnits) {
      const r = window.FisUnits.formatUnit(dim, unitsData, lang);
      return r.name;
    }
    return null;
  }

  function namedUnitsSorted(dim, unitsData, system) {
    if (window.FisUnits && unitsData?.named) {
      const list = unitsData.named[dim] || [];
      return [...list].sort((a, b) => {
        const fa = a.factor != null ? a.factor : 1;
        const fb = b.factor != null ? b.factor : 1;
        const oa = a.offset != null ? a.offset : 0;
        const ob = b.offset != null ? b.offset : 0;
        const score = (f, o) => (Math.abs(f - 1) < 1e-9 && Math.abs(o) < 1e-9 ? 0 : 1) + Math.abs(o) * 1e-6 + Math.abs(f - 1);
        return score(fa, oa) - score(fb, ob);
      });
    }
    const info = unitsForDimension(unitsData, dim);
    const list = info?.units?.[system || "SI"] || [];
    return [...list].sort((a, b) => {
      const fa = a.factor != null ? a.factor : 1;
      const fb = b.factor != null ? b.factor : 1;
      const oa = a.offset != null ? a.offset : 0;
      const ob = b.offset != null ? b.offset : 0;
      const score = (f, o) => (Math.abs(f - 1) < 1e-9 && Math.abs(o) < 1e-9 ? 0 : 1) + Math.abs(o) * 1e-6 + Math.abs(f - 1);
      return score(fa, oa) - score(fb, ob);
    });
  }

  /**
   * Каноническая единица для заголовка:
   * 1) quantity.value_unit
   * 2) FisUnits.formatUnit (named или composed)
   */
  function primaryUnitSymbol(dim, unitsData, lang, quantity) {
    if (quantity && quantity.value_unit) return String(quantity.value_unit);
    if (!dim) return null;
    if (window.FisUnits) {
      const r = window.FisUnits.formatUnit(dim, unitsData, lang);
      if (r.kind === "dimensionless") return null;
      return r.symbol || null;
    }
    const named = namedUnitsSorted(dim, unitsData, "SI");
    if (named.length) {
      const u = named[0];
      if (Array.isArray(u.symbol)) return pickName(u.symbol, lang);
      if (u.symbol) return String(u.symbol);
    }
    if (dim === "[1]") return null;
    return null;
  }

  function formatConstValue(v) {
    if (v == null) return "";
    if (typeof v === "string") return v;
    if (typeof v !== "number") return String(v);
    if (v === 0) return "0";
    if (Number.isInteger(v)) return String(v);
    const abs = Math.abs(v);
    if (abs !== 0 && (abs >= 1e6 || abs < 1e-3)) {
      return v.toExponential(8).replace(/e\+?/g, "e");
    }
    return v.toPrecision(12).replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.$/, "");
  }

  function isConstantQuantity(q) {
    if (!q) return false;
    if (q.value != null) return true;
    if (q._status && String(q._status).includes("констант")) return true;
    if (q._type && String(q._type).includes("констант")) return true;
    return false;
  }

  function unitSystemsForDim(dim, unitsData) {
    if (!dim) return [];
    const systems = new Set(["SI"]);
    const info = unitsForDimension(unitsData, dim);
    for (const [sys, list] of Object.entries(info?.units || {})) {
      if (Array.isArray(list) && list.length) systems.add(sys);
    }
    return [...systems];
  }

  /**
   * Первичный символ величины.
   * По умолчанию = usages[qid][0].symbol.
   * Если передан preferRole — символ с совпадающим role (для bindings с ролями).
   */
  function primarySymbol(qid, usagesData, preferRole) {
    const list = usagesData?.usages?.[qid];
    if (!Array.isArray(list) || !list.length) return qid;
    if (preferRole) {
      for (let i = 0; i < list.length; i++) {
        if (list[i] && list[i].role === preferRole && list[i].symbol != null) {
          return String(list[i].symbol);
        }
      }
    }
    if (list[0].symbol != null) return String(list[0].symbol);
    return qid;
  }

  /**
   * Новая схема (Fis_data):
   *   AST.json        → structures[].ast с operand_id: "O1"…
   *   physi_formulas  → law + structure_ref + bindings { O1: "Q005" | {num:2} }
   *
   * Инстанциация: подстановка bindings в топологический AST → ref/num.
   */
  function getStructuresList(structuresData) {
    return window.FisUnits ? window.FisUnits.getStructuresList(structuresData) : [];
  }
  function getLawsList(formulasData) {
    return window.FisUnits ? window.FisUnits.getLawsList(formulasData) : [];
  }
  function bindingToLeaf(binding) {
    return window.FisUnits ? window.FisUnits.bindingToLeaf(binding) : binding;
  }
  function resolveAst(node, bindings) {
    return window.FisUnits ? window.FisUnits.resolveAst(node, bindings) : node;
  }
  function instantiateLaw(law, structuresData) {
    return window.FisUnits ? window.FisUnits.instantiateLaw(law, structuresData) : null;
  }

  function renderFormulaDisplay(ast, data, options) {
    options = options || {};
    if (!ast) return { html: "", pretty: null };
    const ctx = {
      usagesData: data && data.usages,
      physiQuant: data && data.physi_quant
    };
    const opt = Object.assign(
      { mulStyle: "implicit", divStyle: "bar", format: "html", lang: "ru" },
      options
    );
    if (window.FisUnits && typeof window.FisUnits.formatFormula === "function") {
      try {
        const pack = window.FisUnits.formatFormula(ast, ctx, opt);
        return {
          html: pack.html || "",
          text: pack.text || "",
          pretty: pack.pretty
        };
      } catch (e) {
        console.warn("formatFormula failed", e);
      }
    }
    if (window.FisUnits && typeof window.FisUnits.astToDisplay === "function") {
      try {
        return {
          html: window.FisUnits.astToDisplay(ast, ctx, 0, opt),
          pretty: null
        };
      } catch (e) {
        console.warn("astToDisplay failed", e);
      }
    }
    // fallback: локальный astToAlgebra
    return {
      html: astToAlgebra(ast, data && data.usages, 0, opt),
      pretty: null
    };
  }


  function formulasUsing(formulasData, qid, structuresData) {
    if (window.FisUnits && window.FisUnits.formulasUsing) {
      return window.FisUnits.formulasUsing(formulasData, qid, structuresData);
    }
    return [];
  }


  function astToAlgebra(node, usagesData, parentPrec, options) {
    const opt = Object.assign({ mulStyle: "implicit", divStyle: "bar", format: "html" }, options || {});
    if (window.FisUnits && window.FisUnits.astToDisplay) {
      return window.FisUnits.astToDisplay(node, { usagesData: usagesData }, parentPrec, opt);
    }
    return "";
  }


  function defaultCardManifests() {
    return {
      quantity_passport: {
        id: "quantity_passport",
        label: ["Quantity passport", "Паспорт величины"],
        entity_kinds: ["phys_quant"],
        slots: ["header", "unit_line", "chips", "notes", "usages", "formulas"]
      },
      math_const_passport: {
        id: "math_const_passport",
        label: ["Math constant passport", "Паспорт математического числа"],
        entity_kinds: ["math_const"],
        slots: ["header", "chips", "notes", "usages"]
      },
      formula_stub: {
        id: "formula_stub",
        label: ["Formula (stub)", "Формула (черновик)"],
        entity_kinds: ["formulas"],
        slots: ["formula_header", "formula_algebra", "formula_placeholder"]
      }
    };
  }

  function getCardManifestsMap(data) {
    const defaults = defaultCardManifests();
    const fromData = data && data.card_manifests && data.card_manifests.manifests;
    if (!fromData || typeof fromData !== "object" || Array.isArray(fromData)) {
      return defaults;
    }
    const map = {};
    for (const key of Object.keys(defaults)) {
      const base = defaults[key];
      const over = fromData[key];
      if (over && typeof over === "object" && !Array.isArray(over)) {
        map[key] = {
          id: over.id || base.id,
          label: over.label || base.label,
          entity_kinds: over.entity_kinds || base.entity_kinds,
          slots: Array.isArray(over.slots) && over.slots.length ? over.slots.slice() : base.slots.slice()
        };
      } else {
        map[key] = {
          id: base.id,
          label: base.label,
          entity_kinds: base.entity_kinds,
          slots: base.slots.slice()
        };
      }
    }
    // extra manifests from data (custom)
    for (const key of Object.keys(fromData)) {
      if (map[key]) continue;
      const over = fromData[key];
      if (!over || typeof over !== "object") continue;
      map[key] = {
        id: over.id || key,
        label: over.label || [key, key],
        entity_kinds: over.entity_kinds || [],
        slots: Array.isArray(over.slots) ? over.slots.slice() : []
      };
    }
    return map;
  }

  /**
   * Data adapter: domain graph → presentation ctx.derived (no HTML styling).
   * Section / unit_sys from state.filters affect usages, primary symbol/name, related formulas.
   */
  function buildPresentationCtx(ctx) {
    const { q, qid, lang, data, usages, state } = ctx;
    const isConst = q ? isConstantQuantity(q) : false;
    const derived = Object.assign({}, ctx.derived || {});
    const filters = (state && state.filters) || (ctx.filters) || {};
    const subjectId = (state && state.subject) || filterVal(filters, "subject") || "physics";
    const sectionId = filterVal(filters, "section");
    const unitSys = filterVal(filters, "unit_sys");
    // Section-filtered usages for header symbol/name and table (fallback: all)
    let usagesView = usages || [];

    if (q) {
      const usagesFiltered = (usages || []).filter(function (u) {
        return usageMatchesSection(data, u, subjectId, sectionId);
      });
      usagesView = sectionId && usagesFiltered.length ? usagesFiltered : (usages || []);

      if (!derived.primary_usage) {
        derived.primary_usage = usagesView[0] || null;
      }
      if (!derived.primary_symbol && derived.primary_usage) {
        derived.primary_symbol = derived.primary_usage.symbol || "";
      }
      if (!derived.primary_name && derived.primary_usage) {
        derived.primary_name = pickName(derived.primary_usage.name, lang);
      }

      if (!derived.unit_symbol) {
        // unit_sys selects system; only SI has full coverage for now
        const u = primaryUnitSymbol(q.dimension, data.units, lang, q);
        if (u) derived.unit_symbol = u;
        if (unitSys && unitSys !== "SI" && unitSys !== "SI_named" && unitSys !== "SI_comp") {
          // CGS / natural: mark system; values still SI until unit graphs exist
          derived.unit_sys_note = unitSys;
        }
      }
      if (!derived.unit_name) {
        const namedSI = namedUnitsSorted(q.dimension, data.units, "SI");
        const namedMeaningful = namedSI.filter((u) => {
          const sym = Array.isArray(u.symbol) ? pickName(u.symbol, lang) : String(u.symbol || "");
          const nm = pickName(u.name, lang);
          if (!nm || nm === "—") return false;
          const nmLow = String(nm).toLowerCase();
          if (sym === "1" || nm === "1" || nmLow === "one" || nmLow === "единица") return false;
          if (q.dimension === "[1]") return false;
          return true;
        });
        if (namedMeaningful.length) {
          derived.unit_name = namedMeaningful.map((u) => pickName(u.name, lang)).join(", ");
        } else if (q.dimension && q.dimension !== "[1]") {
          const fullName = composeUnitName(q.dimension, data.units, lang);
          if (fullName) derived.unit_name = fullName;
        }
      }
      if (isConst && q.value != null && !derived.const_value) {
        let valStr = formatConstValue(q.value);
        if (q.value_unit) valStr += " " + String(q.value_unit);
        derived.const_value = valStr;
      }
      if (!derived.usages_rows) {
        derived.usages_rows = usagesView.map((u) => {
          const domains_html = (u.domains || [])
            .map((d) => `<span class="dom" title="${escapeHtml(d)}">${escapeHtml(domainName(data.domains, d, lang))}</span>`)
            .join("");
          return {
            symbol: u.symbol || "",
            name: pickName(u.name, lang),
            role: u.role || "",
            notes: u.notes || "",
            domains_html: domains_html,
            domains: (u.domains || []).map(String)
          };
        });
      }
      if (!derived.related_formulas && qid) {
        let related = formulasUsing(data.formulas, qid, data.structures);
        // Filter related laws by section derived from operand domains
        if (sectionId) {
          related = related.filter(function (f) {
            // formulasUsing returns instantiated laws; map back via id
            const raw = {
              law_id: f.id,
              bindings: f.bindings,
              structure_ref: f.structure_ref
            };
            return formulaMatchesSection(data, raw, subjectId, sectionId);
          });
        }
        derived.related_formulas = related.map((f) => {
          let algebra_html;
          if (f.ast) {
            algebra_html = renderFormulaDisplay(f.ast, data, { lang: lang || "ru" }).html;
          } else {
            algebra_html = `<span class="pres-muted">${escapeHtml(f.error || "—")}</span>`;
          }
          const doms = formulaDomains(data, {
            law_id: f.id,
            bindings: f.bindings
          });
          return {
            algebra_html: algebra_html,
            name: f.name || "",
            meta: f.description || "",
            law_id: f.id || null,
            domains: doms
          };
        });
      }
    }

    if (ctx.law && !derived.formula_html) {
      const law = ctx.law;
      const inst = ctx.inst || (law ? instantiateLaw(law, data.structures) : null);
      if (inst && inst.ast) {
        // Пакет решает семантику клика по символу: navigate → паспорт величины.
        // Ядро (astToDisplay / emitSym) только вызывает wrapSym, если его передали.
        const wrapSym = function (qid, body) {
          if (!qid || !window.FisPresentation || typeof window.FisPresentation.slotActionAttrs !== "function") {
            return body;
          }
          const cardType = String(qid).charAt(0) === "M" ? "math_const" : "phys_quant";
          const hint =
            (lang || "ru") === "ru"
              ? "Открыть паспорт величины"
              : "Open quantity passport";
          const action = window.FisPresentation.slotActionAttrs(
            "navigate",
            { cardType: cardType, id: qid },
            hint
          );
          return (
            '<span class="fis-sym-ref ' +
            action.className +
            '"' +
            action.attrs +
            ">" +
            body +
            "</span>"
          );
        };
        const disp = renderFormulaDisplay(
          inst.ast,
          data,
          Object.assign(
            {
              lang: lang || "ru",
              mulStyle: "implicit",
              divStyle: "bar",
              wrapSym: wrapSym
            },
            (ctx.projection && ctx.projection.options) || {}
          )
        );
        derived.formula_html = disp.html;
      }
    }

    const cardType =
      (state && state.card_type) ||
      ctx.cardType ||
      ctx.card_type ||
      "phys_quant";

    return {
      quantity: q || null,
      usages: usagesView,
      lang: lang || "ru",
      isConst: !!(isConst && q && q.value != null),
      derived: derived,
      law: ctx.law || null,
      cardType: cardType,
      card_type: cardType,
      subject: subjectId,
      section: sectionId,
      filters: filters
    };
  }

  function resolveCardManifest(projection, state, data) {
    const cardType =
      (state && state.card_type) ||
      (projection && projection.card_type) ||
      "phys_quant";
    if (
      window.FisPresentation &&
      typeof window.FisPresentation.passportSlotIds === "function"
    ) {
      const ont = data.presentation_ontology;
      const slotIds = ont ? window.FisPresentation.passportSlotIds(ont, cardType) : null;
      if (slotIds && slotIds.length) {
        const pass = window.FisPresentation.getPassport(ont, cardType);
        return {
          id: (pass && pass.id) || cardType + "_passport",
          label: (pass && pass.label) || [cardType, cardType],
          entity_kinds: [cardType],
          slots: slotIds
        };
      }
    }
    const map = getCardManifestsMap(data);
    const id =
      (projection && projection.manifest) ||
      (cardType === "math_const"
        ? "math_const_passport"
        : cardType === "formulas"
          ? "formula_stub"
          : "quantity_passport");
    return map[id] || map.quantity_passport || {
      id: "quantity_passport",
      label: ["Quantity passport", "Паспорт величины"],
      entity_kinds: ["phys_quant"],
      slots: ["header", "unit_line", "chips", "notes", "usages", "formulas"]
    };
  }

  function renderPassport(container, projection, state, data) {
    const lang = (projection && projection.lang) || "ru";
    const qid = state && state.quantity_id;
    const quantities = flattenQuantities(data.physi_quant);
    const q = quantities.find((x) => x.id === qid);
    if (!q) {
      container.innerHTML = `<div class="empty">Величина <code>${escapeHtml(qid)}</code> не найдена</div>`;
      return;
    }
    const usages =
      (data.usages && data.usages.usages && data.usages.usages[qid]) || [];
    const manifest = resolveCardManifest(projection, state, data);
    const cardType = (state && state.card_type) || "phys_quant";
    const pctx = buildPresentationCtx({
      q, qid, lang, data, usages, projection, state, cardType
    });

    let html =
      `<div class="passport" data-projection="${escapeHtml(manifest.id || "")}" data-qid="${escapeHtml(q.id)}">`;
    if (window.FisPresentation && typeof window.FisPresentation.renderPassportSlots === "function") {
      html += window.FisPresentation.renderPassportSlots(data, cardType, pctx);
    } else if (window.FisPresentation && typeof window.FisPresentation.renderSlot === "function") {
      for (const slotId of manifest.slots) {
        html += window.FisPresentation.renderSlot(data, slotId, pctx) || "";
      }
    } else {
      html += `<div class="empty">FisPresentation не загружен</div>`;
    }
    html += `</div>`;
    container.innerHTML = html;
  }

  function renderList(container, projection, state, data) {
    const lang = (projection && projection.lang) || "ru";
    const quantities = flattenQuantities(data.physi_quant);
    let html = `<div class="passport"><h3 style="margin-bottom:12px">Список величин (${quantities.length})</h3><ul class="formulas-list">`;
    for (const q of quantities) {
      const usages =
        (data.usages && data.usages.usages && data.usages.usages[q.id]) || [];
      const name = usages[0] ? pickName(usages[0].name, lang) : q.id;
      html += `<li><span>${escapeHtml(name)}</span> <span style="color:var(--muted);font-family:var(--mono);font-size:0.75rem;margin-left:auto">${escapeHtml(q.dimension || "")}</span></li>`;
    }
    html += `</ul></div>`;
    container.innerHTML = html;
  }

  function escapeHtml(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  const instances = new WeakMap();

  function renderFormulaStub(container, projection, state, data) {
    const lang = (projection && projection.lang) || "ru";
    const lawId = state && state.law_id;
    if (!lawId) {
      container.innerHTML = `<div class="empty">Укажите state.law_id</div>`;
      return;
    }
    const laws = getLawsList(data.formulas);
    const law = laws.find((l) => (l.law_id || l.id) === lawId);
    if (!law) {
      container.innerHTML = `<div class="empty">Формула <code>${escapeHtml(lawId)}</code> не найдена</div>`;
      return;
    }
    const inst = instantiateLaw(law, data.structures);
    const lawForPres = Object.assign({}, law, {
      structure_ref: (inst && inst.structure_ref) || law.structure_ref,
      name: (inst && inst.name) || law.name
    });
    // formula_html строится в buildPresentationCtx с wrapSym (навигация по символам)
    const manifest = resolveCardManifest(projection, state, data);
    const pctx = buildPresentationCtx({
      q: null,
      qid: null,
      lang,
      data,
      usages: [],
      projection,
      state,
      law: lawForPres,
      inst: inst,
      cardType: "formulas"
    });
    if (!pctx.law.structure_ref && inst && inst.structure_ref) {
      pctx.law.structure_ref = inst.structure_ref;
    }

    let html = `<div class="passport" data-projection="${escapeHtml(manifest.id)}" data-law="${escapeHtml(lawId)}">`;
    if (window.FisPresentation && typeof window.FisPresentation.renderPassportSlots === "function") {
      html += window.FisPresentation.renderPassportSlots(data, "formulas", pctx);
    } else if (window.FisPresentation && typeof window.FisPresentation.renderSlot === "function") {
      for (const slotId of manifest.slots) {
        html += window.FisPresentation.renderSlot(data, slotId, pctx) || "";
      }
    }
    if (!inst || !inst.ast) {
      html += `<div class="section"><div class="card"><div class="value pres-muted">${escapeHtml(law.description || law.structure_ref || "")}</div></div></div>`;
    }

    // график — платформа: GeoCompute.attachLawGraph после render_passport
    html += `</div>`;
    container.innerHTML = html;
  }

  window.Projection = {
    /**
     * @param {HTMLElement} container
     * @param {{ data?: object, projection?: object, state?: object }} payload
     *
     * data       — что существует
     * projection — как работать / что показать { kind, lang, options? }
     * state      — выбор пользователя { quantity_id?, law_id?, card_type? }
     */
    render(container, payload) {
      if (!container) throw new Error("Projection.render: container required");
      payload = payload || {};
      // backward-compat: старый вызов render(container, instruction, data)
      if (arguments.length >= 3 && payload && !payload.data && !payload.projection) {
        const instruction = payload || {};
        const dataLegacy = arguments[2] || {};
        payload = {
          data: dataLegacy,
          projection: {
            kind: instruction.mode || "quantity_passport",
            lang: instruction.lang || "ru"
          },
          state: {
            quantity_id: instruction.quantity_id,
            law_id: instruction.law_id
          }
        };
      }

      const data = payload.data || {};
      const projection = payload.projection || {};
      const state = payload.state || {};

      instances.set(container, { data, projection, state });

      const kind = projection.kind || projection.mode || "quantity_passport";

      try {
        if (kind === "quantity_passport") {
          if (!state.quantity_id) {
            container.innerHTML = `<div class="empty">Укажите state.quantity_id</div>`;
            return;
          }
          renderPassport(container, projection, state, data);
        } else if (kind === "formula_stub" || kind === "formula_passport") {
          renderFormulaStub(container, projection, state, data);
        } else if (kind === "quantity_list") {
          renderList(container, projection, state, data);
        } else {
          container.innerHTML = `<div class="empty">Неизвестный projection.kind: ${escapeHtml(kind)}</div>`;
        }
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        const stack = err && err.stack ? String(err.stack) : "";
        container.innerHTML =
          `<div class="empty" style="color:var(--danger);text-align:left">` +
          `<strong>Ошибка рендера паспорта</strong><br/>` +
          `<code style="font-size:0.85rem">${escapeHtml(msg)}</code>` +
          (stack
            ? `<pre style="margin-top:10px;font-size:0.72rem;color:var(--muted);white-space:pre-wrap">${escapeHtml(stack)}</pre>`
            : "") +
          `</div>`;
        if (typeof console !== "undefined" && console.error) console.error(err);
      }
    },

    destroy(container) {
      if (!container) return;
      instances.delete(container);
      container.innerHTML = "";
      container.removeAttribute("data-projection");
    },

    _getState(container) {
      return instances.get(container) || null;
    },

    getLawsList,
    getStructuresList,
    instantiateLaw,
    resolveAst,
    formulasUsing,
    astToAlgebra,
    primarySymbol
  };
})();

/**
 * FisPresentation — universal presentation runtime.
 * Pipeline: ontology.tree[card].passport.slots → renderSlot → HTML with style hooks.
 * Platform mounts the result; CSS maps style_kinds / layout wrappers.
 */
(function (global) {
  "use strict";

  function pickI18n(arr, lang) {
    if (!Array.isArray(arr)) return arr != null ? String(arr) : "";
    const idx = lang === "ru" ? 1 : 0;
    return arr[idx] != null ? arr[idx] : arr[0] != null ? arr[0] : "";
  }

  function escapeHtml(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function getOntology(data) {
    return (data && data.presentation_ontology) || null;
  }

  function getBranch(ontology, cardType) {
    if (!ontology || !Array.isArray(ontology.tree)) return null;
    return ontology.tree.find(function (n) { return n && n.id === cardType; }) || null;
  }

  function getPassport(ontology, cardType) {
    const b = getBranch(ontology, cardType);
    return b && b.passport ? b.passport : null;
  }

  function passportSlotIds(ontology, cardType) {
    const pass = getPassport(ontology, cardType);
    if (!pass || !Array.isArray(pass.slots)) return null;
    return pass.slots.map(function (s) { return s && s.id; }).filter(Boolean);
  }

  function findSlotCompose(ontology, cardType, slotId) {
    const pass = getPassport(ontology, cardType);
    if (pass && Array.isArray(pass.slots)) {
      const hit = pass.slots.find(function (s) { return s && s.id === slotId; });
      if (hit) return hit;
    }
    if (ontology.slot_compose && ontology.slot_compose[slotId]) {
      return ontology.slot_compose[slotId];
    }
    return null;
  }

  function styleKindInfo(ontology, styleId) {
    return (ontology && ontology.style_kinds && ontology.style_kinds[styleId]) || { css: "pres-muted" };
  }

  function cssFor(ontology, styleId, variant) {
    const sk = styleKindInfo(ontology, styleId);
    if (styleId === "chip" && sk.variants) {
      const v = sk.variants[variant] || sk.variants.default || {};
      return v.css || sk.css || "chip";
    }
    return sk.css || "pres-muted";
  }

  function fieldDef(ontology, fieldId) {
    return ontology && ontology.fields && ontology.fields[fieldId];
  }

  function resolveValue(fieldId, ctx, ontology) {
    const def = fieldDef(ontology, fieldId);
    if (!def || !def.source) return null;
    const src = def.source;
    const lang = (ctx && ctx.lang) || "ru";
    if (src.from === "usages") {
      const list = ctx.usages || [];
      if (src.pick === "all") return list;
      const u = list[0];
      if (!u) return null;
      let v = u[src.key];
      if (src.i18n) v = pickI18n(v, lang);
      return v != null && v !== "" ? v : null;
    }
    if (src.from === "quantity") {
      let v = (ctx.quantity || {})[src.key];
      if (src.i18n) v = pickI18n(v, lang);
      return v != null && v !== "" ? v : null;
    }
    if (src.from === "law") {
      const v = (ctx.law || {})[src.key];
      return v != null && v !== "" ? v : null;
    }
    if (src.from === "unit") {
      let v = (ctx.unit || {})[src.key];
      if (src.i18n) v = pickI18n(v, lang);
      return v != null && v !== "" ? v : null;
    }
    if (src.from === "derived") {
      const v = (ctx.derived || {})[src.key];
      return v != null && v !== "" ? v : null;
    }
    return null;
  }

  function wrapText(text, wrap) {
    if (text == null || text === "") return text;
    if (!wrap || !Array.isArray(wrap) || wrap.length < 2) return text;
    return wrap[0] + text + wrap[1];
  }

  function renderAtom(ontology, styleId, text, options) {
    options = options || {};
    if (text == null || text === "") return "";
    let body = options.rawHtml ? String(text) : escapeHtml(String(text));
    if (options.wrap) body = wrapText(body, options.wrap);
    const cls = cssFor(ontology, styleId, options.variant);
    const extra = options.className ? " " + options.className : "";
    return '<span class="' + cls + extra + '">' + body + "</span>";
  }

  function normalizePart(part) {
    if (!part) return null;
    if (typeof part === "string") return { field: part };
    return part;
  }

  function renderParts(ontology, parts, ctx) {
    const bits = [];
    (parts || []).forEach(function (raw) {
      const part = normalizePart(raw);
      if (!part) return;
      if (part.literal != null) {
        bits.push(renderAtom(ontology, part.style || "muted", part.literal, { className: part.class || "" }));
        return;
      }
      const val = resolveValue(part.field, ctx, ontology);
      if (val == null || val === "") return;
      bits.push(renderAtom(ontology, part.style || "title", val, {
        variant: part.variant,
        wrap: part.wrap,
        className: part.class || "",
        rawHtml: !!part.rawHtml
      }));
    });
    return bits.join("");
  }

  function renderListItem(data, cardType, ctx) {
    const ontology = getOntology(data);
    if (!ontology) return null;
    const branch = getBranch(ontology, cardType);
    let layout = branch && branch.list_item;
    if (!layout && ontology.list_item) {
      layout = ontology.list_item[cardType] || ontology.list_item.phys_quant;
    }
    if (!layout || !Array.isArray(layout.parts)) return null;
    return renderParts(ontology, layout.parts, ctx) || null;
  }

  function renderUnitCatalogItem(data, ctx) {
    return renderListItem(data, "unit_catalog", ctx);
  }

  function sectionWrap(title, bodyHtml) {
    if (!bodyHtml) return "";
    const h = title ? '<h3>' + escapeHtml(title) + '</h3>' : "";
    return '<div class="section">' + h + bodyHtml + "</div>";
  }

  function renderUsagesTable(ctx, compose) {
    const rows = (ctx.derived && ctx.derived.usages_rows) || [];
    const lang = ctx.lang || "ru";
    const title = compose && compose.title ? pickI18n(compose.title, lang) : (lang === "ru" ? "Обозначения и контексты" : "Symbols & contexts");
    let body = '<div class="card" style="padding:0;overflow:hidden"><table class="usages"><thead><tr>' +
      '<th>Символ</th><th>Имя</th><th>Роль</th><th>Домены</th></tr></thead><tbody>';
    if (!rows.length) {
      body += '<tr><td colspan="4" class="pres-muted">—</td></tr>';
    } else {
      rows.forEach(function (r) {
        body += "<tr>" +
          '<td class="sym">' + escapeHtml(r.symbol || "") + "</td>" +
          "<td>" + escapeHtml(r.name || "") +
            (r.notes ? '<div class="pres-muted" style="font-size:0.75rem;margin-top:2px">' + escapeHtml(r.notes) + "</div>" : "") +
          "</td>" +
          '<td><code class="pres-muted" style="font-size:0.78rem">' + escapeHtml(r.role || "—") + "</code></td>" +
          '<td><div class="domains">' + (r.domains_html || "—") + "</div></td>" +
          "</tr>";
      });
    }
    body += "</tbody></table></div>";
    return sectionWrap(title + (rows.length ? " (" + rows.length + ")" : ""), body);
  }

  /**
   * --- Slot action signals -------------------------------------------------
   * Пакет — единственный владелец знания о том, что означает клик по слоту.
   * Платформа ловит "сырой" DOM-клик/keydown и отдаёт event.target сюда,
   * в resolveSlotAction(). Разметку кликабельности (slotActionAttrs) тоже
   * расставляет пакет. Контракт: { type, payload }.
   */
  function slotActionAttrs(actionType, payload, hintLabel) {
    if (!actionType) return { className: "", attrs: "" };

    let attrs = ' data-fis-slot-action="' + escapeHtml(actionType) + '"';

    if (payload && typeof payload === "object") {
      try {
        attrs += ' data-fis-payload="' + escapeHtml(JSON.stringify(payload)) + '"';
      } catch (e) {
        // Ignore serialize errors
      }
    }

    attrs += ' tabindex="0" role="button"';
    if (hintLabel) attrs += ' title="' + escapeHtml(hintLabel) + '"';

    return { className: "clickable", attrs: attrs };
  }

  function resolveSlotAction(target) {
    const el = target && typeof target.closest === "function"
      ? target.closest("[data-fis-slot-action]")
      : null;
    if (!el) return null;

    const actionType = el.getAttribute("data-fis-slot-action");
    if (!actionType) return null;

    let payload = {};
    try {
      const payloadStr = el.getAttribute("data-fis-payload");
      if (payloadStr) payload = JSON.parse(payloadStr);
    } catch (e) {
      // Ignore parse errors
    }

    return {
      type: actionType,
      payload: payload
    };
  }

  function renderFormulasList(ctx, compose) {
    const items = (ctx.derived && ctx.derived.related_formulas) || [];
    const lang = ctx.lang || "ru";
    const title = compose && compose.title ? pickI18n(compose.title, lang) : (lang === "ru" ? "Формулы, где встречается" : "Related formulas");
    let body;
    if (!items.length) {
      body = '<div class="card"><div class="value pres-muted">' +
        (lang === "ru" ? "В текущем наборе формул не встречается" : "Not used in current formula set") +
        "</div></div>";
    } else {
      body = '<ul class="formulas-list">';
      items.forEach(function (it) {
        const hint = it.law_id
          ? (lang === "ru" ? "Открыть паспорт формулы" : "Open formula passport")
          : "";
        // Пакет: navigate с card_type + id; платформа применяет без знания про formulas.
        const action = slotActionAttrs(
          "navigate",
          { cardType: "formulas", id: it.law_id },
          hint
        );
        body += '<li class="formula-card ' + action.className + '"' + action.attrs + '>' +
          '<div class="algebra">' + (it.algebra_html || "") + "</div>" +
          (it.name ? '<div class="fname" style="margin-top:4px">' + escapeHtml(it.name) + "</div>" : "") +
          (it.meta ? '<div class="pres-muted" style="font-size:0.72rem;margin-top:2px">' + escapeHtml(it.meta) + "</div>" : "") +
          "</li>";
      });
      body += "</ul>";
    }
    return sectionWrap(title, body);
  }

  /**
   * Universal slot renderer. All passport content goes through here.
   */
  function renderSlot(data, slotId, ctx) {
    const ontology = getOntology(data);
    if (!ontology) return null;
    const cardType = (ctx && (ctx.cardType || ctx.card_type)) || "phys_quant";
    const compose = findSlotCompose(ontology, cardType, slotId);
    if (!compose) return null;

    const mode = compose.mode || "inline";
    const wrapper = compose.wrapper || "";

    if (mode === "usages_table") return renderUsagesTable(ctx, compose);
    if (mode === "formulas_list") return renderFormulasList(ctx, compose);

    if (mode === "chips") {
      const fieldSpecs = Array.isArray(compose.fields) ? compose.fields : [];
      const parts = [];
      fieldSpecs.forEach(function (raw) {
        const spec = normalizePart(raw);
        if (!spec || !spec.field) return;
        const val = resolveValue(spec.field, ctx, ontology);
        if (val == null || val === "") return;
        parts.push(renderAtom(ontology, spec.style || "chip", val, { variant: spec.variant || "default" }));
      });
      if (!parts.length) return "";
      return '<div class="' + (wrapper || "chips") + '">' + parts.join("") + "</div>";
    }

    if (mode === "card") {
      const fieldSpecs = Array.isArray(compose.fields) ? compose.fields : [];
      const bits = [];
      fieldSpecs.forEach(function (raw) {
        const spec = normalizePart(raw);
        if (!spec || !spec.field) return;
        const val = resolveValue(spec.field, ctx, ontology);
        if (val == null || val === "") return;
        bits.push(renderAtom(ontology, spec.style || "muted", val, {}));
      });
      if (!bits.length) return "";
      const title = compose.title ? pickI18n(compose.title, ctx.lang || "ru") : "";
      const label = title ? '<div class="label">' + escapeHtml(title) + "</div>" : "";
      return '<div class="section"><div class="card">' + label +
        '<div class="value">' + bits.join("") + "</div></div></div>";
    }

    let partsSpec = compose.parts;
    if (slotId === "header" && ctx && ctx.isConst && compose.const_mode && compose.const_mode.parts) {
      partsSpec = compose.const_mode.parts;
    }

    if (mode === "stack") {
      const blocks = [];
      (partsSpec || []).forEach(function (part) {
        const one = renderParts(ontology, [part], ctx);
        if (one) blocks.push(one);
      });
      if (!blocks.length) return "";
      return '<div class="' + (wrapper || "passport-header") + '">' + blocks.join("") + "</div>";
    }

    const inner = renderParts(ontology, partsSpec, ctx);
    if (!inner) return "";
    if (mode === "line") {
      return '<div class="' + (wrapper || "unit-line") + '">' + inner + "</div>";
    }
    return '<div class="' + (wrapper || "passport-header") + '">' + inner + "</div>";
  }

  /** Render full passport from ontology slots */
  function renderPassportSlots(data, cardType, ctx) {
    const ontology = getOntology(data);
    if (!ontology) return "";
    const ids = passportSlotIds(ontology, cardType) || [];
    const cctx = Object.assign({}, ctx, { cardType: cardType, card_type: cardType });
    let html = "";
    ids.forEach(function (slotId) {
      const part = renderSlot(data, slotId, cctx);
      if (part) html += part;
    });
    return html;
  }

  global.FisPresentation = {
    getOntology: getOntology,
    getBranch: getBranch,
    getPassport: getPassport,
    passportSlotIds: passportSlotIds,
    findSlotCompose: findSlotCompose,
    cssFor: cssFor,
    resolveValue: resolveValue,
    renderAtom: renderAtom,
    renderParts: renderParts,
    renderListItem: renderListItem,
    renderUnitCatalogItem: renderUnitCatalogItem,
    renderSlot: renderSlot,
    renderPassportSlots: renderPassportSlots,
    renderChips: function (data, ctx) { return renderSlot(data, "chips", ctx) || ""; },
    fieldDef: fieldDef,
    pickI18n: pickI18n,
    // Слот-сигналы: платформа отдаёт сырой DOM target, пакет отвечает { type, payload }
    resolveSlotAction: resolveSlotAction,
    slotActionAttrs: slotActionAttrs
  };
})(typeof window !== "undefined" ? window : globalThis);


/**
 * FisPackage — заменяемый предметный пакет.
 * Платформа владеет DOM, компонентами и типами сигналов.
 * Пакет только: данные, ingest, handlers → payload / render-result.
 *
 * Контракт handlers (платформа вызывает при наличии):
 *   card_types(ctx)           → [{ id, label }]
 *   filter_schema(ctx)        → [{ id, label, options:[{value,label}] }]
 *   list_items(ctx)           → [{ id, html }]
 *   list_title(ctx)           → string
 *   render_passport(ctx)      → void (рисует в ctx.container)
 *   resolve_slot_action(el)   → { type, payload } | null
 *   id_field(cardType)        → state key for entity id
 *   summarize(data)           → { keys, nQ, nU, nF }
 *   ingest_file(name, json, pack)
 *
 * Сигналы платформы, на которые пакет может отвечать:
 *   card_type_change | filter_change | search_change | list_select | slot_action
 */
(function (global) {
  "use strict";

  function i18nLabel(label, fallback, lang) {
    if (Array.isArray(label)) return lang === "ru" ? (label[1] || label[0]) : label[0];
    if (label != null) return String(label);
    return fallback || "";
  }

  function ingestFile(fileName, json, pack) {
    pack = pack || {};
    const name = String(fileName || "").toLowerCase();
    if (!json || typeof json !== "object") return pack;

    if (json.base_components && (json.named || json.dimensions)) pack.units = json;
    else if (json.quantities) pack.physi_quant = json;
    else if (json.usages) pack.usages = json;
    else if (json.domains && !json.quantities) pack.domains = json;
    else if (json.structures) pack.structures = json;
    else if (Array.isArray(json) || Array.isArray(json.formulas) || Array.isArray(json.laws)) {
      pack.formulas = Array.isArray(json) ? json : json.formulas || json.laws;
    } else if (
      json.tree &&
      (name.indexOf("filter") >= 0 ||
        (json.meta && String(json.meta.description || "").toLowerCase().indexOf("filter") >= 0))
    ) {
      pack.filter_ontology = json;
    } else if (json.style_kinds || (json.tree && json.fields)) pack.presentation_ontology = json;
    else if (json.manifests) pack.card_manifests = json;
    else if (json.operators || json.math_kinds) pack.math_ops = json;
    else if (name.indexOf("units") >= 0) pack.units = json;
    else if (name.indexOf("physi_quant") >= 0 || name.indexOf("quant") >= 0) pack.physi_quant = json;
    else if (name.indexOf("usage") >= 0) pack.usages = json;
    else if (name.indexOf("domain") >= 0) pack.domains = json;
    else if (name.indexOf("ast") >= 0) pack.structures = json;
    else if (name.indexOf("formul") >= 0) pack.formulas = json;
    else if (name.indexOf("filter") >= 0) pack.filter_ontology = json;
    else if (name.indexOf("presentation") >= 0) pack.presentation_ontology = json;
    else if (name.indexOf("card_manifest") >= 0) pack.card_manifests = json;
    else if (name.indexOf("math_ops") >= 0) pack.math_ops = json;

    return pack;
  }

  function getFilterOntology(data) {
    return (data && data.filter_ontology) || null;
  }

  /** v0.4 subjects[]; fallback to legacy tree if needed */
  function subjectNodes(data) {
    const fo = getFilterOntology(data);
    if (fo && Array.isArray(fo.subjects)) return fo.subjects.filter(function (s) { return s && s.id; });
    return [];
  }

  function getSubject(data, subjectId) {
    return subjectNodes(data).find(function (s) { return s.id === subjectId; }) || null;
  }

  function abstractionLevels(data, subjectId) {
    const sub = getSubject(data, subjectId);
    return (sub && Array.isArray(sub.abstraction_levels)) ? sub.abstraction_levels : [];
  }

  function entityKindForAbstraction(data, subjectId, abstractionId) {
    const levels = abstractionLevels(data, subjectId);
    const hit = levels.find(function (a) { return a && a.id === abstractionId; });
    return (hit && hit.entity_kind) || null;
  }

  /** Legacy: tree[card_type] — kept for old bundles */
  function getCardTypeBranch(data, cardType) {
    const fo = getFilterOntology(data);
    if (!fo || !Array.isArray(fo.tree)) return null;
    return fo.tree.find(function (n) { return n && n.id === cardType; }) || null;
  }

  function cardTypeNodes(data) {
    const fo = getFilterOntology(data);
    if (fo && Array.isArray(fo.subjects) && fo.subjects.length) {
      // flatten abstraction entity_kinds as synthetic "types" for legacy callers
      const seen = {};
      const out = [];
      fo.subjects.forEach(function (s) {
        (s.abstraction_levels || []).forEach(function (a) {
          const ek = a.entity_kind || a.id;
          if (!ek || seen[ek]) return;
          seen[ek] = true;
          out.push({ id: ek, label: a.label, kind: "card_type" });
        });
      });
      return out;
    }
    if (!fo || !Array.isArray(fo.tree)) return [];
    return fo.tree.filter(function (n) {
      return n && n.id && n.kind !== "catalog";
    });
  }

  function idFieldForCardType(cardType) {
    const map = {
      formulas: "law_id",
      phys_quant: "quantity_id",
      math_const: "quantity_id",
      construction: "construction_id"
    };
    return map[cardType] || "quantity_id";
  }

  function flattenAllQuantities(data) {
    const out = [];
    const q = data && data.physi_quant && data.physi_quant.quantities;
    if (!q) return out;
    Object.keys(q).forEach(function (t) {
      Object.keys(q[t] || {}).forEach(function (st) {
        (q[t][st] || []).forEach(function (item) {
          out.push(Object.assign({ _type: t, _status: st }, item));
        });
      });
    });
    return out;
  }

  function isMathConst(q) {
    if (!q) return false;
    if (String(q.id || "").startsWith("M")) return true;
    const t = String(q._type || "").toLowerCase();
    return t.indexOf("математич") >= 0 || t.indexOf("math") >= 0;
  }

  function entitiesForCardType(data, cardType) {
    if (cardType === "formulas") {
      return global.Projection && global.Projection.getLawsList
        ? global.Projection.getLawsList(data.formulas)
        : [];
    }
    const items = flattenAllQuantities(data);
    if (cardType === "math_const") return items.filter(isMathConst);
    return items.filter(function (q) { return !isMathConst(q); });
  }

  function domainLabel(data, id, lang) {
    const d = data.domains && data.domains.domains && data.domains.domains[id];
    if (!d) return id;
    return i18nLabel(d.name, id, lang);
  }

  function mathKindKey(item) {
    const mk = item && item.math_kind;
    if (Array.isArray(mk)) return String(mk[0] || "");
    return String(mk || "");
  }

  function invKey(v) {
    if (Array.isArray(v)) return String(v[0] || "");
    return String(v || "");
  }

  function matchCondition(item, cond) {
    if (!cond || typeof cond !== "object") return true;
    if (Array.isArray(cond.math_kind_in)) {
      if (cond.math_kind_in.indexOf(mathKindKey(item)) < 0) return false;
    }
    // category removed in physi_quant v0.12 — conditions silently fail-closed if still present
    if (Array.isArray(cond.category_in)) {
      if (cond.category_in.indexOf(String(item.category || "")) < 0) return false;
    }
    if (cond.category_contains != null && cond.category_contains !== "") {
      if (String(item.category || "").indexOf(String(cond.category_contains)) < 0) return false;
    }
    if (Array.isArray(cond.structure_ref_in)) {
      if (cond.structure_ref_in.indexOf(String(item.structure_ref || "")) < 0) return false;
    }
    return true;
  }

  function matchGroupOption(item, option) {
    const m = option && option.match;
    if (!m) return false;
    if (Array.isArray(m.any) && m.any.length) {
      return m.any.some(function (c) { return matchCondition(item, c); });
    }
    return matchCondition(item, m);
  }

  function collectCriterionValues(data, lang, criterion, pool) {
    const set = new Map();
    const collect = criterion.collect;
    if (Array.isArray(criterion.static_options)) {
      criterion.static_options.forEach(function (o) {
        set.set(String(o.value), i18nLabel(o.label, o.value, lang));
      });
    }
    if (collect === "group" && Array.isArray(criterion.options)) {
      criterion.options.forEach(function (o) {
        if ((pool || []).some(function (item) { return matchGroupOption(item, o); })) {
          set.set(String(o.value), i18nLabel(o.label, o.value, lang));
        }
      });
      return Array.from(set.entries())
        .map(function (e) { return { value: e[0], label: e[1] }; })
        .sort(function (a, b) {
          return String(a.label).localeCompare(String(b.label), lang);
        });
    }
    (pool || []).forEach(function (q) {
      if (collect === "domains") {
        const usages = data.usages && data.usages.usages && data.usages.usages[q.id];
        (usages || []).forEach(function (u) {
          (u.domains || []).forEach(function (d) {
            if (d != null && d !== "") set.set(String(d), domainLabel(data, d, lang));
          });
        });
      } else if (collect === "invariance" && q.invariance) {
        const k = invKey(q.invariance);
        if (k) set.set(k, i18nLabel(q.invariance, k, lang));
      } else if (collect === "category" && q.category) {
        set.set(String(q.category), String(q.category));
      } else if (collect === "structure_ref") {
        const ref = q.structure_ref || q.structure;
        if (ref) set.set(String(ref), String(ref));
      }
    });
    return Array.from(set.entries())
      .map(function (e) { return { value: e[0], label: e[1] }; })
      .sort(function (a, b) {
        return String(a.label).localeCompare(String(b.label), lang);
      });
  }

  function filtersForCardType(data, cardType) {
    const branch = getCardTypeBranch(data, cardType);
    if (branch && Array.isArray(branch.filters)) return branch.filters;
    return [];
  }

  function sideFiltersFor(data, subjectId, abstractionId) {
    const sub = getSubject(data, subjectId);
    if (!sub || !Array.isArray(sub.side_filters)) return [];
    return sub.side_filters.filter(function (c) {
      if (!c || !c.id) return false;
      if (!c.applies_to || !c.applies_to.length) return true;
      return c.applies_to.indexOf(abstractionId) >= 0;
    });
  }

  function sectionMatchDomains(data, subjectId, sectionId) {
    const sub = getSubject(data, subjectId);
    if (!sub || !Array.isArray(sub.sections)) return null;
    const sec = sub.sections.find(function (s) { return s && s.id === sectionId; });
    if (!sec) return null;
    return Array.isArray(sec.match_domains) ? sec.match_domains.map(String) : [String(sectionId)];
  }

  function itemDomains(data, item) {
    const usages = data.usages && data.usages.usages && data.usages.usages[item.id];
    const domains = [];
    (usages || []).forEach(function (u) {
      (u.domains || []).forEach(function (d) {
        domains.push(String(d));
      });
    });
    return domains;
  }

  /** Quantity ids bound in a law (operand roles). */
  function bindingQuantityIds(law) {
    const ids = [];
    const b = law && law.bindings;
    if (!b || typeof b !== "object") return ids;
    Object.keys(b).forEach(function (k) {
      const v = b[k];
      if (typeof v === "string" && v) ids.push(v);
      else if (v && typeof v === "object" && v.quantity) ids.push(String(v.quantity));
    });
    return ids;
  }

  /**
   * Domains of a formula = union of domains of all operand quantities' usages.
   * Section of a formula is derived from this set (not stored on the law).
   */
  function formulaDomains(data, law) {
    const set = Object.create(null);
    bindingQuantityIds(law).forEach(function (qid) {
      const usages = data.usages && data.usages.usages && data.usages.usages[qid];
      (usages || []).forEach(function (u) {
        (u.domains || []).forEach(function (d) {
          if (d != null && d !== "") set[String(d)] = true;
        });
      });
    });
    return Object.keys(set);
  }

  function formulaMatchesSection(data, law, subjectId, sectionId) {
    if (!sectionId) return true;
    const allowed = sectionMatchDomains(data, subjectId, sectionId);
    if (!allowed || !allowed.length) return true;
    const doms = formulaDomains(data, law);
    if (!doms.length) return false;
    return doms.some(function (d) {
      return allowed.indexOf(d) >= 0;
    });
  }

  /** Usage row matches active section (any domain in match_domains). */
  function usageMatchesSection(data, usage, subjectId, sectionId) {
    if (!sectionId) return true;
    const allowed = sectionMatchDomains(data, subjectId, sectionId);
    if (!allowed || !allowed.length) return true;
    const doms = (usage && usage.domains) || [];
    if (!doms.length) return false;
    return doms.some(function (d) {
      return allowed.indexOf(String(d)) >= 0;
    });
  }

  function filterValue(filters, key) {
    if (!filters) return null;
    const entry = filters[key];
    if (entry == null) return null;
    if (typeof entry === "object") return entry.value || null;
    return entry;
  }

  function matchesFilters(data, item, filters, cardType, subjectId) {
    const keys = Object.keys(filters || {});
    if (!keys.length) return true;
    const usages = data.usages && data.usages.usages && data.usages.usages[item.id];
    const side = sideFiltersFor(
      data,
      subjectId || (filters.subject && filters.subject.value),
      filters.abstraction && filters.abstraction.value
    );
    const allCriteria = side.concat(filtersForCardType(data, cardType) || []);

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (key === "subject" || key === "abstraction") continue;
      const entry = filters[key];
      const val = entry && typeof entry === "object" ? entry.value : entry;
      if (val == null || val === "") continue;
      const collect = entry && typeof entry === "object" ? entry.collect : "";
      const criterion = allCriteria.find(function (c) {
        return c && c.id === key;
      });

      if (collect === "group" || (criterion && criterion.collect === "group")) {
        const opt =
          criterion && Array.isArray(criterion.options)
            ? criterion.options.find(function (o) {
                return String(o.value) === String(val);
              })
            : null;
        if (opt && !matchGroupOption(item, opt)) return false;
        continue;
      }
      if (key === "section") {
        const subj = subjectId || filterValue(filters, "subject");
        // Formula: section from operand quantities' domains
        if (cardType === "formulas" || item.bindings || item.law_id || item.structure_ref) {
          if (!formulaMatchesSection(data, item, subj, val)) return false;
        } else {
          const allowed = sectionMatchDomains(data, subj, val);
          if (allowed && allowed.length) {
            const doms = itemDomains(data, item);
            if (!doms.some(function (d) { return allowed.indexOf(d) >= 0; })) return false;
          }
        }
      } else if (key === "domain" || collect === "domains") {
        const domains = itemDomains(data, item);
        if (domains.indexOf(String(val)) < 0) return false;
      } else if (key === "invariance" || collect === "invariance") {
        if (invKey(item.invariance) !== String(val)) return false;
      } else if (key === "category" || collect === "category") {
        if (String(item.category || "") !== val) return false;
      } else if (key === "structure" || collect === "structure_ref") {
        if (String(item.structure_ref || item.structure || "") !== val) return false;
      } else if (key === "unit_sys" || collect === "unit_sys") {
        // v0.4: system choice (SI / CGS / natural). Non-SI systems have no full
        // coverage yet — keep all items visible; filter tightens when data exists.
        if (val === "SI_named" || val === "SI_comp") {
          const dim = item.dimension;
          const named = data.units && data.units.named && data.units.named[dim];
          const hasNamed = Array.isArray(named) && named.length > 0;
          if (val === "SI_named" && !hasNamed) return false;
          if (val === "SI_comp" && hasNamed) return false;
        }
        // SI / CGS / natural: no hard exclude until unit graphs per system exist
      }
    }
    return true;
  }

  function handlers(data) {
    data = data || {};

    return {
      /** Subjects for top strip (physics | mathematics). */
      subjects: function (ctx) {
        const lang = (ctx && ctx.lang) || "ru";
        const nodes = subjectNodes(data);
        if (nodes.length) {
          return nodes.map(function (s) {
            return { id: s.id, label: i18nLabel(s.label, s.id, lang) };
          });
        }
        // legacy fallback: single implicit physics
        return [{ id: "physics", label: lang === "ru" ? "Физика" : "Physics" }];
      },

      /**
       * Abstraction levels for current subject → drive entity_kind (card_type).
       * Platform maps selected abstraction.id → entity_kind for list/passport.
       */
      abstraction_levels: function (ctx) {
        const lang = (ctx && ctx.lang) || "ru";
        const subjectId = (ctx && ctx.subject) || "physics";
        const levels = abstractionLevels(data, subjectId);
        if (levels.length) {
          return levels.map(function (a) {
            return {
              id: a.id,
              label: i18nLabel(a.label, a.id, lang),
              entity_kind: a.entity_kind || a.id
            };
          });
        }
        // legacy: old tree card types
        return cardTypeNodes(data).map(function (node) {
          return { id: node.id, label: i18nLabel(node.label, node.id, lang), entity_kind: node.id };
        });
      },

      /** @deprecated use abstraction_levels; kept for older platform builds */
      card_types: function (ctx) {
        const lang = (ctx && ctx.lang) || "ru";
        const subjectId = (ctx && ctx.subject) || "physics";
        const levels = abstractionLevels(data, subjectId);
        if (levels.length) {
          return levels.map(function (a) {
            return {
              id: a.entity_kind || a.id,
              label: i18nLabel(a.label, a.id, lang),
              abstraction: a.id
            };
          });
        }
        return cardTypeNodes(data).map(function (node) {
          return { id: node.id, label: i18nLabel(node.label, node.id, lang) };
        });
      },

      id_field: function (cardType) {
        return idFieldForCardType(cardType);
      },

      list_title: function (ctx) {
        const lang = (ctx && ctx.lang) || "ru";
        const subjectId = (ctx && ctx.subject) || "physics";
        const abstractionId = ctx && ctx.abstraction;
        const levels = abstractionLevels(data, subjectId);
        if (levels.length && abstractionId) {
          const hit = levels.find(function (a) { return a.id === abstractionId; });
          if (hit) return i18nLabel(hit.label, abstractionId, lang);
        }
        const cardType = ctx && ctx.cardType;
        const branch = getCardTypeBranch(data, cardType);
        return branch ? i18nLabel(branch.label, cardType || "", lang) : cardType || "";
      },

      /**
       * Full schema for platform split top/side.
       * Top: subject, unit_sys (if physics), section.
       * Side: abstraction + side_filters for subject×abstraction.
       */
      filter_schema: function (ctx) {
        const lang = (ctx && ctx.lang) || "ru";
        const subjectId = (ctx && ctx.subject) || "physics";
        const abstractionId = (ctx && ctx.abstraction) || "element";
        const cardType =
          (ctx && ctx.cardType) ||
          entityKindForAbstraction(data, subjectId, abstractionId) ||
          "phys_quant";
        const sub = getSubject(data, subjectId);
        const out = [];

        // —— top: subject ——
        out.push({
          id: "subject",
          label: lang === "ru" ? "Предмет" : "Subject",
          collect: "subject",
          placement: "top",
          options: subjectNodes(data).map(function (s) {
            return { value: s.id, label: i18nLabel(s.label, s.id, lang) };
          })
        });

        // —— top: unit_sys (only physics with non-empty unit_systems) ——
        if (sub && Array.isArray(sub.unit_systems) && sub.unit_systems.length) {
          out.push({
            id: "unit_sys",
            label: lang === "ru" ? "Система единиц" : "Unit system",
            collect: "unit_sys",
            placement: "top",
            options: sub.unit_systems.map(function (u) {
              return {
                value: u.value,
                label: i18nLabel(u.label, u.value, lang)
              };
            })
          });
        }

        // —— top: section ——
        if (sub && Array.isArray(sub.sections) && sub.sections.length) {
          out.push({
            id: "section",
            label: lang === "ru" ? "Раздел" : "Section",
            collect: "section",
            placement: "top",
            options: sub.sections.map(function (s) {
              return {
                value: s.id,
                label: i18nLabel(s.label, s.id, lang)
              };
            })
          });
        }

        // —— side: abstraction ——
        const levels = abstractionLevels(data, subjectId);
        if (levels.length) {
          out.push({
            id: "abstraction",
            label: lang === "ru" ? "Уровень" : "Abstraction",
            collect: "abstraction",
            placement: "side",
            options: levels.map(function (a) {
              return {
                value: a.id,
                label: i18nLabel(a.label, a.id, lang),
                entity_kind: a.entity_kind || a.id
              };
            })
          });
        }

        // —— side: remaining criteria ——
        const pool = entitiesForCardType(data, cardType);
        sideFiltersFor(data, subjectId, abstractionId).forEach(function (c) {
          out.push({
            id: c.id,
            label: i18nLabel(c.label, c.id, lang),
            collect: c.collect || "",
            placement: "side",
            options: collectCriterionValues(data, lang, c, pool)
          });
        });

        // legacy tree filters if no subjects
        if (!sub) {
          filtersForCardType(data, cardType)
            .filter(function (c) { return c && c.id; })
            .forEach(function (c) {
              out.push({
                id: c.id,
                label: i18nLabel(c.label, c.id, lang),
                collect: c.collect || "",
                options: collectCriterionValues(data, lang, c, pool)
              });
            });
        }

        return out;
      },

      list_items: function (ctx) {
        const lang = (ctx && ctx.lang) || "ru";
        const subjectId = (ctx && ctx.subject) || "physics";
        const abstractionId = (ctx && ctx.abstraction) || null;
        const cardType =
          (ctx && ctx.cardType) ||
          (abstractionId
            ? entityKindForAbstraction(data, subjectId, abstractionId)
            : null) ||
          "phys_quant";
        const filters = (ctx && ctx.filters) || {};
        const q = String((ctx && ctx.search) || "").trim().toLowerCase();
        const symbolMode = !!(ctx && ctx.symbolMode);

        // construction has no data yet
        if (cardType === "construction") {
          return [];
        }

        let rows = entitiesForCardType(data, cardType).filter(function (item) {
          return matchesFilters(data, item, filters, cardType, subjectId);
        });

        if (q) {
          rows = rows.filter(function (item) {
            if (cardType === "formulas") {
              return [item.law_id || item.id, item.name, item.description, item.structure_ref]
                .join(" ")
                .toLowerCase()
                .indexOf(q) >= 0;
            }
            const usages = data.usages && data.usages.usages && data.usages.usages[item.id];
            let blob = [
              item.id,
              item.notes,
              item.dimension,
              mathKindKey(item),
              Array.isArray(item.math_kind) ? item.math_kind.join(" ") : "",
              invKey(item.invariance),
              Array.isArray(item.invariance) ? item.invariance.join(" ") : item.invariance
            ]
              .join(" ")
              .toLowerCase();
            (usages || []).forEach(function (u) {
              blob +=
                " " +
                (u.symbol || "") +
                " " +
                (Array.isArray(u.name) ? u.name.join(" ") : "");
            });
            if (symbolMode) {
              return (usages || []).some(function (u) {
                return String(u.symbol || "").toLowerCase().indexOf(q) >= 0;
              });
            }
            return blob.indexOf(q) >= 0;
          });
        }

        const sectionId = filterValue(filters, "section");

        return rows.map(function (item) {
          const id = cardType === "formulas" ? item.law_id || item.id : item.id;
          let html = null;
          if (global.FisPresentation && global.FisPresentation.renderListItem) {
            if (cardType === "formulas") {
              html = global.FisPresentation.renderListItem(data, "formulas", {
                law: item,
                lang: lang,
                domains: formulaDomains(data, item),
                subject: subjectId,
                section: sectionId
              });
            } else {
              let usages =
                (data.usages && data.usages.usages && data.usages.usages[item.id]) || [];
              // Prefer symbols/names whose domains match active section
              if (sectionId) {
                const matched = usages.filter(function (u) {
                  return usageMatchesSection(data, u, subjectId, sectionId);
                });
                if (matched.length) usages = matched;
              }
              html = global.FisPresentation.renderListItem(data, cardType, {
                quantity: item,
                usages: usages,
                lang: lang,
                subject: subjectId,
                section: sectionId
              });
            }
          }
          if (!html) {
            if (cardType === "formulas") {
              html =
                '<span class="pres-title">' +
                String(item.name || item.law_id || item.id || "—") +
                "</span>";
            } else {
              const usages =
                (data.usages && data.usages.usages && data.usages.usages[item.id]) || [];
              let pick = usages[0];
              if (sectionId) {
                pick =
                  usages.find(function (u) {
                    return usageMatchesSection(data, u, subjectId, sectionId);
                  }) || pick;
              }
              const label = pick
                ? String(pick.symbol || "") +
                  (pick.name
                    ? " · " +
                      (Array.isArray(pick.name)
                        ? lang === "ru"
                          ? pick.name[1] || pick.name[0]
                          : pick.name[0]
                        : pick.name)
                    : "")
                : item.id;
              html = '<span class="pres-title">' + String(label || "—") + "</span>";
            }
          }
          return { id: id, html: html };
        });
      },

      render_passport: function (ctx) {
        const container = ctx && ctx.container;
        if (!container) return;
        if (!global.Projection) {
          container.innerHTML = '<div class="empty">Projection missing</div>';
          return;
        }
        const lang = (ctx && ctx.lang) || "ru";
        const cardType = ctx && ctx.cardType;
        const state = (ctx && ctx.state) || {};
        try {
          if (cardType === "formulas") {
            if (!state.law_id) {
              container.innerHTML =
                '<div class="empty">' +
                (lang === "ru" ? "Выберите элемент списка" : "Select a list item") +
                "</div>";
              return;
            }
            global.Projection.render(container, {
              data: data,
              projection: {
                kind: "formula_stub",
                lang: lang,
                options: { mulStyle: "implicit", divStyle: "bar" }
              },
              state: Object.assign({}, state, {
                law_id: state.law_id,
                card_type: cardType,
                filters: state.filters || ctx.filters || {},
                subject: state.subject || ctx.subject
              })
            });
            return;
          }
          if (!state.quantity_id) {
            container.innerHTML =
              '<div class="empty">' +
              (lang === "ru" ? "Выберите элемент списка" : "Select a list item") +
              "</div>";
            return;
          }
          global.Projection.render(container, {
            data: data,
            projection: { kind: "quantity_passport", lang: lang },
            state: Object.assign({}, state, {
              quantity_id: state.quantity_id,
              card_type: cardType,
              filters: state.filters || ctx.filters || {},
              subject: state.subject || ctx.subject
            })
          });
        } catch (err) {
          container.innerHTML =
            '<div class="empty" style="color:var(--danger);text-align:left">' +
            "<strong>Render error</strong><br/><code>" +
            String((err && err.message) || err) +
            "</code></div>";
          console.error(err);
        }
      },

      resolve_slot_action: function (target) {
        if (
          global.FisPresentation &&
          typeof global.FisPresentation.resolveSlotAction === "function"
        ) {
          return global.FisPresentation.resolveSlotAction(target);
        }
        return null;
      },

      summarize: function () {
        const keys = [
          "physi_quant",
          "usages",
          "units",
          "domains",
          "formulas",
          "structures",
          "filter_ontology",
          "presentation_ontology",
          "card_manifests",
          "math_ops"
        ].filter(function (k) {
          return !!data[k];
        });
        const nQ = flattenAllQuantities(data).length;
        const nU =
          data.usages && data.usages.usages
            ? Object.keys(data.usages.usages).length
            : 0;
        const nF =
          global.Projection && global.Projection.getLawsList
            ? global.Projection.getLawsList(data.formulas).length
            : 0;
        return { keys: keys, nQ: nQ, nU: nU, nF: nF };
      }
    };
  }

  global.FisPackage = {
    /** Signal types this package may handle (platform registry is authoritative). */
    supportedSignals: [
      "card_type_change",
      "filter_change",
      "search_change",
      "list_select",
      "slot_action"
    ],
    ingestFile: ingestFile,
    handlers: handlers,
    idFieldForCardType: idFieldForCardType
  };
})(typeof window !== "undefined" ? window : globalThis);
