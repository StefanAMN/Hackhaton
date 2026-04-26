import React, { useEffect, useRef, useState, useCallback } from 'react';
import { getGlobalGraph } from '../api/client';

const NODE_PALETTE = {
  function: { fill: 'rgba(255,154,158,0.18)', stroke: '#ff9a9e', text: '#ffbfc2' },
  class:    { fill: 'rgba(161,140,209,0.18)', stroke: '#a18cd1', text: '#c8b8ff' },
  method:   { fill: 'rgba(143,211,244,0.18)', stroke: '#8fd3f4', text: '#b5e8ff' },
  module:   { fill: 'rgba(251,194,235,0.18)', stroke: '#fbc2eb', text: '#ffdaf6' },
  unknown:  { fill: 'rgba(180,180,200,0.12)', stroke: '#aaa', text: '#ccc' },
};

const EDGE_PALETTE = {
  calls:    '#ff9a9e',
  imports:  '#fbc2eb',
  inherits: '#a18cd1',
};

const NODE_R = 38;          // base radius
const REPULSION = 28000;    // repulsion constant
const ATTRACT = 0.003;      // spring constant
const REST_LEN = 260;       // ideal edge length
const DAMPING = 0.78;       // velocity damping
const ITERATIONS = 200;     // pre-bake iterations before first draw

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
  const canvasRef = useRef(null);
  const stateRef  = useRef({ nodes: [], edges: [], nodeMap: {}, pan: { x: 0, y: 0 }, zoom: 1, dragging: null, lastMouse: null, hoveredId: null, animFrame: null });
  const [info, setInfo]       = useState({ count: 0, edges: 0 });
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
    const { nodes, edges, nodeMap, pan, zoom, hoveredId } = stateRef.current;
    const W = canvas.width, H = canvas.height;

    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = '#13131f';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(W / 2 + pan.x, H / 2 + pan.y);
    ctx.scale(zoom, zoom);
    ctx.translate(-W / 2, -H / 2);

    // Draw edges first
    edges.forEach(e => {
      const a = nodeMap[e.from];
      const b = nodeMap[e.to];
      if (!a || !b) return;

      const isHov = hoveredId === a.id || hoveredId === b.id;
      const color = EDGE_PALETTE[e.relation] || '#888';
      ctx.globalAlpha = isHov ? 0.95 : (hoveredId ? 0.12 : 0.45);

      // Line
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = isHov ? color : '#aaaacc';
      ctx.lineWidth = isHov ? 2 : 1.2;
      ctx.stroke();

      // Arrowhead at ~80% towards b (stops before node edge)
      const t = 0.78;
      const ax = a.x + (b.x - a.x) * t;
      const ay = a.y + (b.y - a.y) * t;
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const aLen = isHov ? 14 : 9;

      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax - aLen * Math.cos(angle - 0.38), ay - aLen * Math.sin(angle - 0.38));
      ctx.lineTo(ax - aLen * Math.cos(angle + 0.38), ay - aLen * Math.sin(angle + 0.38));
      ctx.closePath();
      ctx.fillStyle = isHov ? color : '#aaaacc';
      ctx.fill();

      // Edge label at midpoint
      if (isHov && e.relation) {
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        ctx.globalAlpha = 1;
        ctx.font = 'bold 11px Inter, sans-serif';
        const tw = ctx.measureText(e.relation).width + 10;
        const th = 16;
        ctx.fillStyle = 'rgba(20,20,40,0.88)';
        ctx.beginPath();
        ctx.roundRect(mx - tw / 2, my - th / 2, tw, th, 6);
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(e.relation, mx, my);
      }
    });

    ctx.globalAlpha = 1;

    // Draw nodes
    nodes.forEach(n => {
      const colors = NODE_PALETTE[n.kind] || NODE_PALETTE.unknown;
      const isHov = hoveredId === n.id;
      const isDim = hoveredId && !isHov;
      ctx.globalAlpha = isDim ? 0.18 : 1;

      const r = NODE_R + (isHov ? 6 : 0);

      // Outer glow
      if (isHov) {
        const grad = ctx.createRadialGradient(n.x, n.y, r * 0.5, n.x, n.y, r * 2);
        grad.addColorStop(0, colors.stroke + '44');
        grad.addColorStop(1, 'transparent');
        ctx.beginPath();
        ctx.arc(n.x, n.y, r * 2, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
      }

      // Fill
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = colors.fill;
      ctx.fill();

      // Border
      ctx.strokeStyle = colors.stroke;
      ctx.lineWidth = isHov ? 2.5 : 1.5;
      ctx.stroke();

      // Label — always show full name, wrap if needed
      ctx.globalAlpha = isDim ? 0.18 : 1;
      const label = n.label || n.id || 'unknown';
      const fontSize = isHov ? 13 : 11;
      ctx.font = `bold ${fontSize}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Word-wrap by character width
      const maxW = r * 2 - 8;
      let display = label;
      if (ctx.measureText(label).width > maxW) {
        // Find break point
        let cut = label.length;
        while (cut > 1 && ctx.measureText(label.slice(0, cut) + '…').width > maxW) cut--;
        display = label.slice(0, cut) + '…';
      }

      // Draw text with subtle shadow for readability
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 4;
      ctx.fillStyle = colors.text;
      ctx.fillText(display, n.x, n.y);
      ctx.shadowBlur = 0;

      // Kind tag below node
      ctx.font = `10px Inter, sans-serif`;
      ctx.fillStyle = colors.stroke;
      ctx.globalAlpha = isDim ? 0.1 : (isHov ? 0.9 : 0.55);
      ctx.fillText(n.kind, n.x, n.y + r + 13);
    });

    ctx.globalAlpha = 1;
    ctx.restore();

    stateRef.current.animFrame = requestAnimationFrame(draw);
  }, []);

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

      const size = syncCanvasSize();
      const W = size?.W || 1200;
      const H = size?.H || 700;

      // Centre layout on canvas midpoint
      const nodeMap = buildLayout(rawNodes, rawEdges, W, H);
      stateRef.current.nodes   = rawNodes;
      stateRef.current.edges   = rawEdges;
      stateRef.current.nodeMap = nodeMap;
      stateRef.current.pan     = { x: 0, y: 0 };
      stateRef.current.zoom    = 1;

      setInfo({ count: rawNodes.length, edges: rawEdges.length });
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
      return Math.hypot(dx, dy) <= NODE_R + 6;
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

  const onWheel = useCallback(e => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    stateRef.current.zoom = Math.max(0.2, Math.min(5, stateRef.current.zoom * factor));
  }, []);

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
    <div style={{ position: 'relative', width: '100%', height: 'min(78vh, 920px)', minHeight: 560, background: '#13131f', borderRadius: 16, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 20px',
        background: 'rgba(20,20,38,0.85)',
        backdropFilter: 'blur(10px)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
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
                <div style={{ width: 9, height: 9, borderRadius: '50%', background: c.stroke }} />
                <span style={{ fontSize: 10, color: '#bbb', textTransform: 'uppercase', fontWeight: 600 }}>{kind}</span>
              </div>
            ))}
          </div>
          <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#a18cd1', padding: '5px 12px', background: 'rgba(161,140,209,0.1)', borderRadius: 10 }}>
            {info.count} nodes · {info.edges} edges
          </span>
          <button
            onClick={resetView}
            style={{ padding: '5px 12px', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, color: '#ccc', cursor: 'pointer', fontSize: 12 }}
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
        onWheel={onWheel}
      />

      {/* Controls hint */}
      <div style={{
        position: 'absolute', bottom: 12, right: 16, zIndex: 10,
        fontFamily: 'monospace', fontSize: 10, color: 'rgba(255,255,255,0.25)',
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
