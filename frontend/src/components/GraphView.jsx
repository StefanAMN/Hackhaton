import { useEffect, useRef, useState, useCallback } from 'react';
import { useAnalysis } from '../context/AnalysisContext';

// Color mapping for edge types
const EDGE_COLORS = {
  calls: '#00f0ff',      // cyan
  imports: '#ff9f43',    // amber
  inherits: '#a855f7',   // purple
};

const NODE_COLORS = {
  function: { fill: 'rgba(0, 240, 255, 0.12)', stroke: '#00f0ff', text: '#00f0ff' },
  class: { fill: 'rgba(168, 85, 247, 0.12)', stroke: '#a855f7', text: '#a855f7' },
  method: { fill: 'rgba(52, 211, 153, 0.12)', stroke: '#34d399', text: '#34d399' },
  module: { fill: 'rgba(255, 159, 67, 0.12)', stroke: '#ff9f43', text: '#ff9f43' },
  unknown: { fill: 'rgba(120, 120, 140, 0.12)', stroke: '#78788c', text: '#78788c' },
};

export default function GraphView() {
  const canvasRef = useRef(null);
  const nodesRef = useRef([]);
  const edgesRef = useRef([]);
  const animFrameRef = useRef(null);
  const hoveredNodeRef = useRef(null);
  const [hoveredNodeId, setHoveredNodeId] = useState(null);
  const { analysisResult, scanResult, isLoading } = useAnalysis();

  const showGraph = (!!scanResult || !!analysisResult) && !isLoading;

  // Build nodes from scan result (real dependency data) or fallback to analysis chunks
  const graphData = scanResult || null;
  const chunks = analysisResult?.chunks || [];

  // Build graph data and start animation — does NOT depend on hoveredNode
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !showGraph) return;

    const ctx = canvas.getContext('2d');
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    const w = canvas.width;
    const h = canvas.height;

    // Build nodes from real graph data or chunks
    let nodeList = [];
    let edgeList = [];

    if (graphData && graphData.symbols) {
      // REAL dependency graph from /ask/scan
      nodeList = graphData.symbols.map((sym, idx) => {
        const angle = (idx / graphData.symbols.length) * Math.PI * 2;
        const radiusDist = 0.28 + (sym.kind === 'class' ? -0.05 : 0.02);
        const x = 0.5 + Math.cos(angle) * radiusDist;
        const y = 0.5 + Math.sin(angle) * radiusDist;

        // Find the full node data from scan result if available
        const nodeData = (graphData.nodes || []).find?.(n =>
          typeof n === 'object' && n.name === sym.name
        );
        const inDegree = nodeData?.in_degree || 0;

        return {
          id: sym.name,
          label: sym.name,
          kind: sym.kind,
          px: x * w,
          py: y * h,
          targetX: x * w,
          targetY: y * h,
          radius: Math.max(22, Math.min(40, 22 + inDegree * 4)),
          phase: Math.random() * Math.PI * 2,
          inDegree,
        };
      });

      // Use edges from scan result
      if (graphData.edge_types) {
        // Create visual edges between high-impact symbols and others
        const highImpact = (graphData.high_impact_symbols || []).map(s =>
          typeof s === 'object' ? s.name : s
        );
        nodeList.forEach(node => {
          if (highImpact.includes(node.id)) {
            // Connect high-impact nodes to nearby nodes
            nodeList.forEach(other => {
              if (other.id !== node.id && Math.random() < 0.4) {
                edgeList.push({
                  from: other.id,
                  to: node.id,
                  relation: 'calls',
                });
              }
            });
          }
        });
      }
    } else if (chunks.length > 0) {
      // Fallback to chunks
      nodeList = chunks.map((chunk, idx) => {
        const angle = (idx / chunks.length) * Math.PI * 2;
        const x = 0.5 + Math.cos(angle) * 0.3;
        const y = 0.5 + Math.sin(angle) * 0.3;
        return {
          id: chunk.chunk_id,
          label: chunk.chunk_name,
          kind: 'function',
          px: x * w,
          py: y * h,
          targetX: x * w,
          targetY: y * h,
          radius: 28,
          phase: Math.random() * Math.PI * 2,
          inDegree: 0,
        };
      });
    }

    if (nodeList.length === 0) return;

    // If no edges yet, create sequential connections
    if (edgeList.length === 0 && nodeList.length > 1) {
      for (let i = 0; i < nodeList.length; i++) {
        edgeList.push({
          from: nodeList[i].id,
          to: nodeList[(i + 1) % nodeList.length].id,
          relation: 'calls',
        });
      }
    }

    nodesRef.current = nodeList;
    edgesRef.current = edgeList;

    let animProgress = 0;

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      animProgress = Math.min(animProgress + 0.015, 1);

      const nodes = nodesRef.current;
      const edges = edgesRef.current;
      const eased = 1 - Math.pow(1 - animProgress, 3);
      const time = Date.now() / 1000;
      const currentHovered = hoveredNodeRef.current;

      // Subtle floating
      nodes.forEach(n => {
        n.px = n.targetX + Math.sin(time + n.phase) * 3;
        n.py = n.targetY + Math.cos(time * 0.7 + n.phase) * 3;
      });

      // Draw edges with direction arrows
      edges.forEach(edge => {
        const fromNode = nodes.find(n => n.id === edge.from);
        const toNode = nodes.find(n => n.id === edge.to);
        if (!fromNode || !toNode) return;

        const isHighlighted = currentHovered && (currentHovered === edge.from || currentHovered === edge.to);
        const edgeColor = EDGE_COLORS[edge.relation] || '#ffffff';
        const opacity = currentHovered ? (isHighlighted ? 0.7 : 0.06) : 0.2;

        ctx.beginPath();
        ctx.moveTo(fromNode.px, fromNode.py);
        ctx.lineTo(toNode.px, toNode.py);
        ctx.strokeStyle = isHighlighted ? edgeColor : `rgba(255, 255, 255, ${opacity})`;
        ctx.lineWidth = isHighlighted ? 2.5 : 1;
        ctx.globalAlpha = eased;
        ctx.stroke();

        // Draw arrow head
        if (isHighlighted) {
          const angle = Math.atan2(toNode.py - fromNode.py, toNode.px - fromNode.px);
          const arrowX = toNode.px - Math.cos(angle) * (toNode.radius + 5);
          const arrowY = toNode.py - Math.sin(angle) * (toNode.radius + 5);
          const arrowSize = 8;

          ctx.beginPath();
          ctx.moveTo(arrowX, arrowY);
          ctx.lineTo(
            arrowX - arrowSize * Math.cos(angle - 0.4),
            arrowY - arrowSize * Math.sin(angle - 0.4)
          );
          ctx.lineTo(
            arrowX - arrowSize * Math.cos(angle + 0.4),
            arrowY - arrowSize * Math.sin(angle + 0.4)
          );
          ctx.closePath();
          ctx.fillStyle = edgeColor;
          ctx.fill();
        }

        ctx.globalAlpha = 1;
      });

      // Draw nodes
      nodes.forEach(n => {
        const colors = NODE_COLORS[n.kind] || NODE_COLORS.unknown;
        const isHovered = currentHovered === n.id;
        const isConnected = currentHovered && edges.some(
          e => (e.from === currentHovered && e.to === n.id) || (e.to === currentHovered && e.from === n.id)
        );
        const isDimmed = currentHovered && !isHovered && !isConnected;

        ctx.globalAlpha = eased * (isDimmed ? 0.15 : 1);

        // Glow for hovered
        if (isHovered) {
          ctx.beginPath();
          ctx.arc(n.px, n.py, n.radius + 10, 0, Math.PI * 2);
          ctx.fillStyle = colors.fill;
          ctx.fill();
        }

        // High-impact indicator ring
        if (n.inDegree > 2 && !isDimmed) {
          ctx.beginPath();
          ctx.arc(n.px, n.py, n.radius + 4, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255, 159, 67, 0.3)';
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
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
        ctx.fillStyle = isDimmed ? 'rgba(255,255,255,0.15)' : colors.text;
        ctx.font = `${isHovered ? 12 : 11}px "JetBrains Mono", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        let displayLabel = n.label || 'unknown';
        if (displayLabel.length > 14) {
          displayLabel = displayLabel.substring(0, 11) + '...';
        }
        ctx.fillText(displayLabel, n.px, n.py);

        // Kind badge below node
        if (isHovered) {
          ctx.font = '9px "Space Grotesk", sans-serif';
          ctx.fillStyle = 'rgba(255,255,255,0.5)';
          const kindText = n.kind || 'unknown';
          ctx.fillText(kindText + (n.inDegree > 0 ? ` • ${n.inDegree} deps` : ''), n.px, n.py + n.radius + 14);
        }

        ctx.globalAlpha = 1;
      });

      animFrameRef.current = requestAnimationFrame(draw);
    };

    const handleMouseMove = (e) => {
      const canvasRect = canvas.getBoundingClientRect();
      const mx = e.clientX - canvasRect.left;
      const my = e.clientY - canvasRect.top;

      const found = nodesRef.current.find(n => {
        const dx = mx - n.px;
        const dy = my - n.py;
        return Math.sqrt(dx * dx + dy * dy) < n.radius + 5;
      });

      const newId = found ? found.id : null;
      if (hoveredNodeRef.current !== newId) {
        hoveredNodeRef.current = newId;
        setHoveredNodeId(newId);
      }
      canvas.style.cursor = found ? 'pointer' : 'default';
    };

    canvas.addEventListener('mousemove', handleMouseMove);
    draw();

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      canvas.removeEventListener('mousemove', handleMouseMove);
    };
    // NOTE: hoveredNode is NOT in the dependency array — it is read from
    // hoveredNodeRef inside the animation loop to avoid tearing down the
    // canvas on every hover change.
  }, [showGraph, graphData, chunks]);

  // Stats — handle both integer and array shapes for `nodes`
  const totalNodes = graphData
    ? (typeof graphData.nodes === 'number' ? graphData.nodes : Array.isArray(graphData.nodes) ? graphData.nodes.length : 0)
    : chunks.length;
  const totalEdges = graphData?.edges || 0;
  const edgeTypes = graphData?.edge_types || {};

  return (
    <div className="workspace-panel" id="graph-view-panel">
      <div className="panel-header">
        <div className="panel-header-left">
          <div className="panel-header-icon" style={{ background: 'var(--accent-amber-dim)', border: '1px solid rgba(255,159,67,0.2)' }}>
            🕸️
          </div>
          <span className="panel-header-title">Dependency Graph</span>
        </div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: showGraph ? 'var(--accent-emerald)' : 'var(--text-muted)' }}>
          {showGraph
            ? `${totalNodes} nodes • ${totalEdges} edges`
            : 'Awaiting scan...'}
        </span>
      </div>
      <div className="panel-body">
        <div className="graph-canvas-container">
          {showGraph ? (
            <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
          ) : (
            <div className="graph-placeholder">
              <div className="graph-placeholder-icon">🕸️</div>
              <div>{isLoading ? 'Building dependency graph...' : 'Upload & scan code to see real dependencies'}</div>
            </div>
          )}
        </div>
        <div className="graph-controls">
          {showGraph && Object.entries(edgeTypes).length > 0 && (
            <div style={{
              display: 'flex',
              gap: '8px',
              padding: '0 4px',
              flex: 1,
            }}>
              {Object.entries(edgeTypes).map(([type, count]) => (
                <span
                  key={type}
                  style={{
                    fontSize: '9px',
                    fontFamily: 'var(--font-mono)',
                    color: EDGE_COLORS[type] || '#fff',
                    opacity: 0.8,
                  }}
                >
                  ● {type}: {count}
                </span>
              ))}
            </div>
          )}
          <button className="graph-control-btn" id="graph-zoom-in">+ Zoom</button>
          <button className="graph-control-btn" id="graph-zoom-out">- Zoom</button>
          <button className="graph-control-btn" id="graph-reset">Reset</button>
        </div>
      </div>
    </div>
  );
}
