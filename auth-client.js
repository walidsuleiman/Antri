const SESSION_PREFIX = "antri.supabase.session";
const REFRESH_BUFFER_SECONDS = 30;

function createAntriAuthClient(config) {
  return new AntriAuthClient(config);
}

class AntriAuthClient {
  constructor(config) {
    this.url = trimTrailingSlash(config.url);
    this.anonKey = config.anonKey;
    this.sessionKey = `${SESSION_PREFIX}.${new URL(this.url).host}`;
    this.listeners = new Set();
    this.session = this.readStoredSession();
    this.consumeUrlSession();

    this.auth = {
      getSession: () => this.getSession(),
      onAuthStateChange: (callback) => this.onAuthStateChange(callback),
      signUp: (credentials) => this.signUp(credentials),
      signInWithPassword: (credentials) => this.signInWithPassword(credentials),
      signInWithOAuth: (options) => this.signInWithOAuth(options),
      signOut: () => this.signOut()
    };
  }

  async getSession() {
    if (!this.session) {
      return { data: { session: null }, error: null };
    }

    try {
      if (this.sessionNeedsRefresh()) {
        await this.refreshSession();
      }

      if (!this.session?.user) {
        this.session.user = await this.fetchUser(this.session.access_token);
        this.storeSession(this.session);
      }

      return { data: { session: this.session }, error: null };
    } catch (error) {
      this.clearSession();
      return { data: { session: null }, error };
    }
  }

  onAuthStateChange(callback) {
    this.listeners.add(callback);
    return {
      data: {
        subscription: {
          unsubscribe: () => this.listeners.delete(callback)
        }
      }
    };
  }

  async signUp({ email, password, options = {} }) {
    const endpoint = this.authEndpoint("signup", options.emailRedirectTo);
    const payload = await this.request(endpoint, {
      method: "POST",
      body: { email, password }
    });
    const session = this.captureSession(payload);

    return {
      data: {
        session,
        user: payload.user || session?.user || null
      },
      error: null
    };
  }

  async signInWithPassword({ email, password }) {
    const payload = await this.request(`${this.authEndpoint("token")}?grant_type=password`, {
      method: "POST",
      body: { email, password }
    });
    const session = this.captureSession(payload);
    this.notify("SIGNED_IN", session);

    return {
      data: { session, user: session.user },
      error: null
    };
  }

  async signInWithOAuth({ provider, options = {} }) {
    const authorizeUrl = new URL(this.authEndpoint("authorize"));
    authorizeUrl.searchParams.set("provider", provider);
    if (options.redirectTo) {
      authorizeUrl.searchParams.set("redirect_to", options.redirectTo);
    }

    window.location.assign(authorizeUrl);
    return { data: { url: authorizeUrl.toString() }, error: null };
  }

  async signOut() {
    if (this.session?.access_token) {
      try {
        await this.request(this.authEndpoint("logout"), {
          method: "POST",
          accessToken: this.session.access_token
        });
      } catch {
        // Local sign-out should still clear a browser session if the token expired.
      }
    }

    this.clearSession();
    this.notify("SIGNED_OUT", null);
    return { error: null };
  }

  authEndpoint(path, redirectTo = "") {
    const endpoint = new URL(`${this.url}/auth/v1/${path}`);
    if (redirectTo) {
      endpoint.searchParams.set("redirect_to", redirectTo);
    }
    return endpoint.toString();
  }

  async refreshSession() {
    if (!this.session?.refresh_token) {
      throw new Error("Your session expired. Log in again.");
    }

    const payload = await this.request(`${this.authEndpoint("token")}?grant_type=refresh_token`, {
      method: "POST",
      body: { refresh_token: this.session.refresh_token }
    });
    this.captureSession(payload);
  }

  async fetchUser(accessToken) {
    const payload = await this.request(this.authEndpoint("user"), { accessToken });
    return payload.user || payload;
  }

  async request(url, { method = "GET", body, accessToken = "" } = {}) {
    const response = await fetch(url, {
      method,
      headers: {
        apikey: this.anonKey,
        Authorization: `Bearer ${accessToken || this.anonKey}`,
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const payload = await parseJson(response);

    if (!response.ok) {
      throw new Error(readAuthError(payload, response.status));
    }

    return payload;
  }

  captureSession(payload) {
    if (!payload?.access_token || !payload?.refresh_token) {
      return null;
    }

    const session = normalizeSession(payload);
    this.session = session;
    this.storeSession(session);
    return session;
  }

  consumeUrlSession() {
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    if (!hashParams.get("access_token") || !hashParams.get("refresh_token")) {
      return;
    }

    this.captureSession(Object.fromEntries(hashParams.entries()));
    window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
  }

  sessionNeedsRefresh() {
    if (!this.session?.expires_at) {
      return false;
    }

    return Number(this.session.expires_at) <= Math.floor(Date.now() / 1000) + REFRESH_BUFFER_SECONDS;
  }

  readStoredSession() {
    try {
      return JSON.parse(localStorage.getItem(this.sessionKey)) || null;
    } catch {
      return null;
    }
  }

  storeSession(session) {
    localStorage.setItem(this.sessionKey, JSON.stringify(session));
  }

  clearSession() {
    this.session = null;
    localStorage.removeItem(this.sessionKey);
  }

  notify(event, session) {
    this.listeners.forEach((listener) => listener(event, session));
  }
}

function normalizeSession(payload) {
  const expiresAt = Number(payload.expires_at)
    || Math.floor(Date.now() / 1000) + Number(payload.expires_in || 3600);

  return {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    token_type: payload.token_type || "bearer",
    expires_in: Number(payload.expires_in || 3600),
    expires_at: expiresAt,
    user: payload.user || null
  };
}

async function parseJson(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function readAuthError(payload, status) {
  return payload.error_description
    || payload.msg
    || payload.message
    || payload.error
    || `Supabase auth request failed with HTTP ${status}.`;
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

window.createAntriAuthClient = createAntriAuthClient;
