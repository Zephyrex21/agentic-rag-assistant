import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, useAuth } from '../context/AuthContext';

vi.mock('../lib/api', () => ({
  getMe: vi.fn(),
  requestOtp: vi.fn(),
  verifyOtp: vi.fn(),
  logout: vi.fn(),
}));

import { getMe, requestOtp, verifyOtp } from '../lib/api';

function Probe() {
  const { user, loading, authError, requestOtp: ctxRequestOtp, verifyOtp: ctxVerifyOtp } = useAuth();
  if (loading) return <div>loading</div>;
  return (
    <div>
      <div>{user ? `logged in as ${user.email}` : 'guest'}</div>
      {authError && <div>error: {authError}</div>}
      <button onClick={() => ctxRequestOtp('person@example.com').catch(() => {})}>request</button>
      <button onClick={() => ctxVerifyOtp('person@example.com', '123456').catch(() => {})}>verify</button>
    </div>
  );
}

async function renderProbe() {
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );
  await waitFor(() => expect(screen.queryByText('loading')).not.toBeInTheDocument());
}

describe('AuthContext', () => {
  beforeEach(() => {
    vi.mocked(getMe).mockResolvedValue({ user: null, guestQueriesRemaining: 2, guestQueryLimit: 2, oauthProviders: { google: false, github: false } });
  });

  it('defaults to guest (user: null) when there is no session', async () => {
    await renderProbe();
    expect(screen.getByText('guest')).toBeInTheDocument();
  });

  it('reflects a logged-in user once getMe resolves one', async () => {
    vi.mocked(getMe).mockResolvedValue({ user: { id: 'u1', email: 'person@example.com' }, guestQueriesRemaining: null, guestQueryLimit: null, oauthProviders: { google: false, github: false } });
    await renderProbe();
    expect(screen.getByText('logged in as person@example.com')).toBeInTheDocument();
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

  it('requestOtp (step 1) calls the API and surfaces no error on success', async () => {
    vi.mocked(requestOtp).mockResolvedValue({ sent: true, expiresInSeconds: 600 });
    const user = userEvent.setup();
    await renderProbe();

    await user.click(screen.getByText('request'));
    expect(requestOtp).toHaveBeenCalledWith('person@example.com');
    expect(screen.queryByText(/^error:/)).not.toBeInTheDocument();
  });

  it('requestOtp (step 1) surfaces the error message on failure', async () => {
    vi.mocked(requestOtp).mockRejectedValue(new Error('Please wait 30s before requesting another code.'));
    const user = userEvent.setup();
    await renderProbe();

    await user.click(screen.getByText('request'));
    await waitFor(() => expect(screen.getByText('error: Please wait 30s before requesting another code.')).toBeInTheDocument());
  });

  it('verifyOtp (step 2) reloads the page on success', async () => {
    vi.mocked(verifyOtp).mockResolvedValue({ user: { id: 'u1', email: 'person@example.com' } });
    const reloadSpy = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload: reloadSpy });
    const user = userEvent.setup();
    await renderProbe();

    await user.click(screen.getByText('verify'));
    await waitFor(() => expect(reloadSpy).toHaveBeenCalledTimes(1));
    vi.unstubAllGlobals();
  });

  it('verifyOtp (step 2) surfaces an incorrect-code error without reloading', async () => {
    vi.mocked(verifyOtp).mockRejectedValue(new Error('That code is incorrect.'));
    const reloadSpy = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload: reloadSpy });
    const user = userEvent.setup();
    await renderProbe();

    await user.click(screen.getByText('verify'));
    await waitFor(() => expect(screen.getByText('error: That code is incorrect.')).toBeInTheDocument());
    expect(reloadSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
