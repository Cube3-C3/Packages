/**
 * construct_layout.js — 2D раскладка элементов конструкции по логическим связям.
 * Host: window.ConstructLayout
 *
 * Вход: construction (из Constructs.json) + пакет данных
 *   { relation_types, components (physi_comps), assets (registry), environment E0 }
 *
 * Выход: layout model
 *   {
 *     origin: [0,0], axes, bounds,
 *     nodes: [{ id, component, role, x, y, w, h, asset, anchor, quantities }],
 *     edges: [{ id, structure_ref, from, to, x1,y1,x2,y2 }]
 *   }
 *
 * position элемента = центр в координатах среды E0 (x→right, y→up). Линии не хранятся — port→port.
 */
(function (global) {
  "use strict";

  const DEFAULT_SIZE = { w: 120, h: 40 };
  const GAP_SERIES = 24;
  const GAP_PARALLEL = 48;
  const MARGIN = 16;

  function pick(arr, lang) {
    if (!Array.isArray(arr)) return arr != null ? String(arr) : "";
    return lang === "en" ? arr[0] || arr[1] || "" : arr[1] || arr[0] || "";
  }

  function getTypesMap(relationTypes) {
    const map = Object.create(null);
    const list = (relationTypes && relationTypes.types) || [];
    for (let i = 0; i < list.length; i++) {
      if (list[i] && list[i].id) map[list[i].id] = list[i];
    }
    return map;
  }

  function getComponentsMap(compsData) {
    return (compsData && compsData.components) || {};
  }

  function getAssetsMap(assetsData) {
    return (assetsData && assetsData.assets) || {};
  }


  function getLineTypesMap(lineTypes) {
    const map = Object.create(null);
    const list = (lineTypes && lineTypes.types) || [];
    for (let i = 0; i < list.length; i++) {
      if (list[i] && list[i].id) map[list[i].id] = list[i];
    }
    return map;
  }

  function nodeCenter(n) {
    return { x: n.x + n.w / 2, y: n.y + n.h / 2 };
  }

  /** binding slot: "inst1" | { element, port } → { element, port } */
  function parseBinding(raw) {
    if (raw == null) return null;
    if (typeof raw === "string") return { element: raw, port: null };
    if (typeof raw === "object" && raw.element) {
      return { element: String(raw.element), port: raw.port != null ? String(raw.port) : null };
    }
    return null;
  }

  /**
   * Мировая точка порта. Local: nx,ny ∈ [-1,1] от центра (до rotation узла).
   * rotation узла — CCW math deg.
   */
  function portWorld(n, portId, compsMap) {
    const c = nodeCenter(n);
    const comp = compsMap && n.component ? compsMap[n.component] : null;
    const ports = (n.ports_def) || (comp && comp.ports) || null;
    let nx = 0, ny = 0;
    if (portId && ports && ports[portId]) {
      nx = Number(ports[portId].nx) || 0;
      ny = Number(ports[portId].ny) || 0;
    } else if (portId && n.ports && n.ports[portId]) {
      nx = Number(n.ports[portId].nx) || 0;
      ny = Number(n.ports[portId].ny) || 0;
    }
    // local offset in box units
    let lx = nx * (n.w / 2);
    let ly = ny * (n.h / 2);
    const rot = ((n.rotation || 0) * Math.PI) / 180;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    // CCW
    return {
      x: c.x + lx * cos - ly * sin,
      y: c.y + lx * sin + ly * cos,
      port: portId || null
    };
  }

  function buildLineGeom(rel, nodeById, lineTypesMap, compsMap) {
    const b = rel.bindings || {};
    const pb1 = parseBinding(b.S1 || b.from);
    const pb2 = parseBinding(b.S2 || b.to || b.a || b.b);
    if (!pb1 || !pb2) return null;
    const A = nodeById[pb1.element];
    const C = nodeById[pb2.element];
    if (!A || !C) return null;

    const p1 = portWorld(A, pb1.port, compsMap);
    const p2 = portWorld(C, pb2.port, compsMap);
    const lineRef = rel.line_ref || "L_SEGMENT";
    const lt = lineTypesMap[lineRef] || { kind: "segment", default_offset: 0 };
    const params = rel.params || {};
    const kind = lt.kind || "segment";

    if (kind === "bar") {
      const towardId = params.toward;
      const T = towardId ? nodeById[towardId] : null;
      const attach = params.attach || lt.default_attach || "center";
      let barC;
      if (T) {
        const tPort = params.toward_port || "attach";
        barC = portWorld(T, tPort, compsMap);
      } else {
        const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        const offset = params.offset != null ? Number(params.offset) : Number(lt.default_offset || 48);
        let dx = p2.x - p1.x, dy = p2.y - p1.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        barC = { x: mid.x + (-dy / len) * offset, y: mid.y + (dx / len) * offset };
      }
      const halfx = (p2.x - p1.x) / 2;
      const halfy = (p2.y - p1.y) / 2;
      const bar0 = { x: barC.x - halfx, y: barC.y - halfy };
      const bar1 = { x: barC.x + halfx, y: barC.y + halfy };
      return {
        id: rel.id,
        structure_ref: rel.structure_ref,
        line_ref: lineRef,
        kind: "bar",
        from: pb1.element,
        to: pb2.element,
        from_port: pb1.port,
        to_port: pb2.port,
        toward: towardId || null,
        attach: attach,
        x1: bar0.x, y1: bar0.y, x2: bar1.x, y2: bar1.y,
        legs: [
          { x1: bar0.x, y1: bar0.y, x2: p1.x, y2: p1.y },
          { x1: bar1.x, y1: bar1.y, x2: p2.x, y2: p2.y }
        ],
        joint: { x: barC.x, y: barC.y }
      };
    }

    return {
      id: rel.id,
      structure_ref: rel.structure_ref,
      line_ref: lineRef,
      kind: "segment",
      from: pb1.element,
      to: pb2.element,
      from_port: pb1.port,
      to_port: pb2.port,
      x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y
    };
  }


  function envFrame(componentsMap, envId) {
    const e = componentsMap[envId || "E0"] || {};
    const gRaw = e.g || {};
    // g всегда адресуется к Q006 (free-fall acceleration); value — текущее для просмотра/симуляции
    const g = {
      quantity: gRaw.quantity || "Q006",
      role: gRaw.role || "free_fall_acceleration",
      value: gRaw.value != null ? Number(gRaw.value) : 9.8,
      unit: gRaw.unit || "m/s^2",
      direction: gRaw.direction || "down"
    };
    return {
      origin: Array.isArray(e.origin) ? e.origin.slice() : [0, 0],
      origin_corner: e.origin_corner || "bottom_left",
      axes: e.axes || { x: "right", y: "up" },
      // опорный вектор углов: горизонталь вправо; все углы CCW от него
      angle_ref: Array.isArray(e.angle_ref) ? e.angle_ref.slice() : [1, 0],
      angle_convention: e.angle_convention || "ccw_from_ref",
      g: g,
      quantities: e.quantities || { g: { quantity: g.quantity, role: g.role, value: g.value, unit: g.unit } },
      assumptions: e.assumptions || [],
      initial_conditions: e.initial_conditions || {}
    };
  }

  /** Minimal fallback if FisUnits.normalizeConstructionQuantities is unavailable. */
  function localNormalizeConstruction(nodes, env) {
    const SUB = "₀₁₂₃₄₅₆₇₈₉";
    function sub(n) {
      return String(n).replace(/\d/g, function (d) { return SUB[Number(d)]; });
    }
    const entries = [];
    if (env && env.g && env.g.quantity) {
      entries.push({ key: "env.g", quantity: String(env.g.quantity), role: env.g.role || "g" });
    }
    (nodes || []).forEach(function (n) {
      const qs = n.quantities || {};
      Object.keys(qs).forEach(function (k) {
        const q = qs[k];
        if (!q || q.quantity == null) return;
        entries.push({ key: n.id + "." + k, quantity: String(q.quantity), role: q.role || k });
      });
    });
    const groups = Object.create(null);
    const order = [];
    entries.forEach(function (e) {
      const gk = e.quantity + "\0" + e.role;
      if (!groups[gk]) { groups[gk] = []; order.push(gk); }
      groups[gk].push(e);
    });
    const out = Object.create(null);
    order.forEach(function (gk) {
      const mem = groups[gk];
      const base = (mem[0].role || mem[0].quantity).charAt(0) || "?";
      const zeroRole = /natural|initial|rest|equilibrium|zero/i.test(mem[0].role || "");
      mem.forEach(function (e, i) {
        let idx = null;
        if (mem.length === 1 && zeroRole) idx = 0;
        else if (mem.length > 1) idx = zeroRole && i === 0 ? 0 : (zeroRole ? i : i + 1);
        out[e.key] = {
          base: base,
          index: idx,
          symbol: idx != null ? base + sub(idx) : base,
          quantity: e.quantity,
          role: e.role
        };
      });
    });
    return out;
  }

  /**
   * Resolve quantities for an element instance:
   * instance.quantities override component defaults; always keep quantity ID + value.
   */
  function resolveQuantities(el, comp) {
    const out = Object.create(null);
    const defaults = (comp && comp.quantities) || {};
    const inst = (el && el.quantities) || {};
    const keys = Object.keys(defaults).concat(Object.keys(inst));
    const seen = Object.create(null);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (seen[key]) continue;
      seen[key] = true;
      const d = defaults[key] || {};
      const v = inst[key] || {};
      out[key] = {
        quantity: v.quantity || d.quantity || null,
        role: v.role || d.role || key,
        value: v.value != null ? Number(v.value) : (d.default_value != null ? Number(d.default_value) : null),
        unit: v.unit || d.unit || null
      };
    }
    return out;
  }

  /** Build adjacency from relations (binary S1–S2). */
  function buildGraph(construction, typesMap) {
    const nodes = Object.create(null);
    (construction.elements || []).forEach(function (el) {
      nodes[el.id] = {
        id: el.id,
        component: el.component,
        role: el.role || null,
        quantities: el.quantities || {},
        next: [],
        prev: [],
        parallel: []
      };
    });

    const edges = [];
    (construction.relations || []).forEach(function (rel) {
      const t = typesMap[rel.structure_ref];
      const b = rel.bindings || {};
      const pb1 = parseBinding(b.S1 || b.from);
      const pb2 = parseBinding(b.S2 || b.to || b.a || b.b);
      const a = pb1 && pb1.element;
      const c = pb2 && pb2.element;
      if (!a || !c || !nodes[a] || !nodes[c]) return;

      const kind = (t && t.id) || rel.structure_ref || "";
      edges.push({
        id: rel.id,
        structure_ref: rel.structure_ref,
        from: a,
        to: c,
        kind: kind
      });

      if (kind === "R_SERIES" || kind === "R_ATTACH") {
        nodes[a].next.push(c);
        nodes[c].prev.push(a);
      } else if (kind === "R_PARALLEL") {
        nodes[a].parallel.push(c);
        nodes[c].parallel.push(a);
      } else {
        // default: treat as ordered link
        nodes[a].next.push(c);
        nodes[c].prev.push(a);
      }
    });

    return { nodes: nodes, edges: edges };
  }

  /** Topological chains for series; parallel groups share column. */
  function orderSeries(graph) {
    const nodes = graph.nodes;
    const ids = Object.keys(nodes);
    const roots = ids.filter(function (id) {
      return !nodes[id].prev.length;
    });
    const start = roots.length ? roots[0] : ids[0];
    if (!start) return [];

    const ordered = [];
    const seen = Object.create(null);
    let cur = start;
    while (cur && !seen[cur]) {
      seen[cur] = true;
      ordered.push(cur);
      const nexts = nodes[cur].next;
      cur = nexts && nexts.length ? nexts[0] : null;
    }
    // orphans
    ids.forEach(function (id) {
      if (!seen[id]) ordered.push(id);
    });
    return ordered;
  }

  function assetSize(assetEntry, component) {
    // Sizes aligned with construct_prototype (school schematic).
    const kind = component && component.kind;
    if (kind === "junction") return { w: 16, h: 16 };
    if (kind === "elastic_element") return { w: 120, h: 40 };
    if (kind === "rigid_body") return { w: 56, h: 48 };
    if (kind === "fixed_support") return { w: 28, h: 88 };
    const src = assetEntry ? String(assetEntry.src || "") : "";
    if (src.indexOf("spring") >= 0) return { w: 120, h: 40 };
    if (src.indexOf("block") >= 0) return { w: 56, h: 48 };
    if (src.indexOf("wall") >= 0) return { w: 28, h: 88 };
    return { w: DEFAULT_SIZE.w, h: DEFAULT_SIZE.h };
  }

  /** Geometric center of node boxes (math coords, y up). */
  function centerOf(layoutModel) {
    const nodes = (layoutModel && layoutModel.nodes) || [];
    if (!nodes.length) return { x: 0, y: 0 };
    let sx = 0, sy = 0;
    nodes.forEach(function (n) {
      sx += n.x + n.w / 2;
      sy += n.y + n.h / 2;
    });
    return { x: sx / nodes.length, y: sy / nodes.length };
  }

  /**
   * Поворот всей конструкции вокруг её центра.
   * Угол в градусах, CCW от E0.angle_ref (стандартная тригонометрия, y-up).
   * 0° = вправо, 90° = вверх, 270° = вниз.
   * rotation на узле — тот же CCW; при SVG-рендере: rotate(-rotation) из-за y-down.
   */
  function rotate(layoutModel, angleDeg) {
    if (!layoutModel || !layoutModel.nodes) return layoutModel;
    const ang = Number(angleDeg) || 0;
    const c = centerOf(layoutModel);
    const rad = (ang * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    function rotPoint(px, py) {
      const dx = px - c.x;
      const dy = py - c.y;
      // CCW in y-up
      return {
        x: c.x + dx * cos - dy * sin,
        y: c.y + dx * sin + dy * cos
      };
    }

    const nodes = layoutModel.nodes.map(function (n) {
      const cx = n.x + n.w / 2;
      const cy = n.y + n.h / 2;
      const p = rotPoint(cx, cy);
      return Object.assign({}, n, {
        x: p.x - n.w / 2,
        y: p.y - n.h / 2,
        rotation: ((n.rotation || 0) + ang) % 360
      });
    });

    const byId = Object.create(null);
    nodes.forEach(function (n) {
      byId[n.id] = n;
    });

    function rotPt(px, py) {
      return rotPoint(px, py);
    }
    const edges = (layoutModel.edges || []).map(function (e) {
      const out = Object.assign({}, e);
      if (e.x1 != null) {
        const p1 = rotPt(e.x1, e.y1);
        const p2 = rotPt(e.x2, e.y2);
        out.x1 = p1.x; out.y1 = p1.y; out.x2 = p2.x; out.y2 = p2.y;
      }
      if (e.joint) {
        out.joint = rotPt(e.joint.x, e.joint.y);
      }
      if (Array.isArray(e.legs)) {
        out.legs = e.legs.map(function (leg) {
          const a = rotPt(leg.x1, leg.y1);
          const b = rotPt(leg.x2, leg.y2);
          return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
        });
      }
      return out;
    });


    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(function (n) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.w);
      maxY = Math.max(maxY, n.y + n.h);
    });

    return Object.assign({}, layoutModel, {
      nodes: nodes,
      edges: edges,
      center: c,
      rotation_deg: ((layoutModel.rotation_deg || 0) + ang) % 360,
      bounds: {
        x: minX,
        y: minY,
        w: maxX - minX,
        h: maxY - minY
      }
    });
  }

  /**
   * Main: construction → layout model (math coords, y up).
   */
  function layout(construction, pack, options) {
    options = options || {};
    const gapS = options.gapSeries != null ? options.gapSeries : GAP_SERIES;
    const gapP = options.gapParallel != null ? options.gapParallel : GAP_PARALLEL;
    const margin = options.margin != null ? options.margin : MARGIN;

    const typesMap = getTypesMap(pack && pack.relation_types);
    const comps = getComponentsMap(pack && pack.components);
    const assets = getAssetsMap(pack && pack.assets);
    const env = envFrame(comps, construction.environment || "E0");

    const graph = buildGraph(construction, typesMap);
    const order = orderSeries(graph);

    // column index along series; row for parallel
    const col = Object.create(null);
    const row = Object.create(null);
    order.forEach(function (id, i) {
      col[id] = i;
      row[id] = 0;
    });
    // parallel partners: same col, different row
    order.forEach(function (id) {
      const n = graph.nodes[id];
      (n.parallel || []).forEach(function (pid, j) {
        if (col[pid] == null) col[pid] = col[id];
        if (row[pid] == null || row[pid] === 0 && pid !== id) {
          row[pid] = (row[id] || 0) + j + 1;
        }
      });
    });

    // sizes + explicit positions (center in local plane)
    const sizes = Object.create(null);
    const elById = Object.create(null);
    (construction.elements || []).forEach(function (el) {
      elById[el.id] = el;
    });
    order.forEach(function (id) {
      const n = graph.nodes[id];
      const comp = comps[n.component] || {};
      const assetId = comp.asset;
      const asset = assetId ? assets[assetId] : null;
      sizes[id] = assetSize(asset, comp);
    });
    // include any element missing from order (orphans)
    Object.keys(graph.nodes).forEach(function (id) {
      if (sizes[id]) return;
      const n = graph.nodes[id];
      const comp = comps[n.component] || {};
      sizes[id] = assetSize(comp.asset ? assets[comp.asset] : null, comp);
      if (order.indexOf(id) < 0) order.push(id);
    });

    const hasAnyPos = order.some(function (id) {
      const el = elById[id];
      return el && Array.isArray(el.position) && el.position.length >= 2;
    });

    const xLeft = Object.create(null);
    const yBottom = Object.create(null);

    if (hasAnyPos) {
      // Spatial frame: position = center; missing → auto fallback beside previous
      let cursorX = env.origin[0] + margin;
      order.forEach(function (id) {
        const el = elById[id] || {};
        const sz = sizes[id];
        if (Array.isArray(el.position) && el.position.length >= 2) {
          const cx = Number(el.position[0]);
          const cy = Number(el.position[1]);
          xLeft[id] = cx - sz.w / 2;
          yBottom[id] = cy - sz.h / 2;
        } else {
          xLeft[id] = cursorX;
          yBottom[id] = env.origin[1] + margin;
          cursorX += sz.w + gapS;
        }
      });
    } else {
      // Topological auto-layout (legacy)
      let cursor = env.origin[0] + margin;
      let maxCol = 0;
      order.forEach(function (id) {
        maxCol = Math.max(maxCol, col[id] || 0);
      });
      for (let c = 0; c <= maxCol; c++) {
        const inCol = order.filter(function (id) {
          return (col[id] || 0) === c;
        });
        let colW = 0;
        inCol.forEach(function (id) {
          colW = Math.max(colW, sizes[id].w);
        });
        inCol.forEach(function (id) {
          xLeft[id] = cursor;
        });
        cursor += colW + gapS;
      }
      let maxH = 0;
      order.forEach(function (id) {
        maxH = Math.max(maxH, sizes[id].h);
      });
      const axisY = env.origin[1] + margin + maxH / 2;
      order.forEach(function (id) {
        const r = row[id] || 0;
        const h = sizes[id].h;
        yBottom[id] = axisY + r * (maxH + gapP) - h / 2;
      });
    }

    const nodesOut = [];
    let maxX = 0;
    let maxY = 0;
    let minX = Infinity;
    let minY = Infinity;
    order.forEach(function (id) {
      const n = graph.nodes[id];
      const comp = comps[n.component] || {};
      const assetId = comp.asset || null;
      const asset = assetId ? assets[assetId] : null;
      const sz = sizes[id];
      const x = xLeft[id];
      const y = yBottom[id];
      maxX = Math.max(maxX, x + sz.w);
      maxY = Math.max(maxY, y + sz.h);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      const elRot =
        elById[id] && elById[id].rotation != null
          ? Number(elById[id].rotation)
          : 0;
      const el = elById[id] || {};
      nodesOut.push({
        id: id,
        component: n.component,
        role: n.role,
        quantities: resolveQuantities(el, comp),
        kind: comp.kind || null,
        ports_def: comp.ports || null,
        asset: assetId,
        src: asset ? asset.src : null,
        anchor: asset && asset.anchor ? asset.anchor : [0, 0],
        opacity: asset && asset.opacity != null ? asset.opacity : 1,
        scale: asset && asset.default_scale != null ? asset.default_scale : 1,
        position: el.position ? el.position.slice() : null,
        rotation: elRot,
        x: x,
        y: y,
        w: sz.w,
        h: sz.h
      });
    });

    const nodeById = Object.create(null);
    nodesOut.forEach(function (n) {
      nodeById[n.id] = n;
    });

    // ── Symbol normalization (same rules as formulas) ──
    // Repeated (quantity, role) across the construction → indices; natural/initial →₀.
    const usagesData = (pack && pack.usages) || null;
    let symbolMap = Object.create(null);
    if (global.FisUnits && typeof global.FisUnits.normalizeConstructionQuantities === "function") {
      symbolMap = global.FisUnits.normalizeConstructionQuantities(
        nodesOut,
        env.quantities || { g: env.g },
        usagesData
      );
    } else {
      // local minimal fallback: index repeats by quantity+role
      symbolMap = localNormalizeConstruction(nodesOut, env);
    }
    nodesOut.forEach(function (n) {
      const qs = n.quantities || {};
      Object.keys(qs).forEach(function (k) {
        const sm = symbolMap[n.id + "." + k];
        if (!sm) return;
        qs[k].base = sm.base;
        qs[k].index = sm.index;
        qs[k].symbol = sm.symbol;
      });
    });
    if (env.g && symbolMap["env.g"]) {
      env.g.base = symbolMap["env.g"].base;
      env.g.index = symbolMap["env.g"].index;
      env.g.symbol = symbolMap["env.g"].symbol;
    }

    const lineTypesMap = getLineTypesMap(pack && pack.line_types);
    const edgesOut = [];
    (construction.relations || []).forEach(function (rel) {
      const geom = buildLineGeom(rel, nodeById, lineTypesMap, comps);
      if (geom) edgesOut.push(geom);
    });


    const model = {
      id: construction.id,
      environment: construction.environment || "E0",
      origin: env.origin,
      axes: env.axes,
      g: env.g,
      symbols: symbolMap,
      rotation_deg: 0,
      bounds: {
        x: Number.isFinite(minX) ? minX - margin : env.origin[0],
        y: Number.isFinite(minY) ? minY - margin : env.origin[1],
        w: (Number.isFinite(minX) ? maxX - minX : maxX - env.origin[0]) + margin * 2,
        h: (Number.isFinite(minY) ? maxY - minY : maxY - env.origin[1]) + margin * 2
      },
      nodes: nodesOut,
      edges: edgesOut
    };
    model.center = centerOf(model);
    model.angle_ref = env.angle_ref;
    model.angle_convention = env.angle_convention;

    // Координаты уже в E0. angle_deg конструкции — опциональный batch-поворот каркаса.
    const orient =
      options.angle_deg != null
        ? Number(options.angle_deg)
        : construction.angle_deg != null
          ? Number(construction.angle_deg)
          : 0;
    if (orient) {
      return rotate(model, orient);
    }
    model.rotation_deg = 0;
    return model;
  }

  /**
   * SVG string from layout (y flipped for SVG top-left origin).
   * assetHrefPrefix — путь к папке Assets, например "Fis_data/Assets/"
   */
  /**
   * Vector shapes — prefer component.kind, then asset src name.
   * Does not depend on external SVG files (platform may not serve Assets/).
   */
  function nodeShapeMarkup(n) {
    const w = n.w || 40;
    const h = n.h || 40;
    const src = String(n.src || "");
    const kind = String(n.kind || "");
    const isSpring =
      kind === "elastic_element" || src.indexOf("spring") >= 0;
    const isWall =
      kind === "fixed_support" || src.indexOf("wall") >= 0;
    const isBlock =
      kind === "rigid_body" || src.indexOf("block") >= 0;

    if (isSpring) {
      const mid = h / 2;
      let d = "M0 " + mid + " H" + (w * 0.08);
      for (let i = 0; i < 8; i++) {
        const x = w * 0.08 + (w * 0.84 * (i + 0.5)) / 8;
        const y = mid + (i % 2 === 0 ? -mid * 0.55 : mid * 0.55);
        d += " L" + x.toFixed(1) + " " + y.toFixed(1);
      }
      d += " L" + (w * 0.92) + " " + mid + " H" + w;
      return (
        '<path d="' +
        d +
        '" fill="none" stroke="#18181b" stroke-width="2.5"/>'
      );
    }
    if (isWall) {
      return (
        '<rect x="1" y="1" width="' +
        (w - 2) +
        '" height="' +
        (h - 2) +
        '" fill="#d4d4d8" stroke="#18181b" stroke-width="2.5"/>'
      );
    }
    if (isBlock) {
      return (
        '<rect x="2" y="2" width="' +
        (w - 4) +
        '" height="' +
        (h - 4) +
        '" fill="#e4e4e7" stroke="#18181b" stroke-width="2.5" rx="2"/>'
      );
    }
    return (
      '<rect width="' +
      w +
      '" height="' +
      h +
      '" fill="#e4e4e7" stroke="#52525b"/>'
    );
  }

  /**
   * Fixed environment viewport (~¼ screen). Content is uniformly scaled to fit;
   * the SVG never grows with the construction.
   *
   * options:
   *   viewportW / viewportH — pixel size of env window (default 480×320)
   *   pad — inner margin in viewport px
   *   showLabels
   */
  function toSVG(layoutModel, options) {
    options = options || {};
    // ~¼ of a typical laptop content area (≈960×640 → 480×320)
    const W = options.viewportW != null ? Number(options.viewportW) : 480;
    const H = options.viewportH != null ? Number(options.viewportH) : 320;
    const pad = options.pad != null ? Number(options.pad) : 16;
    const showLabels = options.showLabels !== false;
    const b = layoutModel.bounds || { x: 0, y: 0, w: 100, h: 100 };
    const bw = Math.max(Number(b.w) || 1, 1);
    const bh = Math.max(Number(b.h) || 1, 1);
    const innerW = Math.max(W - pad * 2, 1);
    const innerH = Math.max(H - pad * 2, 1);
    // fit + center; never expand the viewport
    const scale = Math.min(innerW / bw, innerH / bh);
    const ox = pad + (innerW - bw * scale) / 2;
    const oy = pad + (innerH - bh * scale) / 2;

    // math y-up → svg y-down, scaled into fixed viewport
    function sx(x) {
      return ox + (x - b.x) * scale;
    }
    function syPt(y) {
      return oy + (b.y + bh - y) * scale;
    }
    function syTop(y, h) {
      return oy + (b.y + bh - y - (h || 0)) * scale;
    }
    function sw(v) {
      return v * scale;
    }

    const strokeMain = Math.max(1.2, 2.2 * Math.min(scale, 1.2));
    const strokeThin = Math.max(1, 1.6 * Math.min(scale, 1.2));
    const jointR = Math.max(2.5, 4 * Math.min(scale, 1.2));
    const labelFs = Math.max(8, Math.min(11, 10 * Math.min(scale, 1.15)));

    let parts = [];
    parts.push(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' +
        W +
        " " +
        H +
        '" width="' +
        W +
        '" height="' +
        H +
        '" style="display:block;width:' +
        W +
        "px;height:" +
        H +
        'px;max-width:100%;background:transparent">'
    );

    // edges
    (layoutModel.edges || []).forEach(function (e) {
      if (e.kind === "bar") {
        parts.push(
          '<line x1="' +
            sx(e.x1) +
            '" y1="' +
            syPt(e.y1) +
            '" x2="' +
            sx(e.x2) +
            '" y2="' +
            syPt(e.y2) +
            '" stroke="#2563eb" stroke-width="' +
            strokeMain +
            '"/>'
        );
        (e.legs || []).forEach(function (leg) {
          parts.push(
            '<line x1="' +
              sx(leg.x1) +
              '" y1="' +
              syPt(leg.y1) +
              '" x2="' +
              sx(leg.x2) +
              '" y2="' +
              syPt(leg.y2) +
              '" stroke="#64748b" stroke-width="' +
              strokeThin +
              '"/>'
          );
        });
        if (e.joint) {
          parts.push(
            '<circle cx="' +
              sx(e.joint.x) +
              '" cy="' +
              syPt(e.joint.y) +
              '" r="' +
              jointR +
              '" fill="#2563eb"/>'
          );
        }
      } else {
        parts.push(
          '<line x1="' +
            sx(e.x1) +
            '" y1="' +
            syPt(e.y1) +
            '" x2="' +
            sx(e.x2) +
            '" y2="' +
            syPt(e.y2) +
            '" stroke="#71717a" stroke-width="' +
            strokeThin +
            '"/>'
        );
      }
    });

    (layoutModel.nodes || []).forEach(function (n) {
      const nw = sw(n.w);
      const nh = sw(n.h);
      const x = sx(n.x);
      const y = syTop(n.y, n.h);
      const cx = x + nw / 2;
      const cy = y + nh / 2;
      const rotSvg = -(n.rotation || 0);
      // draw shape in local (unscaled) coords, then scale the group
      parts.push(
        '<g transform="rotate(' +
          rotSvg +
          " " +
          cx +
          " " +
          cy +
          ") translate(" +
          x +
          " " +
          y +
          ") scale(" +
          scale +
          ')">' +
          nodeShapeMarkup(n) +
          "</g>"
      );
      if (showLabels) {
        parts.push(
          '<text x="' +
            cx +
            '" y="' +
            (y + nh + labelFs + 2) +
            '" text-anchor="middle" font-size="' +
            labelFs +
            '" fill="#52525b">' +
            String(n.id) +
            "</text>"
        );
      }
    });

    parts.push("</svg>");
    return parts.join("");
  }

  /**
   * Convenience: load construction by id from Constructs pack and layout.
   */
  function layoutById(constructsData, id, pack, options) {
    const list =
      (constructsData && constructsData.constructions) ||
      (Array.isArray(constructsData) ? constructsData : []);
    const c = list.find(function (x) {
      return x && x.id === id;
    });
    if (!c) return null;
    return layout(c, pack, options);
  }

  global.ConstructLayout = {
    layout: layout,
    layoutById: layoutById,
    rotate: rotate,
    centerOf: centerOf,
    toSVG: toSVG,
    buildGraph: buildGraph,
    orderSeries: orderSeries
  };
})(typeof window !== "undefined" ? window : globalThis);
