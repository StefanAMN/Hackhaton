import { motion } from 'framer-motion';
import { useState, useCallback } from 'react';
import useScrollReveal from '../hooks/useScrollReveal';

export default function CodeUpload() {
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState([]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    setFiles(droppedFiles);
  }, []);

  const handleFileSelect = useCallback((e) => {
    const selectedFiles = Array.from(e.target.files);
    setFiles(selectedFiles);
  }, []);

  const formats = ['.py', '.js', '.ts', '.java', '.cpp', '.go', '.rs', '.rb'];

  return (
    <div className="workspace-panel" id="code-upload-panel">
      <div className="panel-header">
        <div className="panel-header-left">
          <div className="panel-header-icon" style={{ background: 'var(--accent-cyan-dim)', border: '1px solid rgba(0,240,255,0.2)' }}>
            📁
          </div>
          <span className="panel-header-title">Code Upload</span>
        </div>
        {files.length > 0 && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--accent-emerald)' }}>
            {files.length} file{files.length !== 1 ? 's' : ''} loaded
          </span>
        )}
      </div>
      <div className="panel-body">
        <input
          type="file"
          id="code-file-input"
          multiple
          accept=".py,.js,.ts,.jsx,.tsx,.java,.cpp,.c,.h,.go,.rs,.rb,.php,.cs"
          style={{ display: 'none' }}
          onChange={handleFileSelect}
        />
        <label
          htmlFor="code-file-input"
          className={`upload-zone ${isDragging ? 'dragging' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          style={isDragging ? { borderColor: 'var(--accent-cyan)', background: 'var(--accent-cyan-dim)' } : {}}
        >
          <div className="upload-zone-icon">
            {files.length > 0 ? '✅' : '📂'}
          </div>
          <div className="upload-zone-title">
            {files.length > 0
              ? `${files.map(f => f.name).join(', ')}`
              : 'Drop your code files here'
            }
          </div>
          <div className="upload-zone-subtitle">
            {files.length > 0
              ? 'Click to replace or drop new files'
              : 'or click to browse'
            }
          </div>
          <div className="upload-formats">
            {formats.map((fmt) => (
              <span key={fmt} className="format-tag">{fmt}</span>
            ))}
          </div>
        </label>

        {files.length > 0 && (
          <motion.button
            className="btn btn-primary"
            style={{ marginTop: 'var(--space-4)', width: '100%' }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            id="scan-code-btn"
          >
            🔍 Scan Code
          </motion.button>
        )}
      </div>
    </div>
  );
}
