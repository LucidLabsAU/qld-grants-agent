import { createRoot } from 'react-dom/client';

import App from '@/App';
import { AuthProvider } from '@/hooks/AuthContext';
import { bootstrapAuth } from '@/services/bootstrap';

import '@qld-gov-au/qgds-bootstrap5/qld.bootstrap.css';
import './main.css';

const root = createRoot(document.getElementById('root')!);
try {
  const authService = await bootstrapAuth();
  root.render(<AuthProvider authService={authService}><App /></AuthProvider>);
} catch (error) {
  root.render(<main className="auth-shell"><section className="panel auth-card">
    <h1>GrantFin</h1><p role="alert" className="error">{error instanceof Error ? error.message : 'App initialization failed.'}</p>
    <button onClick={() => window.location.reload()}>Retry</button>
  </section></main>);
}
