import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HomePage } from '@/pages/HomePage';
import type { ChatTurn, GrantRecord, GrantReview, GrantVersion } from '@/services/grants';

const mocks = vi.hoisted(() => ({
  getGrants: vi.fn(), getChat: vi.fn(), getReviews: vi.fn(), getGrantVersions: vi.fn(), saveReview: vi.fn(), clipboard: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ signOut: vi.fn(), user: { email: 'reviewer@example.test' } }) }));
vi.mock('@/services/grants', () => ({
  ...mocks, askGrants: vi.fn(), importGrants: vi.fn(),
}));

const grant: GrantRecord = {
  id: 'grant-1', user_id: 'owner', sourceId: 'qld-1', source: 'qld',
  title: 'Community grant', summary: 'Current summary', eligibility: 'Current evidence',
  howToApply: 'Apply online', url: 'https://www.qld.gov.au/grants', status: 'Closed',
  openingDate: '', closingDate: '2020-01-01', amount: '0', jurisdictions: 'Queensland',
  categories: 'Community', contentHash: 'new-hash', active: true,
};
const version: GrantVersion = {
  ...grant, id: 'version-1', grantId: grant.id, archivedAt: new Date('2026-10-01'),
  contentHash: 'old-hash', summary: 'Original summary', eligibility: 'Original evidence',
};
const review: GrantReview = {
  id: 'review-1', user_id: 'owner', grantId: grant.id, contentHash: 'old-hash',
  decision: 'shortlisted', notes: 'Check the old guidelines', createdAt: new Date('2026-09-01'),
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getGrants.mockResolvedValue([grant]);
  mocks.getChat.mockResolvedValue([]);
  mocks.getReviews.mockResolvedValue([review]);
  mocks.getGrantVersions.mockResolvedValue([version]);
  mocks.saveReview.mockResolvedValue(undefined);
  mocks.clipboard.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: mocks.clipboard } });
});

function renderWorkbench() {
  render(<HomePage />);
  fireEvent.click(screen.getByRole('tab', { name: 'Browse and review' }));
}

describe('reviewer workspace', () => {
  it('opens on GrantFin Home and explains the app with actions into its working views', async () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { name: 'GrantFin' })).toBeInTheDocument();
    expect(within(screen.getByRole('banner')).getByRole('img', { name: 'GrantFin' })).toHaveAttribute('src', '/brands/grantfin.png');
    expect(screen.getByRole('tab', { name: 'Home' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'How it works' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Where your evidence lives' })).toBeInTheDocument();
    expect(screen.getByText(/Imports are manual, and availability can change/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Browse and review' }));
    expect(screen.getByRole('tab', { name: 'Browse and review' })).toHaveFocus();
    expect(screen.queryByRole('heading', { name: 'How it works' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Home' }));
    fireEvent.click(screen.getByRole('button', { name: 'View reviewer table' }));
    expect(await screen.findByText('Original evidence')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Reviewer table' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Reviewer table' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Home' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Home' }), { key: 'End' });
    expect(screen.getByRole('tab', { name: 'Reviewer table' })).toHaveFocus();
  });

  it('preserves the selected grant and unsaved drafts when returning Home and back', async () => {
    renderWorkbench();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Open now only' }));
    fireEvent.click(await screen.findByRole('button', { name: /Community grant/ }));
    await screen.findByRole('heading', { name: 'Community grant' });
    fireEvent.change(screen.getByLabelText('Evidence and next steps'), { target: { value: 'Unsaved review evidence' } });
    fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'Unsaved question' } });
    const breadcrumb = screen.getByRole('link', { name: 'Queensland grants' });
    expect(breadcrumb).toHaveAttribute('href', '#home-view');
    expect(breadcrumb).not.toHaveAttribute('target');
    fireEvent.click(breadcrumb);
    expect(screen.getByRole('tab', { name: 'Home' })).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'How it works' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Browse and review' }));
    expect(screen.getByRole('heading', { name: 'Community grant' })).toBeInTheDocument();
    expect(screen.getByLabelText('Evidence and next steps')).toHaveValue('Unsaved review evidence');
    expect(screen.getByLabelText('Your question')).toHaveValue('Unsaved question');
  });

  it('explains unselected chat scope and enables focus only when a grant is selected', async () => {
    renderWorkbench();
    const focus = screen.getByRole('checkbox', { name: 'Focus on selected grant' });
    expect(focus).toBeDisabled();
    expect(focus).not.toBeChecked();
    expect(focus).toHaveAccessibleDescription(/No grant selected.*assistant searches your matching Queensland grants/);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Open now only' }));
    fireEvent.click(await screen.findByRole('button', { name: /Community grant/ }));
    expect(focus).toBeEnabled();
    expect(focus).toBeChecked();
    expect(focus).toHaveAccessibleDescription('Focused on: Community grant');
    fireEvent.click(focus);
    expect(focus).toHaveAccessibleDescription('Searching your matching Queensland grants, not just the selected grant.');
  });

  it('saves the selected grant decision and notes from the persistent review form', async () => {
    renderWorkbench();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Open now only' }));
    fireEvent.click(await screen.findByRole('button', { name: /Community grant/ }));
    fireEvent.change(screen.getByLabelText('Review decision'), { target: { value: 'shortlisted' } });
    fireEvent.change(screen.getByLabelText('Evidence and next steps'), { target: { value: 'Confirm current guidelines' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save review' }));
    expect(await screen.findByText('Review saved against this grant version.')).toHaveAttribute('role', 'status');
    expect(mocks.saveReview).toHaveBeenCalledWith(grant, 'shortlisted', 'Confirm current guidelines');
  });

  it('shows closed grants, complete old evidence, and version-linked reviews in tables', async () => {
    render(<HomePage />);
    await waitFor(() => expect(mocks.getGrants).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('tab', { name: 'Reviewer table' }));
    expect(await screen.findByText('Original evidence')).toBeInTheDocument();
    expect(screen.getByText('Current evidence')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getAllByText('Closed')).toHaveLength(2);
    expect(within(screen.getAllByRole('row')[1]).getByText('$0.00')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Include old versions'));
    expect(screen.queryByText('Original evidence')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Table' }), { target: { value: 'reviews' } });
    expect(screen.getByText('Check the old guidelines')).toBeInTheDocument();
    expect(screen.getByText('Old version — recheck evidence')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Community grant' }));
    expect(screen.getByRole('tab', { name: 'Browse and review' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'Community grant' })).toBeInTheDocument();
  });

  it('searches full evidence and supports keyboard tab navigation', async () => {
    renderWorkbench();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Browse and review' }), { key: 'ArrowRight' });
    expect(await screen.findByText('Original evidence')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search all fields'), { target: { value: 'Original evidence' } });
    expect(screen.queryByText('Current evidence')).not.toBeInTheDocument();
    expect(screen.getByText('Original evidence')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Reviewer table' }), { key: 'Home' });
    expect(screen.getByRole('tab', { name: 'Home' })).toHaveFocus();
  });

  it('reports missing history instead of displaying a success-shaped empty result', async () => {
    mocks.getGrantVersions.mockRejectedValue(new Error('Version storage unavailable'));
    render(<HomePage />);
    fireEvent.click(screen.getByRole('tab', { name: 'Reviewer table' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Version storage unavailable');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Lucid Labs, Microsoft and GitHub' })).toHaveAttribute('src', '/brands/ll-ms-gh-white.svg');
  });

  it('keeps long evidence compact while allowing full text expansion and search', async () => {
    const evidence = `${'Guidelines and evidence. '.repeat(20)}Unique co-funding requirement.`;
    mocks.getGrantVersions.mockResolvedValue([{ ...version, eligibility: evidence }]);
    render(<HomePage />);
    fireEvent.click(screen.getByRole('tab', { name: 'Reviewer table' }));
    const fullText = await screen.findByText(evidence);
    const details = fullText.closest('details')!;
    expect(details).not.toHaveAttribute('open');
    fireEvent.change(screen.getByLabelText('Search all fields'), { target: { value: 'Unique co-funding' } });
    expect(screen.getByText(evidence)).toBeInTheDocument();
    fireEvent.click(within(details).getByText(/read full text/));
    expect(details).toHaveAttribute('open');
  });

  it('puts human fields first and filters and sorts grants without treating zero as missing', async () => {
    mocks.getGrants.mockResolvedValue([
      { ...grant, id: 'alpha', title: 'Alpha', amount: '' },
      grant,
      { ...grant, id: 'zeta', title: 'Zeta', amount: '500', source: 'business', status: 'Open' },
    ]);
    render(<HomePage />);
    fireEvent.click(screen.getByRole('tab', { name: 'Reviewer table' }));
    await screen.findByText('Original evidence');
    expect(screen.getAllByRole('columnheader').slice(0, 5).map((cell) => cell.textContent)).toEqual(['Grant', 'Status', 'Amount (AUD)', 'Closes', 'Opens']);
    fireEvent.click(screen.getByLabelText('Include old versions'));
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort by' }), { target: { value: 'amount' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort direction' }), { target: { value: 'desc' } });
    const titles = () => screen.getAllByRole('row').slice(1).map((row) => within(row).getByRole('button').textContent);
    expect(titles()).toEqual(['Zeta', 'Community grant', 'Alpha']);
    fireEvent.change(screen.getByRole('combobox', { name: 'Source' }), { target: { value: 'business' } });
    expect(titles()).toEqual(['Zeta']);
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'Closed' } });
    expect(screen.getByText('No matching records.')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Table' }), { target: { value: 'reviews' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Source' }), { target: { value: '' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Decision' }), { target: { value: 'shortlisted' } });
    expect(screen.getByText('Check the old guidelines')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Decision' }), { target: { value: 'dismissed' } });
    expect(screen.getByText('No matching records.')).toBeInTheDocument();
  });

  it('timestamps saved answers, copies their text, and reports clipboard failures', async () => {
    const turn: ChatTurn = {
      id: 'chat-1', user_id: 'owner', question: 'What should I check?', answer: 'Read the current guidelines.',
      sourcesJson: '[]', createdAt: new Date('2026-11-01T03:00:00Z'),
    };
    mocks.getChat.mockResolvedValue([turn]);
    renderWorkbench();
    const copy = await screen.findByRole('button', { name: 'Copy answer' });
    expect(screen.getByText(new Date(turn.createdAt).toLocaleString('en-AU')).closest('time')).toHaveAttribute('datetime', '2026-11-01T03:00:00.000Z');
    fireEvent.click(copy);
    await screen.findByText('Answer copied to clipboard.');
    expect(mocks.clipboard).toHaveBeenCalledWith(turn.answer);
    mocks.clipboard.mockRejectedValueOnce(new Error('Clipboard permission denied.'));
    fireEvent.click(copy);
    expect(await screen.findByRole('alert')).toHaveTextContent('Clipboard permission denied.');
    expect(screen.queryByText('Answer copied to clipboard.')).not.toBeInTheDocument();
  });

  it('dismisses the copy confirmation after five seconds and resets its timer on another copy', async () => {
    mocks.getChat.mockResolvedValue([{
      id: 'chat-1', user_id: 'owner', question: 'What should I check?', answer: 'Read the current guidelines.',
      sourcesJson: '[]', createdAt: new Date('2026-11-01T03:00:00Z'),
    }]);
    renderWorkbench();
    const copy = await screen.findByRole('button', { name: 'Copy answer' });
    vi.useFakeTimers();
    try {
      await act(async () => { fireEvent.click(copy); });
      expect(screen.getByRole('status')).toHaveTextContent('Answer copied to clipboard.');
      act(() => { vi.advanceTimersByTime(4000); });
      await act(async () => { fireEvent.click(copy); });
      act(() => { vi.advanceTimersByTime(4000); });
      expect(screen.getByRole('status')).toHaveTextContent('Answer copied to clipboard.');
      act(() => { vi.advanceTimersByTime(1000); });
      expect(screen.queryByText('Answer copied to clipboard.')).not.toBeInTheDocument();
      expect(screen.getByText('Read the current guidelines.')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
