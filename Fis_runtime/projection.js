/**
 * projection.js — UI Projection: паспорта величин и формул.
 * Host: window.Projection
 * Depends: FisUnits, FisPresentation (optional for slots/nav)
 *
 * Бывший второй блок code.js.
 */
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

  /**
   * Pick ontology section id for a set of domains under subject.
   * Prefer preferredSection if it still matches; else first matching section.
   */
  function sectionForDomains(data, subjectId, domains, preferredSection) {
    const fo = data && data.filter_ontology;
    if (!fo || !Array.isArray(fo.subjects) || !domains || !domains.length) {
      return preferredSection || null;
    }
    const sub =
      fo.subjects.find(function (s) {
        return s && s.id === (subjectId || "physics");
      }) || fo.subjects[0];
    if (!sub || !Array.isArray(sub.sections)) return preferredSection || null;
    const domSet = domains.map(String);
    function sectionHits(sec) {
      const md = Array.isArray(sec.match_domains) ? sec.match_domains.map(String) : [String(sec.id)];
      return domSet.some(function (d) {
        return md.indexOf(d) >= 0;
      });
    }
    if (preferredSection) {
      const pref = sub.sections.find(function (s) {
        return s && s.id === preferredSection;
      });
      if (pref && sectionHits(pref)) return preferredSection;
    }
    for (let i = 0; i < sub.sections.length; i++) {
      if (sectionHits(sub.sections[i])) return sub.sections[i].id;
    }
    return preferredSection || null;
  }

  function domainsForQuantity(data, qid) {
    const usages = data.usages && data.usages.usages && data.usages.usages[qid];
    const set = Object.create(null);
    (usages || []).forEach(function (u) {
      (u.domains || []).forEach(function (d) {
        if (d != null && d !== "") set[String(d)] = true;
      });
    });
    return Object.keys(set);
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
   * Каноническая единица для заголовка (СИ, язык):
   * formatUnit(dim) → named или composed с делением (m/s, м³/(кг·с²)), не value_unit.
   * value_unit — устаревшая латинская строка со степенями; не используем в UI.
   */
  function primaryUnitSymbol(dim, unitsData, lang, quantity) {
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
    return composeUnitSymbol(dim, unitsData, lang);
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
  function instantiateLaw(law, structuresData, usagesData) {
    return window.FisUnits
      ? window.FisUnits.instantiateLaw(law, structuresData, usagesData)
      : null;
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


  function formulasUsing(formulasData, qid, structuresData, usagesData) {
    if (window.FisUnits && window.FisUnits.formulasUsing) {
      return window.FisUnits.formulasUsing(
        formulasData,
        qid,
        structuresData,
        usagesData
      );
    }
    return [];
  }

  /** SI unit symbol for quantity id via units.json (FisUnits.formatUnit). */
  function unitSymbolForQid(qid, data, lang) {
    if (!qid || !data) return "";
    const flat = flattenQuantities(data.physi_quant);
    const q = flat.find(function (x) {
      return x.id === qid;
    });
    if (!q || !q.dimension) return "";
    if (window.FisUnits && typeof window.FisUnits.formatUnit === "function") {
      try {
        const r = window.FisUnits.formatUnit(
          q.dimension,
          data.units,
          lang || "ru"
        );
        return (r && r.symbol) || "";
      } catch (e) {
        return "";
      }
    }
    return "";
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
      },
      construction_passport: {
        id: "construction_passport",
        label: ["Construction passport", "Паспорт конструкции"],
        entity_kinds: ["construction"],
        slots: ["construction_header", "construction_env", "construction_formulas"]
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
        // Число без единицы: единица — unit_symbol (СИ, lang, деление) синим, как у величин
        derived.const_value = formatConstValue(q.value);
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
        let related = formulasUsing(
          data.formulas,
          qid,
          data.structures,
          data.usages
        );
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
      const inst = ctx.inst || (law ? instantiateLaw(law, data.structures, data.usages) : null);
      if (inst && inst.ast) {
        // Пакет решает семантику клика по символу: navigate → паспорт величины.
        // Ядро (astToDisplay / emitSym) только вызывает wrapSym, если его передали.
        const wrapSym = function (qid, body) {
          if (!qid || !window.FisPresentation || typeof window.FisPresentation.slotActionAttrs !== "function") {
            return body;
          }
          const cardType = String(qid).charAt(0) === "M" ? "math_const" : "phys_quant";
          const qDomains = domainsForQuantity(data, qid);
          // Role context: quantity in this formula → section from its domains
          // (prefer current section if still valid for this operand)
          const navSection = sectionForDomains(
            data,
            subjectId,
            qDomains,
            sectionId
          );
          const hint =
            (lang || "ru") === "ru"
              ? "Открыть паспорт величины"
              : "Open quantity passport";
          const action = window.FisPresentation.slotActionAttrs(
            "navigate",
            {
              cardType: cardType,
              id: qid,
              abstraction: "element",
              subject: subjectId,
              section: navSection
            },
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

  /**
   * Minimal construction passport: title + env SVG (layout in package) + related formulas.
   * No rotation / interactive chrome — host viewport is the environment frame.
   */
  function renderConstructionPassport(container, projection, state, data) {
    const lang = (projection && projection.lang) || "ru";
    const cid = state && state.construction_id;
    if (!cid) {
      container.innerHTML = `<div class="empty">${lang === "ru" ? "Укажите construction_id" : "Set construction_id"}</div>`;
      return;
    }
    const list =
      (data.constructs && data.constructs.constructions) ||
      (Array.isArray(data.constructs) ? data.constructs : []);
    const C = list.find(function (c) {
      return c && c.id === cid;
    });
    if (!C) {
      container.innerHTML =
        `<div class="empty">Конструкция <code>${escapeHtml(cid)}</code> не найдена</div>`;
      return;
    }

    const title = Array.isArray(C.name)
      ? lang === "ru"
        ? C.name[1] || C.name[0]
        : C.name[0] || C.name[1]
      : C.name || C.id;

    // layout + symbols entirely in package runtime
    let layoutModel = null;
    let svgHtml = "";
    if (window.ConstructLayout && typeof window.ConstructLayout.layout === "function") {
      const pack = {
        components: data.components,
        assets: data.assets,
        relation_types: data.relation_types,
        line_types: data.line_types,
        usages: data.usages
      };
      layoutModel = window.ConstructLayout.layout(C, pack);
      if (layoutModel && typeof window.ConstructLayout.toSVG === "function") {
        svgHtml = window.ConstructLayout.toSVG(layoutModel, {
          pad: 16,
          showLabels: true
        });
      }
    }

    // formulas that mention any quantity used on elements / env
    const qids = Object.create(null);
    if (layoutModel && layoutModel.g && layoutModel.g.quantity) {
      qids[layoutModel.g.quantity] = true;
    }
    (C.elements || []).forEach(function (el) {
      const qs = el.quantities || {};
      Object.keys(qs).forEach(function (k) {
        if (qs[k] && qs[k].quantity) qids[qs[k].quantity] = true;
      });
    });
    const related = [];
    const seenLaw = Object.create(null);
    Object.keys(qids).forEach(function (qid) {
      const using =
        formulasUsing(data.formulas, qid, data.structures, data.usages) || [];
      using.forEach(function (f) {
        const id = f.id || f.law_id;
        if (!id || seenLaw[id]) return;
        seenLaw[id] = true;
        related.push(f);
      });
    });

    // quantity chips — unit symbol from units.json via formatUnit(dimension)
    let qtyRows = "";
    if (layoutModel && layoutModel.nodes) {
      layoutModel.nodes.forEach(function (n) {
        const qs = n.quantities || {};
        const keys = Object.keys(qs);
        if (!keys.length) return;
        const parts = keys.map(function (k) {
          const q = qs[k];
          const sym = q.symbol || k;
          const v = q.value != null ? q.value : "—";
          const u = unitSymbolForQid(q.quantity, data, lang) || q.unit || "";
          return (
            `<code>${escapeHtml(sym)}</code>=${escapeHtml(String(v))}` +
            (u ? ` <span class="pres-muted">${escapeHtml(u)}</span>` : "") +
            ` <span class="pres-muted">(${escapeHtml(q.quantity || "")})</span>`
          );
        });
        qtyRows +=
          `<div style="margin:4px 0;font-size:0.82rem"><strong>${escapeHtml(n.id)}</strong> · ${parts.join(", ")}</div>`;
      });
    }
    if (layoutModel && layoutModel.g) {
      const g = layoutModel.g;
      const gu =
        unitSymbolForQid(g.quantity || "Q006", data, lang) || g.unit || "";
      qtyRows =
        `<div style="margin:4px 0;font-size:0.82rem"><strong>E0</strong> · <code>${escapeHtml(g.symbol || "g")}</code>=${escapeHtml(String(g.value))} <span class="pres-muted">${escapeHtml(gu)}</span> <span class="pres-muted">(${escapeHtml(g.quantity || "Q006")})</span></div>` +
        qtyRows;
    }

    let formulasHtml = "";
    if (related.length) {
      formulasHtml = '<ul class="formulas-list">';
      related.slice(0, 12).forEach(function (f) {
        const fid = f.id || f.law_id || "";
        const fname = f.name || fid;
        let algebra = "";
        if (f.ast && window.FisUnits && window.FisUnits.formatFormula) {
          try {
            const disp = window.FisUnits.formatFormula(f.ast, {
              usagesData: data.usages,
              physiQuant: data.physi_quant
            }, { mulStyle: "implicit", divStyle: "bar" });
            algebra = disp && disp.html ? disp.html : "";
          } catch (e) { /* skip */ }
        }
        const navPayload = JSON.stringify({
          cardType: "formulas",
          id: fid,
          abstraction: "law"
        }).replace(/"/g, "&quot;");
        formulasHtml +=
          `<li class="clickable" data-fis-slot-action="navigate" data-fis-payload="${navPayload}" tabindex="0" role="button">` +
          `<span class="fname">${escapeHtml(fname)}</span>` +
          (algebra ? `<div class="algebra">${algebra}</div>` : "") +
          `</li>`;
      });
      formulasHtml += "</ul>";
    } else {
      formulasHtml =
        `<div class="pres-muted" style="font-size:0.85rem">${lang === "ru" ? "Нет связанных формул по величинам конструкции" : "No related formulas"}</div>`;
    }

    container.innerHTML =
      `<div class="passport" data-projection="construction_passport" data-construction="${escapeHtml(cid)}">` +
      `<div class="passport-header">` +
      `<span class="pres-symbol primary">${escapeHtml(C.id)}</span> ` +
      `<span class="pres-title primary">${escapeHtml(title)}</span>` +
      `</div>` +
      (C.description
        ? `<p class="pres-muted" style="margin:6px 0 12px;font-size:0.85rem">${escapeHtml(C.description)}</p>`
        : "") +
      `<div class="section"><h3 style="font-size:0.8rem;color:var(--muted);margin:0 0 8px">${lang === "ru" ? "Среда" : "Environment"} · ${escapeHtml(C.environment || "E0")}</h3>` +
      `<div class="construction-env" style="background:#f4f4f5;border-radius:8px;padding:8px;min-height:120px">${svgHtml || '<div class="empty">ConstructLayout missing</div>'}</div>` +
      (qtyRows ? `<div style="margin-top:10px">${qtyRows}</div>` : "") +
      `</div>` +
      `<div class="section" style="margin-top:16px"><h3 style="font-size:0.8rem;color:var(--muted);margin:0 0 8px">${lang === "ru" ? "Формулы" : "Formulas"}</h3>${formulasHtml}</div>` +
      `</div>`;
  }

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
    const inst = instantiateLaw(law, data.structures, data.usages);
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
        } else if (kind === "construction_passport") {
          renderConstructionPassport(container, projection, state, data);
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

