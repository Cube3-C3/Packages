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
    else if (
      name.indexOf("construct") >= 0 ||
      (json.constructions && Array.isArray(json.constructions))
    ) {
      pack.constructs = json;
    } else if (
      name.indexOf("physi_comp") >= 0 ||
      name.indexOf("comps") >= 0 ||
      (json.components && typeof json.components === "object" && !json.constructions)
    ) {
      pack.components = json;
    } else if (name.indexOf("relation") >= 0 || (json.types && name.indexOf("relation") >= 0)) {
      pack.relation_types = json;
    } else if (name.indexOf("line_type") >= 0) {
      pack.line_types = json;
    } else if (
      name.indexOf("registry") >= 0 ||
      (json.assets && typeof json.assets === "object")
    ) {
      pack.assets = json;
    }

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

  function getConstructionsList(data) {
    const c = data && data.constructs;
    if (!c) return [];
    if (Array.isArray(c)) return c;
    if (Array.isArray(c.constructions)) return c.constructions;
    return [];
  }

  function entitiesForCardType(data, cardType) {
    if (cardType === "formulas") {
      return global.Projection && global.Projection.getLawsList
        ? global.Projection.getLawsList(data.formulas)
        : [];
    }
    if (cardType === "construction") {
      return getConstructionsList(data);
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

        let rows = entitiesForCardType(data, cardType).filter(function (item) {
          if (cardType === "construction") return true;
          return matchesFilters(data, item, filters, cardType, subjectId);
        });

        if (q) {
          rows = rows.filter(function (item) {
            if (cardType === "construction") {
              const nm = Array.isArray(item.name) ? item.name.join(" ") : item.name;
              return [item.id, nm, item.description]
                .join(" ")
                .toLowerCase()
                .indexOf(q) >= 0;
            }
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
          const id =
            cardType === "formulas"
              ? item.law_id || item.id
              : item.id;
          let html = null;
          if (cardType === "construction") {
            const nm = Array.isArray(item.name)
              ? lang === "ru"
                ? item.name[1] || item.name[0]
                : item.name[0] || item.name[1]
              : item.name || item.id;
            html =
              '<span class="pres-symbol">' +
              String(item.id || "") +
              '</span> <span class="pres-title">' +
              String(nm || "—") +
              "</span>";
            return { id: id, html: html };
          }
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
          if (cardType === "construction") {
            if (!state.construction_id) {
              container.innerHTML =
                '<div class="empty">' +
                (lang === "ru" ? "Выберите конструкцию" : "Select a construction") +
                "</div>";
              return;
            }
            global.Projection.render(container, {
              data: data,
              projection: { kind: "construction_passport", lang: lang },
              state: Object.assign({}, state, {
                construction_id: state.construction_id,
                card_type: cardType,
                filters: state.filters || ctx.filters || {},
                subject: state.subject || ctx.subject
              })
            });
            return;
          }
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
          "math_ops",
          "constructs",
          "components",
          "relation_types",
          "line_types",
          "assets"
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
        const nC = getConstructionsList(data).length;
        return { keys: keys, nQ: nQ, nU: nU, nF: nF, nC: nC };
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
