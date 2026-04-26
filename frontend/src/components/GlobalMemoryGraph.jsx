import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { getGlobalGraph } from '../api/client';

// Cute, soft pastel neon colors
const NODE_COLORS = {
  function: { core: '#ff9a9e', glow: 'rgba(255, 154, 158, 0.3)' }, // Soft pink
  class: { core: '#a18cd1', glow: 'rgba(161, 140, 209, 0.3)' },   // Soft purple
  method: { core: '#8fd3f4', glow: 'rgba(143, 211, 244, 0.3)' },   // Soft blue
  module: { core: '#fbc2eb', glow: 'rgba(251, 194, 235, 0.3)' },   // Soft magenta
  unknown: { core: '#cfd9df', glow: 'rgba(207, 217, 223, 0.3)' },  // Soft grey
};

const EDGE_COLORS = {
  calls: '#ff9a9e',
  imports: '#fbc2eb',
  inherits: '#a18cd1',
};

export default function GlobalMemoryGraph() {
  const [graphData, setGraphData] = useState({ nodes: [], links: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Interactive state
  const [hoverNode, setHoverNode] = useState(null);
  const [hoverLink, setHoverLink] = useState(null);

  const graphRef = useRef();

  useEffect(() => {
    let mounted = true;

    async function fetchData() {
      try {
        setIsLoading(true);
        const data = await getGlobalGraph();
        if (!mounted) return;
        
        const nodesArray = Object.keys(data.nodes || {}).map(nodeId => {
          const n = data.nodes[nodeId];
          return {
            id: nodeId,
            name: n.name,
            kind: n.kind,
            val: Math.max(1, (n.in_degree || 0) + 1),
          };
        });

        const linksArray = (data.edges || []).map(e => ({
          source: e.source,
          target: e.target,
          relation: e.relation,
        }));

        setGraphData({ nodes: nodesArray, links: linksArray });
      } catch (err) {
        if (mounted) setError(err.message);
      } finally {
        if (mounted) setIsLoading(false);
      }
    }

    fetchData();
    return () => { mounted = false; };
  }, []);

  // Configure physics engine for less clutter, more "bouncy" cute feel
  useEffect(() => {
    if (graphRef.current && graphData.nodes.length > 0) {
      graphRef.current.d3Force('charge').strength(-300); // Spread nodes
      graphRef.current.d3Force('link').distance(80);     // Comfortable distance
    }
  }, [graphData]);

  const handleNodeClick = useCallback(node => {
    const distance = 40;
    const distRatio = 1 + distance/Math.hypot(node.x, node.y, node.z || 0);

    graphRef.current?.centerAt(node.x, node.y, 1000);
    graphRef.current?.zoom(8, 2000);
  }, [graphRef]);

  const hoverNeighbors = useMemo(() => {
    if (!hoverNode) return new Set();
    const neighbors = new Set();
    graphData.links.forEach(link => {
      const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
      const targetId = typeof link.target === 'object' ? link.target.id : link.target;
      if (sourceId === hoverNode.id) neighbors.add(targetId);
      if (targetId === hoverNode.id) neighbors.add(sourceId);
    });
    return neighbors;
  }, [hoverNode, graphData.links]);

  const paintNode = useCallback((node, ctx, globalScale) => {
    if (node.x === undefined || node.y === undefined) return;

    const isHovered = hoverNode === node;
    const isNeighbor = hoverNeighbors.has(node.id);
    const isDimmed = hoverNode && !isHovered && !isNeighbor;
    
    const colors = NODE_COLORS[node.kind] || NODE_COLORS.unknown;
    
    // Size based on degree, but keep it plump and cute
    const baseRadius = 5 + Math.sqrt(node.val || 1) * 1.2;
    const radius = isHovered ? baseRadius * 1.2 : baseRadius;

    ctx.globalAlpha = isDimmed ? 0.2 : 1;

    // Soft outer glow
    ctx.beginPath();
    ctx.arc(node.x, node.y, radius * 1.8, 0, 2 * Math.PI, false);
    ctx.fillStyle = colors.glow;
    ctx.fill();

    // Solid cute pastel core
    ctx.beginPath();
    ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
    ctx.fillStyle = colors.core;
    ctx.fill();
    
    // Thick white outline for that sticker/cute effect
    ctx.lineWidth = isHovered ? 2.5 / globalScale : 1.5 / globalScale;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    // Cute node icon inside
    const iconMap = { function: '♥', class: '✿', method: '✦', module: '★', unknown: '?' };
    ctx.fillStyle = '#ffffff'; 
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${radius * 1.1}px Inter, sans-serif`;
    ctx.fillText(iconMap[node.kind] || iconMap.unknown, node.x, node.y);

    // --- Draw Node Label underneath with cute pill ---
    const label = node.name || 'unknown';
    const fontSize = isHovered ? 14 / globalScale : 11 / globalScale;
    ctx.font = `bold ${fontSize}px Inter, sans-serif`;
    const textWidth = ctx.measureText(label).width;
    const paddingX = 6 / globalScale;
    const paddingY = 3 / globalScale;
    const bckgDimensions = [textWidth, fontSize].map(n => n + paddingX * 2); 
    
    const labelY = node.y + radius * 1.8 + paddingY;

    // Pill background
    ctx.fillStyle = isHovered ? colors.core : 'rgba(30, 30, 46, 0.9)'; 
    const rectX = node.x - bckgDimensions[0] / 2;
    const rectY = labelY - bckgDimensions[1] / 2;
    
    // Round pill using arc for left and right edges (since roundRect might crash)
    const pillRadius = bckgDimensions[1] / 2;
    ctx.beginPath();
    ctx.arc(rectX + pillRadius, labelY, pillRadius, Math.PI / 2, Math.PI * 1.5);
    ctx.lineTo(rectX + bckgDimensions[0] - pillRadius, rectY);
    ctx.arc(rectX + bckgDimensions[0] - pillRadius, labelY, pillRadius, Math.PI * 1.5, Math.PI / 2);
    ctx.closePath();
    ctx.fill();
    
    // Border for pill
    ctx.strokeStyle = isHovered ? '#ffffff' : colors.core;
    ctx.lineWidth = 1 / globalScale;
    ctx.stroke();

    // Text
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, node.x, labelY);

    ctx.globalAlpha = 1;
  }, [hoverNode, hoverNeighbors]);

  // RESTORED: Custom edge drawing so we can have cute edge labels back!
  const paintLink = useCallback((link, ctx, globalScale) => {
    const start = link.source;
    const end = link.target;

    if (!start.x || !start.y || !end.x || !end.y) return;

    const isHovered = hoverLink === link || 
                      (hoverNode && (start.id === hoverNode.id || end.id === hoverNode.id));
    const isDimmed = (hoverNode || hoverLink) && !isHovered;

    ctx.globalAlpha = isDimmed ? 0.15 : (isHovered ? 1 : 0.6);
    const color = EDGE_COLORS[link.relation] || '#ffffff';

    // --- Draw edge label in the middle ---
    const midX = start.x + (end.x - start.x) / 2;
    const midY = start.y + (end.y - start.y) / 2;
    
    let angle = Math.atan2(end.y - start.y, end.x - start.x);
    if (angle > Math.PI / 2 || angle < -Math.PI / 2) {
      angle += Math.PI;
    }

    ctx.save();
    ctx.translate(midX, midY);
    ctx.rotate(angle);

    const label = link.relation || 'linked';
    const fontSize = isHovered ? 9 / globalScale : 7 / globalScale;
    ctx.font = `bold ${fontSize}px Inter, sans-serif`;
    const textWidth = ctx.measureText(label).width;
    const paddingX = 4 / globalScale;
    const paddingY = 2 / globalScale;

    const boxW = textWidth + paddingX * 2;
    const boxH = fontSize + paddingY * 2;
    const rX = -boxW / 2;
    const rY = -boxH / 2;

    // Cute pill for edge label
    ctx.fillStyle = 'rgba(30, 30, 46, 0.9)';
    const pillRadius = boxH / 2;
    ctx.beginPath();
    ctx.arc(rX + pillRadius, 0, pillRadius, Math.PI / 2, Math.PI * 1.5);
    ctx.lineTo(rX + boxW - pillRadius, rY);
    ctx.arc(rX + boxW - pillRadius, 0, pillRadius, Math.PI * 1.5, Math.PI / 2);
    ctx.closePath();
    ctx.fill();
    
    ctx.strokeStyle = color;
    ctx.lineWidth = 1 / globalScale;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = isHovered ? color : '#e5e7eb';
    ctx.fillText(label, 0, 0);

    ctx.restore();
    ctx.globalAlpha = 1;
  }, [hoverNode, hoverLink]);

  if (isLoading) {
    return (
      <div className="workspace-panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <p>Loading memory graph...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="workspace-panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'red' }}>
        <p>Error: {error}</p>
      </div>
    );
  }

  if (graphData.nodes.length === 0) {
    return (
      <div className="workspace-panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <div className="graph-placeholder">
          <div className="graph-placeholder-icon">🕸️</div>
          <p>Global memory graph is empty. Upload some code to start building it!</p>
        </div>
      </div>
    );
  }

  return (
    <div className="workspace-panel" style={{ padding: 0, overflow: 'hidden', height: '700px', display: 'flex', flexDirection: 'column' }}>
        <div className="panel-header" style={{ position: 'absolute', zIndex: 10, background: 'rgba(30, 30, 46, 0.85)', backdropFilter: 'blur(8px)', width: '100%', borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '12px 20px', display: 'flex', justifyContent: 'space-between' }}>
            <div className="panel-header-left" style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                <div style={{ fontSize: '18px', fontWeight: 'bold', letterSpacing: '1px', color: '#ff9a9e' }}>CODELENS<span style={{ color: '#fbc2eb' }}>.</span></div>
                <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '14px', borderLeft: '1px solid rgba(255,255,255,0.2)', paddingLeft: '15px' }}>Global Memory Model</div>
            </div>
            
            <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                 <div style={{ display: 'flex', gap: '8px', padding: '4px 10px', background: 'rgba(0,0,0,0.2)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)' }}>
                     {Object.entries(NODE_COLORS).filter(([k]) => k !== 'unknown').map(([kind, color]) => (
                         <div key={kind} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: color.core, border: '1px solid #fff' }}></div>
                            <span style={{ fontSize: '11px', color: '#ccc', textTransform: 'uppercase', fontWeight: '600' }}>{kind}</span>
                         </div>
                     ))}
                 </div>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: '#a18cd1', padding: '6px 12px', background: 'rgba(161, 140, 209, 0.1)', borderRadius: '12px', fontWeight: 'bold' }}>
                   {graphData.nodes.length} nodes • {graphData.links.length} edges
                </span>
                <button className="btn btn-ghost" style={{ padding: '6px 10px', minWidth: '0', borderRadius: '12px', background: 'rgba(255,255,255,0.1)' }} onClick={() => graphRef.current?.zoomToFit(400, 50)}>⛶</button>
            </div>
        </div>

      <ForceGraph2D
        ref={graphRef}
        graphData={graphData}
        
        nodeCanvasObject={paintNode}
        
        // Restore edge rendering so we have labels!
        linkCanvasObject={paintLink}
        linkCanvasObjectMode={() => 'after'}
        
        linkCurvature={0.2}
        linkColor={link => {
            const isHovered = hoverLink === link || (hoverNode && (link.source.id === hoverNode.id || link.target.id === hoverNode.id));
            const isDimmed = (hoverNode || hoverLink) && !isHovered;
            if (isDimmed) return 'rgba(255,255,255,0.05)';
            if (isHovered) return '#ffffff'; 
            return EDGE_COLORS[link.relation] || 'rgba(255,255,255,0.2)';
        }}
        linkWidth={link => {
            const isHovered = hoverLink === link || (hoverNode && (link.source.id === hoverNode.id || link.target.id === hoverNode.id));
            return isHovered ? 3 : 1.5;
        }}
        
        nodeLabel={() => ''}
        
        // Directional arrows
        linkDirectionalArrowLength={5}
        linkDirectionalArrowRelPos={1}
        linkDirectionalArrowColor={link => {
            const isHovered = hoverLink === link || (hoverNode && (link.source.id === hoverNode.id || link.target.id === hoverNode.id));
            return isHovered ? '#ffffff' : (EDGE_COLORS[link.relation] || '#fff');
        }}
        
        onNodeClick={handleNodeClick}
        onNodeHover={setHoverNode}
        onLinkHover={setHoverLink}
        
        backgroundColor="#1e1e2f" // Soft dark purple background
        width={window.innerWidth > 1200 ? 1200 : window.innerWidth - 40}
        height={700}
      />
    </div>
  );
}
