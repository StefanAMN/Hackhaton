import React, { useEffect, useRef, useState, useCallback } from 'react';
import { getGlobalGraph } from '../api/client';

const NODE_PALETTE = {
  function: { fill: 'rgba(34,214,238,0.20)', stroke: '#22d6ee', text: '#bff8ff' },
  class:    { fill: 'rgba(173,111,255,0.22)', stroke: '#ad6fff', text: '#e5cbff' },
  method:   { fill: 'rgba(255,136,61,0.20)', stroke: '#ff883d', text: '#ffd9c1' },
  module:   { fill: 'rgba(127,232,97,0.20)', stroke: '#7fe861', text: '#dcffd2' },
  unknown:  { fill: 'rgba(132,159,255,0.16)', stroke: '#849fff', text: '#d6e0ff' },
};

const EDGE_PALETTE = {
  calls:    '#ff883d',
  imports:  '#1dd2ff',
  inherits: '#b084ff',
  linked:   '#59ffbc',
};

const NODE_R = 16;          // base radius
const REPULSION = 28000;    // repulsion constant
const ATTRACT = 0.003;      // spring constant
const REST_LEN = 260;       // ideal edge length
const DAMPING = 0.78;       // velocity damping
const ITERATIONS = 200;     // pre-bake iterations before first draw

function withAlpha(color, alpha) {
  const a = Math.max(0, Math.min(1, alpha));
  if (typeof color !== 'string') return `rgba(255,255,255,${a})`;

  const c = color.trim();
  if (c.startsWith('#')) {
    let hex = c.slice(1);
    if (hex.length === 3) hex = hex.split('').map(ch => ch + ch).join('');
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return `rgba(${r},${g},${b},${a})`;
    }
  }

  if (c.startsWith('rgba(') || c.startsWith('rgb(')) {
    const vals = c.substring(c.indexOf('(') + 1, c.length - 1).split(',').map(v => v.trim());
    if (vals.length >= 3) return `rgba(${vals[0]},${vals[1]},${vals[2]},${a})`;
  }

  return color;
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    return;
  }

  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function curveDirection(from, to, relation = '') {
  const s = `${from}|${to}|${relation}`;
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return hash % 2 === 0 ? 1 : -1;
}

function ensureConnectedEdges(nodes, edges) {
  const ids = nodes.map(n => n.id);
  const idSet = new Set(ids);
  const adjacency = new Map(ids.map(id => [id, new Set()]));
  const unique = [];
  const seen = new Set();

  edges.forEach(e => {
    if (!idSet.has(e.from) || !idSet.has(e.to) || e.from === e.to) return;
    const key = `${e.from}|${e.to}|${e.relation || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(e);
    adjacency.get(e.from).add(e.to);
    adjacency.get(e.to).add(e.from);
  });

  const visited = new Set();
  const components = [];

  ids.forEach(id => {
    if (visited.has(id)) return;
    const stack = [id];
    const comp = [];
    visited.add(id);
    while (stack.length) {
      const cur = stack.pop();
      comp.push(cur);
      adjacency.get(cur).forEach(next => {
        if (!visited.has(next)) {
          visited.add(next);
          stack.push(next);
        }
      });
    }
    components.push(comp);
  });

  const pickRepresentative = (comp) => {
    return comp.reduce((best, cur) => {
      const deg = adjacency.get(cur)?.size || 0;
      const bestDeg = adjacency.get(best)?.size || 0;
      return deg > bestDeg ? cur : best;
    }, comp[0]);
  };

  const bridged = [...unique];
  let bridgeCount = 0;

  if (components.length > 1) {
    for (let i = 0; i < components.length - 1; i++) {
      const from = pickRepresentative(components[i]);
      const to = pickRepresentative(components[i + 1]);
      const key = `${from}|${to}|linked`;
      if (seen.has(key) || from === to) continue;
      bridged.push({ from, to, relation: 'linked', synthetic: true });
      seen.add(key);
      bridgeCount += 1;
    }
  }

  return {
    edges: bridged,
    bridgeCount,
    componentCount: components.length,
  };
}

function structureLabel(density) {
  if (density < 0.04) return 'Dispersed';
  if (density < 0.12) return 'Balanced';
  return 'Dense';
}

function buildLayout(nodes, edges, w, h) {
  // Random initial positions spread across canvas
  nodes.forEach((n, i) => {
    const angle = (i / nodes.length) * Math.PI * 2;
    const r = Math.min(w, h) * 0.35;
    n.x = w / 2 + Math.cos(angle) * r + (Math.random() - 0.5) * 60;
    n.y = h / 2 + Math.sin(angle) * r + (Math.random() - 0.5) * 60;
    n.vx = 0;
    n.vy = 0;
  });

  const nodeMap = {};
  nodes.forEach(n => { nodeMap[n.id] = n; });

  // Pre-bake physics
  for (let iter = 0; iter < ITERATIONS; iter++) {
    // Repulsion between all pairs
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist2 = dx * dx + dy * dy + 1;
        const dist = Math.sqrt(dist2);
        const force = REPULSION / dist2;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx -= fx; a.vy -= fy;
        b.vx += fx; b.vy += fy;
      }
    }

    // Spring attraction along edges
    edges.forEach(e => {
      const a = nodeMap[e.from];
      const b = nodeMap[e.to];
      if (!a || !b) return;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const stretch = dist - REST_LEN;
      const fx = dx / dist * stretch * ATTRACT * 300;
      const fy = dy / dist * stretch * ATTRACT * 300;
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    });

    // Integrate + damp
    nodes.forEach(n => {
      n.vx *= DAMPING;
      n.vy *= DAMPING;
      n.x += n.vx;
      n.y += n.vy;
    });
  }

  return nodeMap;
}

export default function GlobalMemoryGraph() {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const scrollLockRef = useRef(false);
  const savedOverflowRef = useRef({ html: '', body: '' });
  const stateRef  = useRef({ nodes: [], edges: [], nodeMap: {}, pan: { x: 0, y: 0 }, zoom: 1, dragging: null, lastMouse: null, hoveredId: null, animFrame: null });
  const [info, setInfo]       = useState({ count: 0, edges: 0, bridgeCount: 0, density: 0, components: 0, topKinds: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [empty, setEmpty]     = useState(false);

  const syncCanvasSize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const W = canvas.offsetWidth || canvas.clientWidth || canvas.parentElement?.clientWidth || 1200;
    const H = canvas.offsetHeight || canvas.clientHeight || canvas.parentElement?.clientHeight || 700;
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    return { W, H };
  }, []);

  /* ── draw loop ── */
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { nodes, edges, nodeMap, pan, zoom, hoveredId } = stateRef.current;
    const W = canvas.width, H = canvas.height;

    try {
      ctx.clearRect(0, 0, W, H);

      // Layered background for a brighter "knowledge nebula" look.
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, '#05070f');
      bg.addColorStop(0.55, '#090d1a');
      bg.addColorStop(1, '#101429');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const nebulaA = ctx.createRadialGradient(W * 0.2, H * 0.2, 10, W * 0.2, H * 0.2, W * 0.55);
      nebulaA.addColorStop(0, 'rgba(34,214,238,0.22)');
      nebulaA.addColorStop(1, 'rgba(34,214,238,0)');
      ctx.fillStyle = nebulaA;
      ctx.fillRect(0, 0, W, H);

      const nebulaB = ctx.createRadialGradient(W * 0.78, H * 0.28, 10, W * 0.78, H * 0.28, W * 0.5);
      nebulaB.addColorStop(0, 'rgba(173,111,255,0.22)');
      nebulaB.addColorStop(1, 'rgba(173,111,255,0)');
      ctx.fillStyle = nebulaB;
      ctx.fillRect(0, 0, W, H);

      ctx.save();
      ctx.translate(W / 2 + pan.x, H / 2 + pan.y);
      ctx.scale(zoom, zoom);
      ctx.translate(-W / 2, -H / 2);

      // Draw edges first so node glows sit on top.
      edges.forEach(e => {
        const a = nodeMap[e.from];
        const b = nodeMap[e.to];
        if (!a || !b) return;

        const color = EDGE_PALETTE[e.relation] || '#53ccff';
        const isHov = hoveredId === a.id || hoveredId === b.id;
        const isDim = hoveredId && !isHov;
        const alpha = isHov ? 0.95 : (isDim ? 0.1 : 0.42);

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 1;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const bend = Math.min(20, dist * 0.12) * curveDirection(e.from, e.to, e.relation) * (e.synthetic ? 0.45 : 1);
        const nx = -dy / dist;
        const ny = dx / dist;
        const cx = mx + nx * bend;
        const cy = my + ny * bend;

        ctx.globalAlpha = alpha;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Soft glow stroke
        ctx.shadowColor = withAlpha(color, isHov ? 0.7 : 0.45);
        ctx.shadowBlur = isHov ? 16 : 9;
        ctx.strokeStyle = withAlpha(color, isHov ? 0.55 : 0.28);
        ctx.lineWidth = isHov ? 4 : 2.4;
        ctx.setLineDash(e.synthetic ? [6, 5] : []);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(cx, cy, b.x, b.y);
        ctx.stroke();

        // Crisp inner line
        ctx.shadowBlur = 0;
        ctx.strokeStyle = isHov ? color : withAlpha(color, e.synthetic ? 0.68 : 0.82);
        ctx.lineWidth = isHov ? 1.9 : 1.25;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(cx, cy, b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Arrowhead along curve tangent
        const t = 0.78;
        const omt = 1 - t;
        const ax = omt * omt * a.x + 2 * omt * t * cx + t * t * b.x;
        const ay = omt * omt * a.y + 2 * omt * t * cy + t * t * b.y;
        const tx = 2 * omt * (cx - a.x) + 2 * t * (b.x - cx);
        const ty = 2 * omt * (cy - a.y) + 2 * t * (b.y - cy);
        const angle = Math.atan2(ty, tx);
        const arrow = isHov ? 12 : 8;

        ctx.globalAlpha = isHov ? 0.98 : (isDim ? 0.1 : 0.7);
        ctx.shadowColor = withAlpha(color, 0.7);
        ctx.shadowBlur = isHov ? 10 : 5;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax - arrow * Math.cos(angle - 0.42), ay - arrow * Math.sin(angle - 0.42));
        ctx.lineTo(ax - arrow * Math.cos(angle + 0.42), ay - arrow * Math.sin(angle + 0.42));
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;

        // Edge label on hover
        if (isHov && e.relation) {
          ctx.globalAlpha = 1;
          ctx.font = '600 11px "JetBrains Mono", monospace';
          const tw = ctx.measureText(e.relation).width + 12;
          const th = 18;
          ctx.fillStyle = 'rgba(6, 12, 28, 0.9)';
          drawRoundedRect(ctx, mx - tw / 2, my - th / 2, tw, th, 8);
          ctx.fill();
          ctx.strokeStyle = withAlpha(color, 0.95);
          ctx.lineWidth = 1.1;
          ctx.stroke();
          ctx.fillStyle = withAlpha(color, 0.98);
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(e.synthetic ? 'linked' : e.relation, mx, my);
        }
      });

      ctx.globalAlpha = 1;

      // Draw nodes with layered glow and influence-driven size.
      nodes.forEach(n => {
        const colors = NODE_PALETTE[n.kind] || NODE_PALETTE.unknown;
        const isHov = hoveredId === n.id;
        const isDim = hoveredId && !isHov;
        const baseR = n.radius || NODE_R;
        const r = baseR + (isHov ? 5 : 0);

        ctx.globalAlpha = isDim ? 0.2 : 1;

        // Outer aura (always on, stronger on hover)
        const aura = ctx.createRadialGradient(n.x, n.y, r * 0.25, n.x, n.y, r * (isHov ? 3.5 : 2.6));
        aura.addColorStop(0, withAlpha(colors.stroke, isHov ? 0.5 : 0.26));
        aura.addColorStop(1, withAlpha(colors.stroke, 0));
        ctx.beginPath();
        ctx.arc(n.x, n.y, r * (isHov ? 3.5 : 2.6), 0, Math.PI * 2);
        ctx.fillStyle = aura;
        ctx.fill();

        // Core gradient
        const core = ctx.createRadialGradient(n.x - r * 0.25, n.y - r * 0.3, r * 0.2, n.x, n.y, r);
        core.addColorStop(0, withAlpha('#ffffff', isHov ? 0.34 : 0.22));
        core.addColorStop(1, colors.fill);
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = core;
        ctx.shadowColor = withAlpha(colors.stroke, isHov ? 0.8 : 0.55);
        ctx.shadowBlur = isHov ? 18 : 9;
        ctx.fill();
        ctx.shadowBlur = 0;

        // Rings
        ctx.strokeStyle = withAlpha(colors.stroke, 0.9);
        ctx.lineWidth = isHov ? 2.4 : 1.5;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = withAlpha(colors.stroke, 0.35);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 3, 0, Math.PI * 2);
        ctx.stroke();

        const label = n.label || n.id || 'unknown';
        const fontSize = isHov ? 13 : 11;
        ctx.font = `700 ${fontSize}px "JetBrains Mono", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const maxW = Math.max(44, r * 2.35);
        let display = label;
        if (ctx.measureText(label).width > maxW) {
          let cut = label.length;
          while (cut > 1 && ctx.measureText(label.slice(0, cut) + '…').width > maxW) cut--;
          display = label.slice(0, cut) + '…';
        }

        ctx.shadowColor = 'rgba(0,0,0,0.95)';
        ctx.shadowBlur = 6;
        ctx.fillStyle = colors.text;
        ctx.fillText(display, n.x, n.y);
        ctx.shadowBlur = 0;

        ctx.font = '600 10px Inter, sans-serif';
        ctx.fillStyle = withAlpha(colors.stroke, isHov ? 0.95 : 0.72);
        ctx.globalAlpha = isDim ? 0.15 : 1;
        ctx.fillText(n.kind, n.x, n.y + r + 13);
      });

      ctx.globalAlpha = 1;
      ctx.restore();
      stateRef.current.animFrame = requestAnimationFrame(draw);
    } catch (err) {
      setError(`Graph render error: ${err?.message || 'unknown'}`);
    }
  }, [setError]);

  /* ── load data ── */
  useEffect(() => {
    let mounted = true;
    getGlobalGraph().then(data => {
      if (!mounted) return;

      const rawNodes = Object.keys(data.nodes || {}).map(id => ({
        id,
        label: data.nodes[id].name || id,
        kind: data.nodes[id].kind || 'unknown',
        x: 0, y: 0, vx: 0, vy: 0,
      }));

      const rawEdges = (data.edges || []).map(e => ({
        from: e.source,
        to: e.target,
        relation: e.relation,
      }));

      if (rawNodes.length === 0) { setEmpty(true); setLoading(false); return; }

      const { edges: connectedEdges, bridgeCount, componentCount } = ensureConnectedEdges(rawNodes, rawEdges);

      const degreeMap = {};
      connectedEdges.forEach(e => {
        degreeMap[e.from] = (degreeMap[e.from] || 0) + 1;
        degreeMap[e.to] = (degreeMap[e.to] || 0) + 1;
      });

      rawNodes.forEach(n => {
        n.degree = degreeMap[n.id] || 0;
        n.radius = NODE_R + Math.min(16, n.degree * 1.35);
      });

      const kindCounts = rawNodes.reduce((acc, n) => {
        acc[n.kind] = (acc[n.kind] || 0) + 1;
        return acc;
      }, {});

      const topKinds = Object.entries(kindCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([kind, count]) => ({
          kind,
          count,
          pct: Math.round((count / rawNodes.length) * 100),
          color: (NODE_PALETTE[kind] || NODE_PALETTE.unknown).stroke,
        }));

      const density = rawNodes.length > 1 ? connectedEdges.length / (rawNodes.length * (rawNodes.length - 1)) : 0;

      const size = syncCanvasSize();
      const W = size?.W || 1200;
      const H = size?.H || 700;

      // Centre layout on canvas midpoint
      const nodeMap = buildLayout(rawNodes, connectedEdges, W, H);
      stateRef.current.nodes   = rawNodes;
      stateRef.current.edges   = connectedEdges;
      stateRef.current.nodeMap = nodeMap;
      stateRef.current.pan     = { x: 0, y: 0 };
      stateRef.current.zoom    = 1;

      setInfo({
        count: rawNodes.length,
        edges: connectedEdges.length,
        bridgeCount,
        density,
        components: componentCount,
        topKinds,
      });
      setLoading(false);
    }).catch(err => {
      if (mounted) { setError(err.message); setLoading(false); }
    });
    return () => { mounted = false; };
  }, [syncCanvasSize]);

  useEffect(() => {
    if (loading || error || empty) return;
    const raf = requestAnimationFrame(() => {
      syncCanvasSize();
      if (stateRef.current.animFrame) cancelAnimationFrame(stateRef.current.animFrame);
      draw();
    });
    return () => cancelAnimationFrame(raf);
  }, [loading, error, empty, draw, syncCanvasSize]);

  /* ── cleanup animation on unmount ── */
  useEffect(() => {
    return () => { if (stateRef.current.animFrame) cancelAnimationFrame(stateRef.current.animFrame); };
  }, []);

  /* ── pointer events ── */
  const worldCoords = useCallback((cx, cy) => {
    const canvas = canvasRef.current;
    if (!canvas) return { wx: cx, wy: cy };
    const { pan, zoom } = stateRef.current;
    const W = canvas.width, H = canvas.height;
    return {
      wx: (cx - W / 2 - pan.x) / zoom + W / 2,
      wy: (cy - H / 2 - pan.y) / zoom + H / 2,
    };
  }, []);

  const hitTest = useCallback((wx, wy) => {
    const { nodes } = stateRef.current;
    return nodes.find(n => {
      const dx = wx - n.x, dy = wy - n.y;
      return Math.hypot(dx, dy) <= (n.radius || NODE_R) + 6;
    }) || null;
  }, []);

  const onMouseMove = useCallback(e => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    const cx = e.clientX - r.left;
    const cy = e.clientY - r.top;

    if (stateRef.current.dragging) {
      const last = stateRef.current.lastMouse;
      stateRef.current.pan.x += cx - last.x;
      stateRef.current.pan.y += cy - last.y;
      stateRef.current.lastMouse = { x: cx, y: cy };
      canvas.style.cursor = 'grabbing';
    } else {
      const { wx, wy } = worldCoords(cx, cy);
      const hit = hitTest(wx, wy);
      stateRef.current.hoveredId = hit ? hit.id : null;
      canvas.style.cursor = hit ? 'pointer' : 'default';
    }
  }, [worldCoords, hitTest]);

  const onMouseDown = useCallback(e => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    stateRef.current.dragging = true;
    stateRef.current.lastMouse = { x: e.clientX - r.left, y: e.clientY - r.top };
  }, []);

  const onMouseUp = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    stateRef.current.dragging = false;
    stateRef.current.lastMouse = null;
    canvas.style.cursor = stateRef.current.hoveredId ? 'pointer' : 'default';
  }, []);

  const applyZoom = useCallback((factor) => {
    stateRef.current.zoom = Math.max(0.2, Math.min(5, stateRef.current.zoom * factor));
  }, []);

  const onWheel = useCallback(e => {
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    applyZoom(factor);
  }, [applyZoom]);

  const onZoomIn = useCallback(() => {
    applyZoom(1.12);
  }, [applyZoom]);

  const onZoomOut = useCallback(() => {
    applyZoom(0.89);
  }, [applyZoom]);

  const setPageScrollLock = useCallback((locked) => {
    if (scrollLockRef.current === locked) return;

    const html = document.documentElement;
    const body = document.body;
    if (!html || !body) return;

    if (locked) {
      savedOverflowRef.current = {
        html: html.style.overflow,
        body: body.style.overflow,
      };
      html.style.overflow = 'hidden';
      body.style.overflow = 'hidden';
    } else {
      html.style.overflow = savedOverflowRef.current.html;
      body.style.overflow = savedOverflowRef.current.body;
    }

    scrollLockRef.current = locked;
  }, []);

  const onContainerEnter = useCallback(() => {
    setPageScrollLock(true);
  }, [setPageScrollLock]);

  const onContainerLeave = useCallback(() => {
    setPageScrollLock(false);
  }, [setPageScrollLock]);

  useEffect(() => {
    return () => setPageScrollLock(false);
  }, [setPageScrollLock]);

  const resetView = useCallback(() => {
    stateRef.current.pan  = { x: 0, y: 0 };
    stateRef.current.zoom = 1;
  }, []);

  /* ── resize ── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      syncCanvasSize();
    });
    ro.observe(canvas);
    syncCanvasSize();
    return () => ro.disconnect();
  }, [syncCanvasSize]);

  /* ── render ── */
  if (loading) return (
    <div style={center}>
      <div style={{ color: '#a18cd1', fontFamily: 'monospace', fontSize: 16 }}>⚙ Loading memory graph…</div>
    </div>
  );

  if (error) return (
    <div style={center}>
      <div style={{ color: '#ff6b6b', fontFamily: 'monospace' }}>⚠ {error}</div>
    </div>
  );

  if (empty) return (
    <div style={center}>
      <div style={{ textAlign: 'center', color: '#888' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🕸️</div>
        <div>Global memory graph is empty.<br />Upload and scan some code first.</div>
      </div>
    </div>
  );

  return (
    <div
      ref={containerRef}
      onMouseEnter={onContainerEnter}
      onMouseLeave={onContainerLeave}
      onWheelCapture={onWheel}
      style={{
      position: 'relative',
      width: '100%',
      height: 'min(80vh, 950px)',
      minHeight: 600,
      background: 'linear-gradient(135deg, #060917 0%, #10162e 55%, #1a1633 100%)',
      borderRadius: 18,
      overflow: 'hidden',
      overscrollBehavior: 'contain',
      border: '1px solid rgba(255,255,255,0.08)',
      boxShadow: '0 24px 80px rgba(0,0,0,0.5), inset 0 0 120px rgba(173,111,255,0.08), inset 0 0 90px rgba(34,214,238,0.08)',
    }}>
      {/* Header */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 20px',
        background: 'linear-gradient(90deg, rgba(8,13,28,0.88), rgba(28,18,48,0.75))',
        backdropFilter: 'blur(10px)',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontWeight: 800, letterSpacing: 1, color: '#ff9a9e', fontSize: 16 }}>
            CODELENS<span style={{ color: '#fbc2eb' }}>.</span>
          </span>
          <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, borderLeft: '1px solid rgba(255,255,255,0.15)', paddingLeft: 14 }}>
            Global Memory Graph
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Legend */}
          <div style={{ display: 'flex', gap: 10, padding: '4px 12px', background: 'rgba(0,0,0,0.25)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)' }}>
            {Object.entries(NODE_PALETTE).filter(([k]) => k !== 'unknown').map(([kind, c]) => (
              <div key={kind} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: c.stroke, boxShadow: `0 0 10px ${withAlpha(c.stroke, 0.9)}` }} />
                <span style={{ fontSize: 10, color: '#c8d2ff', textTransform: 'uppercase', fontWeight: 700 }}>{kind}</span>
              </div>
            ))}
          </div>
          <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#cdd6ff', padding: '5px 12px', background: 'rgba(64,117,255,0.16)', borderRadius: 10, border: '1px solid rgba(150,190,255,0.2)' }}>
            {info.count} nodes · {info.edges} links
          </span>
          <button
            onClick={onZoomOut}
            style={{ padding: '5px 10px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 8, color: '#e8ebff', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}
            title="Zoom Out"
            aria-label="Zoom Out"
          >
            -
          </button>
          <button
            onClick={onZoomIn}
            style={{ padding: '5px 10px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 8, color: '#e8ebff', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}
            title="Zoom In"
            aria-label="Zoom In"
          >
            +
          </button>
          <button
            onClick={resetView}
            style={{ padding: '5px 12px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 8, color: '#e8ebff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
          >
            ⛶ Reset
          </button>
        </div>
      </div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', left: 0, right: 0, top: 52, bottom: 0, width: '100%', height: 'calc(100% - 52px)', cursor: 'default' }}
        onMouseMove={onMouseMove}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      />

      {/* Insight panel inspired by semantic graph dashboards */}
      <div style={{
        position: 'absolute',
        right: 16,
        top: 74,
        zIndex: 12,
        width: 250,
        maxWidth: 'calc(100% - 32px)',
        padding: 12,
        borderRadius: 12,
        background: 'linear-gradient(180deg, rgba(6,10,20,0.9), rgba(12,18,35,0.82))',
        border: '1px solid rgba(255,255,255,0.12)',
        boxShadow: '0 12px 36px rgba(0,0,0,0.45)',
        backdropFilter: 'blur(8px)',
      }}>
        <div style={{ color: '#b8c6ff', fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10 }}>
          Network Insights
        </div>

        {info.topKinds.map((item) => (
          <div key={item.kind} style={{ marginBottom: 7 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
              <span style={{ color: '#dce5ff', textTransform: 'capitalize' }}>{item.kind}</span>
              <span style={{ color: '#a6b8ff' }}>{item.pct}%</span>
            </div>
            <div style={{ height: 7, borderRadius: 999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${item.pct}%`,
                borderRadius: 999,
                background: item.color,
                boxShadow: `0 0 14px ${withAlpha(item.color, 0.8)}`,
              }} />
            </div>
          </div>
        ))}

        <div style={{ marginTop: 10, paddingTop: 9, borderTop: '1px solid rgba(255,255,255,0.1)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div style={{ padding: '6px 8px', borderRadius: 8, background: 'rgba(255,255,255,0.05)' }}>
            <div style={{ color: '#93a2d7', fontSize: 10 }}>Structure</div>
            <div style={{ color: '#dce5ff', fontWeight: 700, fontSize: 12 }}>{structureLabel(info.density)}</div>
          </div>
          <div style={{ padding: '6px 8px', borderRadius: 8, background: 'rgba(255,255,255,0.05)' }}>
            <div style={{ color: '#93a2d7', fontSize: 10 }}>Density</div>
            <div style={{ color: '#dce5ff', fontWeight: 700, fontSize: 12 }}>{info.density.toFixed(3)}</div>
          </div>
          <div style={{ padding: '6px 8px', borderRadius: 8, background: 'rgba(255,255,255,0.05)' }}>
            <div style={{ color: '#93a2d7', fontSize: 10 }}>Components</div>
            <div style={{ color: '#dce5ff', fontWeight: 700, fontSize: 12 }}>{info.components}</div>
          </div>
          <div style={{ padding: '6px 8px', borderRadius: 8, background: 'rgba(255,255,255,0.05)' }}>
            <div style={{ color: '#93a2d7', fontSize: 10 }}>Bridges</div>
            <div style={{ color: '#dce5ff', fontWeight: 700, fontSize: 12 }}>{info.bridgeCount}</div>
          </div>
        </div>
      </div>

      {/* Always-visible zoom controls */}
      <div style={{
        position: 'absolute',
        left: 16,
        bottom: 14,
        zIndex: 14,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: 8,
        borderRadius: 12,
        background: 'rgba(7,12,24,0.82)',
        border: '1px solid rgba(255,255,255,0.14)',
        boxShadow: '0 8px 28px rgba(0,0,0,0.4)',
        backdropFilter: 'blur(8px)',
      }}>
        <button
          onClick={onZoomOut}
          style={{
            width: 34,
            height: 34,
            borderRadius: 8,
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.18)',
            color: '#e8ebff',
            cursor: 'pointer',
            fontSize: 18,
            fontWeight: 700,
            lineHeight: '30px',
          }}
          title="Zoom Out"
          aria-label="Zoom Out"
        >
          -
        </button>
        <button
          onClick={onZoomIn}
          style={{
            width: 34,
            height: 34,
            borderRadius: 8,
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.18)',
            color: '#e8ebff',
            cursor: 'pointer',
            fontSize: 18,
            fontWeight: 700,
            lineHeight: '30px',
          }}
          title="Zoom In"
          aria-label="Zoom In"
        >
          +
        </button>
        <span style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 0.6,
          color: 'rgba(220,229,255,0.88)',
          textTransform: 'uppercase',
          userSelect: 'none',
        }}>
          Zoom
        </span>
      </div>

      {/* Controls hint */}
      <div style={{
        position: 'absolute', bottom: 12, right: 16, zIndex: 10,
        fontFamily: 'monospace', fontSize: 10, color: 'rgba(220,229,255,0.45)',
        display: 'flex', gap: 14,
      }}>
        <span>Scroll to zoom</span>
        <span>Drag to pan</span>
      </div>
    </div>
  );
}

const center = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: '100%', height: '100%', minHeight: 400,
  background: '#13131f', borderRadius: 16,
};
