const SERVICE_NAME = "competition-community-api";
const API_VERSION = 1;
const BUILD_ID = "2026-10-21-drive-asset-studio";

// Keep the public action inventory in one place. The health endpoint and
// POST allowlist both use these constants so they cannot silently drift apart.
const GET_ACTIONS = [
  "health",
  "getTeamSettings",
  "getCompetitionSettings",
  "getMatchResults",
  "getMatchPolls",
  "getTeamPageDesign",
  "getTeamPlayerCards",
  "getTeamPlayerCardAssetUpload",
  "getTeamAssets",
  "getTeamAssetUpload",
  "getCompetitionAssetUpload",
  "getCompetitionAssets",
  "getPublishedTeamPage",
  "getTeamEditorPinStatus",
  "verifyTeamEditorPin",
  "getSocialPosts",
  "getTeamSocialStatus",
  "getModerationSession",
  "getScoreEditorSession",
  "getModerationQueue"
];

const POST_ACTIONS = [
  "updateTeamSettings",
  "updateCompetitionSettings",
  "updateTeamEditorPin",
  "submitMatchResult",
  "saveTeamPageDesign",
  "saveTeamPlayerCards",
  "uploadTeamPlayerCardAsset",
  "uploadTeamAsset",
  "uploadCompetitionAsset",
  "publishTeamPage",
  "revertTeamPage",
  "submitFeatureRequest",
  "submitMatchVote",
  "submitSocialPost",
  "submitOfficialSocialPost",
  "createModerationSession",
  "createScoreEditorSession",
  "moderateSocialPost",
  "markSocialPostViewed",
  "setSocialPostingBan"
];

const API_ACTIONS = [...new Set([...GET_ACTIONS, ...POST_ACTIONS])];

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
      const hasSpreadsheetId = Boolean(properties.getProperty("SPREADSHEET_ID"));
      const hasAdminToken = Boolean(properties.getProperty("ADMIN_TOKEN"));
      const hasScoreEditorCode = Boolean(properties.getProperty("SCORE_EDITOR_CODE"));
      const hasResultsSpreadsheetId = Boolean(properties.getProperty("RESULTS_SPREADSHEET_ID"));
      result = {
        ok: true,
        service: SERVICE_NAME,
        apiVersion: API_VERSION,
        buildId: BUILD_ID,
        configured: hasSpreadsheetId && hasAdminToken,
        configuration: {
          spreadsheetId: hasSpreadsheetId,
          adminToken: hasAdminToken,
          scoreEditorCode: hasScoreEditorCode,
          resultsSpreadsheetId: hasResultsSpreadsheetId
        },
        helpers: {
          respond: typeof respond_ === "function",
          jsonResponse: typeof jsonResponse_ === "function",
          moderationSession: typeof requestModerationSession_ === "function" && typeof consumeModerationSession_ === "function",
          scoreEditorSession: typeof requestScoreEditorSession_ === "function" && typeof consumeScoreEditorSession_ === "function",
          playerCardAssetUpload: typeof uploadTeamPlayerCardAsset_ === "function"
        },
        actions: API_ACTIONS,
        getActions: GET_ACTIONS,
        postActions: POST_ACTIONS
      };
    } else if (action === "getMatchResults") {
      result = { ok: true, service: SERVICE_NAME, apiVersion: API_VERSION, action: action, results: readMatchResults_() };
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
    } else if (action === "getTeamPlayerCards") {
      const teamId = String(params.teamId || "").trim().toUpperCase();
      if (!TEAM_IDS.includes(teamId) || getSessionTeam_(params.sessionToken) !== teamId) result = { ok: false, error: "Studio session expired. Sign in again." };
      else result = { ok: true, action: action, teamId: teamId, cards: readTeamPlayerCards_(teamId) };
    } else if (action === "getTeamPlayerCardAssetUpload") {
      const teamId = String(params.teamId || "").trim().toUpperCase();
      const uploadKey = String(params.uploadKey || "").trim();
      if (!TEAM_IDS.includes(teamId) || getSessionTeam_(params.sessionToken) !== teamId || !/^[a-z0-9-]{8,100}$/i.test(uploadKey)) {
        result = { ok: false, error: "Studio session expired or asset upload key is invalid." };
      } else {
        const props = PropertiesService.getScriptProperties();
        const propertyKey = "PLAYER_CARD_ASSET_UPLOAD_" + teamId + "_" + uploadKey;
        const fileId = props.getProperty(propertyKey);
        const uploadErrorKey = "PLAYER_CARD_ASSET_ERROR_" + teamId + "_" + uploadKey;
        const uploadError = props.getProperty(uploadErrorKey);
        if (!fileId) {
          if (uploadError) {
            props.deleteProperty(uploadErrorKey);
            result = { ok: false, error: uploadError };
          } else {
            result = { ok: false, error: "Drive did not confirm the upload. The Apps Script deployment may not have the latest upload handler, or the upload request failed before it could save a result. Check Apps Script Executions for the uploadTeamPlayerCardAsset request." };
          }
        } else {
          props.deleteProperty(propertyKey);
          props.deleteProperty(uploadErrorKey);
          result = { ok: true, action: action, teamId: teamId, url: "https://drive.google.com/uc?export=view&id=" + encodeURIComponent(fileId), fileId: fileId };
        }
      }
    } else if (action === "getTeamAssets") {
      const teamId = String(params.teamId || "").trim().toUpperCase();
      if (!TEAM_IDS.includes(teamId) || getSessionTeam_(params.sessionToken) !== teamId) {
        result = { ok: false, error: "Team session expired. Sign in again." };
      } else {
        result = { ok: true, action: action, teamId: teamId, assets: readTeamAssets_(teamId) };
      }
    } else if (action === "getTeamAssetUpload") {
      const teamId = String(params.teamId || "").trim().toUpperCase();
      const uploadKey = String(params.uploadKey || "").trim();
      if (!TEAM_IDS.includes(teamId) || getSessionTeam_(params.sessionToken) !== teamId || !/^[a-f0-9]{32,64}$/i.test(uploadKey)) {
        result = { ok: false, pending: false, error: "Team session expired or asset upload key is invalid." };
      } else {
        const props = PropertiesService.getScriptProperties();
        const resultKey = "TEAM_ASSET_UPLOAD_" + teamId + "_" + uploadKey;
        const errorKey = "TEAM_ASSET_UPLOAD_ERROR_" + teamId + "_" + uploadKey;
        const saved = props.getProperty(resultKey);
        const uploadError = props.getProperty(errorKey);
        if (saved) {
          props.deleteProperty(resultKey);
          result = JSON.parse(saved);
        } else if (uploadError) {
          props.deleteProperty(errorKey);
          result = { ok: false, pending: false, error: uploadError };
        } else {
          result = { ok: true, pending: true, action: action, teamId: teamId };
        }
      }
    } else if (action === "getCompetitionAssetUpload") {
      const uploadKey = String(params.uploadKey || "").trim();
      if (!/^[a-f0-9]{32,64}$/i.test(uploadKey)) {
        result = { ok: false, pending: false, error: "Invalid asset upload key." };
      } else {
        const props = PropertiesService.getScriptProperties();
        const savedKey = "COMPETITION_ASSET_UPLOAD_" + uploadKey;
        const errorKey = "COMPETITION_ASSET_UPLOAD_ERROR_" + uploadKey;
        const saved = props.getProperty(savedKey);
        const uploadError = props.getProperty(errorKey);
        if (saved) {
          props.deleteProperty(savedKey);
          result = JSON.parse(saved);
        } else if (uploadError) {
          props.deleteProperty(errorKey);
          result = { ok: false, pending: false, error: uploadError };
        } else {
          result = { ok: true, pending: true, action: action };
        }
      }
    } else if (action === "getCompetitionAssets") {
      result = { ok: true, action: action, assets: readCompetitionAssets_() };
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
    } else if (action === "getScoreEditorSession") {
      result = consumeScoreEditorSession_(params.nonce);
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

  if (!POST_ACTIONS.includes(body.action)) {
    return jsonResponse_({
      ok: false,
      service: SERVICE_NAME,
      error: "Operation not allowed"
    });
  }

  if (body.action === "submitFeatureRequest") return submitFeatureRequest_(body);
  if (body.action === "submitSocialPost") return submitSocialPost_(body);
  if (body.action === "submitOfficialSocialPost") return submitOfficialSocialPost_(body);
  if (body.action === "createModerationSession") return requestModerationSession_(body);
  if (body.action === "createScoreEditorSession") return requestScoreEditorSession_(body);
  if (body.action === "submitMatchResult" && isScoreEditorSession_(body.scoreSessionToken)) return submitMatchResult_(body);
  if (["moderateSocialPost", "markSocialPostViewed", "setSocialPostingBan"].includes(body.action)) return handleSocialModeration_(body);
  if (body.action === "submitMatchVote") return submitMatchVote_(body);
  if (body.action === "saveTeamPageDesign") return saveTeamPageDesign_(body);
  if (body.action === "uploadTeamPlayerCardAsset") return uploadTeamPlayerCardAsset_(body);
  if (body.action === "uploadTeamAsset") return uploadTeamAsset_(body);
  if (body.action === "saveTeamPlayerCards") return saveTeamPlayerCards_(body);
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

  if (body.action === "uploadCompetitionAsset") return uploadCompetitionAsset_(body);
  if (body.action === "updateCompetitionSettings") return updateCompetitionSettings_(body);
  if (body.action === "submitMatchResult") return submitMatchResult_(body);

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

/** Official result tab configuration. Columns A-E: Match ID, Home Team,
 * Home Score, Away Team, Away Score. */
function getResultsSheet_() {
  const p = PropertiesService.getScriptProperties();
  const id = p.getProperty("RESULTS_SPREADSHEET_ID"), name = p.getProperty("RESULTS_SHEET_NAME") || "Team results";
  if (!id) throw new Error("Missing RESULTS_SPREADSHEET_ID");
  const sheet = SpreadsheetApp.openById(id).getSheetByName(name);
  if (!sheet || sheet.getLastRow() < 1 || sheet.getLastColumn() < 5) throw new Error("Configured results sheet is missing or incomplete");
  const h = sheet.getRange(1,1,1,5).getDisplayValues()[0].map(v => String(v || "").trim().toLowerCase());
  const idHeader = h[0].startsWith("game") || h[0].startsWith("match");
  if (!idHeader || !h[1].includes("home") || !h[2].includes("score") || !h[3].includes("away") || !h[4].includes("score")) {
    throw new Error("Expected columns A-E: Match ID, Home Team, Home Score, Away Team, Away Score");
  }
  return sheet;
}
function readMatchResults_() {
  const sh = getResultsSheet_(), last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2,1,last-1,Math.min(7,sh.getLastColumn())).getValues().map(r => ({
    matchId:Number(r[0]), home:String(r[1]||""), homeScore:r[2]===""||r[2]===null?null:Number(r[2]),
    away:String(r[3]||""), awayScore:r[4]===""||r[4]===null?null:Number(r[4]),
    stage:String(r[5]||"REGULAR"), referee:String(r[6]||"")
  })).filter(r => Number.isInteger(r.matchId) && r.matchId > 0);
}
function submitMatchResult_(body) {
  const id=Number(body.matchId), home=Number(body.homeScore), away=Number(body.awayScore);
  if (!Number.isInteger(id)||id<1||body.homeScore===""||body.awayScore===""||
      !Number.isInteger(home)||!Number.isInteger(away)||home<0||away<0||home>99||away>99) {
    return jsonResponse_({ok:false,error:"Enter whole-number scores from 0 to 99."});
  }
  const lock=LockService.getScriptLock();
  if (!lock.tryLock(10000)) return jsonResponse_({ok:false,error:"Results are busy. Try again."});
  try {
    const sh=getResultsSheet_(), last=sh.getLastRow();
    const ids=last<2?[]:sh.getRange(2,1,last-1,1).getDisplayValues();
    let row=0;
    ids.forEach((r,i)=>{if(String(r[0]).trim()===String(id))row=i+2;});
    if(!row)return jsonResponse_({ok:false,error:"Match ID not found in the official results sheet."});
    sh.getRange(row,3).setValue(home); sh.getRange(row,5).setValue(away); SpreadsheetApp.flush();
    if(Number(sh.getRange(row,3).getValue())!==home||Number(sh.getRange(row,5).getValue())!==away)throw new Error("Score verification failed");
    return jsonResponse_({ok:true,saved:true,matchId:id,homeScore:home,awayScore:away});
  } catch(e) {
    console.error(e); return jsonResponse_({ok:false,error:"Could not save the result. Check Script Properties and execution logs."});
  } finally { lock.releaseLock(); }
}

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

/**
 * Saves a cleaned shared asset to Drive. This action is reached only after
 * doPost has validated the admin token. The browser polls a one-time upload
 * key because GitHub Pages cannot read the response to a no-cors POST.
 */
function uploadCompetitionAsset_(body) {
  const uploadKey = String(body.uploadKey || "").trim();
  if (!/^[a-f0-9]{32,64}$/i.test(uploadKey)) return jsonResponse_({ ok: false, error: "Invalid asset upload key." });
  const dataUrl = String(body.dataUrl || "");
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return jsonResponse_({ ok: false, error: "Unsupported image format. Save the cleaned asset as PNG, JPG, WebP or GIF." });
  let bytes;
  try { bytes = Utilities.base64Decode(match[2]); } catch (e) { return jsonResponse_({ ok: false, error: "Could not decode the image." }); }
  if (!bytes.length || bytes.length > 5 * 1024 * 1024) return jsonResponse_({ ok: false, error: "Each asset must be 5 MB or smaller." });

  const props = PropertiesService.getScriptProperties();
  const resultKey = "COMPETITION_ASSET_UPLOAD_" + uploadKey;
  const errorKey = "COMPETITION_ASSET_UPLOAD_ERROR_" + uploadKey;
  try {
    let folder = null;
    const folderId = props.getProperty("COMPETITION_ASSETS_FOLDER_ID");
    if (folderId) {
      try { folder = DriveApp.getFolderById(folderId); } catch (e) { folder = null; }
    }
    if (!folder) {
      folder = DriveApp.createFolder("Competition Dashboard Assets");
      props.setProperty("COMPETITION_ASSETS_FOLDER_ID", folder.getId());
    }
    const mime = match[1].toLowerCase();
    const ext = mime === "image/jpeg" ? "jpg" : mime.split("/")[1];
    const rawName = String(body.assetName || "competition-asset").trim().slice(0, 90);
    const safeName = rawName.replace(/[^a-z0-9 _.-]/gi, "").replace(/\s+/g, " ").trim() || "competition-asset";
    const category = ["Card background", "Card frame", "Player portrait", "Team crest", "Other"].includes(String(body.category)) ? String(body.category) : "Other";
    const blob = Utilities.newBlob(bytes, mime, safeName + "." + ext);
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    file.setDescription("Competition Dashboard Asset\nCategory: " + category + "\nAsset name: " + safeName);
    const saved = {
      ok: true,
      pending: false,
      action: "uploadCompetitionAsset",
      name: safeName,
      category: category,
      fileId: file.getId(),
      url: "https://drive.google.com/uc?export=view&id=" + encodeURIComponent(file.getId())
    };
    props.setProperty(resultKey, JSON.stringify(saved));
    props.deleteProperty(errorKey);
    return jsonResponse_({ ok: true, action: "uploadCompetitionAsset", saved: true });
  } catch (error) {
    console.error(error);
    try { props.setProperty(errorKey, "Drive upload failed: " + String(error && error.message || error).slice(0, 350)); } catch (ignored) {}
    return jsonResponse_({ ok: false, error: "Drive could not save the asset. Check Apps Script Drive authorisation and Executions." });
  }
}


/**
 * Lists the public assets saved through Asset Studio so the Player Card Studio
 * can use Drive backgrounds without making the user paste a file URL.
 */
function readCompetitionAssets_() {
  const props = PropertiesService.getScriptProperties();
  const folderId = props.getProperty("COMPETITION_ASSETS_FOLDER_ID");
  if (!folderId) return [];
  try {
    const folder = DriveApp.getFolderById(folderId);
    const files = folder.getFiles();
    const assets = [];
    while (files.hasNext() && assets.length < 150) {
      const file = files.next();
      if (file.isTrashed() || !/^image\//i.test(file.getMimeType())) continue;
      const description = String(file.getDescription() || "");
      const categoryMatch = description.match(/(?:^|\n)Category:\s*([^\n]+)/i);
      const nameMatch = description.match(/(?:^|\n)Asset name:\s*([^\n]+)/i);
      assets.push({
        id: file.getId(),
        name: nameMatch ? nameMatch[1].trim() : file.getName().replace(/\.[^.]+$/, ""),
        category: categoryMatch ? categoryMatch[1].trim() : "Uncategorised",
        url: "https://drive.google.com/uc?export=view&id=" + encodeURIComponent(file.getId()),
        thumbnailUrl: "https://drive.google.com/thumbnail?id=" + encodeURIComponent(file.getId()) + "&sz=w400",
        updatedAt: file.getLastUpdated().getTime()
      });
    }
    assets.sort(function(a, b) { return b.updatedAt - a.updatedAt; });
    return assets;
  } catch (error) {
    console.error(error);
    throw new Error("Could not list Competition Dashboard assets. Check Drive authorisation.");
  }
}

/**
 * Team Asset Studio: each team has a separate Drive folder and authenticated
 * list/upload/poll endpoints. Public card images are link-viewable so the
 * published GitHub Pages team pages can display them, but libraries are scoped.
 */
function getTeamAssetsFolder_(teamId) {
  const props = PropertiesService.getScriptProperties();
  const propertyKey = "TEAM_ASSETS_FOLDER_ID_" + teamId;
  const savedId = props.getProperty(propertyKey);
  if (savedId) {
    try { return DriveApp.getFolderById(savedId); } catch (e) {}
  }
  const folder = DriveApp.createFolder("Competition Dashboard Team " + teamId + " Assets");
  props.setProperty(propertyKey, folder.getId());
  return folder;
}

function uploadTeamAsset_(body) {
  const teamId = String(body.teamId || "").trim().toUpperCase();
  const uploadKey = String(body.uploadKey || "").trim();
  if (!TEAM_IDS.includes(teamId) || getSessionTeam_(body.sessionToken) !== teamId)
    return jsonResponse_({ ok: false, error: "Team session expired. Sign in again." });
  if (!/^[a-f0-9]{32,64}$/i.test(uploadKey)) return jsonResponse_({ ok: false, error: "Invalid asset upload key." });
  const match = String(body.dataUrl || "").match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return jsonResponse_({ ok: false, error: "Unsupported image format. Use JPG, PNG, WebP or GIF." });
  let bytes;
  try { bytes = Utilities.base64Decode(match[2]); } catch (e) { return jsonResponse_({ ok: false, error: "Could not decode the image." }); }
  if (!bytes.length || bytes.length > 5 * 1024 * 1024) return jsonResponse_({ ok: false, error: "Each image must be 5 MB or smaller." });
  const props = PropertiesService.getScriptProperties();
  const resultKey = "TEAM_ASSET_UPLOAD_" + teamId + "_" + uploadKey;
  const errorKey = "TEAM_ASSET_UPLOAD_ERROR_" + teamId + "_" + uploadKey;
  try {
    const mime = match[1].toLowerCase();
    const ext = mime === "image/jpeg" ? "jpg" : mime.split("/")[1];
    const rawName = String(body.assetName || "team-asset").trim().slice(0, 90);
    const safeName = rawName.replace(/[^a-z0-9 _.-]/gi, "").replace(/\s+/g, " ").trim() || "team-asset";
    const category = ["Card background", "Card frame", "Player portrait", "Team crest", "Other"].includes(String(body.category)) ? String(body.category) : "Other";
    const blob = Utilities.newBlob(bytes, mime, "Team-" + teamId + "-" + safeName + "." + ext);
    const folder = getTeamAssetsFolder_(teamId);
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    file.setDescription("Competition Dashboard Team Asset\nTeam ID: " + teamId + "\nCategory: " + category + "\nAsset name: " + safeName);
    const saved = {
      ok: true, pending: false, action: "uploadTeamAsset", teamId: teamId,
      name: safeName, category: category, fileId: file.getId(),
      url: "https://drive.google.com/uc?export=view&id=" + encodeURIComponent(file.getId()),
      thumbnailUrl: "https://drive.google.com/thumbnail?id=" + encodeURIComponent(file.getId()) + "&sz=w400",
      updatedAt: file.getLastUpdated().getTime()
    };
    props.setProperty(resultKey, JSON.stringify(saved));
    props.deleteProperty(errorKey);
    return jsonResponse_({ ok: true, action: "uploadTeamAsset", saved: true, teamId: teamId });
  } catch (error) {
    console.error(error);
    try { props.setProperty(errorKey, "Drive upload failed: " + String(error && error.message || error).slice(0, 350)); } catch (ignored) {}
    return jsonResponse_({ ok: false, error: "Drive could not store this asset. Check Apps Script Drive authorisation and Executions." });
  }
}

function readTeamAssets_(teamId) {
  const props = PropertiesService.getScriptProperties();
  const folderId = props.getProperty("TEAM_ASSETS_FOLDER_ID_" + teamId);
  if (!folderId) return [];
  try {
    const folder = DriveApp.getFolderById(folderId);
    const files = folder.getFiles(), assets = [];
    while (files.hasNext() && assets.length < 200) {
      const file = files.next();
      if (file.isTrashed() || !/^image\//i.test(file.getMimeType())) continue;
      const description = String(file.getDescription() || "");
      const teamMatch = description.match(/(?:^|\\n)Team ID:\\s*([^\\n]+)/i);
      if (!teamMatch || teamMatch[1].trim().toUpperCase() !== teamId) continue;
      const categoryMatch = description.match(/(?:^|\\n)Category:\\s*([^\\n]+)/i);
      const nameMatch = description.match(/(?:^|\\n)Asset name:\\s*([^\\n]+)/i);
      assets.push({
        id: file.getId(),
        teamId: teamId,
        name: nameMatch ? nameMatch[1].trim() : file.getName().replace(/\\.[^.]+$/, ""),
        category: categoryMatch ? categoryMatch[1].trim() : "Other",
        url: "https://drive.google.com/uc?export=view&id=" + encodeURIComponent(file.getId()),
        thumbnailUrl: "https://drive.google.com/thumbnail?id=" + encodeURIComponent(file.getId()) + "&sz=w400",
        updatedAt: file.getLastUpdated().getTime()
      });
    }
    assets.sort(function(a, b) { return b.updatedAt - a.updatedAt; });
    return assets;
  } catch (error) {
    console.error(error);
    throw new Error("Could not list Team " + teamId + " assets. Check Drive authorisation.");
  }
}

const TEAM_PLAYER_CARDS_TAB = "Team Player Cards";
/**
 * Stores one image file in Drive. Uploads are deliberately one image per
 * request so a whole library of photos never has to travel in one POST body.
 * Files are shared as anyone-with-link viewer assets because public team pages
 * must be able to display them without a Google sign-in.
 */
function uploadTeamPlayerCardAsset_(body) {
  const teamId = String(body.teamId || "").trim().toUpperCase();
  const uploadKey = String(body.uploadKey || "").trim();
  if (!TEAM_IDS.includes(teamId) || getSessionTeam_(body.sessionToken) !== teamId) {
    return jsonResponse_({ ok: false, error: "Studio session expired. Sign in again." });
  }
  if (!/^[a-z0-9-]{8,100}$/i.test(uploadKey)) return jsonResponse_({ ok: false, error: "Invalid asset upload key." });
  const match = String(body.dataUrl || "").match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return jsonResponse_({ ok: false, error: "Unsupported image format. Use JPG, PNG, WebP or GIF." });
  let bytes;
  try { bytes = Utilities.base64Decode(match[2]); } catch (e) { return jsonResponse_({ ok: false, error: "Could not decode the image." }); }
  if (!bytes.length || bytes.length > 5 * 1024 * 1024) return jsonResponse_({ ok: false, error: "Each image must be 5 MB or smaller." });

  try {
    const props = PropertiesService.getScriptProperties();
    const folderProperty = "PLAYER_CARD_ASSETS_FOLDER_ID";
    let folderId = props.getProperty(folderProperty);
    let folder;
    if (folderId) {
      try { folder = DriveApp.getFolderById(folderId); } catch (e) { folder = null; }
    }
    if (!folder) {
      folder = DriveApp.createFolder("Competition Dashboard Player Card Assets");
      props.setProperty(folderProperty, folder.getId());
    }
    const mime = match[1].toLowerCase();
    const ext = mime === "image/jpeg" ? "jpg" : mime.split("/")[1];
    const safeCardId = String(body.cardId || "card").replace(/[^a-z0-9_-]/gi, "").slice(0, 50) || "card";
    const safeField = ["portrait", "teamLogo", "backgroundArt"].includes(String(body.field)) ? String(body.field) : "image";
    const blob = Utilities.newBlob(bytes, mime, teamId + "-" + safeCardId + "-" + safeField + "-" + Date.now() + "." + ext);
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    props.setProperty("PLAYER_CARD_ASSET_UPLOAD_" + teamId + "_" + uploadKey, file.getId());
    return jsonResponse_({ ok: true, action: "uploadTeamPlayerCardAsset", teamId: teamId });
  } catch (error) {
    console.error(error);
    try {
      PropertiesService.getScriptProperties().setProperty(
        "PLAYER_CARD_ASSET_ERROR_" + teamId + "_" + uploadKey,
        "Drive upload failed: " + String(error && error.message || error).slice(0, 350)
      );
    } catch (ignored) {}
    return jsonResponse_({ ok: false, error: "Drive could not store this image. Check Apps Script authorisation and the Executions log." });
  }
}

function getTeamPlayerCardsSheet_() {
  const id = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (!id) throw new Error("Missing SPREADSHEET_ID");
  const ss = SpreadsheetApp.openById(id);
  let sheet = ss.getSheetByName(TEAM_PLAYER_CARDS_TAB);
  const headers = ["Team ID", "Cards JSON", "Updated At"];
  if (!sheet) sheet = ss.insertSheet(TEAM_PLAYER_CARDS_TAB);
  if (sheet.getLastRow() === 0) { sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold"); sheet.setFrozenRows(1); }
  else { const actual = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0]; if (!headers.every((v, i) => actual[i] === v)) throw new Error("Unexpected Team Player Cards headers."); }
  return sheet;
}
function readTeamPlayerCards_(teamId) {
  const sheet = getTeamPlayerCardsSheet_(), last = sheet.getLastRow();
  if (last < 2) return [];
  const rows = sheet.getRange(2, 1, last - 1, 3).getValues();
  for (let i = rows.length - 1; i >= 0; i--) if (String(rows[i][0] || "").trim().toUpperCase() === teamId) {
    try { const cards = JSON.parse(String(rows[i][1] || "[]")); return Array.isArray(cards) ? cards : []; } catch (e) { return []; }
  }
  return [];
}
function saveTeamPlayerCards_(body) {
  const teamId = String(body.teamId || "").trim().toUpperCase();
  if (!TEAM_IDS.includes(teamId) || getSessionTeam_(body.sessionToken) !== teamId) return jsonResponse_({ ok: false, error: "Studio session expired. Sign in again." });
  let cards;
  try { cards = typeof body.cards === "string" ? JSON.parse(body.cards) : body.cards; } catch (e) { return jsonResponse_({ ok: false, error: "Invalid player-card JSON." }); }
  if (!Array.isArray(cards) || cards.length > 100) return jsonResponse_({ ok: false, error: "Player cards must be an array of at most 100 cards." });
  const safeCards = cards.map(function(card) {
    if (!card || typeof card !== "object" || Array.isArray(card)) throw new Error("Each player card must be a JSON object.");
    const copy = Object.assign({}, card); copy.teamId = teamId;
    if (String(copy.id || "").length > 120 || String(copy.playerName || "").length > 100) throw new Error("A player card contains a field that is too long.");
    return copy;
  });
  const serialized = JSON.stringify(safeCards);
  if (serialized.length > 45000) return jsonResponse_({ ok: false, error: "Player-card library is too large for one spreadsheet cell. Reduce portrait sizes and save again." });
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return jsonResponse_({ ok: false, error: "Service busy. Try again." });
  try {
    const sheet = getTeamPlayerCardsSheet_(), last = sheet.getLastRow(), rows = last >= 2 ? sheet.getRange(2, 1, last - 1, 3).getDisplayValues() : [];
    let rowNumber = 0; rows.forEach(function(row, i) { if (String(row[0] || "").trim().toUpperCase() === teamId) rowNumber = i + 2; });
    if (!rowNumber) rowNumber = Math.max(2, last + 1);
    sheet.getRange(rowNumber, 1, 1, 3).setValues([[teamId, serialized, new Date()]]);
    return jsonResponse_({ ok: true, action: "saveTeamPlayerCards", saved: true, teamId: teamId, count: safeCards.length });
  } catch (e) { console.error(e); return jsonResponse_({ ok: false, error: e.message || "Could not save team player cards." }); }
  finally { lock.releaseLock(); }
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
      const existingIndex = rows.findIndex(function (row) {
        return String(row[0]).trim() === matchId && String(row[2]).trim() === tokenHash;
      });
      if (existingIndex >= 0) {
        const rowNumber = existingIndex + 2;
        const previousTeam = String(rows[existingIndex][1] || "").trim().toUpperCase();
        if (previousTeam === teamId) {
          return jsonResponse_({ ok: true, action: "submitMatchVote", saved: true, changed: false, matchId: Number(matchId), teamId: teamId });
        }
        sheet.getRange(rowNumber, 2).setValue(teamId);
        sheet.getRange(rowNumber, 4).setValue(new Date());
        return jsonResponse_({ ok: true, action: "submitMatchVote", saved: true, changed: true, matchId: Number(matchId), teamId: teamId });
      }
    }
    if (last > 10000) return jsonResponse_({ ok: false, error: "Poll storage is full." });
    sheet.getRange(last + 1, 1, 1, MATCH_POLL_HEADERS.length).setValues([[matchId, teamId, tokenHash, new Date()]]);
    return jsonResponse_({ ok: true, action: "submitMatchVote", saved: true, changed: false, matchId: Number(matchId), teamId: teamId });
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
function socialPost_(r){return {postId:String(r[0]||""),submittedAt:r[1]?new Date(r[1]).toISOString():"",teamId:String(r[2]||""),title:String(r[3]||""),body:String(r[4]||""),category:String(r[6]||"Team news"),reviewStatus:String(r[7]||"Unviewed"),publicationStatus:String(r[8]||"Pending"),publishedAt:r[9]?new Date(r[9]).toISOString():"",updatedAt:r[10]?new Date(r[10]).toISOString():"",moderationNote:String(r[11]||""),featured:String(r[12]).toLowerCase()==="true"};}
function allSocialPosts_(){const sh=socialPostsSheet_(),n=sh.getLastRow();return n<2?[]:sh.getRange(2,1,n-1,SOCIAL_POST_HEADERS.length).getValues().map(socialPost_).filter(p=>p.postId);}
function readPublicSocialPosts_(){return allSocialPosts_().filter(p=>p.publicationStatus==="Published").sort((a,b)=>Number(b.featured)-Number(a.featured)||String(b.publishedAt).localeCompare(String(a.publishedAt))).slice(0,100);}
function readModerationPosts_(){return allSocialPosts_().sort((a,b)=>String(b.submittedAt).localeCompare(String(a.submittedAt)));}
function readSocialBans_(){const sh=socialBansSheet_(),n=sh.getLastRow(),out={};if(n<2)return out;sh.getRange(2,1,n-1,4).getDisplayValues().forEach(r=>{const id=String(r[0]).toUpperCase();if(TEAM_IDS.includes(id))out[id]={banned:String(r[1]).toLowerCase()==="true",reason:String(r[2]||""),updatedAt:String(r[3]||"")};});return out;}
function readSocialAudit_(){const sh=socialAuditSheet_(),n=sh.getLastRow();if(n<2)return [];return sh.getRange(Math.max(2,n-99),1,Math.min(100,n-1),6).getDisplayValues().reverse().map(r=>({timestamp:r[0],action:r[1],postId:r[2],teamId:r[3],actor:r[4],reason:r[5]}));}
function logSocial_(action,id,team,actor,reason){socialAuditSheet_().appendRow([new Date(),action,id||"",team||"",actor||"Admin",String(reason||"").slice(0,500)]);}
function requestScoreEditorSession_(b) {
  const props = PropertiesService.getScriptProperties();
  const expected = String(props.getProperty("SCORE_EDITOR_CODE") || "");
  const supplied = String(b.scoreEditorCode || "");
  const nonce = String(b.nonce || "");
  if (!/^[a-f0-9]{32,64}$/.test(nonce)) return jsonResponse_({ok:false,error:"Invalid session challenge."});
  const cache = CacheService.getScriptCache();
  if (!expected) {
    cache.put("scoreEditorSessionError:" + nonce, "SCORE_EDITOR_CODE is missing from this deployment's Script Properties.", 60);
    return jsonResponse_({ok:false,error:"SCORE_EDITOR_CODE is not configured."});
  }
  if (supplied.length < 12 || supplied !== expected) {
    cache.put("scoreEditorSessionError:" + nonce, "Score editor code rejected by this deployment.", 60);
    return jsonResponse_({ok:false,error:"Score editor code rejected."});
  }
  const token = Utilities.getUuid().replace(/-/g,"") + Utilities.getUuid().replace(/-/g,"");
  cache.put("scoreEditorSession:" + token, "score-editor", 21600);
  cache.put("scoreEditorExchange:" + nonce, token, 60);
  return jsonResponse_({ok:true,queued:true});
}
function consumeScoreEditorSession_(nonce) {
  const n = String(nonce || "");
  if (!/^[a-f0-9]{32,64}$/.test(n)) return {ok:false,error:"Invalid session challenge."};
  const cache = CacheService.getScriptCache();
  const key = "scoreEditorExchange:" + n;
  const token = cache.get(key);
  if (token) {
    cache.remove(key);
    cache.remove("scoreEditorSessionError:" + n);
    return {ok:true,sessionToken:token,expiresIn:21600};
  }
  const errorKey = "scoreEditorSessionError:" + n;
  const error = cache.get(errorKey);
  if (error) {
    cache.remove(errorKey);
    return {ok:false,error:error};
  }
  return {ok:false,error:"Session exchange pending. Try again."};
}
function isScoreEditorSession_(token) {
  const value = String(token || "");
  return /^[a-f0-9]{64}$/.test(value) && CacheService.getScriptCache().get("scoreEditorSession:" + value) === "score-editor";
}
function requestModerationSession_(b) {
  const props = PropertiesService.getScriptProperties();
  const expected = String(props.getProperty("ADMIN_TOKEN") || "");
  const supplied = String(b.adminToken || "");
  const nonce = String(b.nonce || "");
  if (!/^[a-f0-9]{32,64}$/.test(nonce)) return jsonResponse_({ok:false,error:"Invalid session challenge."});
  const cache = CacheService.getScriptCache();
  if (!expected) {
    cache.put("socialSessionError:" + nonce, "ADMIN_TOKEN is missing from this deployment’s Script Properties.", 60);
    return jsonResponse_({ok:false,error:"ADMIN_TOKEN is not configured."});
  }
  if (supplied !== expected) {
    cache.put("socialSessionError:" + nonce, "Admin token rejected by this deployment.", 60);
    return jsonResponse_({ok:false,error:"Admin token rejected."});
  }
  const token = Utilities.getUuid().replace(/-/g,"") + Utilities.getUuid().replace(/-/g,"");
  cache.put("socialAdminSession:" + token, "admin", 1800);
  cache.put("socialSessionExchange:" + nonce, token, 60);
  return jsonResponse_({ok:true,queued:true});
}
function consumeModerationSession_(nonce) {
  const n = String(nonce || "");
  if (!/^[a-f0-9]{32,64}$/.test(n)) return {ok:false,error:"Invalid session challenge."};
  const cache = CacheService.getScriptCache();
  const key = "socialSessionExchange:" + n;
  const token = cache.get(key);
  if (token) {
    cache.remove(key);
    cache.remove("socialSessionError:" + n);
    return {ok:true,sessionToken:token,expiresIn:1800};
  }
  const errorKey = "socialSessionError:" + n;
  const error = cache.get(errorKey);
  if (error) {
    cache.remove(errorKey);
    return {ok:false,error:error};
  }
  return {ok:false,error:"Session exchange pending. Try again."};
}
function getModerationSession_(token){return /^[a-f0-9]{64}$/.test(String(token||""))&&CacheService.getScriptCache().get("socialAdminSession:"+token)==="admin";}
function findSocialPost_(id){const sh=socialPostsSheet_(),n=sh.getLastRow();if(n<2)return {sheet:sh,row:0};const ids=sh.getRange(2,1,n-1,1).getDisplayValues();for(let i=0;i<ids.length;i++)if(ids[i][0]===String(id))return {sheet:sh,row:i+2};return {sheet:sh,row:0};}
function submitSocialPost_(b) {
  const team = String(b.teamId || "").toUpperCase();
  const title = String(b.title || "").trim();
  const body = String(b.body || "").trim();
  const category = String(b.category || "Team news");
  if (!TEAM_IDS.includes(team) || getSessionTeam_(b.sessionToken) !== team) return jsonResponse_({ ok: false, error: "Team Studio session expired." });
  if (title.length < 3 || title.length > 120) return jsonResponse_({ ok: false, error: "Headline must be 3–120 characters." });
  if (body.length < 10 || body.length > 5000) return jsonResponse_({ ok: false, error: "Post text must be 10–5000 characters." });
  if (!["Announcements", "Match reports", "Team news"].includes(category)) return jsonResponse_({ ok: false, error: "Invalid category." });
  const bans = readSocialBans_();
  if (bans[team] && bans[team].banned) return jsonResponse_({ ok: false, error: "This team is blocked from submitting posts." });
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return jsonResponse_({ ok: false, error: "Service busy." });
  try {
    const sh = socialPostsSheet_();
    if (sh.getLastRow() > 5000) return jsonResponse_({ ok: false, error: "Post archive is full." });
    const id = Utilities.getUuid(), now = new Date();
    sh.appendRow([id, now, team, title, body, "", category, "Unviewed", "Pending", "", now, "", false]);
    logSocial_("Submitted", id, team, "Team " + team, "");
    return jsonResponse_({ ok: true, saved: true, postId: id });
  } catch (e) {
    console.error(e);
    return jsonResponse_({ ok: false, error: "Could not save post." });
  } finally { lock.releaseLock(); }
}
function submitOfficialSocialPost_(b){
  if(!getModerationSession_(b.sessionToken))return jsonResponse_({ok:false,error:"Admin session expired."});
  const title=String(b.title||"").trim(),body=String(b.body||"").trim(),category=String(b.category||"Announcements");
  if(title.length<3||title.length>120)return jsonResponse_({ok:false,error:"Headline must be 3–120 characters."});
  if(body.length<10||body.length>5000)return jsonResponse_({ok:false,error:"Post text must be 10–5000 characters."});
  if(!["Announcements","Match reports","Team news"].includes(category))return jsonResponse_({ok:false,error:"Invalid category."});
  const lock=LockService.getScriptLock();if(!lock.tryLock(5000))return jsonResponse_({ok:false,error:"Service busy."});
  try{
    const sh=socialPostsSheet_();if(sh.getLastRow()>5000)return jsonResponse_({ok:false,error:"Post archive is full."});
    const id=Utilities.getUuid(),now=new Date();
    sh.appendRow([id,now,"OFFICIAL",title,body,"",category,"Viewed","Published",now,now,"",false]);
    logSocial_("Official post published",id,"OFFICIAL","Competition Official","");
    return jsonResponse_({ok:true,saved:true,published:true,postId:id});
  }catch(e){console.error(e);return jsonResponse_({ok:false,error:"Could not publish official post."});}
  finally{lock.releaseLock();}
}
function handleSocialModeration_(b) {
  if (!getModerationSession_(b.sessionToken)) return jsonResponse_({ ok: false, error: "Admin session expired." });
  const action = String(b.action || "");
  const team = String(b.teamId || "").toUpperCase();
  const reason = String(b.reason || "").trim().slice(0, 500);

  if (action === "setSocialPostingBan") {
    if (!TEAM_IDS.includes(team)) return jsonResponse_({ ok: false, error: "Invalid team." });
    if (b.banned && reason.length < 4) return jsonResponse_({ ok: false, error: "Add a reason before applying a ban." });
    const sh = socialBansSheet_(), n = sh.getLastRow();
    const rows = n < 2 ? [] : sh.getRange(2, 1, n - 1, 4).getDisplayValues();
    let row = 0;
    rows.forEach((r, i) => { if (String(r[0]).toUpperCase() === team) row = i + 2; });
    if (!row) row = Math.max(2, n + 1);
    sh.getRange(row, 1, 1, 4).setValues([[team, Boolean(b.banned), reason, new Date()]]);
    logSocial_(b.banned ? "Posting ban applied" : "Posting ban lifted", "", team, "Admin", reason);
    return jsonResponse_({ ok: true, saved: true });
  }

  const id = String(b.postId || "");
  const found = findSocialPost_(id);
  if (!found.row) return jsonResponse_({ ok: false, error: "Post not found." });
  const p = socialPost_(found.sheet.getRange(found.row, 1, 1, SOCIAL_POST_HEADERS.length).getValues()[0]);
  if (action === "markSocialPostViewed") {
    if (p.reviewStatus !== "Viewed") {
      found.sheet.getRange(found.row, 8).setValue("Viewed");
      found.sheet.getRange(found.row, 11).setValue(new Date());
      logSocial_("Viewed", id, p.teamId, "Admin", "");
    }
    return jsonResponse_({ ok: true, saved: true });
  }

  const decision = String(b.decision || "");
  if (!["publish", "reject", "remove", "feature", "unfeature"].includes(decision)) return jsonResponse_({ ok: false, error: "Invalid decision." });
  if (decision === "publish" || decision === "feature") {
    found.sheet.getRange(found.row, 9).setValue("Published");
    if (!p.publishedAt) found.sheet.getRange(found.row, 10).setValue(new Date());
    found.sheet.getRange(found.row, 12).setValue("");
    if (decision === "feature") found.sheet.getRange(found.row, 13).setValue(true);
  } else if (decision === "unfeature") {
    found.sheet.getRange(found.row, 13).setValue(false);
  } else {
    found.sheet.getRange(found.row, 9).setValue(decision === "reject" ? "Rejected" : "Removed");
    found.sheet.getRange(found.row, 12).setValue(reason);
    found.sheet.getRange(found.row, 13).setValue(false);
  }
  found.sheet.getRange(found.row, 11).setValue(new Date());
  logSocial_(decision, id, p.teamId, "Admin", reason);
  return jsonResponse_({ ok: true, saved: true, decision: decision });
}
function readTeamSocialStatus_(teamId,token){const team=String(teamId||"").toUpperCase();if(!TEAM_IDS.includes(team)||getSessionTeam_(token)!==team)return {ok:false,error:"Team Studio session expired."};const bans=readSocialBans_();return {ok:true,teamId:team,banned:Boolean(bans[team]&&bans[team].banned),posts:allSocialPosts_().filter(p=>p.teamId===team).sort((a,b)=>String(b.submittedAt).localeCompare(String(a.submittedAt))).slice(0,30)};}
