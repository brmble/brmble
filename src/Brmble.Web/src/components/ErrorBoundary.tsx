import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  label: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

const isDev = import.meta.env.DEV;

/**
 * ErrorBoundary — catches render crashes and displays a user-friendly
 * fallback inline instead of letting the entire app unmount.
 * In development, the raw error message and stack are shown for debugging.
 * Resets automatically when the `label` prop changes (e.g. route/tab switch).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.label !== this.props.label && this.state.error) {
      this.setState({ error: null, info: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary:${this.props.label}]`, error, info.componentStack);
    this.setState({ info });
  }

  handleReset = () => {
    this.setState({ error: null, info: null });
  };

  render() {
    if (this.state.error) {
      const errorMessage = this.state.error.message;
      const errorStack = this.state.error.stack;
      const componentStack = this.state.info?.componentStack;
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
          <div style={{ 
            textAlign: 'left',
            fontFamily: 'var(--font-mono)', 
            fontSize: 'var(--text-xs, 0.75rem)',
            marginBottom: 'var(--space-md)',
          }}>
            <p style={{ color: 'var(--accent-danger)', marginBottom: 'var(--space-xs)' }}>
              Error: {errorMessage}
            </p>
            {componentStack && (
              <pre style={{ whiteSpace: 'pre-wrap', opacity: 0.8, color: 'var(--text-muted)' }}>
                {componentStack}
              </pre>
            )}
            {isDev && errorStack && (
              <details style={{ marginTop: 'var(--space-sm)' }}>
                <summary style={{ cursor: 'pointer', color: 'var(--accent-decorative)' }}>
                  Stack trace
                </summary>
                <pre style={{ whiteSpace: 'pre-wrap', marginTop: 'var(--space-xs)', opacity: 0.7 }}>
                  {errorStack}
                </pre>
              </details>
            )}
          </div>
          <button
            className="btn btn-secondary btn-sm"
            onClick={this.handleReset}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
