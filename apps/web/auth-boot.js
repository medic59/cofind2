(function () {
  const handledForms = new Set(["login-form", "register-form", "reset-request-form", "reset-confirm-form"]);

  function apiBase() {
    const meta = document.querySelector('meta[name="cofind-api-base"]')?.content?.trim();
    return (meta || `${location.origin}/api/v1`).replace(/\/$/, "");
  }

  function setNote(message, isError) {
    const note = document.querySelector("#reset-note") || document.querySelector("#auth-title");
    if (note && message) note.textContent = message;
    const toast = document.querySelector("#toast");
    if (toast && message) {
      toast.textContent = message;
      toast.classList.add("is-visible");
      window.setTimeout(() => toast.classList.remove("is-visible"), isError ? 5000 : 2800);
    }
  }

  function storeSession(session) {
    try {
      localStorage.setItem("cofindAccessToken", session.accessToken || "");
      localStorage.setItem("cofindRefreshToken", session.refreshToken || "");
      localStorage.setItem("cofindUser", JSON.stringify(session.user || null));
    } catch {
      // Cookies still keep the server-side session alive.
    }
  }

  async function post(path, payload) {
    const response = await fetch(`${apiBase()}${path}`, {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(payload || {})
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!response.ok) {
      const message = Array.isArray(body?.message)
        ? body.message.join(", ")
        : body?.message || body?.error || "Запрос не выполнен";
      throw new Error(message);
    }
    return body;
  }

  async function logoutPreviousSession() {
    try {
      await fetch(`${apiBase()}/auth/logout`, {
        method: "POST",
        credentials: "include",
        headers: { Accept: "application/json" }
      });
    } catch {
      // The next successful login/register response will replace cookies.
    }
    try {
      localStorage.removeItem("cofindAccessToken");
      localStorage.removeItem("cofindRefreshToken");
      localStorage.removeItem("cofindUser");
    } catch {}
  }

  function authValue(selector) {
    return document.querySelector(selector)?.value || "";
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-auth-mode]");
    if (!button) return;
    event.preventDefault();
    document.querySelectorAll("[data-auth-panel]").forEach((panel) => {
      panel.classList.toggle("is-hidden", panel.dataset.authPanel !== button.dataset.authMode);
    });
  }, true);

  document.addEventListener("submit", async (event) => {
    const form = event.target;
    if (!handledForms.has(form?.id)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const submit = form.querySelector("[type=submit]");
    if (submit) submit.disabled = true;
    try {
      if (form.id === "login-form") {
        await logoutPreviousSession();
        const session = await post("/auth/login", {
          email: authValue("#login-email"),
          password: authValue("#login-password")
        });
        storeSession(session);
        location.assign("/me");
        return;
      }

      if (form.id === "register-form") {
        await logoutPreviousSession();
        const session = await post("/auth/register", {
          email: authValue("#register-email"),
          username: authValue("#register-username"),
          displayName: authValue("#register-display"),
          password: authValue("#register-password")
        });
        storeSession(session);
        location.assign("/me");
        return;
      }

      if (form.id === "reset-request-form") {
        const result = await post("/auth/password-reset/request", { email: authValue("#reset-email") });
        const tokenInput = document.querySelector("#reset-token");
        if (result?.resetToken && tokenInput) tokenInput.value = result.resetToken;
        setNote("Если e-mail есть в системе, мы отправим инструкции восстановления.");
        return;
      }

      if (form.id === "reset-confirm-form") {
        await post("/auth/password-reset/confirm", {
          token: authValue("#reset-token").trim(),
          newPassword: authValue("#reset-new-password")
        });
        form.reset();
        setNote("Пароль обновлен. Теперь войдите по e-mail.");
        document.querySelector('[data-auth-mode="login"]')?.click();
      }
    } catch (error) {
      setNote(error.message || "Не удалось выполнить действие", true);
    } finally {
      if (submit) submit.disabled = false;
    }
  }, true);
})();