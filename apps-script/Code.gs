const SERVICE_NAME = "competition-community-api";
const API_VERSION = 1;

const TEAM_SETTINGS_TAB = "Team Settings";
const TEAM_PAGE_DESIGNS_TAB = "Team Page Designs";
const PUBLISHED_TEAM_PAGES_TAB = "Published Team Pages";
const FEATURE_REQUESTS_TAB = "Feature Requests";
const TEAM_EDITOR_PINS_TAB = "Team Editor PINs";
const MATCH_POLLS_TAB = "Match Polls";
const SOCIAL_POSTS_TAB = "Social Posts";
const SOCIAL_AUDIT_TAB = "Social Audit";
const SOCIAL_BANS_TAB = "Social Posting Bans";
const SOCIAL_POST_HEADERS = ["Post ID","Submitted At","Team ID","Title","Body","Image URL","Category","Review Status","Publication Status","Published At","Updated At","Moderation Note","Featured"];
const COMPETITION_SETTINGS_TAB = "Competition Settings";
const MIN_GAMES_PER_TEAM = 3;
const MAX_GAMES_PER_TEAM = 32;
const MATCH_POLL_HEADERS = ["Match ID", "Team ID", "Voter Token Hash", "Submitted At"];
const TEAM_EDITOR_PIN_HEADERS = ["Team ID", "PIN", "Updated At"];
const TEAM_IDS = ["A", "B", "C", "D", "E"];
const TEAM_SETTINGS_HEADERS = [
  "Team ID",
  "Display Name",
  "Primary Color",
  "Secondary Color",
  "Logo URL",
  "Updated At"
];

/**
 * Public GET endpoints:
 *   /exec?action=health
 *   /exec?action=getTeamSettings
 *
 * Add ?callback=someFunction for JSONP reads from GitHub Pages.
 * Do not return credentials or private spreadsheet content.
 */
function doGet(e) {
  const params = (e && e.parameter) || {};
  const action = String(params.action || "health").trim();
  const callback = String(params.callback || "").trim();

  let result;

  try {
    if (action === "health") {
      const properties = PropertiesService.getScriptProperties();
      result = {
        ok: true,
        service: SERVICE_NAME,
        apiVersion: API_VERSION,
        configured: Boolean(
          properties.getProperty("SPREADSHEET_ID") &&
          properties.getProperty("ADMIN_TOKEN")
        ),
        actions: ["health", "getTeamSettings", "getCompetitionSettings", "updateCompetitionSettings", "getTeamEditorPinStatus", "verifyTeamEditorPin", "updateTeamEditorPin", "getTeamPageDesign", "saveTeamPageDesign", "getPublishedTeamPage", "publishTeamPage", "revertTeamPage", "submitFeatureRequest", "getMatchPolls", "submitMatchVote", "getSocialPosts", "getTeamSocialStatus", "getModerationSession", "getModerationQueue"]
      };
    } else if (action === "getMatchPolls") {
      result = { ok: true, service: SERVICE_NAME, apiVersion: API_VERSION, action: action, polls: readMatchPolls_() };
    } else if (action === "getCompetitionSettings") {
      result = readCompetitionSettings_();
    } else if (action === "getTeamSettings") {
      result = {
        ok: true,
        service: SERVICE_NAME,
        apiVersion: API_VERSION,
        action: action,
        teams: readTeamSettings_()
      };
    } else if (action === "getTeamPageDesign") {
      const teamId = String(params.teamId || "").trim().toUpperCase();
      const sessionTeam = getSessionTeam_(params.sessionToken);
      if (!sessionTeam || sessionTeam !== teamId) result = { ok: false, error: "Studio session expired. Sign in again." };
      else result = { ok: true, action: action, teamId: teamId, design: readTeamPageDesign_(teamId) };
    } else if (action === "getPublishedTeamPage") {
      const teamId = String(params.teamId || "").trim().toUpperCase();
      if (!TEAM_IDS.includes(teamId)) result = { ok: false, error: "Invalid team ID." };
      else result = { ok: true, action: action, teamId: teamId, design: readPublishedTeamPage_(teamId) };
    } else if (action === "getTeamEditorPinStatus") {
      result = {
        ok: true,
        service: SERVICE_NAME,
        apiVersion: API_VERSION,
        action: action,
        teams: readTeamEditorPinStatus_()
      };
    } else if (action === "verifyTeamEditorPin") {
      result = verifyTeamEditorPin_(params.pin);
    } else if (action === "getSocialPosts") {
      result = { ok: true, action: action, posts: readPublicSocialPosts_() };
    } else if (action === "getTeamSocialStatus") {
      result = readTeamSocialStatus_(params.teamId, params.sessionToken);
    } else if (action === "getModerationSession") {
      result = consumeModerationSession_(params.nonce);
    } else if (action === "getModerationQueue") {
      if (!getModerationSession_(params.sessionToken)) result = { ok: false, error: "Admin session expired." };
      else result = { ok: true, posts: readModerationPosts_(), bans: readSocialBans_(), audit: readSocialAudit_() };
    } else {
      result = { ok: false, service: SERVICE_NAME, apiVersion: API_VERSION, error: "Unknown action" };
    }
  } catch (error) {
    console.error(error);
    result = {
      ok: false,
      service: SERVICE_NAME,
      apiVersion: API_VERSION,
      error: "Request failed. Check Apps Script configuration and execution logs."
    };
  }

  return respond_(result, callback);
}

/**
 * POST actions are explicitly allow-listed below. Social writes are isolated
 * to the Social Posts, Social Audit and Social Posting Bans tabs; they never
 * modify fixtures, scores, or official competition results.
 *
 * Send JSON as the POST body. For browser no-cors requests, use
 * Content-Type: text/plain;charset=UTF-8 and verify through a read endpoint.
 */
function doPost(e) {
  let body;

  try {
    body = JSON.parse(
      e && e.postData && e.postData.contents
        ? e.postData.contents
        : "{}"
    );
  } catch (error) {
    return jsonResponse_({
      ok: false,
      service: SERVICE_NAME,
      error: "Invalid JSON"
    });
  }

  if (!["updateTeamSettings", "updateCompetitionSettings", "updateTeamEditorPin", "saveTeamPageDesign", "publishTeamPage", "revertTeamPage", "submitFeatureRequest", "submitMatchVote", "submitSocialPost", "createModerationSession", "moderateSocialPost", "markSocialPostViewed", "setSocialPostingBan"].includes(body.action)) {
    return jsonResponse_({
      ok: false,
      service: SERVICE_NAME,
      error: "Operation not allowed"
    });
  }

  if (body.action === "submitFeatureRequest") return submitFeatureRequest_(body);
  if (body.action === "submitSocialPost") return submitSocialPost_(body);
  if (body.action === "createModerationSession") return requestModerationSession_(body);
  if (["moderateSocialPost", "markSocialPostViewed", "setSocialPostingBan"].includes(body.action)) return handleSocialModeration_(body);
  if (body.action === "submitMatchVote") return submitMatchVote_(body);
  if (body.action === "saveTeamPageDesign") return saveTeamPageDesign_(body);
  if (body.action === "publishTeamPage") return publishTeamPage_(body);
  if (body.action === "revertTeamPage") return revertTeamPage_(body);

  const expectedToken = PropertiesService
    .getScriptProperties()
    .getProperty("ADMIN_TOKEN");
  const suppliedToken = String(body.adminToken || "");

  if (!expectedToken || suppliedToken.length < 1 || suppliedToken !== expectedToken) {
    return jsonResponse_({
      ok: false,
      service: SERVICE_NAME,
      error: "Not authorised"
    });
  }

  if (body.action === "updateCompetitionSettings") return updateCompetitionSettings_(body);

  if (body.action === "updateTeamEditorPin") {
    const teamId = String(body.teamId || "").trim().toUpperCase();
    const pin = String(body.pin || "").trim();
    if (!TEAM_IDS.includes(teamId) || !/^\d{6}$/.test(pin)) {
      return jsonResponse_({ ok: false, service: SERVICE_NAME, error: "A valid team ID and six-digit PIN are required." });
    }
    const pinLock = LockService.getScriptLock();
    if (!pinLock.tryLock(5000)) return jsonResponse_({ ok: false, service: SERVICE_NAME, error: "Service busy. Try again." });
    try {
      const sheet = getTeamEditorPinsSheet_();
      const lastRow = sheet.getLastRow();
      const rows = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, 3).getDisplayValues() : [];
      let rowNumber = 0;
      rows.forEach(function (row, index) {
        if (String(row[0]).trim() === teamId) rowNumber = index + 2;
      });
      if (!rowNumber) rowNumber = Math.max(2, lastRow + 1);
      sheet.getRange(rowNumber, 1, 1, 3).setNumberFormat("@");
      sheet.getRange(rowNumber, 1, 1, 3).setValues([[teamId, pin, new Date().toISOString()]]);
      return jsonResponse_({ ok: true, service: SERVICE_NAME, apiVersion: API_VERSION, action: body.action, saved: true, teamId: teamId });
    } catch (error) {
      console.error(error);
      return jsonResponse_({ ok: false, service: SERVICE_NAME, error: "Could not save the Team Editor PIN." });
    } finally {
      pinLock.releaseLock();
    }
  }

  let teams;
  try {
    teams = validateTeamSettings_(body.teams);
  } catch (error) {
    return jsonResponse_({
      ok: false,
      service: SERVICE_NAME,
      error: error.message || "Invalid team settings"
    });
  }

  const lock = LockService.getScriptLock();

  if (!lock.tryLock(5000)) {
    return jsonResponse_({
      ok: false,
      service: SERVICE_NAME,
      error: "Service busy. Try again."
    });
  }

  try {
    const sheet = getTeamSettingsSheet_();
    const updatedAt = new Date();

    const rows = TEAM_IDS.map(function (teamId) {
      const team = teams[teamId];
      return [
        teamId,
        team.displayName,
        team.primaryColor,
        team.secondaryColor,
        team.logoUrl,
        updatedAt
      ];
    });

    // Store user-controlled fields as plain text, not spreadsheet formulas.
    sheet.getRange(2, 1, TEAM_IDS.length, 5).setNumberFormat("@");
    sheet.getRange(2, 6, TEAM_IDS.length, 1).setNumberFormat("yyyy-mm-dd hh:mm:ss");
    sheet.getRange(2, 1, rows.length, TEAM_SETTINGS_HEADERS.length).setValues(rows);

    return jsonResponse_({
      ok: true,
      service: SERVICE_NAME,
      apiVersion: API_VERSION,
      action: "updateTeamSettings",
      saved: true,
      teams: readTeamSettings_()
    });
  } catch (error) {
    console.error(error);
    return jsonResponse_({
      ok: false,
      service: SERVICE_NAME,
      error: "Could not save team settings. Check Apps Script execution logs."
    });
  } finally {
    lock.releaseLock();
  }
}


/**
 * The shared competition length lives only in Competition Settings!B2.
 * Reads are public; writes require the configured admin token.
 */
function readCompetitionSettings_() {
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (!spreadsheetId) throw new Error("Missing SPREADSHEET_ID script property");
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  const sheet = spreadsheet.getSheetByName(COMPETITION_SETTINGS_TAB);
  if (!sheet) throw new Error('Missing "' + COMPETITION_SETTINGS_TAB + '" sheet');
  const raw = sheet.getRange("B2").getValue();
  const gamesPerTeam = Number(raw);
  if (!Number.isInteger(gamesPerTeam) || gamesPerTeam < MIN_GAMES_PER_TEAM || gamesPerTeam > MAX_GAMES_PER_TEAM) {
    return { ok: false, service: SERVICE_NAME, apiVersion: API_VERSION, action: "getCompetitionSettings", error: "Competition Settings!B2 must contain a whole number from " + MIN_GAMES_PER_TEAM + " to " + MAX_GAMES_PER_TEAM + "." };
  }
  return { ok: true, service: SERVICE_NAME, apiVersion: API_VERSION, action: "getCompetitionSettings", gamesPerTeam: gamesPerTeam };
}

function updateCompetitionSettings_(body) {
  const raw = body.gamesPerTeam;
  const gamesPerTeam = Number(raw);
  if (raw === "" || raw === null || raw === undefined || !Number.isInteger(gamesPerTeam) ||
      gamesPerTeam < MIN_GAMES_PER_TEAM || gamesPerTeam > MAX_GAMES_PER_TEAM) {
    return jsonResponse_({ ok: false, service: SERVICE_NAME, apiVersion: API_VERSION, action: "updateCompetitionSettings", error: "gamesPerTeam must be a whole number from " + MIN_GAMES_PER_TEAM + " to " + MAX_GAMES_PER_TEAM + "." });
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return jsonResponse_({ ok: false, service: SERVICE_NAME, error: "Service busy. Try again." });
  try {
    const spreadsheetId = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
    if (!spreadsheetId) throw new Error("Missing SPREADSHEET_ID script property");
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    const sheet = spreadsheet.getSheetByName(COMPETITION_SETTINGS_TAB);
    if (!sheet) throw new Error('Missing "' + COMPETITION_SETTINGS_TAB + '" sheet');
    sheet.getRange("B2").setValue(gamesPerTeam);
    SpreadsheetApp.flush();
    const saved = Number(sheet.getRange("B2").getValue());
    if (saved !== gamesPerTeam) throw new Error("The setting did not read back as the requested value.");
    return jsonResponse_({ ok: true, service: SERVICE_NAME, apiVersion: API_VERSION, action: "updateCompetitionSettings", saved: true, gamesPerTeam: saved });
  } catch (error) {
    console.error(error);
    return jsonResponse_({ ok: false, service: SERVICE_NAME, action: "updateCompetitionSettings", error: "Could not save the shared season length. Check Apps Script configuration and execution logs." });
  } finally {
    lock.releaseLock();
  }
}

function readTeamSettings_() {
  const sheet = getTeamSettingsSheet_();
  const lastRow = sheet.getLastRow();
  const rows = lastRow >= 2
    ? sheet.getRange(2, 1, lastRow - 1, TEAM_SETTINGS_HEADERS.length).getValues()
    : [];

  const byId = {};

  rows.forEach(function (row) {
    const teamId = String(row[0] || "").trim();
    if (!TEAM_IDS.includes(teamId)) return;

    byId[teamId] = {
      teamId: teamId,
      displayName: String(row[1] || ("Team " + teamId)),
      primaryColor: String(row[2] || ""),
      secondaryColor: String(row[3] || ""),
      logoUrl: String(row[4] || ""),
      updatedAt: row[5] instanceof Date ? row[5].toISOString() : null
    };
  });

  return TEAM_IDS.map(function (teamId) {
    return byId[teamId] || {
      teamId: teamId,
      displayName: "Team " + teamId,
      primaryColor: "",
      secondaryColor: "",
      logoUrl: "",
      updatedAt: null
    };
  });
}

function getTeamEditorPinsSheet_() {
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (!spreadsheetId) throw new Error("Missing SPREADSHEET_ID script property");
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  let sheet = spreadsheet.getSheetByName(TEAM_EDITOR_PINS_TAB);
  if (!sheet) sheet = spreadsheet.insertSheet(TEAM_EDITOR_PINS_TAB);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, TEAM_EDITOR_PIN_HEADERS.length).setValues([TEAM_EDITOR_PIN_HEADERS]);
    sheet.getRange(1, 1, 1, TEAM_EDITOR_PIN_HEADERS.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, TEAM_EDITOR_PIN_HEADERS.length);
  } else {
    const headers = sheet.getRange(1, 1, 1, TEAM_EDITOR_PIN_HEADERS.length).getDisplayValues()[0];
    if (!TEAM_EDITOR_PIN_HEADERS.every(function (value, index) { return headers[index] === value; })) {
      throw new Error("The Team Editor PINs tab has unexpected headers. No data was changed.");
    }
  }
  return sheet;
}

function readTeamEditorPinStatus_() {
  const sheet = getTeamEditorPinsSheet_();
  const lastRow = sheet.getLastRow();
  const rows = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, 3).getDisplayValues() : [];
  const configured = {};
  rows.forEach(function (row) {
    const teamId = String(row[0] || "").trim().toUpperCase();
    if (TEAM_IDS.includes(teamId) && /^\d{6}$/.test(String(row[1] || "").trim())) configured[teamId] = true;
  });
  return TEAM_IDS.map(function (teamId) { return { teamId: teamId, configured: Boolean(configured[teamId]) }; });
}

function verifyTeamEditorPin_(input) {
  const pin = String(input || "").trim();
  if (!/^\d{6}$/.test(pin)) return { ok: false, service: SERVICE_NAME, apiVersion: API_VERSION, error: "Invalid PIN." };
  const cache = CacheService.getScriptCache();
  const attemptsKey = "teamEditorPinFailures";
  const failures = Number(cache.get(attemptsKey) || 0);
  if (failures >= 30) return { ok: false, service: SERVICE_NAME, apiVersion: API_VERSION, error: "Too many attempts. Wait one minute and try again." };
  const sheet = getTeamEditorPinsSheet_();
  const lastRow = sheet.getLastRow();
  const rows = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, 2).getDisplayValues() : [];
  for (let i = 0; i < rows.length; i++) {
    const teamId = String(rows[i][0] || "").trim().toUpperCase();
    const savedPin = String(rows[i][1] || "").trim();
    if (TEAM_IDS.includes(teamId) && savedPin === pin) {
      cache.remove(attemptsKey);
      const sessionToken = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
      cache.put("studioSession:" + sessionToken, teamId, 21600);
      return { ok: true, service: SERVICE_NAME, apiVersion: API_VERSION, action: "verifyTeamEditorPin", teamId: teamId, sessionToken: sessionToken };
    }
  }
  cache.put(attemptsKey, String(failures + 1), 60);
  return { ok: false, service: SERVICE_NAME, apiVersion: API_VERSION, error: "Invalid PIN." };
}


function getSessionTeam_(token) {
  const value = String(token || "");
  if (!/^[a-f0-9]{64}$/.test(value)) return "";
  return String(CacheService.getScriptCache().get("studioSession:" + value) || "");
}
function getTeamPageDesignSheet_() {
  const id = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (!id) throw new Error("Missing SPREADSHEET_ID");
  const ss = SpreadsheetApp.openById(id);
  let sheet = ss.getSheetByName(TEAM_PAGE_DESIGNS_TAB);
  const headers = ["Team ID", "Design JSON", "Updated At"];
  if (!sheet) sheet = ss.insertSheet(TEAM_PAGE_DESIGNS_TAB);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
    sheet.setFrozenRows(1);
  } else {
    const actual = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
    if (!headers.every((v, i) => actual[i] === v)) throw new Error("Unexpected Team Page Designs headers.");
  }
  return sheet;
}
function readTeamPageDesign_(teamId) {
  const sheet = getTeamPageDesignSheet_(), last = sheet.getLastRow();
  if (last < 2) return null;
  const rows = sheet.getRange(2, 1, last - 1, 3).getValues();
  for (let i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i][0]).toUpperCase() === teamId) {
      try { return JSON.parse(String(rows[i][1] || "")); } catch (e) { return null; }
    }
  }
  return null;
}
function saveTeamPageDesign_(body) {
  const teamId = String(body.teamId || "").trim().toUpperCase();
  if (!TEAM_IDS.includes(teamId) || getSessionTeam_(body.sessionToken) !== teamId)
    return jsonResponse_({ ok: false, error: "Studio session expired. Sign in again." });
  let design;
  try { design = typeof body.design === "string" ? JSON.parse(body.design) : body.design; }
  catch (e) { return jsonResponse_({ ok: false, error: "Invalid design data." }); }
  if (!design || !Array.isArray(design.blocks) || design.blocks.length > 100)
    return jsonResponse_({ ok: false, error: "Design must contain at most 100 blocks." });
  const serialized = JSON.stringify(design);
  if (serialized.length > 45000)
    return jsonResponse_({ ok: false, error: "Design is too large for shared storage. Use hosted image URLs instead of embedded uploads." });
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return jsonResponse_({ ok: false, error: "Service busy. Try again." });
  try {
    const sheet = getTeamPageDesignSheet_(), last = sheet.getLastRow();
    const rows = last >= 2 ? sheet.getRange(2, 1, last - 1, 3).getDisplayValues() : [];
    let rowNumber = 0;
    rows.forEach((row, i) => { if (String(row[0]).toUpperCase() === teamId) rowNumber = i + 2; });
    if (!rowNumber) rowNumber = Math.max(2, last + 1);
    sheet.getRange(rowNumber, 1, 1, 3).setValues([[teamId, serialized, new Date()]]);
    return jsonResponse_({ ok: true, action: "saveTeamPageDesign", saved: true, teamId: teamId });
  } catch (e) {
    console.error(e); return jsonResponse_({ ok: false, error: "Could not save the shared design." });
  } finally { lock.releaseLock(); }
}
function getPublishedTeamPageSheet_() {
  const id = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (!id) throw new Error("Missing SPREADSHEET_ID");
  const ss = SpreadsheetApp.openById(id);
  let sheet = ss.getSheetByName(PUBLISHED_TEAM_PAGES_TAB);
  const headers = ["Team ID", "Design JSON", "Updated At"];
  if (!sheet) sheet = ss.insertSheet(PUBLISHED_TEAM_PAGES_TAB);
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  else {
    const actual = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
    if (!headers.every((v, i) => actual[i] === v)) throw new Error("Unexpected Published Team Pages headers.");
  }
  return sheet;
}

function readPublishedTeamPage_(teamId) {
  const sheet = getPublishedTeamPageSheet_(), last = sheet.getLastRow();
  if (last < 2) return null;
  const rows = sheet.getRange(2, 1, last - 1, 3).getValues();
  for (let i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i][0]).toUpperCase() === teamId) {
      try { return JSON.parse(String(rows[i][1] || "")); } catch (e) { return null; }
    }
  }
  return null;
}

function publishTeamPage_(body) {
  const teamId = String(body.teamId || "").trim().toUpperCase();
  if (!TEAM_IDS.includes(teamId) || getSessionTeam_(body.sessionToken) !== teamId)
    return jsonResponse_({ ok: false, error: "Studio session expired. Sign in again." });
  let design;
  try { design = typeof body.design === "string" ? JSON.parse(body.design) : body.design; }
  catch (e) { return jsonResponse_({ ok: false, error: "Invalid design data." }); }
  if (!design || !Array.isArray(design.blocks) || design.blocks.length > 100)
    return jsonResponse_({ ok: false, error: "Design must contain at most 100 blocks." });
  const serialized = JSON.stringify(design);
  if (serialized.length > 45000)
    return jsonResponse_({ ok: false, error: "Design is too large to publish. Use hosted image URLs instead of embedded uploads." });
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return jsonResponse_({ ok: false, error: "Service busy. Try again." });
  try {
    const sheet = getPublishedTeamPageSheet_(), last = sheet.getLastRow();
    const rows = last >= 2 ? sheet.getRange(2, 1, last - 1, 3).getDisplayValues() : [];
    let rowNumber = 0;
    rows.forEach((row, i) => { if (String(row[0]).toUpperCase() === teamId) rowNumber = i + 2; });
    if (!rowNumber) rowNumber = Math.max(2, last + 1);
    sheet.getRange(rowNumber, 1, 1, 3).setValues([[teamId, serialized, new Date()]]);
    return jsonResponse_({ ok: true, action: "publishTeamPage", published: true, teamId: teamId });
  } catch (e) {
    console.error(e); return jsonResponse_({ ok: false, error: "Could not publish the team page." });
  } finally { lock.releaseLock(); }
}

function revertTeamPage_(body) {
  const teamId = String(body.teamId || "").trim().toUpperCase();
  if (!TEAM_IDS.includes(teamId) || getSessionTeam_(body.sessionToken) !== teamId)
    return jsonResponse_({ ok: false, error: "Studio session expired. Sign in again." });
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return jsonResponse_({ ok: false, error: "Service busy. Try again." });
  try {
    const sheet = getPublishedTeamPageSheet_(), last = sheet.getLastRow();
    if (last < 2) return jsonResponse_({ ok: true, action: "revertTeamPage", reverted: true, teamId: teamId });
    const rows = sheet.getRange(2, 1, last - 1, 3).getDisplayValues();
    for (let i = rows.length - 1; i >= 0; i--) {
      if (String(rows[i][0]).trim().toUpperCase() === teamId) {
        sheet.deleteRow(i + 2);
        break;
      }
    }
    return jsonResponse_({ ok: true, action: "revertTeamPage", reverted: true, teamId: teamId });
  } catch (e) {
    console.error(e); return jsonResponse_({ ok: false, error: "Could not restore the default team page." });
  } finally { lock.releaseLock(); }
}

function submitFeatureRequest_(body) {
  const request = String(body.request || "").trim();
  const teamId = String(body.teamId || "").trim().toUpperCase();
  if (request.length < 8 || request.length > 1500) return jsonResponse_({ ok: false, error: "Request must be 8 to 1500 characters." });
  if (teamId && !TEAM_IDS.includes(teamId)) return jsonResponse_({ ok: false, error: "Invalid team ID." });
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return jsonResponse_({ ok: false, error: "Service busy. Try again." });
  try {
    const id = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
    if (!id) throw new Error("Missing SPREADSHEET_ID");
    const ss = SpreadsheetApp.openById(id);
    let sheet = ss.getSheetByName(FEATURE_REQUESTS_TAB);
    const headers = ["Submitted At", "Team ID", "Request", "Page"];
    if (!sheet) sheet = ss.insertSheet(FEATURE_REQUESTS_TAB);
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
      sheet.setFrozenRows(1);
    } else {
      const actual = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
      if (!headers.every((v, i) => actual[i] === v)) throw new Error("Unexpected Feature Requests headers.");
    }
    if (sheet.getLastRow() > 5000) return jsonResponse_({ ok: false, error: "Request inbox is full. Please try later." });
    sheet.appendRow([new Date(), teamId, request, String(body.page || "Team Page Studio").slice(0, 100)]);
    return jsonResponse_({ ok: true, action: "submitFeatureRequest", saved: true });
  } catch (e) {
    console.error(e); return jsonResponse_({ ok: false, error: "Could not save the feature request." });
  } finally { lock.releaseLock(); }
}


function getMatchPollsSheet_() {
  const id = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (!id) throw new Error("Missing SPREADSHEET_ID script property");
  const ss = SpreadsheetApp.openById(id);
  let sheet = ss.getSheetByName(MATCH_POLLS_TAB);
  if (!sheet) sheet = ss.insertSheet(MATCH_POLLS_TAB);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, MATCH_POLL_HEADERS.length).setValues([MATCH_POLL_HEADERS]).setFontWeight("bold");
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, MATCH_POLL_HEADERS.length);
  } else {
    const actual = sheet.getRange(1, 1, 1, MATCH_POLL_HEADERS.length).getDisplayValues()[0];
    if (!MATCH_POLL_HEADERS.every(function (v, i) { return actual[i] === v; })) throw new Error("The Match Polls tab has unexpected headers.");
  }
  return sheet;
}
function hashVoterToken_(token) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token, Utilities.Charset.UTF_8);
  return bytes.map(function (value) { return ("0" + (((value + 256) % 256).toString(16))).slice(-2); }).join("");
}
function readMatchPolls_() {
  const sheet = getMatchPollsSheet_(), last = sheet.getLastRow(), counts = {};
  if (last < 2) return counts;
  sheet.getRange(2, 1, last - 1, 2).getDisplayValues().forEach(function (row) {
    const matchId = String(row[0] || "").trim(), teamId = String(row[1] || "").trim().toUpperCase();
    if (!/^\d{1,4}$/.test(matchId) || !TEAM_IDS.includes(teamId)) return;
    if (!counts[matchId]) counts[matchId] = {};
    counts[matchId][teamId] = (counts[matchId][teamId] || 0) + 1;
  });
  return counts;
}
function submitMatchVote_(body) {
  const matchId = String(body.matchId || "").trim(), teamId = String(body.teamId || "").trim().toUpperCase();
  const voterToken = String(body.voterToken || "").trim();
  if (!/^\d{1,4}$/.test(matchId) || Number(matchId) < 1 || !TEAM_IDS.includes(teamId))
    return jsonResponse_({ ok: false, error: "Invalid match or team." });
  if (!/^[a-f0-9-]{32,80}$/i.test(voterToken))
    return jsonResponse_({ ok: false, error: "A valid voter token is required." });
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return jsonResponse_({ ok: false, error: "Poll busy. Try again." });
  try {
    const sheet = getMatchPollsSheet_(), last = sheet.getLastRow(), tokenHash = hashVoterToken_(voterToken);
    if (last >= 2) {
      const rows = sheet.getRange(2, 1, last - 1, 3).getDisplayValues();
      if (rows.some(function (row) { return String(row[0]).trim() === matchId && String(row[2]).trim() === tokenHash; }))
        return jsonResponse_({ ok: false, error: "This browser has already voted in this match." });
    }
    if (last > 10000) return jsonResponse_({ ok: false, error: "Poll storage is full." });
    sheet.getRange(last + 1, 1, 1, MATCH_POLL_HEADERS.length).setValues([[matchId, teamId, tokenHash, new Date()]]);
    return jsonResponse_({ ok: true, action: "submitMatchVote", saved: true, matchId: Number(matchId) });
  } catch (error) {
    console.error(error);
    return jsonResponse_({ ok: false, error: "Could not save the match vote." });
  } finally { lock.releaseLock(); }
}
\nfunction getTeamSettingsSheet_() {
  const properties = PropertiesService.getScriptProperties();
  const spreadsheetId = properties.getProperty("SPREADSHEET_ID");

  if (!spreadsheetId) {
    throw new Error("Missing SPREADSHEET_ID script property");
  }

  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  let sheet = spreadsheet.getSheetByName(TEAM_SETTINGS_TAB);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(TEAM_SETTINGS_TAB);
  }

  if (sheet.getLastRow() === 0) {
    initialiseTeamSettingsSheet_(sheet);
    return sheet;
  }

  const header = sheet
    .getRange(1, 1, 1, TEAM_SETTINGS_HEADERS.length)
    .getDisplayValues()[0];

  const headerMatches = TEAM_SETTINGS_HEADERS.every(function (value, index) {
    return header[index] === value;
  });

  if (!headerMatches) {
    throw new Error(
      "The Team Settings tab exists but its headers do not match the API schema. No data was changed."
    );
  }

  if (sheet.getLastRow() < 2) {
    initialiseTeamSettingsRows_(sheet);
  }

  return sheet;
}

function initialiseTeamSettingsSheet_(sheet) {
  sheet.getRange(1, 1, 1, TEAM_SETTINGS_HEADERS.length)
    .setValues([TEAM_SETTINGS_HEADERS]);
  sheet.getRange(1, 1, 1, TEAM_SETTINGS_HEADERS.length).setFontWeight("bold");
  initialiseTeamSettingsRows_(sheet);
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, TEAM_SETTINGS_HEADERS.length);
}

function initialiseTeamSettingsRows_(sheet) {
  const rows = TEAM_IDS.map(function (teamId) {
    return [teamId, "Team " + teamId, "", "", "", ""];
  });

  sheet.getRange(2, 1, rows.length, 5).setNumberFormat("@");
  sheet.getRange(2, 1, rows.length, TEAM_SETTINGS_HEADERS.length).setValues(rows);
}

function validateTeamSettings_(input) {
  if (!Array.isArray(input) || input.length !== TEAM_IDS.length) {
    throw new Error("Exactly five team settings are required.");
  }

  const byId = {};

  input.forEach(function (item) {
    if (!item || typeof item !== "object") {
      throw new Error("Each team setting must be an object.");
    }

    const teamId = String(item.teamId || "").trim().toUpperCase();

    if (!TEAM_IDS.includes(teamId) || byId[teamId]) {
      throw new Error("Team IDs must be A, B, C, D, and E exactly once.");
    }

    const displayName = String(item.displayName == null ? "" : item.displayName).trim();
    const primaryColor = String(item.primaryColor || "").trim();
    const secondaryColor = String(item.secondaryColor || "").trim();
    const logoUrl = String(item.logoUrl || "").trim();

    if (!displayName || displayName.length > 30) {
      throw new Error("Team " + teamId + " needs a display name of 1 to 30 characters.");
    }

    if (/[\u0000-\u001F\u007F]/.test(displayName)) {
      throw new Error("Team names cannot contain control characters.");
    }

    if (primaryColor && !/^#[0-9a-fA-F]{6}$/.test(primaryColor)) {
      throw new Error("Primary colours must be blank or a hex value such as #3366FF.");
    }

    if (secondaryColor && !/^#[0-9a-fA-F]{6}$/.test(secondaryColor)) {
      throw new Error("Secondary colours must be blank or a hex value such as #3366FF.");
    }

    if (logoUrl && (
      logoUrl.length > 500 ||
      !/^https:\/\/[^\s]+$/i.test(logoUrl)
    )) {
      throw new Error("Logo URLs must be blank or a valid HTTPS URL under 500 characters.");
    }

    byId[teamId] = {
      displayName: displayName,
      primaryColor: primaryColor,
      secondaryColor: secondaryColor,
      logoUrl: logoUrl
    };
  });

  TEAM_IDS.forEach(function (teamId) {
    if (!byId[teamId]) {
      throw new Error("Missing settings for Team " + teamId + ".");
    }
  });

  return byId;
}

function respond_(value, callback) {
  if (!callback) return jsonResponse_(value);

  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(callback)) {
    return jsonResponse_({
      ok: false,
      service: SERVICE_NAME,
      error: "Invalid callback"
    });
  }

  return ContentService
    .createTextOutput(callback + "(" + JSON.stringify(value) + ");")
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function jsonResponse_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function socialSheet_(name,headers){const id=PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");if(!id)throw new Error("Missing SPREADSHEET_ID");const ss=SpreadsheetApp.openById(id);let sh=ss.getSheetByName(name);if(!sh)sh=ss.insertSheet(name);if(!sh.getLastRow()){sh.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight("bold");sh.setFrozenRows(1);}else if(!headers.every((h,i)=>sh.getRange(1,i+1).getDisplayValue()===h))throw new Error("Unexpected headers in "+name);return sh;}
function socialPostsSheet_(){return socialSheet_(SOCIAL_POSTS_TAB,SOCIAL_POST_HEADERS);}
function socialAuditSheet_(){return socialSheet_(SOCIAL_AUDIT_TAB,["Timestamp","Action","Post ID","Team ID","Actor","Reason"]);}
function socialBansSheet_(){return socialSheet_(SOCIAL_BANS_TAB,["Team ID","Banned","Reason","Updated At"]);}
function socialPost_(r){return {postId:String(r[0]||""),submittedAt:r[1]?new Date(r[1]).toISOString():"",teamId:String(r[2]||""),title:String(r[3]||""),body:String(r[4]||""),imageUrl:String(r[5]||""),category:String(r[6]||"Team news"),reviewStatus:String(r[7]||"Unviewed"),publicationStatus:String(r[8]||"Pending"),publishedAt:r[9]?new Date(r[9]).toISOString():"",updatedAt:r[10]?new Date(r[10]).toISOString():"",moderationNote:String(r[11]||""),featured:String(r[12]).toLowerCase()==="true"};}
function allSocialPosts_(){const sh=socialPostsSheet_(),n=sh.getLastRow();return n<2?[]:sh.getRange(2,1,n-1,SOCIAL_POST_HEADERS.length).getValues().map(socialPost_).filter(p=>p.postId);}
function readPublicSocialPosts_(){return allSocialPosts_().filter(p=>p.publicationStatus==="Published").sort((a,b)=>Number(b.featured)-Number(a.featured)||String(b.publishedAt).localeCompare(String(a.publishedAt))).slice(0,100);}
function readModerationPosts_(){return allSocialPosts_().sort((a,b)=>String(b.submittedAt).localeCompare(String(a.submittedAt)));}
function readSocialBans_(){const sh=socialBansSheet_(),n=sh.getLastRow(),out={};if(n<2)return out;sh.getRange(2,1,n-1,4).getDisplayValues().forEach(r=>{const id=String(r[0]).toUpperCase();if(TEAM_IDS.includes(id))out[id]={banned:String(r[1]).toLowerCase()==="true",reason:String(r[2]||""),updatedAt:String(r[3]||"")};});return out;}
function readSocialAudit_(){const sh=socialAuditSheet_(),n=sh.getLastRow();if(n<2)return [];return sh.getRange(Math.max(2,n-99),1,Math.min(100,n-1),6).getDisplayValues().reverse().map(r=>({timestamp:r[0],action:r[1],postId:r[2],teamId:r[3],actor:r[4],reason:r[5]}));}
function logSocial_(action,id,team,actor,reason){socialAuditSheet_().appendRow([new Date(),action,id||"",team||"",actor||"Admin",String(reason||"").slice(0,500)]);}
function requestModerationSession_(b){const expected=PropertiesService.getScriptProperties().getProperty("ADMIN_TOKEN"),nonce=String(b.nonce||"");if(!expected||String(b.adminToken||"")!==expected)return jsonResponse_({ok:false,error:"Admin token rejected."});if(!/^[a-f0-9]{32,64}$/.test(nonce))return jsonResponse_({ok:false,error:"Invalid session challenge."});const t=Utilities.getUuid().replace(/-/g,"")+Utilities.getUuid().replace(/-/g,"");const cache=CacheService.getScriptCache();cache.put("socialAdminSession:"+t,"admin",1800);cache.put("socialSessionExchange:"+nonce,t,60);return jsonResponse_({ok:true,queued:true});}
function consumeModerationSession_(nonce){const n=String(nonce||"");if(!/^[a-f0-9]{32,64}$/.test(n))return {ok:false,error:"Invalid session challenge."};const cache=CacheService.getScriptCache(),key="socialSessionExchange:"+n,t=cache.get(key);if(!t)return {ok:false,error:"Session exchange pending. Try again."};cache.remove(key);return {ok:true,sessionToken:t,expiresIn:1800};}
function getModerationSession_(token){return /^[a-f0-9]{64}$/.test(String(token||""))&&CacheService.getScriptCache().get("socialAdminSession:"+token)==="admin";}
function findSocialPost_(id){const sh=socialPostsSheet_(),n=sh.getLastRow();if(n<2)return {sheet:sh,row:0};const ids=sh.getRange(2,1,n-1,1).getDisplayValues();for(let i=0;i<ids.length;i++)if(ids[i][0]===String(id))return {sheet:sh,row:i+2};return {sheet:sh,row:0};}
function submitSocialPost_(b){const team=String(b.teamId||"").toUpperCase(),title=String(b.title||"").trim(),body=String(b.body||"").trim(),category=String(b.category||"Team news"),image=String(b.imageUrl||"").trim();if(!TEAM_IDS.includes(team)||getSessionTeam_(b.sessionToken)!==team)return jsonResponse_({ok:false,error:"Team Studio session expired."});if(title.length<3||title.length>120)return jsonResponse_({ok:false,error:"Headline must be 3–120 characters."});if(body.length<10||body.length>5000)return jsonResponse_({ok:false,error:"Post text must be 10–5000 characters."});if(!["Announcements","Match reports","Team news"].includes(category))return jsonResponse_({ok:false,error:"Invalid category."});if(image&&(!image.toLowerCase().startsWith("https://")||image.length>1000))return jsonResponse_({ok:false,error:"Image must be an HTTPS URL."});const bans=readSocialBans_();if(bans[team]&&bans[team].banned)return jsonResponse_({ok:false,error:"This team is blocked from submitting posts."});const lock=LockService.getScriptLock();if(!lock.tryLock(5000))return jsonResponse_({ok:false,error:"Service busy."});try{const sh=socialPostsSheet_();if(sh.getLastRow()>5000)return jsonResponse_({ok:false,error:"Post archive is full."});const id=Utilities.getUuid(),now=new Date();sh.appendRow([id,now,team,title,body,image,category,"Unviewed","Pending","",now,"",false]);logSocial_("Submitted",id,team,"Team "+team,"");return jsonResponse_({ok:true,saved:true,postId:id});}catch(e){console.error(e);return jsonResponse_({ok:false,error:"Could not save post."});}finally{lock.releaseLock();}}
function handleSocialModeration_(b){if(!getModerationSession_(b.sessionToken))return jsonResponse_({ok:false,error:"Admin session expired."});const action=String(b.action||""),team=String(b.teamId||"").toUpperCase(),reason=String(b.reason||"").trim().slice(0,500);if(action==="setSocialPostingBan"){if(!TEAM_IDS.includes(team))return jsonResponse_({ok:false,error:"Invalid team."});if(b.banned&&reason.length<4)return jsonResponse_({ok:false,error:"Add a reason before applying a ban."});const sh=socialBansSheet_(),n=sh.getLastRow(),rows=n<2?[]:sh.getRange(2,1,n-1,4).getDisplayValues();let row=0;rows.forEach((r,i)=>{if(String(r[0]).toUpperCase()===team)row=i+2;});if(!row)row=Math.max(2,n+1);sh.getRange(row,1,1,4).setValues([[team,Boolean(b.banned),reason,new Date()]]);logSocial_(b.banned?"Posting ban applied":"Posting ban lifted","",team,"Admin",reason);return jsonResponse_({ok:true,saved:true});}const id=String(b.postId||""),found=findSocialPost_(id);if(!found.row)return jsonResponse_({ok:false,error:"Post not found."});const p=socialPost_(found.sheet.getRange(found.row,1,1,SOCIAL_POST_HEADERS.length).getValues()[0]);if(action==="markSocialPostViewed"){if(p.reviewStatus!=="Viewed"){found.sheet.getRange(found.row,8).setValue("Viewed");found.sheet.getRange(found.row,11).setValue(new Date());logSocial_("Viewed",id,p.teamId,"Admin","");}return jsonResponse_({ok:true,saved:true});}const d=String(b.decision||"");if(!["publish","reject","remove","feature","unfeature"].includes(d))return jsonResponse_({ok:false,error:"Invalid decision."});if(d==="publish"||d==="feature"){found.sheet.getRange(found.row,9).setValue("Published");if(!p.publishedAt)found.sheet.getRange(found.row,10).setValue(new Date());found.sheet.getRange(found.row,12).setValue("");if(d==="feature")found.sheet.getRange(found.row,13).setValue(true);}else if(d==="unfeature")found.sheet.getRange(found.row,13).setValue(false);else{found.sheet.getRange(found.row,9).setValue(d==="reject"?"Rejected":"Removed");found.sheet.getRange(found.row,12).setValue(reason);found.sheet.getRange(found.row,13).setValue(false);}found.sheet.getRange(found.row,11).setValue(new Date());logSocial_(d,id,p.teamId,"Admin",reason);return jsonResponse_({ok:true,saved:true,decision:d});}

function readTeamSocialStatus_(teamId,token){const team=String(teamId||"").toUpperCase();if(!TEAM_IDS.includes(team)||getSessionTeam_(token)!==team)return {ok:false,error:"Team Studio session expired."};const bans=readSocialBans_();return {ok:true,teamId:team,banned:Boolean(bans[team]&&bans[team].banned),posts:allSocialPosts_().filter(p=>p.teamId===team).sort((a,b)=>String(b.submittedAt).localeCompare(String(a.submittedAt))).slice(0,30)};}
