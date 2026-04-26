import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { getGlobalGraph } from '../api/client';

const NODE_COLORS = {
  function: { core: '#00f0ff', glow: 'rgba(0, 240, 255, 0.2)' },
  class: { core: '#a855f7', glow: 'rgba(168, 85, 247, 0.2)' },
  method: { core: '#34d399', glow: 'rgba(52, 211, 153, 0.2)' },
  module: { core: '#ff9f43', glow: 'rgba(255, 159, 67, 0.2)' },
  unknown: { core: '#78788c', glow: 'rgba(120, 120, 140, 0.2)' },
};

const EDGE_COLORS = {
  calls: '#00f0ff',
  imports: '#ff9f43',
  inherits: '#a855f7',
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

  // Configure physics engine for less clutter
  useEffect(() => {
    if (graphRef.current && graphData.nodes.length > 0) {
      // Repel nodes strongly so they are not clumped
      graphRef.current.d3Force('charge').strength(-400);
      // Make edges longer
      graphRef.current.d3Force('link').distance(100);
    }
  }, [graphData]);

  const handleNodeClick = useCallback(node => {
    const distance = 40;
    const distRatio = 1 + distance/Math.hypot(node.x, node.y, node.z || 0);

    graphRef.current?.centerAt(node.x, node.y, 1000);
    graphRef.current?.zoom(8, 2000);
  }, [graphRef]);

  // Compute a map of neighboring nodes for the hovered node
  const hoverNeighbors = useMemo(() => {
    if (!hoverNode) return new Set();
    const neighbors = new Set();
    graphData.links.forEach(link => {
      // link.source and target might be objects if ForceGraph has already processed them, or IDs if not
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
    
    // Size based on degree (made smaller overall to balance with text)
    const baseRadius = 2 + Math.sqrt(node.val || 1) * 0.8;
    const radius = isHovered ? baseRadius * 1.5 : baseRadius;

    ctx.globalAlpha = isDimmed ? 0.2 : 1;

    // Draw selection box / extra glow if hovered
    if (isHovered) {
      // Like the reference image: a glowing box around the node
      const boxWidth = radius * 8;
      const boxHeight = radius * 5;
      ctx.strokeStyle = colors.core;
      ctx.lineWidth = 1 / globalScale;
      ctx.strokeRect(node.x - boxWidth/2, node.y - boxHeight/2 - radius, boxWidth, boxHeight);
      
      // Draw a subtle background for the box
      ctx.fillStyle = colors.glow;
      ctx.fillRect(node.x - boxWidth/2, node.y - boxHeight/2 - radius, boxWidth, boxHeight);
    }

    // Outer glow (neon effect)
    ctx.beginPath();
    ctx.arc(node.x, node.y, radius * 2.5, 0, 2 * Math.PI, false);
    ctx.fillStyle = colors.glow;
    ctx.fill();

    // Inner core
    ctx.beginPath();
    ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
    
    // Gradient for core
    const gradient = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, radius);
    gradient.addColorStop(0, '#ffffff'); // bright center
    gradient.addColorStop(0.5, colors.core);
    gradient.addColorStop(1, colors.core);
    
    ctx.fillStyle = gradient;
    ctx.fill();
    
    // Outline
    ctx.lineWidth = isHovered ? 2 / globalScale : 1 / globalScale;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    // --- Draw Node Label underneath ---
    const label = node.name || 'unknown';
    // Make text larger relative to the circle
    const fontSize = isHovered ? 14 / globalScale : 12 / globalScale;
    ctx.font = `${fontSize}px Inter, sans-serif`;
    const textWidth = ctx.measureText(label).width;
    const paddingX = 4 / globalScale;
    const paddingY = 2 / globalScale;
    const bckgDimensions = [textWidth, fontSize].map(n => n + paddingX * 2); 
    
    // Label positioning
    const labelY = node.y + radius * 1.8 + paddingY;

    // Background pill
    ctx.fillStyle = 'rgba(10, 15, 25, 0.85)'; // Dark background
    const rectX = node.x - bckgDimensions[0] / 2;
    const rectY = labelY - bckgDimensions[1] / 2;
    
    // Use standard fillRect to avoid issues with older browsers lacking roundRect
    ctx.fillRect(rectX, rectY, bckgDimensions[0], bckgDimensions[1]);
    
    // Border for pill
    ctx.strokeStyle = colors.core;
    ctx.lineWidth = 0.5 / globalScale;
    ctx.strokeRect(rectX, rectY, bckgDimensions[0], bckgDimensions[1]);

    // Text
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = isHovered ? '#ffffff' : '#d1d5db';
    ctx.fillText(label, node.x, labelY);

    // Number badge (like the top-right pill in the reference)
    if (node.val > 1) {
        const badgeRadius = 4 / globalScale;
        const badgeX = node.x + radius;
        const badgeY = node.y - radius;
        ctx.beginPath();
        ctx.arc(badgeX, badgeY, badgeRadius, 0, 2 * Math.PI);
        ctx.fillStyle = colors.core;
        ctx.fill();
        
        ctx.fillStyle = '#000000';
        ctx.font = `bold ${5 / globalScale}px Inter, sans-serif`;
        ctx.fillText(node.val - 1, badgeX, badgeY);
    }

    ctx.globalAlpha = 1;
  }, [hoverNode, hoverNeighbors]);


  const paintLink = useCallback((link, ctx, globalScale) => {
    // Only draw the label in linkCanvasObject since we're using mode='after'
    const start = link.source;
    const end = link.target;

    if (!start.x || !start.y || !end.x || !end.y) return;

    const isHovered = hoverLink === link || 
                      (hoverNode && (start.id === hoverNode.id || end.id === hoverNode.id));
    const isDimmed = (hoverNode || hoverLink) && !isHovered;

    ctx.globalAlpha = isDimmed ? 0.2 : (isHovered ? 1 : 0.8);
    const color = EDGE_COLORS[link.relation] || '#ffffff';

    // --- Draw edge label in the middle ---
    const midX = start.x + (end.x - start.x) / 2;
    const midY = start.y + (end.y - start.y) / 2;
    
    // Calculate angle for text rotation
    let angle = Math.atan2(end.y - start.y, end.x - start.x);
    // Keep text upright
    if (angle > Math.PI / 2 || angle < -Math.PI / 2) {
      angle += Math.PI;
    }

    ctx.save();
    ctx.translate(midX, midY);
    ctx.rotate(angle);

    const label = link.relation || 'linked';
    const fontSize = isHovered ? 8 / globalScale : 6 / globalScale;
    ctx.font = `${fontSize}px Inter, sans-serif`;
    const textWidth = ctx.measureText(label).width;
    const paddingX = 3 / globalScale;
    const paddingY = 1.5 / globalScale;

    // Label Background
    ctx.fillStyle = 'rgba(10, 15, 25, 0.9)';
    ctx.fillRect(
      -textWidth / 2 - paddingX,
      -fontSize / 2 - paddingY,
      textWidth + paddingX * 2,
      fontSize + paddingY * 2
    );
    
    // Label border
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.5 / globalScale;
    ctx.strokeRect(
      -textWidth / 2 - paddingX,
      -fontSize / 2 - paddingY,
      textWidth + paddingX * 2,
      fontSize + paddingY * 2
    );

    // Label Text
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = isHovered ? '#ffffff' : color;
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
        {/* Top toolbar similar to reference image */}
        <div className="panel-header" style={{ position: 'absolute', zIndex: 10, background: 'rgba(15, 20, 30, 0.85)', backdropFilter: 'blur(8px)', width: '100%', borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '12px 20px', display: 'flex', justifyContent: 'space-between' }}>
            <div className="panel-header-left" style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                <div style={{ fontSize: '18px', fontWeight: 'bold', letterSpacing: '1px', color: '#fff' }}>CODELENS<span style={{ color: 'var(--accent-cyan)' }}>.</span></div>
                <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '14px', borderLeft: '1px solid rgba(255,255,255,0.2)', paddingLeft: '15px' }}>Global Memory Model</div>
            </div>
            
            <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                 <div style={{ display: 'flex', gap: '8px', padding: '4px 10px', background: 'rgba(0,0,0,0.4)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)' }}>
                     {Object.entries(NODE_COLORS).filter(([k]) => k !== 'unknown').map(([kind, color]) => (
                         <div key={kind} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: color.core, boxShadow: `0 0 4px ${color.core}` }}></div>
                            <span style={{ fontSize: '10px', color: '#aaa', textTransform: 'uppercase' }}>{kind}</span>
                         </div>
                     ))}
                 </div>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--accent-emerald)', padding: '4px 10px', background: 'rgba(52, 211, 153, 0.1)', borderRadius: '4px' }}>
                   {graphData.nodes.length} nodes • {graphData.links.length} edges
                </span>
                <button className="btn btn-ghost" style={{ padding: '4px 8px', minWidth: '0' }} onClick={() => graphRef.current?.zoomToFit(400, 50)}>⛶</button>
            </div>
        </div>

      <ForceGraph2D
        ref={graphRef}
        graphData={graphData}
        
        // Custom canvas drawing for nodes
        nodeCanvasObject={paintNode}
        
        // Link rendering
        linkCanvasObject={paintLink}
        linkCanvasObjectMode={() => 'after'}
        linkColor={link => {
            const isHovered = hoverLink === link || (hoverNode && (link.source.id === hoverNode.id || link.target.id === hoverNode.id));
            const isDimmed = (hoverNode || hoverLink) && !isHovered;
            if (isDimmed) return 'rgba(255,255,255,0.05)';
            return EDGE_COLORS[link.relation] || 'rgba(255,255,255,0.2)';
        }}
        linkWidth={link => {
            const isHovered = hoverLink === link || (hoverNode && (link.source.id === hoverNode.id || link.target.id === hoverNode.id));
            return isHovered ? 2 : 1;
        }}
        
        // Let the custom painter handle the label so we don't use the default tooltip
        nodeLabel={() => ''}
        
        // Directional arrows
        linkDirectionalArrowLength={4}
        linkDirectionalArrowRelPos={1}
        linkDirectionalArrowColor={link => {
            const isHovered = hoverLink === link || (hoverNode && (link.source.id === hoverNode.id || link.target.id === hoverNode.id));
            const isDimmed = (hoverNode || hoverLink) && !isHovered;
            if (isDimmed) return 'rgba(255,255,255,0.05)';
            return EDGE_COLORS[link.relation] || 'rgba(255,255,255,0.2)';
        }}
        
        // Interaction
        onNodeClick={handleNodeClick}
        onNodeHover={setHoverNode}
        onLinkHover={setHoverLink}
        
        // Styling
        backgroundColor="#0B0D14" // Deep dark blue/black like reference
        width={window.innerWidth > 1200 ? 1200 : window.innerWidth - 40}
        height={700}
      />
      
      {/* Fake Minimap on bottom right */}
      <div style={{
          position: 'absolute',
          bottom: '20px',
          right: '20px',
          width: '180px',
          height: '140px',
          background: 'rgba(15, 20, 30, 0.85)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '8px',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
      }}>
          <div style={{ flex: 1, padding: '10px', position: 'relative' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.3, background: 'radial-gradient(circle at center, rgba(0,240,255,0.2) 0%, transparent 70%)' }}></div>
              <div style={{ width: '100%', height: '100%', border: '1px dashed rgba(255,255,255,0.3)', borderRadius: '4px' }}></div>
          </div>
          <div style={{ height: '30px', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 10px', fontSize: '10px', color: '#aaa' }}>
              <span>–</span>
              <span>100%</span>
              <span>+</span>
              <span>⛶</span>
          </div>
      </div>
    </div>
  );
}
