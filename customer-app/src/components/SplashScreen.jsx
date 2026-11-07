export function SplashScreen() {
  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#ffffff',
      zIndex: 9999,
      animation: 'fadeIn 0.3s ease-out'
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '80px',
        height: '80px',
        backgroundColor: '#f0f9ff',
        borderRadius: '50%',
        marginBottom: '1rem',
        animation: 'pulse 2s infinite cubic-bezier(0.4, 0, 0.6, 1)'
      }}>
        <span style={{ fontSize: '3rem' }}>💊</span>
      </div>
      <h1 style={{
        fontSize: '1.5rem',
        fontWeight: 700,
        color: '#0f172a',
        letterSpacing: '-0.025em'
      }}>
        Pharma<span style={{ color: '#0ea5e9' }}>Dash</span>
      </h1>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: .7; transform: scale(0.95); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
