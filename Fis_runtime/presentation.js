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
      const def = fieldDef(ontology, part.field);
      const looksHtml =
        typeof val === "string" &&
        (val.indexOf("<span") >= 0 || val.indexOf("<sup") >= 0);
      bits.push(renderAtom(ontology, part.style || "title", val, {
        variant: part.variant,
        wrap: part.wrap,
        className: part.class || "",
        rawHtml: !!(part.rawHtml || (def && def.rawHtml) || looksHtml)
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

  function renderFormulasList(data, ctx, compose) {
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
        // Quantity → formula: abstraction → law; section from formula operand domains
        function fv(filters, key) {
          if (!filters) return null;
          const e = filters[key];
          if (e == null) return null;
          return typeof e === "object" ? e.value || null : e;
        }
        const subj =
          ctx.subject || fv(ctx.filters, "subject") || "physics";
        const prefSec = ctx.section || fv(ctx.filters, "section") || null;
        let resolvedSection = prefSec;
        const fo = data && data.filter_ontology;
        if (it.domains && it.domains.length && fo) {
          const sub =
            (fo.subjects || []).find(function (s) {
              return s && s.id === subj;
            }) || (fo.subjects || [])[0];
          if (sub && Array.isArray(sub.sections)) {
            const domSet = it.domains.map(String);
            function hits(sec) {
              return (sec.match_domains || [sec.id]).some(function (d) {
                return domSet.indexOf(String(d)) >= 0;
              });
            }
            const pref = prefSec
              ? sub.sections.find(function (s) {
                  return s.id === prefSec && hits(s);
                })
              : null;
            if (pref) {
              resolvedSection = prefSec;
            } else {
              const hit = sub.sections.find(hits);
              if (hit) resolvedSection = hit.id;
            }
          }
        }
        const action = slotActionAttrs(
          "navigate",
          {
            cardType: "formulas",
            id: it.law_id,
            abstraction: "law",
            subject: subj,
            section: resolvedSection
          },
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

    // Размерность [1] (физ. и мат.): строку СИ не показываем.
    // Также не показываем пустую «СИ: » / дубль, если нет unit_name.
    if (slotId === "unit_line") {
      const q = (ctx && (ctx.quantity || ctx.q)) || null;
      const dim =
        (q && q.dimension) ||
        (ctx && ctx.derived && ctx.derived.dimension) ||
        null;
      if (dim === "[1]") return "";
      const un = ctx && ctx.derived && ctx.derived.unit_name;
      if (un == null || String(un).trim() === "") return "";
    }

    if (mode === "usages_table") return renderUsagesTable(ctx, compose);
    if (mode === "formulas_list") return renderFormulasList(data, ctx, compose);

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


