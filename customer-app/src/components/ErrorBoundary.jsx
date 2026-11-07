import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f9fafb', padding: '2rem', textAlign: 'center' }}>
          <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>💊</div>
          <h1 style={{ fontSize: '2rem', color: '#111827', marginBottom: '0.5rem', fontWeight: 700 }}>Oops, something went wrong.</h1>
          <p style={{ color: '#6b7280', marginBottom: '2rem', maxWidth: '400px' }}>
            We're sorry, an unexpected error occurred. Our team has been notified.
          </p>
          <button 
            onClick={() => window.location.reload()} 
            style={{ backgroundColor: '#0ea5e9', color: 'white', padding: '0.75rem 1.5rem', borderRadius: '8px', border: 'none', fontWeight: 600, cursor: 'pointer', fontSize: '1rem', transition: 'background-color 0.2s' }}
            onMouseOver={e => e.target.style.backgroundColor = '#0284c7'}
            onMouseOut={e => e.target.style.backgroundColor = '#0ea5e9'}
          >
            Refresh Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
