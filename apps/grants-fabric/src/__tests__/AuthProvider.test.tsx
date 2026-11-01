import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AuthProvider } from '@/hooks/AuthContext';
import { useAuth } from '@/hooks/useAuth';
import type { IAuthService } from '@/services/IAuthService';

const stubAuthService: IAuthService = {
  fabricAuthEnabled: false,
  async signIn() {
    return { id: 'u1', email: 'dev@contoso.com', name: 'dev' };
  },
  async signOut() {},
  async getCurrentUser() {
    return null;
  },
  async initEmbeddedAuth() {
    return null;
  },
};

function AuthStatus() {
  const { loading, user } = useAuth();
  return <div data-testid="content">{loading ? 'loading' : user?.id ?? 'ready'}</div>;
}

describe('AuthProvider', () => {
  it('renders children once initial auth check completes', async () => {
    render(
      <AuthProvider authService={stubAuthService}>
        <AuthStatus />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('content')).toHaveTextContent('ready');
    });
  });

  it('shares a restored session with consumers of the extracted auth hook', async () => {
    render(
      <AuthProvider authService={{
        ...stubAuthService,
        async getCurrentUser() { return { id: 'u1', email: 'dev@contoso.com', name: 'dev' }; },
      }}>
        <AuthStatus />
      </AuthProvider>
    );
    expect(await screen.findByText('u1')).toBeInTheDocument();
  });
});
