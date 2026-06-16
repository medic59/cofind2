(function () {
  const protectedViews = new Set(["me", "appearance", "inbox", "new-listing", "subscription"]);
  const staffRoles = new Set(["OWNER", "ADMIN", "MODERATOR"]);

  function currentRole() {
    try {
      return JSON.parse(localStorage.getItem("cofindUser") || "null")?.role || "";
    } catch {
      return "";
    }
  }

  function isAuthenticated() {
    try {
      return Boolean(localStorage.getItem("cofindAccessToken"));
    } catch {
      return false;
    }
  }

  function isStaff() {
    return staffRoles.has(currentRole());
  }

  function viewForPath(pathname) {
    const cleanPath = pathname.replace(/\/+$/, "") || "/";
    const parts = cleanPath.split("/").filter(Boolean);
    const section = parts[0] || "";

    if (cleanPath === "/" || cleanPath.endsWith("/index.html")) return "home";
    if (section === "feed") return "feed";
    if (section === "chat") return "chat";
    if (section === "auth") return "auth";
    if (section === "listing" && parts[1]) return "listing";
    if (["profile", "profiles", "u"].includes(section) && parts[1]) return "profile";
    if (section === "suggestions") return "suggestions";
    if (section === "help") return "help";
    if (section === "rules") return "rules";
    if (section === "privacy") return "privacy";
    if (section === "contacts") return "contacts";
    if (section === "reports") return isAuthenticated() ? "report" : "auth";
    if (section === "ai-partner") return isAuthenticated() ? "ai-partner" : "auth";

    if (section === "admin") {
      if (!isAuthenticated()) return "auth";
      return isStaff() ? "admin" : "me";
    }
    if (section === "me" && parts[1] === "appearance") return isAuthenticated() ? "appearance" : "auth";
    if (section === "me" && parts[1] === "listings" && parts[2] === "new") return isAuthenticated() ? "new-listing" : "auth";
    if (section === "me" && parts[1] === "inbox") return isAuthenticated() ? "inbox" : "auth";
    if (section === "me" && parts[1] === "subscription") return isAuthenticated() ? "subscription" : "auth";
    if (section === "me") return isAuthenticated() ? "me" : "auth";
    if (protectedViews.has(section)) return isAuthenticated() ? section : "auth";

    return "home";
  }

  document.documentElement.dataset.initialView = viewForPath(location.pathname || "/");
})();
