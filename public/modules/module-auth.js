(() => {
  const TOKEN_KEY = "vmill:auth:token";
  const USER_KEY = "vmill:auth:user";
  const SERVER_KEY = "vmill:server:url";

  function safeParse(raw, fallback = null) {
    try {
      const v = JSON.parse(raw);
      return v == null ? fallback : v;
    } catch {
      return fallback;
    }
  }

  function readLs(key, fallback = "") {
    try {
      const v = localStorage.getItem(String(key || ""));
      return v == null ? fallback : v;
    } catch {
      return fallback;
    }
  }

  function writeLs(key, value) {
    try { localStorage.setItem(String(key || ""), String(value ?? "")); } catch {}
  }

  function delLs(key) {
    try { localStorage.removeItem(String(key || "")); } catch {}
  }

  function normalizeServerUrl(raw) {
    const src = String(raw || "").trim();
    if (!src) return "";
    const withProto = /^[a-z]+:\/\//i.test(src) ? src : `http://${src}`;
    try {
      const u = new URL(withProto);
      return `${u.protocol}//${u.host}`;
    } catch {
      return "";
    }
  }

  function getToken() {
    return String(readLs(TOKEN_KEY, "") || "").trim();
  }

  function getUser() {
    const raw = readLs(USER_KEY, "");
    return safeParse(raw, null);
  }

  function getServerUrl() {
    const fromLs = normalizeServerUrl(readLs(SERVER_KEY, ""));
    if (fromLs) return fromLs;
    if (location.protocol === "http:" || location.protocol === "https:") {
      return normalizeServerUrl(location.origin);
    }
    return "http://localhost:8080";
  }

  function isLoggedIn() {
    return !!getToken();
  }

  function roleRank(role) {
    const r = String(role || "").toLowerCase();
    if (r === "admin") return 3;
    if (r === "manager") return 2;
    if (r === "operator") return 1;
    return 0;
  }

  function isAdmin() {
    return roleRank(getUser()?.role) >= 3;
  }

  function isManager() {
    return roleRank(getUser()?.role) >= 2;
  }

  async function ping(serverUrl = "") {
    const base = normalizeServerUrl(serverUrl || getServerUrl());
    if (!base) return { ok: false, serverUrl: "", status: 0 };
    try {
      const res = await fetch(`${base}/api/status`, { method: "GET", cache: "no-store" });
      const ok = !!res.ok;
      return { ok, serverUrl: base, status: Number(res.status || 0) };
    } catch {
      return { ok: false, serverUrl: base, status: 0 };
    }
  }

  async function login(username, password, serverUrl = "") {
    const base = normalizeServerUrl(serverUrl || getServerUrl());
    if (!base) {
      return { ok: false, error: "invalid_server_url", status: 0 };
    }
    const body = {
      username: String(username || "").trim(),
      password: String(password || ""),
    };
    try {
      const out = await requestJson(base, "/api/auth/login", {
        method: "POST",
        body,
      });
      const data = out?.data || {};
      if (!out.ok || !data?.token) {
        return {
          ok: false,
          error: String(data?.error || "login_failed"),
          status: Number(out.status || 0),
          serverUrl: base,
        };
      }
      persistAuth(data, base);
      return {
        ok: true,
        token: String(data.token),
        user: data.user || null,
        expiresAt: String(data.expires_at || ""),
        serverUrl: base,
      };
    } catch (err) {
      return {
        ok: false,
        error: String(err?.message || "network_error"),
        status: 0,
        serverUrl: base,
      };
    }
  }

  function persistAuth(data, base) {
    if (!data?.token) return;
    writeLs(TOKEN_KEY, String(data.token));
    writeLs(USER_KEY, JSON.stringify(data.user || null));
    writeLs(SERVER_KEY, base);
    window.CANBus?.emit("auth:changed", { loggedIn: true, user: data.user || null, serverUrl: base }, "module-auth");
  }

  async function requestJson(base, path, options = {}) {
    const method = String(options?.method || "GET").toUpperCase();
    const headers = { ...(options?.headers || {}) };
    const init = { method, headers, cache: "no-store" };
    if (options?.body != null) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }
    const res = await fetch(`${base}${path}`, init);
    const data = await res.json().catch(() => ({}));
    return {
      ok: !!res.ok,
      status: Number(res.status || 0),
      data: data && typeof data === "object" ? data : {},
    };
  }

  async function register(username, password, email = "", serverUrl = "") {
    const base = normalizeServerUrl(serverUrl || getServerUrl());
    if (!base) {
      return { ok: false, error: "invalid_server_url", status: 0 };
    }
    const body = {
      username: String(username || "").trim(),
      password: String(password || ""),
      email: String(email || "").trim(),
    };
    try {
      const out = await requestJson(base, "/api/auth/register", {
        method: "POST",
        body,
      });
      const data = out?.data || {};
      if (!out.ok || !data?.token) {
        return {
          ok: false,
          error: String(data?.error || "register_failed"),
          status: Number(out.status || 0),
          serverUrl: base,
        };
      }
      persistAuth(data, base);
      return {
        ok: true,
        token: String(data.token || ""),
        user: data.user || null,
        expiresAt: String(data.expires_at || ""),
        serverUrl: base,
      };
    } catch (err) {
      return {
        ok: false,
        error: String(err?.message || "network_error"),
        status: 0,
        serverUrl: base,
      };
    }
  }

  async function forgotPassword(identifier, serverUrl = "") {
    const base = normalizeServerUrl(serverUrl || getServerUrl());
    if (!base) return { ok: false, error: "invalid_server_url", status: 0 };
    try {
      const out = await requestJson(base, "/api/auth/forgot-password", {
        method: "POST",
        body: { identifier: String(identifier || "").trim() },
      });
      const data = out?.data || {};
      return {
        ok: !!out.ok,
        status: Number(out.status || 0),
        error: out.ok ? "" : String(data?.error || "request_failed"),
        message: String(data?.message || ""),
        devPreview: !!data?.dev_preview,
        resetToken: String(data?.reset_token || ""),
        serverUrl: base,
      };
    } catch (err) {
      return {
        ok: false,
        error: String(err?.message || "network_error"),
        status: 0,
        message: "",
        devPreview: false,
        resetToken: "",
        serverUrl: base,
      };
    }
  }

  async function resetPassword(token, password, serverUrl = "") {
    const base = normalizeServerUrl(serverUrl || getServerUrl());
    if (!base) return { ok: false, error: "invalid_server_url", status: 0 };
    try {
      const out = await requestJson(base, "/api/auth/reset-password", {
        method: "POST",
        body: {
          token: String(token || "").trim(),
          password: String(password || ""),
        },
      });
      const data = out?.data || {};
      return {
        ok: !!out.ok,
        status: Number(out.status || 0),
        error: out.ok ? "" : String(data?.error || "reset_failed"),
        serverUrl: base,
      };
    } catch (err) {
      return {
        ok: false,
        error: String(err?.message || "network_error"),
        status: 0,
        serverUrl: base,
      };
    }
  }

  async function getAuthOptions(serverUrl = "") {
    const base = normalizeServerUrl(serverUrl || getServerUrl());
    if (!base) return { ok: false, error: "invalid_server_url", status: 0, serverUrl: "" };
    try {
      const out = await requestJson(base, "/api/auth/options", { method: "GET" });
      return {
        ok: !!out.ok,
        status: Number(out.status || 0),
        data: out.data || {},
        error: out.ok ? "" : String(out?.data?.error || "options_failed"),
        serverUrl: base,
      };
    } catch (err) {
      return {
        ok: false,
        status: 0,
        data: {},
        error: String(err?.message || "network_error"),
        serverUrl: base,
      };
    }
  }

  async function adminServerSettingsGet(serverUrl = "") {
    const base = normalizeServerUrl(serverUrl || getServerUrl());
    const token = getToken();
    if (!base || !token) {
      return { ok: false, status: 0, data: {}, error: "missing_auth" };
    }
    try {
      const res = await fetch(`${base}/api/admin/server-settings`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      return {
        ok: !!res.ok,
        status: Number(res.status || 0),
        data: data && typeof data === "object" ? data : {},
        error: res.ok ? "" : String(data?.error || "load_failed"),
      };
    } catch (err) {
      return {
        ok: false,
        status: 0,
        data: {},
        error: String(err?.message || "network_error"),
      };
    }
  }

  async function adminServerSettingsPut(patch, serverUrl = "") {
    const base = normalizeServerUrl(serverUrl || getServerUrl());
    const token = getToken();
    if (!base || !token) {
      return { ok: false, status: 0, data: {}, error: "missing_auth" };
    }
    try {
      const res = await fetch(`${base}/api/admin/server-settings`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify(patch && typeof patch === "object" ? patch : {}),
      });
      const data = await res.json().catch(() => ({}));
      return {
        ok: !!res.ok,
        status: Number(res.status || 0),
        data: data && typeof data === "object" ? data : {},
        error: res.ok ? "" : String(data?.error || "save_failed"),
      };
    } catch (err) {
      return {
        ok: false,
        status: 0,
        data: {},
        error: String(err?.message || "network_error"),
      };
    }
  }

  async function refreshMe(serverUrl = "") {
    const base = normalizeServerUrl(serverUrl || getServerUrl());
    const token = getToken();
    if (!base || !token) return { ok: false, error: "missing_auth", status: 0, user: null };
    try {
      const out = await requestJson(base, "/api/auth/me", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      const user = out?.data?.user || null;
      if (!out.ok || !user) return { ok: false, error: String(out?.data?.error || "me_failed"), status: Number(out.status || 0), user: null };
      writeLs(USER_KEY, JSON.stringify(user));
      return { ok: true, error: "", status: Number(out.status || 0), user };
    } catch (err) {
      return { ok: false, error: String(err?.message || "network_error"), status: 0, user: null };
    }
  }

  async function logout() {
    const token = getToken();
    const base = getServerUrl();
    if (token && base) {
      try {
        await fetch(`${base}/api/auth/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {}
    }
    delLs(TOKEN_KEY);
    delLs(USER_KEY);
    window.CANBus?.emit("auth:changed", { loggedIn: false, user: null, serverUrl: base }, "module-auth");
    return { ok: true };
  }

  window.VMillAuth = {
    keys: { TOKEN_KEY, USER_KEY, SERVER_KEY },
    login,
    register,
    forgotPassword,
    resetPassword,
    getAuthOptions,
    adminServerSettingsGet,
    adminServerSettingsPut,
    refreshMe,
    logout,
    ping,
    getUser,
    getToken,
    getServerUrl,
    isLoggedIn,
    isAdmin,
    isManager,
  };
})();
