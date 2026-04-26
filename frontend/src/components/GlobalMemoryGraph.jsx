import React, { useEffect, useState, useRef, useCallback } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { getGlobalGraph } from '../api/client';

const NODE_COLORS = {
  function: '#00f0ff',
  class: '#a855f7',
  method: '#34d399',
  module: '#ff9f43',
  unknown: '#78788c',
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
  const graphRef = useRef();

  useEffect(() => {
    let mounted = true;

    async function fetchData() {
      try {
        setIsLoading(true);
        const data = await getGlobalGraph();
        if (!mounted) return;
        
        // Transform the dictionary response to arrays required by ForceGraph
        const nodesArray = Object.keys(data.nodes || {}).map(nodeId => {
          const n = data.nodes[nodeId];
          return {
            id: nodeId,
            name: n.name,
            kind: n.kind,
            val: Math.max(1, (n.in_degree || 0) + 1), // size based on incoming connections
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

  const handleNodeClick = useCallback(node => {
    // Aim at node from outside it
    const distance = 40;
    const distRatio = 1 + distance/Math.hypot(node.x, node.y, node.z || 0);

    graphRef.current?.centerAt(node.x, node.y, 1000);
    graphRef.current?.zoom(8, 2000);
  }, [graphRef]);

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
    <div className="workspace-panel" style={{ padding: 0, overflow: 'hidden', height: '600px', display: 'flex', flexDirection: 'column' }}>
        <div className="panel-header" style={{ position: 'absolute', zIndex: 10, background: 'rgba(10, 10, 15, 0.8)', backdropFilter: 'blur(4px)', width: '100%', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="panel-header-left">
            <div className="panel-header-icon" style={{ background: 'var(--accent-amber-dim)', border: '1px solid rgba(255,159,67,0.2)' }}>
                🧠
            </div>
            <span className="panel-header-title">Global Memory Graph</span>
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--accent-emerald)' }}>
               {graphData.nodes.length} nodes • {graphData.links.length} edges
            </span>
        </div>
      <ForceGraph2D
        ref={graphRef}
        graphData={graphData}
        nodeColor={node => NODE_COLORS[node.kind] || NODE_COLORS.unknown}
        nodeLabel={node => `${node.name} (${node.kind})`}
        nodeRelSize={6}
        linkColor={link => EDGE_COLORS[link.relation] || 'rgba(255,255,255,0.2)'}
        linkDirectionalArrowLength={3.5}
        linkDirectionalArrowRelPos={1}
        linkCurvature={0.25}
        onNodeClick={handleNodeClick}
        backgroundColor="#0A0A0F"
        width={window.innerWidth > 1200 ? 1200 : window.innerWidth - 40} // Approximate width to prevent horizontal scroll if not handled by CSS
        height={600}
      />
    </div>
  );
}
