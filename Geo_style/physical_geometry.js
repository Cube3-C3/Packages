/** Minimal executable Point/Vec3/Path2/Shape2 geometry in SI.
 * Uses Geo_style sorts; no viewport or parallel coordinate system. */
(function (global) {
  'use strict';
  const copy = x => JSON.parse(JSON.stringify(x));
  function point(value) {
    if (!Array.isArray(value) || value.length < 2 || value.length > 3 || !value.every(Number.isFinite)) throw new Error('INVALID_POINT');
    return { sort: value.length === 3 ? 'Point3' : 'Point', value: [value[0], value[1], value[2] || 0] };
  }
  const sub = (a,b) => a.map((v,i) => v-b[i]);
  const length = v => Math.hypot(...v);
  function unit(v) { const l=length(v); if (l===0) throw new Error('ZERO_VECTOR'); return v.map(x=>x/l); }
  function build(descriptor, position, angle = 0) {
    const center = point(position), d = descriptor || { constructor: 'point' };
    if (!Number.isFinite(angle)) throw new Error('INVALID_ROTATION');
    const c=Math.cos(angle),s=Math.sin(angle);
    const world = local => point([position[0]+local[0]*c-local[1]*s,position[1]+local[0]*s+local[1]*c,(position[2] || 0)+(local[2] || 0)]);
    const anchors = { center };
    for (const [name, v] of Object.entries(d.anchors || {})) anchors[name]=world(point(v).value);
    if (d.constructor === 'point') return { sort:center.sort, center, anchors, contour:[center] };
    if (d.constructor !== 'rect') throw new Error('UNSUPPORTED_GEOMETRY');
    if (!(Number.isFinite(d.width) && d.width>0 && Number.isFinite(d.height) && d.height>0)) throw new Error('INVALID_SIZE');
    const w=d.width/2,h=d.height/2;
    return { sort:'Shape2', constructor:'rect', center, anchors, contour:[[-w,-h],[w,-h],[w,h],[-w,h]].map(world) };
  }
  function reference(geometry, name = 'center') {
    if (!geometry.anchors[name]) throw new Error('UNKNOWN_ANCHOR');
    return copy(geometry.anchors[name]);
  }
  function segment(a,b) {
    const v=sub(b.value,a.value), l=length(v);
    if (!l) throw new Error('ZERO_VECTOR');
    return { sort:'Path2', constructor:'segment', contour:[copy(a),copy(b)], length:l, direction:unit(v) };
  }
  global.GeoGeometry={point,sub,length,unit,build,reference,segment};
  if (typeof module!=='undefined' && module.exports) module.exports=global.GeoGeometry;
})(typeof window!=='undefined'?window:globalThis);
