import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '@/App';
import { AuthProvider } from '@/hooks/AuthContext';
import type { IAuthService } from '@/services/IAuthService';

const mocks = vi.hoisted(() => ({
  getGrants: vi.fn(), getChat: vi.fn(), getReviews: vi.fn(), getGrantVersions: vi.fn(),
}));
vi.mock('@/services/grants', () => ({ ...mocks, askGrants: vi.fn(), importGrants: vi.fn(), saveReview: vi.fn() }));

function renderApp(signedIn: boolean) {
  const user = { id: 'reviewer', email: 'reviewer@example.test', name: 'Reviewer' };
  const authService: IAuthService = {
    fabricAuthEnabled: true,
    async signIn() { return user; },
    async signOut() {},
    async getCurrentUser() { return signedIn ? user : null; },
    async initEmbeddedAuth() { return null; },
  };
  render(<AuthProvider authService={authService}><App /></AuthProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getGrants.mockResolvedValue([]);
  mocks.getChat.mockResolvedValue([]);
  window.history.replaceState(null, '', '/why-and-how?ref=demo');
});

describe('authenticated story navigation', () => {
  it('opens directly for a signed-in visitor without loading private catalogue or chat data', async () => {
    renderApp(true);
    expect(await screen.findByRole('heading', { level: 1, name: 'Why and How we built this' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/why-and-how');
    expect(screen.getByRole('tab', { name: 'Why and How' })).toHaveAttribute('aria-selected', 'true');
    expect(mocks.getGrants).not.toHaveBeenCalled();
    expect(mocks.getChat).not.toHaveBeenCalled();
  });

  it('requires sign-in and returns to the requested story URL with its query intact', async () => {
    renderApp(false);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with Microsoft' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Why and How we built this' })).toBeInTheDocument();
    expect(window.location.pathname + window.location.search).toBe('/why-and-how?ref=demo');
    expect(mocks.getGrants).not.toHaveBeenCalled();
  });

  it('shares all workspace navigation and loads private data only when entering the workbench', async () => {
    renderApp(true);
    fireEvent.click(await screen.findByRole('tab', { name: 'Home' }));
    expect(await screen.findByRole('tab', { name: 'Home' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('tab')).toHaveLength(5);
    await waitFor(() => expect(mocks.getGrants).toHaveBeenCalledOnce());
  });

  it('keeps workbench drafts and loaded data when opening the story and returning', async () => {
    window.history.replaceState(null, '', '/');
    renderApp(true);
    fireEvent.click(await screen.findByRole('tab', { name: 'Browse and review' }));
    fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'Keep my research question' } });
    fireEvent.change(screen.getByLabelText('Search grants'), { target: { value: 'Community' } });
    await waitFor(() => expect(mocks.getGrants).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('tab', { name: 'Why and How' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Why and How we built this' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/why-and-how');
    fireEvent.click(screen.getByRole('tab', { name: 'Browse and review' }));
    expect(screen.getByLabelText('Your question')).toHaveValue('Keep my research question');
    expect(screen.getByLabelText('Search grants')).toHaveValue('Community');
    expect(window.location.pathname).toBe('/');
    expect(mocks.getGrants).toHaveBeenCalledOnce();
    expect(mocks.getChat).toHaveBeenCalledOnce();
  });
});
