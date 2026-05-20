import { Component, type ReactNode, type ErrorInfo } from 'react';
import './ErrorBoundary.css';

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
 * In development, detailed error info is shown; in production only a generic message.
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
        <div className="error-boundary-fallback">
          <div className="error-boundary-heading">
            <strong className="error-boundary-title">
              Something went wrong
            </strong>
          </div>
          <p className="error-boundary-message">
            This section encountered an error and could not be displayed.
          </p>
          <div className="error-boundary-details">
            {isDev && (
              <>
                <p className="error-boundary-error">
                  Error: {errorMessage}
                </p>
                {componentStack && (
                  <pre className="error-boundary-stack error-boundary-component-stack">
                    {componentStack}
                  </pre>
                )}
                {errorStack && (
                  <details className="error-boundary-trace">
                    <summary className="error-boundary-summary">
                      Stack trace
                    </summary>
                    <pre className="error-boundary-stack error-boundary-runtime-stack">
                      {errorStack}
                    </pre>
                  </details>
                )}
              </>
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
