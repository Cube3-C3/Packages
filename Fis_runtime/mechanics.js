/**
 * mechanics.js — атомарная механика связности величин.
 *
 * Не вычисляет физику и не рисует. Проверяет и нормализует:
 *   operator -> arity -> operand/value occurrences -> indexes.
 *
 * Индексы являются адресами, а не отдельными величинами:
 *   event       — состояние/переход;
 *   membership  — принадлежность конструкции;
 *   coordinate  — компонент/ось.
 */
(function (global) {
  "use strict";

  function clone(v) {
    if (Array.isArray(v)) return v.map(clone);
    if (v && typeof v === "object") {
      const out = {};
      Object.keys(v).forEach((k) => { out[k] = clone(v[k]); });
      return out;
    }
    return v;
  }

  function fail(code, message, extra) {
    return Object.assign({ ok: false, error: code, message: message }, extra || {});
  }

  function ok(value, extra) {
    return Object.assign({ ok: true, value: value }, extra || {});
  }

  function normalizeArity(spec, fallback) {
    if (spec == null) return fallback == null ? null : fallback;
    if (typeof spec === "number") return { kind: "fixed", value: spec };
    if (typeof spec === "string") return { kind: spec };
    if (typeof spec === "object") return clone(spec);
    return null;
  }

  function validateIndex(index) {
    if (!index || typeof index !== "object" || Array.isArray(index)) return fail("INDEX_TYPE", "Index must be an object.");
    const kind = String(index.kind || "");
    if (!["event", "membership", "coordinate"].includes(kind)) {
      return fail("INDEX_KIND", "Unknown index kind: " + kind);
    }

    if (kind === "event" && !index.event_id) {
      return fail("INDEX_EVENT_ID", "event index requires event_id.");
    }

    if (kind === "membership" && !index.construction_id) {
      return fail("INDEX_CONSTRUCTION_ID", "membership index requires construction_id.");
    }

    if (kind === "coordinate" && index.axis == null) {
      return fail("INDEX_AXIS", "coordinate index requires axis.");
    }
    if (kind === "coordinate" && !index.frame_id) {
      return fail("INDEX_FRAME", "coordinate index requires frame_id.");
    }

    return ok(clone(index));
  }

  function normalizeIndexes(indexes) {
    if (indexes == null) return ok([]);
    const list = Array.isArray(indexes) ? indexes : [indexes];
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const r = validateIndex(list[i]);
      if (!r.ok) return r;
      if (out.some((index) => index.kind === r.value.kind)) {
        return fail("INDEX_DUPLICATE", "Only one index of each kind is allowed.");
      }
      out.push(r.value);
    }
    return ok(out);
  }

  function vectorArity(value) {
    if (!Array.isArray(value)) return null;
    return {
      kind: "vector",
      value: value.length,
      component_indexes: value.map((_, i) => ({
        kind: "coordinate",
        axis: i
      }))
    };
  }

  function resolveOperator(mechanicsData, operatorId) {
    const op = mechanicsData && mechanicsData.operators &&
      mechanicsData.operators[operatorId];
    if (!op) return fail("UNKNOWN_OPERATOR", "Unknown operator: " + operatorId);
    return ok(op, { operator_id: operatorId });
  }

  function validateApplication(mechanicsData, application) {
    if (!application || typeof application !== "object") {
      return fail("APPLICATION_TYPE", "Operator application must be an object.");
    }

    const opResult = resolveOperator(mechanicsData, application.operator);
    if (!opResult.ok) return opResult;

    const op = opResult.value;
    const operands = Array.isArray(application.operands)
      ? application.operands
      : (application.operand != null ? [application.operand] : []);

    const expected = op.arity;
    if (typeof expected === "number" && operands.length !== expected) {
      return fail(
        "ARITY_MISMATCH",
        application.operator + ": expected " + expected + " operands, got " + operands.length
      );
    }

    const indexResult = normalizeIndexes(application.indexes);
    if (!indexResult.ok) return indexResult;

    const indexes = indexResult.value;
    const requiredIndexes = Array.isArray(op.required_indexes)
      ? op.required_indexes
      : [];
    for (let i = 0; i < requiredIndexes.length; i++) {
      if (!indexes.some((index) => index && index.kind === requiredIndexes[i])) {
        return fail(
          "INDEX_REQUIRED",
          application.operator + ": required index kind is missing: " + requiredIndexes[i]
        );
      }
    }

    const out = {
      operator: application.operator,
      arity: operands.length,
      operands: clone(operands),
      indexes: indexes
    };

    if (application.result != null) out.result = clone(application.result);
    return ok(out);
  }

  function makeOccurrence(spec) {
    spec = spec || {};
    if (!spec.quantity_id) {
      return fail("QUANTITY_ID", "Occurrence requires quantity_id.");
    }

    const indexResult = normalizeIndexes(spec.indexes);
    if (!indexResult.ok) return indexResult;

    let arity = spec.arity != null ? normalizeArity(spec.arity) : null;
    if (spec.value && Array.isArray(spec.value)) {
      arity = vectorArity(spec.value);
    }

    return ok({
      quantity_id: String(spec.quantity_id),
      role: spec.role != null ? String(spec.role) : null,
      arity: arity,
      operator: spec.operator || null,
      indexes: indexResult.value,
      ...(Object.prototype.hasOwnProperty.call(spec, "value") ? { value: clone(spec.value) } : {}),
      ...(spec.frame_id != null ? { frame_id: String(spec.frame_id) } : {}),
      ...(spec.application_point != null ? { application_point: clone(spec.application_point) } : {}),
      ...(spec.provenance != null ? { provenance: clone(spec.provenance) } : {})
    });
  }

  /**
   * Bind an occurrence to a construction without changing the quantity id.
   * This is the important bridge from "what quantity" to "where it occurs".
   */
  function bindMembership(occurrence, membership) {
    const base = makeOccurrence(occurrence);
    if (!base.ok) return base;

    const indexResult = normalizeIndexes([
      ...(base.value.indexes || []),
      Object.assign({ kind: "membership" }, membership || {})
    ]);
    if (!indexResult.ok) return indexResult;

    base.value.indexes = indexResult.value;
    return base;
  }

  /**
   * Build the connectivity record used later by formula matching.
   * It intentionally keeps law and construction separate:
   * the same quantity may occur in several constructions.
   */
  function linkQuantityToLawAndConstruction(spec) {
    spec = spec || {};
    if (!spec.quantity_id) return fail("QUANTITY_ID", "quantity_id is required.");
    if (!spec.construction_id) return fail("CONSTRUCTION_ID", "construction_id is required.");

    const indexes = [];
    const i1 = normalizeIndexes(spec.indexes || []);
    if (!i1.ok) return i1;
    indexes.push(...i1.value);

    const membership = {
      kind: "membership",
      construction_id: String(spec.construction_id)
    };
    ["element_id", "relation_id", "port", "role"].forEach((k) => {
      if (spec[k] != null) membership[k] = spec[k];
    });
    const i2 = validateIndex(membership);
    if (!i2.ok) return i2;
    indexes.push(i2.value);

    if (spec.event_id) {
      const e = validateIndex({
        kind: "event",
        event_id: spec.event_id,
        role: spec.event_role,
        phase: spec.phase
      });
      if (!e.ok) return e;
      indexes.push(e.value);
    }

    if (spec.axis != null) {
      const c = validateIndex({
        kind: "coordinate",
        frame_id: spec.frame_id,
        axis: spec.axis,
        component: spec.component
      });
      if (!c.ok) return c;
      indexes.push(c.value);
    }

    return ok({
      quantity_id: String(spec.quantity_id),
      law_id: spec.law_id || null,
      operand_id: spec.operand_id || null,
      role: spec.role != null ? String(spec.role) : null,
      indexes: indexes
    });
  }

  /**
   * Find construction occurrences of a quantity. This is deliberately a
   * pure matcher: formula selection remains in the existing package.
   */
  function findQuantityOccurrences(construction, quantityId, componentsData) {
    const out = [];
    const GC = global.GeoCompute;
    const raw = construction && construction.elements;
    const elements = GC && GC.elementsList
      ? GC.elementsList(construction)
      : Array.isArray(raw) ? raw : Object.keys(raw || {}).flatMap((type) =>
          (raw[type] || []).map((el) => Object.assign({}, el, { component: type })));
    const comps = (componentsData && (componentsData.components || componentsData)) || {};
    elements.forEach((element) => {
      let params = GC && GC.resolveElementParams
        ? GC.resolveElementParams(element, comps[element.component] || {})
        : element.params || [];
      // Keep the legacy quantities dictionary usable alongside thin params.
      const quantities = element.quantities || {};
      params = params.concat(Object.keys(quantities).map((key) =>
        Object.assign({ role: key }, quantities[key])));
      params.forEach((q) => {
        if (!q || String(q.quantity) !== String(quantityId)) return;
        const bound = bindMembership(
          { quantity_id: String(quantityId), role: q.role || null, value: q.value },
          { construction_id: construction.id, element_id: element.id, port: q.port }
        );
        if (bound.ok) out.push(bound.value);
      });
    });
    return out;
  }

  /**
   * Resolve a law against a construction by quantity identity.
   * No formula is recalculated here: this only creates addressable links.
   * If a law binding points to the same quantity more than once, every
   * construction occurrence is returned; count/role filtering stays explicit.
   */
  function linkLawToConstruction(law, construction, componentsData) {
    if (!law || !law.law_id) {
      return fail("LAW_ID", "law_id is required.");
    }
    if (!construction || !construction.id) {
      return fail("CONSTRUCTION_ID", "construction.id is required.");
    }

    const bindings = law.bindings && typeof law.bindings === "object"
      ? law.bindings
      : {};
    const links = [];

    Object.keys(bindings).forEach((operandId) => {
      const binding = bindings[operandId];
      if (!binding || !binding.quantity) return;

      const occurrences = findQuantityOccurrences(
        construction,
        String(binding.quantity),
        componentsData
      ).filter((o) => !binding.role || o.role === binding.role);

      occurrences.forEach((occurrence) => {
        links.push({
          law_id: String(law.law_id),
          operand_id: operandId,
          quantity_id: String(binding.quantity),
          role: binding.role || occurrence.role || null,
          indexes: clone(occurrence.indexes || [])
        });
      });
    });

    return ok({
      construction_id: String(construction.id),
      law_id: String(law.law_id),
      links: links
    });
  }

  function occurrenceKey(occurrence) {
    const normalized = makeOccurrence(occurrence);
    if (!normalized.ok) return null;
    function canonical(value) {
      if (Array.isArray(value)) return value.map(canonical);
      if (value && typeof value === "object") {
        const out = {};
        Object.keys(value).sort().forEach((key) => {
          if (value[key] !== undefined) out[key] = canonical(value[key]);
        });
        return out;
      }
      return value;
    }
    const o = normalized.value;
    return JSON.stringify([o.quantity_id, o.role, o.frame_id || null,
      o.indexes.slice().sort((a, b) => a.kind.localeCompare(b.kind)).map(canonical)]);
  }

  const Mechanics = {
    normalizeArity: normalizeArity,
    vectorArity: vectorArity,
    validateIndex: validateIndex,
    normalizeIndexes: normalizeIndexes,
    resolveOperator: resolveOperator,
    validateApplication: validateApplication,
    makeOccurrence: makeOccurrence,
    bindMembership: bindMembership,
    linkQuantityToLawAndConstruction: linkQuantityToLawAndConstruction,
    findQuantityOccurrences: findQuantityOccurrences,
    linkLawToConstruction: linkLawToConstruction,
    occurrenceKey: occurrenceKey
  };

  global.Mechanics = Mechanics;
  if (typeof module !== "undefined" && module.exports) module.exports = Mechanics;
})(typeof window !== "undefined" ? window : globalThis);

