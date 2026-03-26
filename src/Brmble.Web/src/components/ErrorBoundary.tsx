import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  label: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

const isDev = import.meta.env.DEV;

/**
 * ErrorBoundary — catches render crashes and displays a user-friendly
 * fallback inline instead of letting the entire app unmount.
 * In development, detailed error info is shown; in production only a generic message.
 * Resets automatically when the `label` prop changes (e.g. route/tab switch).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.label !== this.props.label && this.state.error) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary:${this.props.label}]`, error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <div className="error-boundary-fallback" style={{
          padding: 'var(--space-lg)',
          margin: 'var(--space-xs)',
          background: 'var(--bg-surface)',
          border: '1px solid var(--accent-danger)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-body)',
          fontSize: 'var(--text-sm, 0.875rem)',
          textAlign: 'center',
        }}>
          <div style={{ marginBottom: 'var(--space-sm)' }}>
            <strong style={{ color: 'var(--accent-danger)', fontFamily: 'var(--font-display)' }}>
              Something went wrong
            </strong>
          </div>
          <p style={{ color: 'var(--text-muted)', margin: '0 0 var(--space-md) 0' }}>
            This section encountered an error and could not be displayed.
          </p>
          <button
            className="btn btn-secondary btn-sm"
            onClick={this.handleReset}
          >
            Try again
          </button>
          {isDev && (
            <details style={{
              marginTop: 'var(--space-md)',
              textAlign: 'left',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs, 0.75rem)',
              color: 'var(--text-muted)',
            }}>
              <summary style={{ cursor: 'pointer', color: 'var(--accent-danger)' }}>
                [{this.props.label}] {this.state.error.message}
              </summary>
              <pre style={{ whiteSpace: 'pre-wrap', marginTop: 'var(--space-xs)', opacity: 0.7 }}>
                {this.state.error.stack}
              </pre>
            </details>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
