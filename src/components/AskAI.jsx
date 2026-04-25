import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export default function AskAI() {
  const [messages, setMessages] = useState([
    {
      id: 1,
      role: 'system',
      text: 'CodeLens AI is ready. Upload and scan your code, then ask me anything about the codebase.',
    },
  ]);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    if (!input.trim()) return;

    const userMsg = {
      id: Date.now(),
      role: 'user',
      text: input.trim(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');

    // Placeholder: In production, this would call the backend API
    // For now, show a "waiting for backend" message
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          role: 'system',
          text: 'Backend not connected yet. When integrated, I\'ll analyze only the relevant code slice from the dependency graph and give you a precise answer.',
          contextLines: 0,
        },
      ]);
    }, 800);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="workspace-panel" id="ask-ai-panel">
      <div className="panel-header">
        <div className="panel-header-left">
          <div className="panel-header-icon" style={{ background: 'var(--accent-purple-dim)', border: '1px solid rgba(168,85,247,0.2)' }}>
            🤖
          </div>
          <span className="panel-header-title">Ask AI</span>
        </div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--accent-emerald)' }}>
          context-aware
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
                {msg.text}
                {msg.contextLines !== undefined && msg.contextLines > 0 && (
                  <div className="ai-context-badge">
                    📐 {msg.contextLines} lines analyzed (not {(msg.contextLines * 50).toLocaleString()})
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
          <div ref={messagesEndRef} />
        </div>

        <div className="ai-input-area">
          <input
            type="text"
            className="ai-input"
            placeholder="Ask about your codebase..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            id="ai-question-input"
          />
          <button className="ai-send-btn" onClick={handleSend} id="ai-send-btn">
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
