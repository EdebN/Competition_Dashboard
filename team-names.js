/* Shared display-name lookup for standalone team tools.
   Team A–E remain stable internal IDs; only labels are replaced. */
(function () {
  const API = "https://script.google.com/macros/s/AKfycbzhyO1bjLf8FO-fy9lSMgd4cJqn-OaytD-XWKFn9HUxH-iQUQJpYhgGaliIUkTBHwWr/exec";
  const fallback = Object.fromEntries(["A","B","C","D","E"].map(id => [id, "Team " + id]));
  window.CompetitionTeamNames = { ...fallback };
  window.getCompetitionTeamDisplayName = function (id) {
    const letter = String(id || "").replace(/^Team\s*/i, "").toUpperCase();
    return window.CompetitionTeamNames[letter] || (fallback[letter] || String(id || ""));
  };
  function load() {
    return new Promise((resolve, reject) => {
      const callback = "__competitionTeamNames_" + Date.now() + "_" + Math.random().toString(36).slice(2);
      const script = document.createElement("script");
      let finished = false;
      const timer = setTimeout(() => done(new Error("Team-name lookup timed out.")), 10000);
      function done(error, data) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        try { delete window[callback]; } catch {}
        script.remove();
        if (error) reject(error); else resolve(data);
      }
      window[callback] = data => done(null, data);
      const url = new URL(API);
      url.searchParams.set("action", "getTeamSettings");
      url.searchParams.set("callback", callback);
      url.searchParams.set("_", String(Date.now()));
      script.async = true;
      script.src = url.toString();
      script.onerror = () => done(new Error("Team-name lookup failed."));
      document.head.appendChild(script);
    });
  }
  load().then(response => {
    if (!response || response.ok !== true || !Array.isArray(response.teams)) return;
    response.teams.forEach(team => {
      const id = String(team.teamId || "").toUpperCase();
      const name = String(team.displayName || "").trim();
      if (/^[A-E]$/.test(id) && name) window.CompetitionTeamNames[id] = name;
    });
    window.dispatchEvent(new CustomEvent("competition:team-names-loaded", { detail: { ...window.CompetitionTeamNames } }));
  }).catch(error => console.warn("Using default team names:", error.message));
})();