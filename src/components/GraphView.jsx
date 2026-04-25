import { useEffect, useRef, useState } from 'react';

// Placeholder graph data — will be replaced by backend output
const PLACEHOLDER_NODES = [
  { id: 'calculate_total', label: 'calculate_total()', type: 'function', x: 0.5, y: 0.3 },
  { id: 'get_subtotal', label: 'get_subtotal()', type: 'function', x: 0.25, y: 0.55 },
  { id: 'apply_tax', label: 'apply_tax()', type: 'function', x: 0.75, y: 0.55 },
  { id: 'check_promo', label: 'check_promo()', type: 'function', x: 0.5, y: 0.75 },
  { id: 'TAX_RATE', label: 'TAX_RATE', type: 'variable', x: 0.85, y: 0.35 },
  { id: 'cart', label: 'cart[]', type: 'variable', x: 0.15, y: 0.35 },
];

const PLACEHOLDER_EDGES = [
  { from: 'calculate_total', to: 'get_subtotal' },
  { from: 'calculate_total', to: 'apply_tax' },
  { from: 'calculate_total', to: 'check_promo' },
  { from: 'apply_tax', to: 'TAX_RATE' },
  { from: 'get_subtotal', to: 'cart' },
  { from: 'check_promo', to: 'cart' },
];

export default function GraphView() {
  const canvasRef = useRef(null);
  const [hoveredNode, setHoveredNode] = useState(null);
  const [showGraph, setShowGraph] = useState(false);
  const nodesRef = useRef([]);
  const animFrameRef = useRef(null);

  useEffect(() => {
    // Simulate showing graph after a short delay
    const timer = setTimeout(() => setShowGraph(true), 500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !showGraph) return;

    const ctx = canvas.getContext('2d');
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    const w = canvas.width;
    const h = canvas.height;

    // Initialize node positions
    nodesRef.current = PLACEHOLDER_NODES.map((n) => ({
      ...n,
      px: n.x * w,
      py: n.y * h,
      targetX: n.x * w,
      targetY: n.y * h,
      radius: n.type === 'function' ? 28 : 22,
      phase: Math.random() * Math.PI * 2,
    }));

    let animProgress = 0;

    const getColor = (type) => {
      if (type === 'function') return { fill: 'rgba(0, 240, 255, 0.12)', stroke: '#00f0ff', text: '#00f0ff' };
      return { fill: 'rgba(255, 159, 67, 0.12)', stroke: '#ff9f43', text: '#ff9f43' };
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      animProgress = Math.min(animProgress + 0.015, 1);

      const nodes = nodesRef.current;
      const eased = 1 - Math.pow(1 - animProgress, 3);

      // Subtle floating
      const time = Date.now() / 1000;
      nodes.forEach((n) => {
        n.px = n.targetX + Math.sin(time + n.phase) * 3;
        n.py = n.targetY + Math.cos(time * 0.7 + n.phase) * 3;
      });

      // Draw edges
      PLACEHOLDER_EDGES.forEach((edge) => {
        const fromNode = nodes.find((n) => n.id === edge.from);
        const toNode = nodes.find((n) => n.id === edge.to);
        if (!fromNode || !toNode) return;

        const isHighlighted = hoveredNode && (hoveredNode === edge.from || hoveredNode === edge.to);
        const opacity = hoveredNode ? (isHighlighted ? 0.6 : 0.08) : 0.25;

        ctx.beginPath();
        ctx.moveTo(fromNode.px, fromNode.py);
        ctx.lineTo(toNode.px, toNode.py);
        ctx.strokeStyle = isHighlighted ? '#00f0ff' : `rgba(255, 255, 255, ${opacity})`;
        ctx.lineWidth = isHighlighted ? 2 : 1;
        ctx.globalAlpha = eased;
        ctx.stroke();
        ctx.globalAlpha = 1;
      });

      // Draw nodes
      nodes.forEach((n) => {
        const colors = getColor(n.type);
        const isHovered = hoveredNode === n.id;
        const isConnected = hoveredNode && PLACEHOLDER_EDGES.some(
          (e) => (e.from === hoveredNode && e.to === n.id) || (e.to === hoveredNode && e.from === n.id)
        );
        const isDimmed = hoveredNode && !isHovered && !isConnected && hoveredNode !== n.id;

        ctx.globalAlpha = eased * (isDimmed ? 0.2 : 1);

        // Glow
        if (isHovered) {
          ctx.beginPath();
          ctx.arc(n.px, n.py, n.radius + 8, 0, Math.PI * 2);
          ctx.fillStyle = colors.fill;
          ctx.fill();
        }

        // Node circle
        ctx.beginPath();
        ctx.arc(n.px, n.py, n.radius, 0, Math.PI * 2);
        ctx.fillStyle = isDimmed ? 'rgba(20, 20, 40, 0.6)' : colors.fill;
        ctx.fill();
        ctx.strokeStyle = colors.stroke;
        ctx.lineWidth = isHovered ? 2.5 : 1.5;
        ctx.stroke();

        // Label
        ctx.fillStyle = isDimmed ? 'rgba(255,255,255,0.2)' : colors.text;
        ctx.font = `${n.type === 'function' ? '11' : '10'}px "JetBrains Mono", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(n.label, n.px, n.py);

        ctx.globalAlpha = 1;
      });

      animFrameRef.current = requestAnimationFrame(draw);
    };

    const handleMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const found = nodesRef.current.find((n) => {
        const dx = mx - n.px;
        const dy = my - n.py;
        return Math.sqrt(dx * dx + dy * dy) < n.radius + 5;
      });

      setHoveredNode(found ? found.id : null);
      canvas.style.cursor = found ? 'pointer' : 'default';
    };

    canvas.addEventListener('mousemove', handleMouseMove);
    draw();

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      canvas.removeEventListener('mousemove', handleMouseMove);
    };
  }, [showGraph, hoveredNode]);

  return (
    <div className="workspace-panel" id="graph-view-panel">
      <div className="panel-header">
        <div className="panel-header-left">
          <div className="panel-header-icon" style={{ background: 'var(--accent-amber-dim)', border: '1px solid rgba(255,159,67,0.2)' }}>
            🕸️
          </div>
          <span className="panel-header-title">Dependency Graph</span>
        </div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)' }}>
          {showGraph ? '6 nodes · 6 edges' : 'Awaiting scan...'}
        </span>
      </div>
      <div className="panel-body">
        <div className="graph-canvas-container">
          {showGraph ? (
            <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
          ) : (
            <div className="graph-placeholder">
              <div className="graph-placeholder-icon">🕸️</div>
              <div>Upload & scan code to see the dependency graph</div>
            </div>
          )}
        </div>
        <div className="graph-controls">
          <button className="graph-control-btn" id="graph-zoom-in">+ Zoom</button>
          <button className="graph-control-btn" id="graph-zoom-out">- Zoom</button>
          <button className="graph-control-btn" id="graph-reset">Reset</button>
          <button className="graph-control-btn" id="graph-filter">Filter</button>
        </div>
      </div>
    </div>
  );
}
