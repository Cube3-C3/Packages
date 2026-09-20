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
    if (!index || typeof index !== "object") return fail("INDEX_TYPE", "Index must be an object.");
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

    return ok(clone(index));
  }

  function normalizeIndexes(indexes) {
    if (indexes == null) return [];
    const list = Array.isArray(indexes) ? indexes : [indexes];
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const r = validateIndex(list[i]);
      if (!r.ok) return r;
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

    const out = {
      operator: application.operator,
      arity: operands.length,
      operands: clone(operands),
      indexes: indexResult.value
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
      role: spec.role || null,
      arity: arity,
      operator: spec.operator || null,
      indexes: indexResult.value
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
      role: spec.role || null,
      indexes: indexes
    });
  }

  /**
   * Find construction occurrences of a quantity. This is deliberately a
   * pure matcher: formula selection remains in the existing package.
   */
  function findQuantityOccurrences(construction, quantityId) {
    const out = [];
    const elements = construction && Array.isArray(construction.elements)
      ? construction.elements
      : [];

    elements.forEach((element) => {
      const quantities = element && element.quantities || {};
      Object.keys(quantities).forEach((key) => {
        const q = quantities[key];
        if (!q || q.quantity !== quantityId) return;
        const bound = bindMembership(
          { quantity_id: quantityId, role: q.role || null },
          {
            construction_id: construction.id,
            element_id: element.id,
            port: q.port,
            role: q.role
          }
        );
        if (bound.ok) out.push(bound.value);
      });
    });

    return out;
  }

  /**
   * Convert an occurrence into an addressable key. Useful for later graph
   * construction and UI selection without imposing a graph implementation.
   */
  /**
   * Resolve a law against a construction by quantity identity.
   * No formula is recalculated here: this only creates addressable links.
   * If a law binding points to the same quantity more than once, every
   * construction occurrence is returned; count/role filtering stays explicit.
   */
  function linkLawToConstruction(law, construction) {
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
        String(binding.quantity)
      );

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
    if (!occurrence || !occurrence.quantity_id) return null;
    const parts = [String(occurrence.quantity_id)];
    (occurrence.indexes || []).forEach((index) => {
      if (!index || !index.kind) return;
      if (index.kind === "membership") {
        parts.push("m:" + String(index.construction_id));
        if (index.element_id != null) parts.push("e:" + String(index.element_id));
        if (index.relation_id != null) parts.push("r:" + String(index.relation_id));
        if (index.port != null) parts.push("p:" + String(index.port));
      } else if (index.kind === "event") {
        parts.push("t:" + String(index.event_id));
      } else if (index.kind === "coordinate") {
        parts.push("c:" + String(index.frame_id || "_") + ":" + String(index.axis));
      }
    });
    return parts.join("|");
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
