/* Shared display-name lookup for standalone team tools.
   Team A–E remain stable internal IDs; only labels are replaced. */
(function () {
  const API = "https://script.google.com/macros/s/AKfycbw77wOi2EhaSUkWHwiyowOIFieZqlNCFkDO-s6AUa5X63jbDs5m6n8F0lrsjIouwfHC/exec";
  const fallback = Object.fromEntries(["A","B","C","D","E"].map(id => [id, "Team " + id]));
  window.CompetitionTeamNames = { ...fallback };
  window.getCompetitionTeamDisplayName = function (id) {
    const letter = String(id || "").replace(/^Team\s*/i, "").toUpperCase();
    return window.CompetitionTeamNames[letter] || (fallback[letter] || String(id || ""));
  };
  // Replace visible fallback labels across standalone tools as well as labels
  // generated later by the app. Stable IDs in JavaScript/data remain untouched.
  const originalText = new WeakMap();
  const originalAttributes = new WeakMap();
  function replaceLabel(value) {
    return String(value).replace(/\\bTeam ([A-E])\\b/gi, (match, letter) => {
      const name = window.CompetitionTeamNames[String(letter).toUpperCase()];
      return name || match;
    });
  }
  function refreshVisibleLabels(root = document.body) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || parent.closest("script,style,noscript,textarea,select,option")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let node;
    while ((node = walker.nextNode())) {
      const current = node.nodeValue || "";
      let record = originalText.get(node);
      if (!record || current !== record.applied) record = { original: current, applied: current };
      const next = replaceLabel(record.original);
      record.applied = next;
      originalText.set(node, record);
      if (current !== next) node.nodeValue = next;
    }
    const elements = root.nodeType === 1 ? [root, ...root.querySelectorAll("*")] : [...root.querySelectorAll("*")];
    elements.forEach(element => {
      if (/^(INPUT|TEXTAREA|SELECT|OPTION|SCRIPT|STYLE)$/.test(element.tagName)) return;
      ["title", "aria-label", "placeholder"].forEach(attribute => {
        if (!element.hasAttribute(attribute)) return;
        let record = originalAttributes.get(element);
        if (!record) { record = {}; originalAttributes.set(element, record); }
        const current = element.getAttribute(attribute);
        if (!record[attribute] || current !== record[attribute].applied) record[attribute] = { original: current, applied: current };
        const next = replaceLabel(record[attribute].original);
        record[attribute].applied = next;
        if (current !== next) element.setAttribute(attribute, next);
      });
      if (element instanceof HTMLInputElement && element.type !== "password" && element.value && /^Team [A-E]$/i.test(element.value)) {
        const letter = element.value.slice(-1).toUpperCase();
        element.value = window.CompetitionTeamNames[letter] || element.value;
      }
    });
  }
  let labelObserver = null;
  function startLabelRefresh() {
    refreshVisibleLabels();
    if (labelObserver || !document.body) return;
    labelObserver = new MutationObserver(records => {
      records.forEach(record => {
        if (record.type === "characterData") refreshVisibleLabels(record.target.parentElement || document.body);
        else record.addedNodes.forEach(node => {
          if (node.nodeType === 1) refreshVisibleLabels(node);
          else if (node.nodeType === 3) refreshVisibleLabels(node.parentElement || document.body);
        });
      });
    });
    labelObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
  }
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
    startLabelRefresh();
    window.dispatchEvent(new CustomEvent("competition:team-names-loaded", { detail: { ...window.CompetitionTeamNames } }));
  }).catch(error => console.warn("Using default team names:", error.message));
})();