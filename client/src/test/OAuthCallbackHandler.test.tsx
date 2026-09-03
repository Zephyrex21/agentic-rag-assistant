import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider } from '../context/AuthContext';
import { OAuthCallbackHandler } from '../components/OAuthCallbackHandler';

vi.mock('../lib/api', () => ({
  getMe: vi.fn(async () => ({ user: null, guestQueriesRemaining: null, guestQueryLimit: null, oauthProviders: { google: false, github: false } })),
  setSessionToken: vi.fn(),
  getOAuthUrl: vi.fn((provider: string) => `/api/auth/oauth/${provider}`),
  requestOtp: vi.fn(),
  verifyOtp: vi.fn(),
  logout: vi.fn(),
}));

import { setSessionToken } from '../lib/api';

function renderHandler() {
  return render(
    <AuthProvider>
      <OAuthCallbackHandler />
    </AuthProvider>
  );
}

describe('OAuthCallbackHandler', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/');
  });

  it('does nothing when there is no hash at all', async () => {
    window.history.replaceState(null, '', '/');
    renderHandler();

    await waitFor(() => expect(screen.queryByText(/loading/i)).not.toBeInTheDocument());
    expect(setSessionToken).not.toHaveBeenCalled();
    // No visible modal content either - Dialog.Title only renders when open.
    expect(screen.queryByText('Sign in')).not.toBeInTheDocument();
  });

  it('an oauth_token hash stores the token, strips the hash, and reloads the page', async () => {
    // Set the real hash BEFORE stubbing location below - the stub snapshots
    // window.location at the moment it's created, so this ordering is what
    // makes the component actually see the hash on mount.
    window.history.replaceState(null, '', '/#oauth_token=test-jwt-value');
    const reloadSpy = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload: reloadSpy });
    // window.history itself is deliberately left real/un-stubbed, so this
    // spy observes the component's ACTUAL hash-stripping call rather than
    // a disconnected copy - the location stub above only ever affected
    // window.location, never window.history.
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState');

    renderHandler();

    await waitFor(() => expect(setSessionToken).toHaveBeenCalledWith('test-jwt-value'));
    await waitFor(() => expect(reloadSpy).toHaveBeenCalledTimes(1));
    expect(replaceStateSpy).toHaveBeenCalledWith(null, '', '/');
  });

  it('an oauth_error hash surfaces the message via a visible AuthModal, without storing a token or reloading', async () => {
    window.history.replaceState(null, '', '/#oauth_error=Sign-in%20was%20cancelled.');
    const reloadSpy = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload: reloadSpy });

    renderHandler();

    await waitFor(() => expect(screen.getByText('Sign-in was cancelled.')).toBeInTheDocument());
    expect(setSessionToken).not.toHaveBeenCalled();
    expect(reloadSpy).not.toHaveBeenCalled();
  });
});
