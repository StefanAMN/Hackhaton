import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAnalysis } from '../context/AnalysisContext';

export default function AskAI() {
  const { analysisResult } = useAnalysis();
  const [messages, setMessages] = useState([
    {
      id: 1,
      role: 'system',
      text: 'CodeLens AI is ready. Upload and scan your code, then ask me anything about the codebase.',
    },
  ]);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef(null);

  // Automatically add a message when analysis is complete
  useEffect(() => {
    if (analysisResult && analysisResult.chunks && analysisResult.chunks.length > 0) {
      const chunks = analysisResult.chunks;
      const totalBugs = chunks.reduce((acc, chunk) => acc + chunk.bugs_and_vulnerabilities.length, 0);
      
      let summaryText = `Analysis complete! I found ${chunks.length} functions/classes.`;
      if (totalBugs > 0) {
         summaryText += ` I also identified ${totalBugs} potential bugs/vulnerabilities.`;
      } else {
         summaryText += ` The code looks pretty clean with no obvious bugs.`;
      }
      
      summaryText += `\n\nHere is a quick summary of the first component (${chunks[0].chunk_name}): ${chunks[0].junior_summary}`;

      setMessages(prev => [
        ...prev.filter(m => m.id === 1), // Keep the initial greeting
        {
          id: Date.now(),
          role: 'system',
          text: summaryText,
          contextLines: chunks.length,
        }
      ]);
    }
  }, [analysisResult]);

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

    // If we have analysis result, try to answer based on it
    setTimeout(() => {
      let reply = "I haven't analyzed any code yet. Please upload and scan a file first.";
      let contextLines = 0;

      if (analysisResult) {
        // Very basic local keyword matching against chunks
        const query = userMsg.text.toLowerCase();
        const matchedChunk = analysisResult.chunks.find(c => 
          c.chunk_name.toLowerCase().includes(query) || 
          c.junior_summary.toLowerCase().includes(query) ||
          c.source_code.toLowerCase().includes(query)
        );

        if (matchedChunk) {
          reply = `Based on the code for \`${matchedChunk.chunk_name}\`:\n\n${matchedChunk.junior_summary}\n\n`;
          if (matchedChunk.bugs_and_vulnerabilities.length > 0) {
            reply += `**Note on Bugs:**\n- ${matchedChunk.bugs_and_vulnerabilities.join('\n- ')}`;
          }
          contextLines = matchedChunk.source_code.split('\n').length;
        } else {
           reply = `I couldn't find a specific answer for that in the ${analysisResult.chunks.length} chunks analyzed. Try asking about a specific function name.`;
           contextLines = analysisResult.chunks.length;
        }
      }

      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          role: 'system',
          text: reply,
          contextLines,
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
                <div style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</div>
                {msg.contextLines !== undefined && msg.contextLines > 0 && (
                  <div className="ai-context-badge">
                    📐 {msg.contextLines} items analyzed
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
