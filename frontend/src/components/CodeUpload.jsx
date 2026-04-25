import { motion, AnimatePresence } from 'framer-motion';
import { useState, useCallback } from 'react';
import { useAnalysis } from '../context/AnalysisContext';

const SUPPORTED_FORMATS = ['.py', '.js', '.ts', '.jsx', '.tsx', '.java', '.go'];
const LANGUAGE_MAP = {
  '.py': 'python',
  '.js': 'javascript',
  '.ts': 'javascript',
  '.jsx': 'javascript',
  '.tsx': 'javascript',
  '.java': 'java',
  '.go': 'go',
};

function detectLanguage(filename) {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  return LANGUAGE_MAP[ext] ?? 'auto';
}

export default function CodeUpload() {
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState(null);
  const { runAnalysis, isLoading, error, clearAnalysis } = useAnalysis();

  const handleFile = useCallback((selectedFile) => {
    setFile(selectedFile);
    clearAnalysis();
  }, [clearAnalysis]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) handleFile(dropped);
  }, [handleFile]);

  const handleFileSelect = useCallback((e) => {
    const selected = e.target.files[0];
    if (selected) handleFile(selected);
  }, [handleFile]);

  const handleScan = useCallback(async () => {
    if (!file) return;
    const language = detectLanguage(file.name);
    await runAnalysis(file, language);
  }, [file, runAnalysis]);

  return (
    <div className="workspace-panel" id="code-upload-panel">
      <div className="panel-header">
        <div className="panel-header-left">
          <div className="panel-header-icon" style={{ background: 'var(--accent-cyan-dim)', border: '1px solid rgba(0,240,255,0.2)' }}>
            📁
          </div>
          <span className="panel-header-title">Code Upload</span>
        </div>
        {file && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--accent-emerald)' }}>
            {file.name}
          </span>
        )}
      </div>

      <div className="panel-body">
        <input
          type="file"
          id="code-file-input"
          accept=".py,.js,.ts,.jsx,.tsx,.java,.go"
          style={{ display: 'none' }}
          onChange={handleFileSelect}
        />
        <label
          htmlFor="code-file-input"
          className={`upload-zone ${isDragging ? 'dragging' : ''}`}
          onDragEnter={handleDragOver}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          style={isDragging ? { borderColor: 'var(--accent-cyan)', background: 'var(--accent-cyan-dim)' } : {}}
        >
          <div className="upload-zone-icon">
            {file ? '✅' : '📂'}
          </div>
          <div className="upload-zone-title">
            {file ? file.name : 'Drop your code file here'}
          </div>
          <div className="upload-zone-subtitle">
            {file ? 'Click to replace file' : 'or click to browse'}
          </div>
          <div className="upload-formats">
            {SUPPORTED_FORMATS.map((fmt) => (
              <span key={fmt} className="format-tag">{fmt}</span>
            ))}
          </div>
        </label>

        <AnimatePresence>
          {file && !isLoading && (
            <motion.button
              className="btn btn-primary"
              style={{ marginTop: 'var(--space-4)', width: '100%' }}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ duration: 0.3 }}
              id="scan-code-btn"
              onClick={handleScan}
            >
              🔍 Scan Code
            </motion.button>
          )}

          {isLoading && (
            <motion.div
              key="loading"
              className="upload-loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{
                marginTop: 'var(--space-4)',
                textAlign: 'center',
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                color: 'var(--accent-cyan)',
                padding: 'var(--space-3)',
              }}
            >
              <span className="loading-dots">⚙ Analyzing</span>
            </motion.div>
          )}

          {error && (
            <motion.div
              key="error"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              style={{
                marginTop: 'var(--space-3)',
                padding: 'var(--space-3)',
                background: 'rgba(255, 80, 80, 0.08)',
                border: '1px solid rgba(255, 80, 80, 0.25)',
                borderRadius: '8px',
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                color: '#ff6b6b',
              }}
            >
              ⚠ {error}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
