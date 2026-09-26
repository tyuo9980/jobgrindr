import { useAuth } from './auth';
import Dashboard from './components/Dashboard';
import SignIn from './components/SignIn';

export default function App() {
  const { state, signIn, signOut, sessionEnded } = useAuth();

  switch (state.status) {
    case 'loading':
      return <div className="page muted">Loading…</div>;
    case 'error':
      return (
        <div className="page">
          <div className="error-banner" role="alert">
            Couldn't reach the server: {state.message}
          </div>
        </div>
      );
    case 'signedOut':
      return <SignIn googleClientId={state.googleClientId} message={state.message} onCredential={signIn} />;
    case 'signedIn':
      return (
        <Dashboard
          // Remount per user so nothing from a previous account lingers.
          key={state.user.id}
          user={state.user}
          onSignOut={state.googleClientId ? signOut : undefined}
          onSessionEnded={sessionEnded}
        />
      );
  }
}
