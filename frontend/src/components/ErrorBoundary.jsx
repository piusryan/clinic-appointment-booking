import React from 'react';

/**
 * React error boundary — catches render-time errors anywhere below so a crash
 * in one page cannot blank the whole app. Shows a recoverable fallback.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message ?? 'Something went wrong' };
  }

  componentDidCatch(error, info) {
    // Intentionally quiet in the UI; the request logger / console keeps the trail.
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, message: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="page fatal-page">
          <div className="card fatal-card">
            <div className="fatal-mark">⚠</div>
            <h1>Something went wrong</h1>
            <p className="muted">{this.state.message}</p>
            <button className="btn btn-primary" type="button" onClick={this.handleReset}>
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
