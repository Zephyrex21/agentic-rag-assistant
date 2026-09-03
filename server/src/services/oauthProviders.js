/**
 * Provider registry - each entry knows how to build its own authorize URL,
 * exchange a code for an access token, and turn that token into a single
 * verified email address. Adding a third provider later means adding one
 * more entry here, not touching routes/oauth.js at all.
 *
 * A verified email IS the account in this app (see userStore.findOrCreateByEmail,
 * shared with the OTP flow) - so every provider's exchangeCodeForEmail
 * below returns just that one string, never a broader profile object. If
 * a provider genuinely has no verified email for this user (rare - e.g. a
 * GitHub account with no verified address at all), it throws, and the
 * callback route turns that into a clear redirect-with-error rather than
 * silently creating an unverified/unreachable account.
 */
const PROVIDERS = {
  google: {
    label: 'Google',
    scope: 'openid email profile',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET',

    buildAuthorizeParams(state, redirectUri) {
      return {
        client_id: process.env[this.clientIdEnv],
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: this.scope,
        state,
        // Shows Google's account chooser even if the browser has one
        // Google session already signed in elsewhere - avoids silently
        // authenticating as "whichever account happened to be active",
        // which is a confusing failure mode for a shared/family computer.
        prompt: 'select_account',
      };
    },

    async exchangeCodeForEmail(code, redirectUri) {
      const tokenRes = await fetch(this.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: process.env[this.clientIdEnv],
          client_secret: process.env[this.clientSecretEnv],
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });
      if (!tokenRes.ok) {
        throw new Error(`Google token exchange failed (${tokenRes.status}): ${await tokenRes.text().catch(() => '')}`);
      }
      const { access_token: accessToken } = await tokenRes.json();

      const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!profileRes.ok) {
        throw new Error(`Google profile fetch failed (${profileRes.status})`);
      }
      const profile = await profileRes.json();
      if (!profile.email || profile.email_verified !== true) {
        throw new Error('Google did not return a verified email for this account.');
      }
      return profile.email;
    },
  },

  github: {
    label: 'GitHub',
    scope: 'read:user user:email',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    clientIdEnv: 'GITHUB_CLIENT_ID',
    clientSecretEnv: 'GITHUB_CLIENT_SECRET',

    buildAuthorizeParams(state, redirectUri) {
      return {
        client_id: process.env[this.clientIdEnv],
        redirect_uri: redirectUri,
        scope: this.scope,
        state,
      };
    },

    async exchangeCodeForEmail(code, redirectUri) {
      const tokenRes = await fetch(this.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          // Without this, GitHub returns form-encoded (application/x-www-form-urlencoded)
          // instead of JSON, for backwards compatibility with very old integrations.
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          code,
          client_id: process.env[this.clientIdEnv],
          client_secret: process.env[this.clientSecretEnv],
          redirect_uri: redirectUri,
        }),
      });
      if (!tokenRes.ok) {
        throw new Error(`GitHub token exchange failed (${tokenRes.status}): ${await tokenRes.text().catch(() => '')}`);
      }
      const tokenBody = await tokenRes.json();
      if (tokenBody.error) {
        throw new Error(`GitHub token exchange failed: ${tokenBody.error_description || tokenBody.error}`);
      }
      const accessToken = tokenBody.access_token;

      // GitHub's own User-Agent requirement - requests without one are
      // rejected outright regardless of auth validity.
      const ghHeaders = {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'agentic-rag-assistant',
      };

      // GET /user's own `email` field is frequently null (anyone with
      // "keep my email private" enabled on GitHub, which is common) even
      // with user:email scope granted - the verified primary address only
      // shows up via the separate /user/emails endpoint below.
      const emailsRes = await fetch('https://api.github.com/user/emails', { headers: ghHeaders });
      if (!emailsRes.ok) {
        throw new Error(`GitHub emails fetch failed (${emailsRes.status})`);
      }
      const emails = await emailsRes.json();
      const primary = Array.isArray(emails) ? emails.find((e) => e.primary && e.verified) : null;
      if (!primary) {
        throw new Error('GitHub did not return a verified primary email for this account.');
      }
      return primary.email;
    },
  },
};

function isValidProvider(provider) {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, provider);
}

function isProviderConfigured(provider) {
  if (!isValidProvider(provider)) return false;
  const { clientIdEnv, clientSecretEnv } = PROVIDERS[provider];
  return Boolean(process.env[clientIdEnv] && process.env[clientSecretEnv]);
}

function buildAuthorizeUrl(provider, state, redirectUri) {
  const params = new URLSearchParams(PROVIDERS[provider].buildAuthorizeParams(state, redirectUri));
  return `${PROVIDERS[provider].authorizeUrl}?${params.toString()}`;
}

async function exchangeCodeForEmail(provider, code, redirectUri) {
  return PROVIDERS[provider].exchangeCodeForEmail(code, redirectUri);
}

function getProviderLabel(provider) {
  return PROVIDERS[provider]?.label || provider;
}

module.exports = {
  isValidProvider,
  isProviderConfigured,
  buildAuthorizeUrl,
  exchangeCodeForEmail,
  getProviderLabel,
  PROVIDER_NAMES: Object.keys(PROVIDERS),
};
