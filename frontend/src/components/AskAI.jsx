import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAnalysis } from '../context/AnalysisContext';
import { askQuestion, APIError } from '../api/client';

export default function AskAI() {
  const { analysisResult, scanResult, sessionId, sourceCode } = useAnalysis();
  const [messages, setMessages] = useState([
    {
      id: 1,
      role: 'system',
      text: 'CodeLens is ready. Upload and scan your code, then ask me anything about the codebase.',
      answeredBy: null,
    },
  ]);
  const [input, setInput] = useState('');
  const [isAsking, setIsAsking] = useState(false);
  const messagesEndRef = useRef(null);

  // Show scan result when graph is built
  useEffect(() => {
    if (scanResult) {
      const graphMsg = `🔍 **Graph scan complete** ($0 cost)!\n` +
        `Found ${scanResult.nodes} symbols and ${scanResult.edges} dependency edges.\n` +
        (scanResult.high_impact_symbols?.length > 0
          ? `\n⚡ High-impact symbols: ${scanResult.high_impact_symbols.map(s => s?.name || 'unknown').join(', ')}`
          : '') +
        `\n\nTry asking impact questions like:\n• "Ce se strică dacă modific [funcție]?"\n• "Cine folosește [funcție]?"\n• "Arată-mi structura codului"`;

      setMessages(prev => [
        ...prev.filter(m => m.id === 1),
        {
          id: Date.now(),
          role: 'system',
          text: graphMsg,
          answeredBy: 'graph',
          costSaved: true,
        },
      ]);
    }
  }, [scanResult]);

  // Legacy AI analysis result hook removed to prevent rate limits.
  // AI is now only called on-demand via the askQuestion API.

  useEffect(() => {
    const parent = messagesEndRef.current?.parentElement;
    if (parent) {
      parent.scrollTop = parent.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isAsking) return;

    const userMsg = {
      id: Date.now(),
      role: 'user',
      text: input.trim(),
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsAsking(true);

    try {
      // Try the graph-first /ask endpoint
      const response = await askQuestion(
        userMsg.text,
        sessionId,
        sourceCode,
        'auto',
      );

      setMessages(prev => [
        ...prev,
        {
          id: Date.now() + 1,
          role: 'system',
          text: response.answer,
          answeredBy: response.answered_by,
          category: response.category,
          costSaved: response.answered_by === 'graph',
          processingTime: response.processing_time_ms,
          details: response.details,
        },
      ]);
    } catch (err) {
      // Fallback if backend is down
      let reply = "Could not reach the backend. ";
      if (!scanResult) {
        reply += "Upload and scan code first.";
      } else {
        reply += "Backend API is unavailable. Please check if the server is running on port 8000.";
      }

      setMessages(prev => [
        ...prev,
        {
          id: Date.now() + 1,
          role: 'system',
          text: reply,
          answeredBy: 'local',
        },
      ]);
    } finally {
      setIsAsking(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const getSourceBadge = (msg) => {
    if (!msg.answeredBy) return null;

    const badges = {
      graph: { text: '⚡ Graph ($0)', color: 'var(--accent-emerald)', bg: 'rgba(52, 211, 153, 0.1)' },
      ai: { text: '🤖 AI', color: 'var(--accent-purple)', bg: 'rgba(168, 85, 247, 0.1)' },
      local: { text: '💻 Local', color: 'var(--accent-amber)', bg: 'rgba(255, 159, 67, 0.1)' },
    };

    const badge = badges[msg.answeredBy];
    if (!badge) return null;

    return (
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '2px 8px',
        borderRadius: '12px',
        fontSize: '10px',
        fontFamily: 'var(--font-mono)',
        color: badge.color,
        background: badge.bg,
        border: `1px solid ${badge.color}33`,
      }}>
        {badge.text}
        {msg.processingTime && (
          <span style={{ opacity: 0.7 }}>• {msg.processingTime.toFixed(0)}ms</span>
        )}
      </span>
    );
  };

  return (
    <div className="workspace-panel" id="ask-ai-panel">
      <div className="panel-header">
        <div className="panel-header-left">
          <div className="panel-header-icon" style={{ background: 'var(--accent-purple-dim)', border: '1px solid rgba(168,85,247,0.2)' }}>
            🤖
          </div>
          <span className="panel-header-title">Ask CodeLens</span>
        </div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--accent-emerald)' }}>
          graph-first • ai-last
        </span>
      </div>
      <div className="panel-body">
        <div className="ai-messages">
          <AnimatePresence>
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                className={`ai-message ${msg.role}`}
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              >
                <div style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
                  {getSourceBadge(msg)}
                  {msg.costSaved && (
                    <span style={{
                      fontSize: '10px',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--accent-emerald)',
                      opacity: 0.8,
                    }}>
                      💰 $0 cost
                    </span>
                  )}
                  {msg.category && (
                    <span style={{
                      fontSize: '9px',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}>
                      {msg.category}
                    </span>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {isAsking && (
            <motion.div
              className="ai-message system"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--accent-cyan)' }}
            >
              <span className="loading-dots">⚙ Thinking</span>
            </motion.div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div className="ai-input-area">
          <input
            type="text"
            className="ai-input"
            placeholder={scanResult ? "Ask about impact, dependencies..." : "Upload code first..."}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isAsking}
            id="ai-question-input"
          />
          <button
            className="ai-send-btn"
            onClick={handleSend}
            disabled={isAsking || !input.trim()}
            id="ai-send-btn"
          >
            {isAsking ? '...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
