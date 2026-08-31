import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '../context/AuthContext';

vi.mock('../lib/api', () => ({
  getMe: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  signup: vi.fn(),
}));

import { getMe } from '../lib/api';

function Probe() {
  const { user, loading } = useAuth();
  if (loading) return <div>loading</div>;
  return <div>{user ? `logged in as ${user.email}` : 'guest'}</div>;
}

describe('AuthContext', () => {
  it('defaults to guest (user: null) when there is no session', async () => {
    vi.mocked(getMe).mockResolvedValue({ user: null, guestQueriesRemaining: 2, guestQueryLimit: 2 });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByText('guest')).toBeInTheDocument());
  });

  it('reflects a logged-in user once getMe resolves one', async () => {
    vi.mocked(getMe).mockResolvedValue({ user: { id: 'u1', email: 'person@example.com' }, guestQueriesRemaining: null, guestQueryLimit: null });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByText('logged in as person@example.com')).toBeInTheDocument());
  });

  it('falls back to guest if getMe fails entirely (e.g. backend unreachable)', async () => {
    vi.mocked(getMe).mockRejectedValue(new Error('network error'));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    // AuthContext retries the initial getMe call once after a short delay
    // (see lib/retry.ts) - a longer timeout here just accounts for that,
    // it isn't testing the retry itself.
    await waitFor(() => expect(screen.getByText('guest')).toBeInTheDocument(), { timeout: 3000 });
  });
});
