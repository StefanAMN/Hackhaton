import { Component } from 'react';

/**
 * ErrorBoundary — catches unhandled errors in the React component tree
 * and prevents the entire page from going black/blank.
 *
 * Wraps each workspace panel to contain failures to individual panels.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '24px',
          textAlign: 'center',
          color: '#ff6b6b',
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: '12px',
        }}>
          <div style={{ fontSize: '28px', marginBottom: '12px' }}>⚠️</div>
          <div style={{ marginBottom: '8px' }}>Something went wrong in this panel.</div>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              padding: '6px 16px',
              background: 'rgba(255, 80, 80, 0.1)',
              border: '1px solid rgba(255, 80, 80, 0.3)',
              borderRadius: '8px',
              color: '#ff6b6b',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: '11px',
            }}
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
