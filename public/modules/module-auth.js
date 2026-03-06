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
      const res = await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.token) {
        return {
          ok: false,
          error: String(data?.error || "login_failed"),
          status: Number(res.status || 0),
          serverUrl: base,
        };
      }
      writeLs(TOKEN_KEY, String(data.token));
      writeLs(USER_KEY, JSON.stringify(data.user || null));
      writeLs(SERVER_KEY, base);
      window.CANBus?.emit("auth:changed", { loggedIn: true, user: data.user || null, serverUrl: base }, "module-auth");
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
