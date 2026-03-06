import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  label: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Diagnostic ErrorBoundary — catches render crashes and displays them
 * inline instead of letting the entire app unmount.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary:${this.props.label}]`, error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          padding: '1rem',
          margin: '0.5rem',
          background: '#2a0000',
          border: '1px solid #ff4444',
          borderRadius: '6px',
          color: '#ff8888',
          fontFamily: 'monospace',
          fontSize: '0.8rem',
          overflow: 'auto',
          maxHeight: '300px',
        }}>
          <strong>[{this.props.label}] Render crash:</strong>
          <pre style={{ whiteSpace: 'pre-wrap', marginTop: '0.5rem' }}>
            {this.state.error.message}
          </pre>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.7rem', opacity: 0.7 }}>
            {this.state.error.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
