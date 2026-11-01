import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';

export function AuthPage() {
  const { signIn, error: authError } = useAuth();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return <main className="auth-shell"><section className="panel auth-card">
    <h1>GrantFin</h1>
    <p>Research Queensland grants, record your review trail, and ask questions grounded in source evidence.</p>
    <button className="primary" disabled={busy} onClick={() => {
      setBusy(true); setError('');
      signIn().catch((err: unknown) => setError(err instanceof Error ? err.message : 'Sign-in failed.'))
        .finally(() => setBusy(false));
    }}>{busy ? 'Opening Fabric…' : 'Sign in with Microsoft'}</button>
    {(error || authError) && <p role="alert" className="error">{error || authError}</p>}
    <p className="muted">Your imported grants, reviews, and chat history are private to your signed-in identity.</p>
  </section></main>;
}
