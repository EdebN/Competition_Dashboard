const TEAMS = [
  "Team A",
  "Team B",
  "Team C",
  "Team D",
  "Team E"
];

const START_ELO = 1000;

// Provisional Glicko-2 parameters from Rating Lab's mean of 329
// candidates that passed training-set accuracy guardrails.
// These averages have NOT passed the independent holdout robustness test.
// RD is rating uncertainty in the dashboard's displayed-point scale.
const GLICKO_INITIAL_RD = 203.57;
const GLICKO_INITIAL_VOLATILITY = 0.0894;
const GLICKO_TAU = 0.5638;
const GLICKO_EPSILON = 0.000001;
const GLICKO_SCALE = 173.7178;

const MIN_GAMES_PER_TEAM = 3;
const MAX_GAMES_PER_TEAM = 32;
const DEFAULT_GAMES_PER_TEAM = 16;

const FINALS_COUNT = 4;

const COMMUNITY_API_URL = "https://script.google.com/macros/s/AKfycbyOEesoEjFmplckwJ2T5uSMFit3LEu9Eue351tCrJ4AKB7w0_4JVF4vQJLZMjddavAM/exec";

const SHEET_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vT2tLmAB4OB6uWLeBeCSWLMarzK9RjelvVTJRGqsm94yVijiT25leyXnPWhJybPtoyMKUgfBL6tTzFe/pub?output=csv";


/* =========================================================
   LOCAL COMPETITION SETTINGS
========================================================= */

let currentGamesPerTeam = DEFAULT_GAMES_PER_TEAM;
let sharedGamesSettingLoaded = false;
let sharedGamesSettingError = "";

function getGamesPerTeam() {
  return currentGamesPerTeam;
}

function setGamesPerTeam(value) {
  const number = Number(value);

  if (
    !Number.isInteger(number) ||
    number < MIN_GAMES_PER_TEAM ||
    number > MAX_GAMES_PER_TEAM
  ) {
    throw new Error(`Games per team must be an integer from ${MIN_GAMES_PER_TEAM} to ${MAX_GAMES_PER_TEAM}.`);
  }

  currentGamesPerTeam = number;
}

/* ─────────────────────────────────────
   TEAM DISPLAY NAMES
   Internal IDs stay Team A–D.
   These names are display-only.
───────────────────────────────────── */

let currentTeamSettings = TEAMS.map(team => ({
  teamId: team.slice(-1),
  displayName: team,
  primaryColor: "",
  secondaryColor: "",
  logoUrl: "",
  updatedAt: null
}));

let communitySettingsLoaded = false;
let communitySettingsError = "";

function getTeamNames() {
  const names = {};

  TEAMS.forEach(team => {
    const teamId = team.slice(-1);
    const setting = currentTeamSettings.find(item => item.teamId === teamId);
    names[team] = setting?.displayName || team;
  });

  return names;
}

function getTeamDisplayName(team) {
  if (!team) return "";
  return getTeamNames()[team] || team;
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function normalizeCommunitySettings(response) {
  if (!response || response.ok !== true || !Array.isArray(response.teams)) {
    throw new Error("The API did not return a valid team-settings response.");
  }

  const byId = new Map();

  response.teams.forEach(item => {
    const teamId = String(item?.teamId || "").trim().toUpperCase();
    if (!["A", "B", "C", "D", "E"].includes(teamId) || byId.has(teamId)) {
      throw new Error("The API returned invalid or duplicate team IDs.");
    }

    const displayName = String(item.displayName || `Team ${teamId}`).trim();
    if (!displayName || displayName.length > 30) {
      throw new Error(`Team ${teamId} has an invalid display name.`);
    }

    byId.set(teamId, {
      teamId,
      displayName,
      primaryColor: String(item.primaryColor || "").trim(),
      secondaryColor: String(item.secondaryColor || "").trim(),
      logoUrl: String(item.logoUrl || "").trim(),
      updatedAt: item.updatedAt ? String(item.updatedAt) : null
    });
  });

  if (byId.size !== 5) {
    throw new Error("The API must return exactly five team records.");
  }

  return ["A", "B", "C", "D", "E"].map(teamId => byId.get(teamId));
}

function readCommunityApi(action, extraParams = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(COMMUNITY_API_URL);
    const callbackName = "__competitionCommunityCallback_" +
      Date.now() + "_" + Math.random().toString(36).slice(2);
    const script = document.createElement("script");
    let finished = false;

    const timeout = setTimeout(() => {
      finish(new Error("The community API read timed out."));
    }, 15000);

    function finish(error, data) {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      try { delete window[callbackName]; } catch {}
      script.remove();
      if (error) reject(error);
      else resolve(data);
    }

    window[callbackName] = data => finish(null, data);
    url.searchParams.set("action", action);
    Object.entries(extraParams).forEach(([key, value]) => url.searchParams.set(key, String(value)));
    url.searchParams.set("callback", callbackName);
    url.searchParams.set("_cacheBust", String(Date.now()));

    script.async = true;
    script.src = url.toString();
    script.onerror = () => finish(new Error("The browser could not load the community API response."));
    document.head.appendChild(script);
  });
}

function postCommunityAction(payload) {
  return fetch(COMMUNITY_API_URL, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify(payload)
  });
}

function postCommunitySettings(token, teams) {
  return postCommunityAction({
    action: "updateTeamSettings",
    adminToken: token,
    teams
  });
}

function postCommunityGamesPerTeam(token, gamesPerTeam) {
  return postCommunityAction({
    action: "updateCompetitionSettings",
    adminToken: token,
    gamesPerTeam
  });
}

function updateDashboardTeamNames() {
  updateTeamNavNames();
  calculate();
  renderGames();
  renderFinalsPage();
  if (typeof renderMatchCentre === "function") renderMatchCentre();

  const status = document.getElementById("teamNamesStatus");
  if (status && communitySettingsLoaded) {
    status.textContent = "Connected to shared team settings. Changes are visible to all visitors.";
    status.className = "admin-info";
  }

  if (currentPage === "admin" && adminUnlocked) {
    const names = getTeamNames();
    const inputIds = {
      "Team A": "teamNameA",
      "Team B": "teamNameB",
      "Team C": "teamNameC",
      "Team D": "teamNameD",
      "Team E": "teamNameE"
    };

    TEAMS.forEach(team => {
      const input = document.getElementById(inputIds[team]);
      if (input && document.activeElement !== input) {
        input.value = names[team];
      }
    });
  }
}

async function loadCommunitySettings() {
  try {
    const response = await readCommunityApi("getTeamSettings");
    currentTeamSettings = normalizeCommunitySettings(response);
    communitySettingsLoaded = true;
    communitySettingsError = "";
    updateDashboardTeamNames();
  } catch (error) {
    communitySettingsLoaded = false;
    communitySettingsError = error?.message || "Could not load shared team settings.";
    console.error("Could not load shared team settings:", error);

    const status = document.getElementById("teamNamesStatus");
    if (status) {
      status.textContent = "Shared settings unavailable. Team names are using defaults until the API reconnects.";
      status.className = "admin-warning";
    }
  }
}

async function loadSharedCompetitionSettings() {
  try {
    const response = await readCommunityApi("getCompetitionSettings");
    if (!response || response.ok !== true) {
      throw new Error(response?.error || "The API did not return shared competition settings.");
    }

    const value = Number(response.gamesPerTeam);
    if (!Number.isInteger(value) || value < MIN_GAMES_PER_TEAM || value > MAX_GAMES_PER_TEAM) {
      throw new Error("The API returned an invalid games-per-team value.");
    }

    setGamesPerTeam(value);
    sharedGamesSettingLoaded = true;
    sharedGamesSettingError = "";

    calculate();
    renderGames();
    renderFinalsPage();

    const slider = document.getElementById("gamesPerTeamSlider");
    const valueLabel = document.getElementById("gamesPerTeamValue");
    const status = document.getElementById("gamesPerTeamStatus");
    if (slider) slider.value = String(value);
    if (valueLabel) valueLabel.textContent = String(value);
    if (status) {
      status.className = "admin-info";
      status.textContent = "Connected to shared competition settings.";
    }
  } catch (error) {
    sharedGamesSettingLoaded = false;
    sharedGamesSettingError = error?.message || "Could not load shared competition settings.";
    console.error("Could not load shared competition settings:", error);

    const status = document.getElementById("gamesPerTeamStatus");
    if (status) {
      status.className = "admin-warning";
      status.textContent = "Shared season length unavailable: " + sharedGamesSettingError;
    }
  }
}

function delayCommunityApi(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function saveSharedGamesPerTeam(value) {
  if (!adminToken) {
    throw new Error("Enter the admin token before saving.");
  }

  const desired = Number(value);
  if (!Number.isInteger(desired) || desired < MIN_GAMES_PER_TEAM || desired > MAX_GAMES_PER_TEAM) {
    throw new Error(`Games per team must be an integer from ${MIN_GAMES_PER_TEAM} to ${MAX_GAMES_PER_TEAM}.`);
  }

  await postCommunityGamesPerTeam(adminToken, desired);

  let saved = null;
  let lastReadError = null;

  for (let attempt = 0; attempt < 7; attempt++) {
    if (attempt > 0) {
      await delayCommunityApi(700 + attempt * 400);
    }

    try {
      const response = await readCommunityApi("getCompetitionSettings");
      if (!response || response.ok !== true) {
        throw new Error(response?.error || "The API did not return shared competition settings.");
      }

      const valueFromApi = Number(response.gamesPerTeam);
      if (!Number.isInteger(valueFromApi) || valueFromApi < MIN_GAMES_PER_TEAM || valueFromApi > MAX_GAMES_PER_TEAM) {
        throw new Error("The API returned an invalid games-per-team value.");
      }

      saved = valueFromApi;
      if (saved === desired) break;
    } catch (error) {
      lastReadError = error;
    }
  }

  if (saved === null) {
    throw new Error(
      "The write was sent, but the shared setting could not be read back" +
      (lastReadError?.message ? ": " + lastReadError.message : ".")
    );
  }

  if (saved !== desired) {
    throw new Error(`Expected ${desired} games per team, but the API returned ${saved}.`);
  }

  setGamesPerTeam(saved);
  sharedGamesSettingLoaded = true;
  sharedGamesSettingError = "";
  calculate();
  renderGames();
  renderFinalsPage();
}

async function saveSharedTeamNames(names) {
  if (!adminToken) {
    throw new Error("Enter the admin token before saving.");
  }

  if (!communitySettingsLoaded) {
    throw new Error("Shared team settings have not loaded. Check the API connection and try again.");
  }

  const cleanedNames = {};
  TEAMS.forEach(team => {
    const value = String(names[team] ?? "").trim();
    if (!value || value.length > 30 || /[\u0000-\u001F\u007F]/.test(value)) {
      throw new Error(`${team} must have a name of 1–30 characters.`);
    }
    cleanedNames[team] = value;
  });

  // Re-read first so the write preserves the latest non-name fields.
  const beforeResponse = await readCommunityApi("getTeamSettings");
  const before = normalizeCommunitySettings(beforeResponse);
  const desired = before.map(setting => ({
    ...setting,
    displayName: cleanedNames[`Team ${setting.teamId}`]
  }));

  await postCommunitySettings(adminToken, desired);

  // A cross-origin no-cors POST is intentionally unreadable to the browser.
  // Poll the public read endpoint briefly rather than assuming the sheet is
  // visible after a single fixed delay.
  let saved = null;
  let namesMatch = false;
  let lastReadError = null;

  for (let attempt = 0; attempt < 7; attempt++) {
    if (attempt > 0) {
      await delayCommunityApi(700 + attempt * 400);
    }

    try {
      const savedResponse = await readCommunityApi("getTeamSettings");
      saved = normalizeCommunitySettings(savedResponse);
      namesMatch = saved.every(setting =>
        setting.displayName === cleanedNames[`Team ${setting.teamId}`]
      );

      if (namesMatch) break;
    } catch (error) {
      lastReadError = error;
    }
  }

  if (!saved) {
    throw new Error(
      "The save request was sent, but the API read-back failed" +
      (lastReadError?.message ? ": " + lastReadError.message : ".") +
      " Check the connection and read the team settings again before retrying."
    );
  }

  if (!namesMatch) {
    const differences = saved
      .filter(setting =>
        setting.displayName !== cleanedNames[`Team ${setting.teamId}`]
      )
      .map(setting =>
        `Team ${setting.teamId}: expected "${cleanedNames[`Team ${setting.teamId}`]}", API returned "${setting.displayName}"`
      );

    throw new Error(
      "The API read-back still differs after retrying. " +
      differences.join("; ") +
      ". This usually means the API rejected the write (for example, an incorrect token) or the update was not applied."
    );
  }

  currentTeamSettings = saved;
  communitySettingsLoaded = true;
  communitySettingsError = "";
  updateDashboardTeamNames();
}

function updateTeamNavNames() {
  const names = getTeamNames();

  const navMap = {
    "team-a": "Team A",
    "team-b": "Team B",
    "team-c": "Team C",
    "team-d": "Team D",
    "team-e": "Team E"
  };

  document.querySelectorAll("[data-page]").forEach(button => {
    const page = button.dataset.page;
    const team = navMap[page];

    if (!team) return;

    button.textContent = names[team] || team;
  });
}
function getRegularGameCount() {
  return getGamesPerTeam() * TEAMS.length / 2;
}
/* =========================================================
   FIXTURE STRUCTURE
========================================================= */

function generateFixtureTemplate() {
  const fixtures = [];

  // Each round has two games and one team on referee duty.
  // The bye/referee rotates through the five teams.
  const rounds = [
    { referee: "Team E", games: [["Team A", "Team B"], ["Team C", "Team D"]] },
    { referee: "Team D", games: [["Team A", "Team C"], ["Team B", "Team E"]] },
    { referee: "Team B", games: [["Team A", "Team D"], ["Team C", "Team E"]] },
    { referee: "Team C", games: [["Team A", "Team E"], ["Team B", "Team D"]] },
    { referee: "Team A", games: [["Team B", "Team C"], ["Team D", "Team E"]] }
  ];

  const teamIndex = new Map(TEAMS.map((team, index) => [team, index]));
  const matchesPerCycle = TEAMS.length * (TEAMS.length - 1) / 2;
  const regularGameLimit = MAX_GAMES_PER_TEAM * TEAMS.length / 2;
  const cyclesNeeded = Math.ceil(regularGameLimit / matchesPerCycle);
  let gameId = 1;

  for (let cycle = 0; cycle < cyclesNeeded; cycle++) {
    for (const round of rounds) {
      for (const [first, second] of round.games) {
        if (fixtures.length >= regularGameLimit) break;

        const firstIndex = teamIndex.get(first);
        const secondIndex = teamIndex.get(second);
        const offset = (secondIndex - firstIndex + TEAMS.length) % TEAMS.length;
        let home = offset > 0 && offset <= Math.floor((TEAMS.length - 1) / 2)
          ? first
          : second;
        let away = home === first ? second : first;

        // Reverse home/away on every second round-robin cycle.
        if (cycle % 2 === 1) {
          [home, away] = [away, home];
        }

        fixtures.push({
          id: gameId++,
          home,
          away,
          referee: round.referee,
          stage: "REGULAR"
        });
      }
    }
  }

  for (let i = 0; i < FINALS_COUNT; i++) {
    fixtures.push({
      id: gameId + i,
      home: "",
      away: "",
      referee: "",
      stage: i === FINALS_COUNT - 1 ? "GRAND FINAL" : "FINAL"
    });
  }

  return fixtures;
}
let games = [];


/* =========================================================
   SCORES
========================================================= */

const scores = {};


/* =========================================================
   ACTIVE REGULAR SEASON
========================================================= */
function normalizeStage(stage) {
  return String(stage || "")
    .trim()
    .toUpperCase();
}

function getActiveRegularGames() {

  const count =
    getRegularGameCount();

  return games
    .filter(
      game =>
        normalizeStage(game.stage) === "REGULAR"
    )
    .slice(0, count);
}

function getFinalGames() {

  return games.filter(
    game =>
      normalizeStage(game.stage) === "FINAL" ||
      normalizeStage(game.stage) === "GRAND FINAL"
  );
}


/* =========================================================
   GAME VALIDATION
========================================================= */

function isPlayed(game) {

  return (
    game.home !== "" &&
    game.away !== "" &&
    scores[game.id] &&
    scores[game.id].home !== "" &&
    scores[game.id].away !== "" &&
    scores[game.id].home !== null &&
    scores[game.id].away !== null
  );
}


/* =========================================================
   ELO
========================================================= */

/*
 * Glicko-2 rating system.
 *
 * Ratings are displayed around START_ELO rather than the conventional
 * 1500-point centre. This is only an offset; rating differences and
 * probability calculations are unchanged.
 *
 * Glicko-2 uses win/draw/loss outcomes, not score margin. We still show
 * the logarithmic score margin in the audit table, but do not let it
 * distort the statistically defined Glicko update. A margin extension
 * should only be added after validation against historical results.
 */
function expectedScore(
  ratingA,
  ratingB
) {
  return (
    1 /
    (
      1 +
      Math.pow(
        10,
        (ratingB - ratingA) / 400
      )
    )
  );
}

function glickoG(phi) {
  return 1 / Math.sqrt(
    1 + (3 * phi * phi) / (Math.PI * Math.PI)
  );
}

function glickoExpected(mu, opponentMu, opponentPhi) {
  const g = glickoG(opponentPhi);
  return 1 / (1 + Math.exp(-g * (mu - opponentMu)));
}

function glickoVolatility(phi, sigma, delta, variance) {
  const a = Math.log(sigma * sigma);
  const tauSquared = GLICKO_TAU * GLICKO_TAU;

  const f = x => {
    const expX = Math.exp(x);
    const numerator =
      expX * (delta * delta - phi * phi - variance - expX);
    const denominator =
      2 * Math.pow(phi * phi + variance + expX, 2);

    return numerator / denominator - (x - a) / tauSquared;
  };

  let A = a;
  let B;

  if (delta * delta > phi * phi + variance) {
    B = Math.log(delta * delta - phi * phi - variance);
  } else {
    let k = 1;
    B = a - k * GLICKO_TAU;

    while (f(B) < 0 && k < 100) {
      k += 1;
      B = a - k * GLICKO_TAU;
    }
  }

  let fA = f(A);
  let fB = f(B);
  let iterations = 0;

  while (Math.abs(B - A) > GLICKO_EPSILON && iterations < 100) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);

    if (fC * fB < 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }

    B = C;
    fB = fC;
    iterations += 1;
  }

  return Math.exp(A / 2);
}

/*
 * Optimised custom Glicko margin weighting.
 * The historical bake-off's selected contender used scale=1.6,
 * denominatorBase=1.8, gapSensitivity=0, and maxWeight=4.
 * On the tested holdout, it narrowly led the candidates on Brier score
 * and log loss. This changes the evidence weight, not the Glicko-2 core.
 */
function marginFactor(scoreA, scoreB, ratingA, ratingB) {
  if (scoreA === scoreB) return 1;

  // Optimised custom Glicko configuration selected by the historical bake-off:
  // marginScale=1.6, denominatorBase=1.8, gapSensitivity=0, maxWeight=4.
  // It led the tested candidates on both test Brier score and log loss.
  const scoreMargin = Math.abs(scoreA - scoreB);
  const rawWeight = Math.log(scoreMargin + 1) * 1.6 / 1.8;

  return Math.max(0, Math.min(4, rawWeight));
}

function actualScore(scoreA, scoreB) {
  if (scoreA > scoreB) return 1;
  if (scoreA < scoreB) return 0;
  return 0.5;
}

function formatChange(value) {
  if (Math.abs(value) < 0.000001) {
    return "0.00";
  }

  return value > 0
    ? `+${value.toFixed(2)}`
    : value.toFixed(2);
}

function toGlickoState(rating, rd, volatility) {
  return {
    rating,
    rd,
    volatility,
    mu: (rating - START_ELO) / GLICKO_SCALE,
    phi: rd / GLICKO_SCALE
  };
}

function fromGlickoState(state) {
  return {
    rating: START_ELO + state.mu * GLICKO_SCALE,
    rd: state.phi * GLICKO_SCALE,
    volatility: state.volatility,
    mu: state.mu,
    phi: state.phi
  };
}

function updateGlickoPeriod(state, results) {
  const phi = state.phi;
  const sigma = state.volatility;

  // No games in this rating period: preserve the estimate and let
  // uncertainty grow by the volatility term, as Glicko-2 specifies.
  if (!results.length) {
    return fromGlickoState({
      mu: state.mu,
      phi: Math.sqrt(phi * phi + sigma * sigma),
      volatility: sigma
    });
  }

  let sumVariance = 0;
  let sumResidual = 0;

  results.forEach(result => {
    const g = glickoG(result.opponent.phi);
    const expected = glickoExpected(
      state.mu,
      result.opponent.mu,
      result.opponent.phi
    );

    const weight = result.weight ?? 1;

    sumVariance += weight * g * g * expected * (1 - expected);
    sumResidual += weight * g * (result.score - expected);
  });

  if (sumVariance <= 0) {
    return fromGlickoState({
      mu: state.mu,
      phi: Math.sqrt(phi * phi + sigma * sigma),
      volatility: sigma
    });
  }

  const variance = 1 / sumVariance;
  const delta = variance * sumResidual;
  const newVolatility = glickoVolatility(
    phi,
    sigma,
    delta,
    variance
  );

  const phiStar = Math.sqrt(
    phi * phi + newVolatility * newVolatility
  );
  const newPhi = 1 / Math.sqrt(
    1 / (phiStar * phiStar) + 1 / variance
  );
  const newMu = state.mu + newPhi * newPhi * sumResidual;

  return fromGlickoState({
    mu: newMu,
    phi: newPhi,
    volatility: newVolatility
  });
}

function calculateElo() {
  const states = {};

  TEAMS.forEach(team => {
    states[team] = toGlickoState(
      START_ELO,
      GLICKO_INITIAL_RD,
      GLICKO_INITIAL_VOLATILITY
    );
  });

  const eloRows = [];
  const activeGames = getActiveRegularGames();

  // Fixtures are generated in rounds of two matches. Every result in a
  // round uses the same pre-round ratings, then all teams update together.
  // This avoids order-dependent ratings when simultaneous matches exist.
  for (let roundStart = 0; roundStart < activeGames.length; roundStart += 2) {
    const roundGames = activeGames.slice(roundStart, roundStart + 2);
    const preRound = {};

    TEAMS.forEach(team => {
      preRound[team] = { ...states[team] };
    });

    const resultsByTeam = {};
    TEAMS.forEach(team => {
      resultsByTeam[team] = [];
    });

    const roundRows = roundGames.map(game => {
      const preA = preRound[game.home];
      const preB = preRound[game.away];

      let scoreA = "";
      let scoreB = "";

      if (scores[game.id]) {
        scoreA = scores[game.id].home;
        scoreB = scores[game.id].away;
      }

      let expectedA = glickoExpected(
        preA.mu,
        preB.mu,
        preB.phi
      );
      let margin = 0;
      let changeA = 0;
      let changeB = 0;

      let postA = preA.rating;
      let postB = preB.rating;
      let rdA = preA.rd;
      let rdB = preB.rd;

      if (isPlayed(game)) {
        scoreA = Number(scoreA);
        scoreB = Number(scoreB);

        const resultA = actualScore(scoreA, scoreB);
        margin = marginFactor(
          scoreA,
          scoreB,
          preA.rating,
          preB.rating
        );

        // Treat the margin correction as the weight of this result's
        // evidence in the Glicko-2 update. The same weight is used for
        // both teams, preserving symmetric match treatment.
        resultsByTeam[game.home].push({
          opponent: preB,
          score: resultA,
          weight: margin
        });
        resultsByTeam[game.away].push({
          opponent: preA,
          score: 1 - resultA,
          weight: margin
        });
      }

      return {
        game: game.id,
        teamA: game.home,
        scoreA,
        teamB: game.away,
        scoreB,
        preA: preA.rating,
        preB: preB.rating,
        preRDA: preA.rd,
        preRDB: preB.rd,
        expectedA,
        margin,
        changeA,
        changeB,
        postA,
        postB,
        rdA,
        rdB
      };
    });

    // Apply each team's Glicko-2 update once per rating period.
    TEAMS.forEach(team => {
      states[team] = updateGlickoPeriod(
        preRound[team],
        resultsByTeam[team]
      );
    });

    roundRows.forEach(row => {
      const postA = states[row.teamA];
      const postB = states[row.teamB];

      row.postA = postA.rating;
      row.postB = postB.rating;
      row.rdA = postA.rd;
      row.rdB = postB.rd;
      row.changeA = postA.rating - row.preA;
      row.changeB = postB.rating - row.preB;
      eloRows.push(row);
    });
  }

  const finalRatings = {};
  const finalRatingDetails = {};

  TEAMS.forEach(team => {
    finalRatings[team] = states[team].rating;
    finalRatingDetails[team] = {
      rating: states[team].rating,
      rd: states[team].rd,
      volatility: states[team].volatility
    };
  });

  return {
    rows: eloRows,
    finalRatings,
    finalRatingDetails
  };
}


/* =========================================================
   LADDER
========================================================= */

function calculateLadder(
  finalRatings
) {

  const stats = {};

  TEAMS.forEach(team => {

    stats[team] = {

      team,

      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,

      pf: 0,
      pa: 0,
      diff: 0,

      winPercent: 0,

      elo:
        finalRatings[team],

      form: [],

      latestEloChange: 0

    };

  });


  getActiveRegularGames()
    .forEach(game => {

      if (!isPlayed(game))
        return;

      const scoreA =
        Number(
          scores[game.id].home
        );

      const scoreB =
        Number(
          scores[game.id].away
        );

      const A =
        stats[game.home];

      const B =
        stats[game.away];


      A.played++;
      B.played++;

      A.pf += scoreA;
      A.pa += scoreB;

      B.pf += scoreB;
      B.pa += scoreA;


      let resultA;
      let resultB;


      if (scoreA > scoreB) {

        A.wins++;
        B.losses++;

        resultA = "W";
        resultB = "L";

      }

      else if (
        scoreA < scoreB
      ) {

        B.wins++;
        A.losses++;

        resultA = "L";
        resultB = "W";

      }

      else {

        A.draws++;
        B.draws++;

        resultA = "D";
        resultB = "D";

      }


      A.form.push({

        game: game.id,

        opponent:
          game.away,

        result: resultA,

        scoreFor:
          scoreA,

        scoreAgainst:
          scoreB

      });


      B.form.push({

        game: game.id,

        opponent:
          game.home,

        result: resultB,

        scoreFor:
          scoreB,

        scoreAgainst:
          scoreA

      });

    });


  TEAMS.forEach(team => {

    const s =
      stats[team];

    s.diff =
      s.pf - s.pa;

    s.winPercent =
      s.played === 0
        ? 0
        : s.wins /
          s.played;

    s.form =
      s.form.slice(-5);

  });


  const elo =
    calculateElo();


  elo.rows.forEach(row => {

    if (
      row.scoreA === "" ||
      row.scoreB === ""
    ) {
      return;
    }

    stats[row.teamA]
      .latestEloChange =
        row.changeA;

    stats[row.teamB]
      .latestEloChange =
        row.changeB;

  });


  const sorted =
    Object.values(stats)
      .sort((a, b) => {

        if (
          b.elo !== a.elo
        )
          return b.elo - a.elo;

        if (
          b.diff !== a.diff
        )
          return b.diff - a.diff;

        if (
          b.wins !== a.wins
        )
          return b.wins - a.wins;

        return b.pf - a.pf;

      });


  sorted.forEach(
    (team, index) => {

      team.rank =
        index + 1;

    }
  );


  return sorted;
}


/* =========================================================
   LADDER RENDER
========================================================= */

function renderLadder(
  ladder
) {

  const container =
    document.getElementById(
      "ladder"
    );

  if (!container)
    return;


  let html = `

    <div class="table-wrap">

      <table>

        <thead>

          <tr>

            <th>RANK</th>
            <th>TEAM</th>
            <th>P</th>
            <th>W</th>
            <th>D</th>
            <th>L</th>
            <th>PF</th>
            <th>PA</th>
            <th>DIFF</th>
            <th>WIN %</th>
            <th>FORM</th>
            <th>ELO</th>
            <th>ELO Δ</th>

          </tr>

        </thead>

        <tbody>

  `;


  ladder.forEach(team => {

    const diffClass =
      team.diff > 0
        ? "positive"
        : team.diff < 0
        ? "negative"
        : "neutral";


    /* =========================
       FORM
    ========================= */

    let formHTML = "";


    if (
      team.form.length === 0
    ) {

      formHTML = `
        <span class="neutral">–</span>
      `;

    }

    else {

      formHTML =
        team.form
          .map(form => {

            const resultClass =
              form.result === "W"
                ? "form-win"
                : form.result === "L"
                ? "form-loss"
                : "form-draw";


            return `

              <span
                class="
                  form-result
                  ${resultClass}
                "
              >
                ${form.result}
              </span>

            `;

          })
          .join("");

    }


    /* =========================
       ELO MOVEMENT
    ========================= */

    let eloMovement =
      `<span class="neutral">→ 0.00</span>`;


    if (
      team.latestEloChange >
      0.000001
    ) {

      eloMovement =
        `
          <span class="positive">
            ↑ +${team.latestEloChange.toFixed(2)}
          </span>
        `;

    }

    else if (
      team.latestEloChange <
      -0.000001
    ) {

      eloMovement =
        `
          <span class="negative">
            ↓ ${team.latestEloChange.toFixed(2)}
          </span>
        `;

    }


    html += `

      <tr>

        <td class="ladder-rank">
          ${team.rank}
        </td>

        <td class="team-name">
  ${escapeHTML(getTeamDisplayName(team.team))}
</td>

        <td>${team.played}</td>
        <td>${team.wins}</td>
        <td>${team.draws}</td>
        <td>${team.losses}</td>

        <td>${team.pf}</td>

        <td>${team.pa}</td>

        <td class="${diffClass}">
          ${
            team.diff > 0
              ? "+"
              : ""
          }${team.diff}
        </td>

        <td>
          ${
            (
              team.winPercent *
              100
            ).toFixed(1)
          }%
        </td>

        <td class="ladder-form">

          ${
            team.form.length
              ? team.form.map(result => {

                  const cls =
                    result.result === "W"
                      ? "form-win"
                      : result.result === "D"
                      ? "form-draw"
                      : "form-loss";

                  return `
                    <button
                      class="form-result ${cls}"
                      onclick="jumpToGame(${result.game})"
                      title="Game ${result.game}: ${escapeHTML(getTeamDisplayName(team.team))} vs ${escapeHTML(getTeamDisplayName(result.opponent))}"
                    >
                      ${result.result}
                    </button>
                  `;

                }).join("")
              : "—"
          }

        </td>

        <td class="ladder-elo">
          ${team.elo.toFixed(2)}
        </td>

        <td class="ladder-elo-change">
          ${eloMovement}
        </td>

      </tr>

    `;

  });


  html += `

        </tbody>

      </table>

    </div>

  `;


  container.innerHTML =
    html;

}
/* =========================================================
   GAMES
========================================================= */

function renderGames() {
  console.log(
    "MATCH SETTINGS:",
    "games/team =", getGamesPerTeam(),
    "regular games =", getRegularGameCount(),
    "active games =", getActiveRegularGames().length
  );
  const container =
    document.getElementById(
      "games"
    );

  if (!container)
    return;


  container.innerHTML = "";


  const grid =
    document.createElement(
      "div"
    );

  grid.className =
    "games-grid";


  const gamesToDisplay =
  getActiveRegularGames();

gamesToDisplay.forEach(game => {

    const row =
      document.createElement(
        "div"
      );

    row.className = "game match-clickable";
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", "Open details for game " + game.id);
    row.addEventListener("click", () => { if (typeof openMatchDetail === "function") openMatchDetail(game.id); });
    row.addEventListener("keydown", event => { if ((event.key === "Enter" || event.key === " ") && typeof openMatchDetail === "function") { event.preventDefault(); openMatchDetail(game.id); } });

    row.dataset.gameId =
      game.id;


    const number =
  document.createElement(
    "div"
  );

number.className =
  "game-number";

const activeRegularGames = getActiveRegularGames();

const displayGameNumber =
  activeRegularGames.includes(game)
    ? activeRegularGames.indexOf(game) + 1
    : game.id;

number.textContent =
  `GAME ${displayGameNumber}`;


    const matchup =
      document.createElement(
        "div"
      );

    matchup.className =
      "game-matchup";


    const activeRegular =
      getActiveRegularGames()
        .some(
          g => g.id === game.id
        );


    if (
      game.home &&
      game.away
    ) {

      matchup.innerHTML = `

        <span class="team-home">
  ${escapeHTML(getTeamDisplayName(game.home))}
</span>

<span class="versus">
  VS
</span>

<span class="team-away">
  ${escapeHTML(getTeamDisplayName(game.away))}
</span>

        <div
          class="result"
          id="result-${game.id}"
        ></div>

      `;

    }

    else {

      matchup.innerHTML = `

        <span class="team-home">
          To be determined
        </span>

        <span class="versus">
          VS
        </span>

        <span class="team-away">
          To be determined
        </span>

        <div class="result">
          Finals
        </div>

      `;

    }


    if (game.referee && activeRegular) {
      const refereeLabel = document.createElement("div");
      refereeLabel.className = "game-referee";
      refereeLabel.textContent = `REFEREE: ${getTeamDisplayName(game.referee)}`
      matchup.appendChild(refereeLabel);
    }

    const scoreArea =
      document.createElement(
        "div"
      );

    scoreArea.className =
      "score-area";


    if (isPlayed(game)) {

      scoreArea.innerHTML = `

        <span>
          ${scores[game.id].home}
        </span>

        <span class="score-separator">
          –
        </span>

        <span>
          ${scores[game.id].away}
        </span>

      `;

    }

    else {

      scoreArea.innerHTML = `

        <span
          style="color:#596676"
        >
          TBD
        </span>

      `;

    }


    const stage =
      document.createElement(
        "div"
      );

    stage.className =
      "stage";

    stage.textContent =
      activeRegular
        ? "REGULAR"
        : game.stage;


    row.appendChild(number);
    row.appendChild(matchup);
    row.appendChild(scoreArea);
    row.appendChild(stage);

    grid.appendChild(row);

  });


  container.appendChild(
    grid
  );

  updateGameResults();
  if (typeof renderMatchCentre === "function") renderMatchCentre();

}


/* =========================================================
   RESULTS
========================================================= */

function updateGameResults() {

  getActiveRegularGames().forEach(game => {

    const result =
      document.getElementById(
        `result-${game.id}`
      );

    if (!result)
      return;


    if (!isPlayed(game)) {

      result.textContent =
        "Awaiting result";

      result.className =
        "result";

      return;

    }


    const A =
      Number(
        scores[game.id].home
      );

    const B =
      Number(
        scores[game.id].away
      );


    if (A > B) {

      result.textContent =
  `${getTeamDisplayName(game.home)} wins`;

      result.className =
        "result positive";

    }

    else if (B > A) {

      result.textContent =
  `${getTeamDisplayName(game.away)} wins`;

      result.className =
        "result negative";

    }

    else {

      result.textContent =
        "Draw";

      result.className =
        "result neutral";

    }

  });

}


/* =========================================================
   GAME JUMP
========================================================= */

function jumpToGame(gameId) {
  const id = Number(gameId);
  if (!Number.isFinite(id)) return;

  // Use the same match-detail route as the clickable match cards.
  if (typeof openMatchDetail === "function") {
    openMatchDetail(id);
    return;
  }

  // Graceful fallback for builds where match details are unavailable.
  showPage("home");
  setTimeout(() => {
    const row = document.querySelector(`.game[data-game-id="${id}"]`);
    if (!row) return;
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    row.classList.add("game-highlight");
    setTimeout(() => row.classList.remove("game-highlight"), 1800);
  }, 80);
}


/* =========================================================
   ELO TABLE
========================================================= */

function renderEloTable(
  rows
) {

  const container =
    document.getElementById(
      "eloTable"
    );

  if (!container)
    return;


  let html = `

    <div class="table-wrap">

      <table>

        <thead>

          <tr>

            <th>GAME</th>
            <th>TEAM A</th>
            <th>SCORE</th>
            <th>TEAM B</th>
            <th>SCORE</th>
            <th>PRE A</th>
            <th>PRE B</th>
            <th>EXPECTED A</th>
            <th>MARGIN</th>
            <th>CHANGE A</th>
            <th>CHANGE B</th>
            <th>POST A</th>
            <th>POST B</th>
            <th>RD A</th>
            <th>RD B</th>

          </tr>

        </thead>

        <tbody>

  `;


  rows.forEach(row => {

    const changeAClass =
      row.changeA > 0
        ? "elo-up"
        : row.changeA < 0
        ? "elo-down"
        : "elo-zero";


    const changeBClass =
      row.changeB > 0
        ? "elo-up"
        : row.changeB < 0
        ? "elo-down"
        : "elo-zero";


    html += `

      <tr>

        <td>${row.game}</td>

        <td class="team-name">
  ${escapeHTML(getTeamDisplayName(row.teamA))}
</td>

        <td>
          ${
            row.scoreA === ""
              ? "–"
              : row.scoreA
          }
        </td>

        <td class="team-name">
  ${escapeHTML(getTeamDisplayName(row.teamB))}
</td>

        <td>
          ${
            row.scoreB === ""
              ? "–"
              : row.scoreB
          }
        </td>

        <td>
          ${row.preA.toFixed(2)}
        </td>

        <td>
          ${row.preB.toFixed(2)}
        </td>

        <td>
          ${row.expectedA.toFixed(3)}
        </td>

        <td>
          ${row.margin.toFixed(3)}
        </td>

        <td class="${changeAClass}">
          ${formatChange(row.changeA)}
        </td>

        <td class="${changeBClass}">
          ${formatChange(row.changeB)}
        </td>

        <td>
          ${row.postA.toFixed(2)}
        </td>

        <td>
          ${row.postB.toFixed(2)}
        </td>

        <td title="Team A rating deviation after this rating period">
          ${row.rdA.toFixed(1)}
        </td>

        <td title="Team B rating deviation after this rating period">
          ${row.rdB.toFixed(1)}
        </td>

      </tr>

    `;

  });


  html += `

        </tbody>

      </table>

    </div>

  `;


  container.innerHTML =
    html;
}


/* =========================================================
   FINALS PAGE
========================================================= */

function renderFinalsPage() {

  const page =
    document.getElementById(
      "finals-page"
    );

  if (!page)
    return;


  /* ─────────────────────────
     GET CURRENT LADDER
  ───────────────────────── */

  const elo =
    calculateElo();

  const ladder =
    calculateLadder(
      elo.finalRatings
    );


  /* ─────────────────────────
     GET FINALS GAMES
  ───────────────────────── */

  const finals =
    getFinalGames();

  const finalsInOrder = [...finals].sort((a, b) => a.id - b.id);
  const openingFinals = finalsInOrder.filter(
    game => normalizeStage(game.stage) === "FINAL"
  );

  const final1 = openingFinals[0] || null;
  const final2 = openingFinals[1] || null;
  const final3 = openingFinals[2] || null;

  const grandFinal = finalsInOrder.find(
    game => normalizeStage(game.stage) === "GRAND FINAL"
  ) || null;


  /* ─────────────────────────
     INITIAL SEEDING
  ───────────────────────── */

  const first =
    ladder[0]
      ? ladder[0].team
      : "TBD";

  const second =
    ladder[1]
      ? ladder[1].team
      : "TBD";

  const third =
    ladder[2]
      ? ladder[2].team
      : "TBD";

  const fourth =
    ladder[3]
      ? ladder[3].team
      : "TBD";


  /* ─────────────────────────
     WINNER / LOSER HELPERS
  ───────────────────────── */

  function getWinner(game) {

    if (
      !game ||
      !isPlayed(game) ||
      !scores[game.id]
    ) {
      return null;
    }

    const homeScore =
      Number(
        scores[game.id].home
      );

    const awayScore =
      Number(
        scores[game.id].away
      );

    if (homeScore === awayScore) {
      const homeElo = Number(elo.finalRatings[game.home]);
      const awayElo = Number(elo.finalRatings[game.away]);

      if (Number.isFinite(homeElo) && Number.isFinite(awayElo)) {
        // A tied finals score is decided by end-of-regular-season Elo.
        // If ratings are exactly equal, use the home team as a stable fallback.
        return homeElo >= awayElo ? game.home : game.away;
      }
      return null;
    }

    return homeScore > awayScore
      ? game.home
      : game.away;
  }


  function getLoser(game) {

    if (
      !game ||
      !isPlayed(game) ||
      !scores[game.id]
    ) {
      return null;
    }

    const homeScore =
      Number(
        scores[game.id].home
      );

    const awayScore =
      Number(
        scores[game.id].away
      );

    if (homeScore === awayScore) {
      const homeElo = Number(elo.finalRatings[game.home]);
      const awayElo = Number(elo.finalRatings[game.away]);

      if (Number.isFinite(homeElo) && Number.isFinite(awayElo)) {
        return homeElo >= awayElo ? game.away : game.home;
      }
      return null;
    }

    return homeScore < awayScore
      ? game.home
      : game.away;
  }


  /* ─────────────────────────
     FINAL 1 / FINAL 2 SEEDING
  ───────────────────────── */

  const final1Home =
    first;

  const final1Away =
    fourth;

  const final2Home =
    second;

  const final2Away =
    third;


  if (final1) {

    final1.home =
      final1Home;

    final1.away =
      final1Away;

  }


  if (final2) {

    final2.home =
      final2Home;

    final2.away =
      final2Away;

  }


  /* ─────────────────────────
     WINNERS / LOSERS
  ───────────────────────── */

  const winner1 =
    getWinner(final1);

  const winner2 =
    getWinner(final2);

  const loser1 =
    getLoser(final1);

  const loser2 =
    getLoser(final2);


  /* ─────────────────────────
     GRAND FINAL
  ───────────────────────── */

  const grandFinalHome =
    winner1 ||
    "Winner Final 1";

  const grandFinalAway =
    winner2 ||
    "Winner Final 2";


  if (grandFinal) {

    grandFinal.home =
      winner1 || "";

    grandFinal.away =
      winner2 || "";

  }


  const grandFinalWinner =
    getWinner(grandFinal);


  /* ─────────────────────────
     FINAL 3
  ───────────────────────── */

  const final3Home =
    loser1 ||
    "Loser Final 1";

  const final3Away =
    loser2 ||
    "Loser Final 2";


  if (final3) {

    final3.home =
      loser1 || "";

    final3.away =
      loser2 || "";

  }


  const final3Winner =
    getWinner(final3);


  /* ─────────────────────────
     DISPLAY HELPERS
  ───────────────────────── */

  function teamName(
  team,
  seed = ""
) {

  if (!team)
    team = "TBD";

  const displayTeam =
    (
      team === "TBD" ||
      team === "Winner Final 1" ||
      team === "Winner Final 2" ||
      team === "Loser Final 1" ||
      team === "Loser Final 2"
    )
      ? team
      : getTeamDisplayName(team);

  return `
    <span class="bracket-seed">
      ${seed}
    </span>
    ${escapeHTML(displayTeam)}
  `;

}


  function getScore(
    game,
    side
  ) {

    if (
      !game ||
      !isPlayed(game) ||
      !scores[game.id]
    ) {
      return null;
    }

    return scores[game.id][side];

  }


  function teamRow(
    team,
    score,
    seed = "",
    result = ""
  ) {

    let resultClass = "";

    if (result === "win")
      resultClass = " bracket-win";

    if (result === "loss")
      resultClass = " bracket-loss";

    return `
      <div class="bracket-team${resultClass}">

        ${teamName(
          team,
          seed
        )}

        ${
          score !== null &&
          score !== undefined
            ? `
              <div class="bracket-score">
                ${score}
              </div>
            `
            : ""
        }

      </div>
    `;

  }


  function resultHTML(
    game,
    winner
  ) {

    if (
      !game ||
      !isPlayed(game) ||
      !winner
    ) {
      return "";
    }

    return `
  <div class="bracket-result">
    ${escapeHTML(getTeamDisplayName(winner))} won
  </div>
`;

  }


  function statusHTML(game) {

    if (!game || !game.home || !game.away)
      return "AWAITING TEAMS";

    return isPlayed(game)
      ? "COMPLETED"
      : "READY TO PLAY";

  }


  /* ─────────────────────────
     PAGE
  ───────────────────────── */

  page.innerHTML = `

    <div class="finals-header">

      <div class="section-title">
        CHAMPIONSHIP
      </div>

      <h1 class="finals-title">
        Finals
      </h1>

      <div class="finals-subtitle">
        ${getGamesPerTeam()}
        regular-season games per team
      </div>

    </div>


    <section class="card">

      <div class="section-title">
        FINALS BRACKET
      </div>

      <h2>
        Championship Tree
      </h2>


      <div class="final-bracket">


        <!-- =========================================
             OPENING FINALS
        ========================================== -->

        <div class="bracket-round bracket-opening">


          <!-- FINAL 1 -->

          <div class="bracket-match" data-final-game="${final1 ? final1.id : 0}">

            <div class="bracket-match-title">
              FINAL 1
            </div>


            ${teamRow(
              final1Home,
              getScore(
                final1,
                "home"
              ),
              "#1",
              winner1 === final1Home
                ? "win"
                : winner1
                  ? "loss"
                  : ""
            )}


            ${teamRow(
              final1Away,
              getScore(
                final1,
                "away"
              ),
              "#4",
              winner1 === final1Away
                ? "win"
                : winner1
                  ? "loss"
                  : ""
            )}


            ${resultHTML(
              final1,
              winner1
            )}


            <div class="bracket-status">
              ${statusHTML(
                final1
              )}
            </div>

          </div>


          <!-- FINAL 2 -->

          <div class="bracket-match" data-final-game="${final2 ? final2.id : 0}">

            <div class="bracket-match-title">
              FINAL 2
            </div>


            ${teamRow(
              final2Home,
              getScore(
                final2,
                "home"
              ),
              "#2",
              winner2 === final2Home
                ? "win"
                : winner2
                  ? "loss"
                  : ""
            )}


            ${teamRow(
              final2Away,
              getScore(
                final2,
                "away"
              ),
              "#3",
              winner2 === final2Away
                ? "win"
                : winner2
                  ? "loss"
                  : ""
            )}


            ${resultHTML(
              final2,
              winner2
            )}


            <div class="bracket-status">
              ${statusHTML(
                final2
              )}
            </div>

          </div>


        </div>


        <!-- =========================================
             CONNECTORS
        ========================================== -->

        <div class="bracket-connectors">

          <div class="connector-top">

            <span>
              WINNER
            </span>

          </div>


          <div class="connector-bottom">

            <span>
              WINNER
            </span>

          </div>

        </div>


        <!-- =========================================
             GRAND FINAL
        ========================================== -->

        <div class="bracket-round bracket-final">


          <div class="bracket-match grand-final-match" data-final-game="${grandFinal ? grandFinal.id : 0}">

            <div class="bracket-match-title">
              GRAND FINAL
            </div>


            ${teamRow(
              grandFinalHome,
              getScore(
                grandFinal,
                "home"
              ),
              "",
              grandFinalWinner === grandFinalHome
                ? "win"
                : grandFinalWinner
                  ? "loss"
                  : ""
            )}


            ${teamRow(
              grandFinalAway,
              getScore(
                grandFinal,
                "away"
              ),
              "",
              grandFinalWinner === grandFinalAway
                ? "win"
                : grandFinalWinner
                  ? "loss"
                  : ""
            )}


            ${resultHTML(
              grandFinal,
              grandFinalWinner
            )}


            <div class="bracket-status">
              ${statusHTML(
                grandFinal
              )}
            </div>

          </div>


        </div>


      </div>


      <!-- =========================================
           THIRD PLACE
      ========================================== -->

      <div class="third-place-section">

        <div class="section-title">
          LOSERS' ROUTE
        </div>

        <h2>
          Third-place final
        </h2>

        <p class="third-place-description">
          The losing teams from both opening finals meet here for third place.
        </p>

        <div class="placement-paths" aria-label="Placement final progression">
          <span>Loser of Final 1</span>
          <span>Loser of Final 2</span>
        </div>


        <div class="third-place-bracket">

          <div class="bracket-match" data-final-game="${final3 ? final3.id : 0}">

            <div class="bracket-match-title">
              THIRD-PLACE FINAL
            </div>


            ${teamRow(
              final3Home,
              getScore(
                final3,
                "home"
              ),
              "",
              final3Winner === final3Home
                ? "win"
                : final3Winner
                  ? "loss"
                  : ""
            )}


            ${teamRow(
              final3Away,
              getScore(
                final3,
                "away"
              ),
              "",
              final3Winner === final3Away
                ? "win"
                : final3Winner
                  ? "loss"
                  : ""
            )}


            ${resultHTML(
              final3,
              final3Winner
            )}


            <div class="bracket-status">
              ${statusHTML(
                final3
              )}
            </div>

          </div>

        </div>

      </div>


    </section>

  `;

  // Open assigned finals fixtures from the bracket.
  page.querySelectorAll("[data-final-game]").forEach(matchCard => {
    const gameId = Number(matchCard.dataset.finalGame);
    if (!Number.isFinite(gameId) || gameId <= 0) return;

    matchCard.classList.add("is-clickable");
    matchCard.setAttribute("role", "button");
    matchCard.setAttribute("tabindex", "0");
    matchCard.setAttribute("aria-label", "Open match " + gameId);

    const openFixture = () => jumpToGame(gameId);
    matchCard.addEventListener("click", openFixture);
    matchCard.addEventListener("keydown", event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openFixture();
    });
  });
}
let adminToken = "";
let adminUnlocked = false;
let socialAdminSessionToken = "";
function renderAdminPage() {

  const page =
    document.getElementById(
      "admin-page"
    );

  if (!page)
    return;


  if (!adminUnlocked) {
    page.innerHTML = `
      <section class="card admin-card">
        <div class="section-title">ADMINISTRATION</div>
        <h2>Admin access</h2>
        <div class="admin-lock">
          <label class="admin-label" for="adminTokenInput">API ADMIN TOKEN</label>
          <input
            id="adminTokenInput"
            class="admin-input"
            type="password"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            placeholder="Enter your API admin token"
          >
          <button class="admin-button" id="adminUnlock">OPEN ADMIN SETTINGS</button>
          <div id="adminError" class="admin-error" role="status" aria-live="polite"></div>
          <div class="admin-info">
            The token stays in this page's memory only and is never saved to browser storage or included in the website code. The server checks it when you save shared settings.
          </div>
          <div class="admin-info">
            ${communitySettingsLoaded
              ? "Shared team settings connected."
              : communitySettingsError
                ? "Shared settings could not be loaded. Check the API connection."
                : "Connecting to shared team settings…"}
          </div>
        </div>
      </section>
      <div class="admin-portal-entry"><a class="admin-button page-access-studio" href="team-editor.html">OPEN TEAM EDITOR PORTAL ↗</a><a class="admin-button score-entry-portal" href="score-entry.html">OPEN SCORE ENTRY PORTAL ↗</a></div>
    `;

    document.getElementById("adminUnlock").addEventListener("click", unlockAdmin);
    document.getElementById("adminTokenInput").addEventListener("keydown", event => {
      if (event.key === "Enter") unlockAdmin();
    });
    return;
  }


  const gamesPerTeam =
    getGamesPerTeam();

  const regularGames =
    getRegularGameCount();

  const sheetRegularGames =
    games.filter(
      game =>
        normalizeStage(game.stage) === "REGULAR"
    ).length;


  const enoughFixtures =
    sheetRegularGames >=
    regularGames;


  const teamNames =
    getTeamNames();


  page.innerHTML = `

    <section class="card admin-card">

      <div class="section-title">
        ADMINISTRATION
      </div>

      <h2>
        Competition settings
      </h2>


      <div class="admin-settings">


        <!-- TEAM NAMES -->

        <div class="admin-setting">

          <div class="admin-setting-header">

            <div class="admin-setting-name">
              Team names
            </div>

          </div>


          <div class="team-name-editor">

            <div class="team-name-row">

              <div class="team-name-label">
                TEAM A
              </div>

              <input
                id="teamNameA"
                class="admin-input team-name-input"
                type="text"
                maxlength="30"
                value="${escapeHTML(teamNames["Team A"])}"
              >

            </div>


            <div class="team-name-row">

              <div class="team-name-label">
                TEAM B
              </div>

              <input
                id="teamNameB"
                class="admin-input team-name-input"
                type="text"
                maxlength="30"
                value="${escapeHTML(teamNames["Team B"])}"
              >

            </div>


            <div class="team-name-row">

              <div class="team-name-label">
                TEAM C
              </div>

              <input
                id="teamNameC"
                class="admin-input team-name-input"
                type="text"
                maxlength="30"
                value="${escapeHTML(teamNames["Team C"])}"
              >

            </div>


            <div class="team-name-row">

              <div class="team-name-label">
                TEAM D
              </div>

              <input
                id="teamNameD"
                class="admin-input team-name-input"
                type="text"
                maxlength="30"
                value="${escapeHTML(teamNames["Team D"])}"
              >

            </div>

            <div class="team-name-row">
              <div class="team-name-label">
                TEAM E
              </div>
              <input
                id="teamNameE"
                class="admin-input team-name-input"
                type="text"
                maxlength="30"
                value="${escapeHTML(teamNames["Team E"])}"
              >
            </div>

          </div>


          <div class="admin-info">
            Team names are stored in the shared community database, so every visitor sees the same names.
            Internal team IDs, fixtures, and official score data remain unchanged.
          </div>

          <div id="teamNamesStatus" class="admin-info" role="status" aria-live="polite">
            ${communitySettingsLoaded
              ? "Connected to shared team settings."
              : communitySettingsError
                ? "Shared settings unavailable: " + escapeHTML(communitySettingsError)
                : "Loading shared team settings…"}
          </div>


          <button
            id="adminSaveNames"
            class="admin-button"
          >
            SAVE TEAM NAMES
          </button>

        </div>



        <!-- OFFICIAL MATCH RESULTS -->
        <div class="admin-setting admin-results-setting">
          <div class="admin-setting-header">
            <div class="admin-setting-name">Official match result</div>
            <span class="admin-setting-value">GOOGLE SHEETS</span>
          </div>
          <p class="admin-info">Enter or correct a score here. The result is written to the official results sheet, then the dashboard refreshes its ratings and standings.</p>
          <div class="admin-result-form">
            <label class="admin-label" for="adminResultMatch">MATCH</label>
            <select id="adminResultMatch" class="admin-input"></select>
            <div class="admin-result-scores">
              <div><label class="admin-label" for="adminResultHome">HOME SCORE</label><input id="adminResultHome" class="admin-input" type="number" min="0" max="99" step="1" inputmode="numeric" placeholder="0"></div>
              <div><label class="admin-label" for="adminResultAway">AWAY SCORE</label><input id="adminResultAway" class="admin-input" type="number" min="0" max="99" step="1" inputmode="numeric" placeholder="0"></div>
            </div>
            <div class="admin-info">Existing scores can be corrected. Saving replaces only the two score cells; fixture assignments and referee details stay untouched.</div>
            <button type="button" id="adminSaveResult" class="admin-button">SAVE MATCH RESULT</button>
            <div id="adminResultStatus" class="admin-info" role="status" aria-live="polite"></div>
          </div>
        </div>

        <!-- GAMES PER TEAM -->

        <div class="admin-setting">

          <div class="admin-setting-header">

            <div class="admin-setting-name">
              Games per team
            </div>

            <div
              id="gamesPerTeamValue"
              class="admin-setting-value"
            >
              ${gamesPerTeam}
            </div>

          </div>


          <input
            id="gamesPerTeamSlider"
            class="admin-range"
            type="range"
            min="${MIN_GAMES_PER_TEAM}"
            max="${MAX_GAMES_PER_TEAM}"
            step="1"
            value="${gamesPerTeam}"
          >


          <div class="admin-info">

            Controls how many regular-season
            games each team plays. All visitors
            use the same shared season length.

          </div>

          <div id="gamesPerTeamStatus" class="admin-info" role="status" aria-live="polite">
            ${sharedGamesSettingLoaded
              ? "Connected to shared competition settings."
              : sharedGamesSettingError
                ? "Shared setting unavailable: " + escapeHTML(sharedGamesSettingError)
                : "Loading shared competition settings…"}
          </div>

        </div>


        <div class="admin-summary">

          <div class="admin-summary-box">

            <div class="admin-summary-label">
              GAMES / TEAM
            </div>

            <div class="admin-summary-value">
              ${gamesPerTeam}
            </div>

          </div>


          <div class="admin-summary-box">

            <div class="admin-summary-label">
              REGULAR GAMES
            </div>

            <div class="admin-summary-value">
              ${regularGames}
            </div>

          </div>


          <div class="admin-summary-box">

            <div class="admin-summary-label">
              FINALS
            </div>

            <div class="admin-summary-value">
              ${FINALS_COUNT}
            </div>

          </div>

        </div>


        ${
          enoughFixtures
            ? `
              <div class="admin-success">
                Fixture capacity is sufficient for
                the selected season length.
              </div>
            `
            : `
              <div class="admin-warning">
                The selected competition requires
                ${regularGames} regular-season games,
                but only ${sheetRegularGames}
                regular fixture slots are available.
              </div>
            `
        }


        <button
          id="adminSave"
          class="admin-button"
        >
          SAVE COMPETITION SETTING
        </button>


        <button
          id="adminLock"
          class="admin-button"
        >
          LOCK ADMIN
        </button>


        


      </div>

    </section>


    


    <section class="card admin-card page-access-card">
      <div class="section-title">TEAM CONTENT</div>
      <div class="page-access-heading"><div><h2>Page Editor Access</h2><p class="page-access-intro">Give each team’s social manager access to their own page. They can build the look, write updates and manage photos without touching competition settings.</p></div><div class="page-access-mark" aria-hidden="true">✦</div></div>
      <div class="page-access-notice"><span class="page-access-notice-dot"></span><div><strong>Shared Team Editor access</strong><br>PINs are saved to the private Google Sheet and work across devices.</div></div>
      <div class="page-access-grid" id="pageAccessTeams"></div>
      
      <div id="pageAccessStatus" class="admin-info" role="status" aria-live="polite">Loading saved PIN status from the shared Google Sheet…</div>
    </section>


    

  `;


  const moderationPanel = document.createElement("section");
  moderationPanel.className = "card admin-card social-moderation-panel";
  moderationPanel.id = "socialModerationPanel";
  moderationPanel.innerHTML = '<div class="section-title">SOCIALS</div><div class="social-mod-heading"><div><h2>Post moderation</h2><p>Review new submissions, manage publication and control posting access.</p></div><button type="button" class="admin-button" id="socialModRefresh">REFRESH QUEUE</button></div><section class="official-post-composer"><div class="official-post-brand"><span class="social-official-crest" aria-hidden="true"><svg viewBox="0 0 240 250" fill="none"><path d="M120 18L204 48V112C204 165 171 207 120 232C69 207 36 165 36 112V48L120 18Z" fill="#0A1728" stroke="#E0B95A" stroke-width="9"/><path d="M66 145L96 85H112L82 145H66Z" fill="#F4D57F"/><path d="M96 145L126 85H142L112 145H96Z" fill="#6EBCE7"/><path d="M126 145L156 85H172L142 145H126Z" fill="#F4D57F"/><path d="M74 160H166" stroke="#E0B95A" stroke-width="4" stroke-linecap="round"/></svg></span><div><strong>Competition Official</strong><span>Official account · published under the competition crest</span></div></div><form id="officialPostForm" class="official-post-form"><label>Headline<input class="admin-input" id="officialPostTitle" maxlength="120" minlength="3" required placeholder="Official announcement"></label><label>Category<select class="admin-input" id="officialPostCategory"><option>Announcements</option><option>Match reports</option><option>Team news</option></select></label><label>Post text<textarea class="admin-input" id="officialPostBody" maxlength="5000" minlength="10" required rows="4" placeholder="Write an official competition update…"></textarea></label><div class="official-post-actions"><span id="officialPostStatus" role="status" aria-live="polite">Official posts publish immediately.</span><button type="submit" class="admin-button">PUBLISH AS OFFICIAL</button></div></form></section><div id="socialModStatus" class="admin-info" role="status" aria-live="polite">Loading moderation queue…</div><div class="social-mod-tabs" role="tablist"><button type="button" class="social-mod-tab is-active" data-mod-tab="Unviewed">Unviewed <span id="socialModUnviewedCount">0</span></button><button type="button" class="social-mod-tab" data-mod-tab="Viewed">Viewed</button><button type="button" class="social-mod-tab" data-mod-tab="Bans">Posting bans</button><button type="button" class="social-mod-tab" data-mod-tab="Audit">Audit history</button></div><div id="socialModContent" class="social-mod-content"></div>';
  page.appendChild(moderationPanel);
  initSocialModerationPanel();

  const pageAccessTeams = document.getElementById("pageAccessTeams");
  if (pageAccessTeams) {
    const accents = ["#8b7cff", "#55d6be", "#ffb86b", "#ff729f", "#7bb7ff"];
    pageAccessTeams.innerHTML = TEAMS.map((team, index) => {
      const teamId = team.slice(-1);
      const displayName = teamNames[team] || team;
      return '<article class="page-access-team" style="--team-accent:' + accents[index % accents.length] + '">' +
        '<div class="page-access-team-top"><div class="page-access-avatar">' + escapeHTML(teamId) + '</div><span class="page-access-status">NOT SET UP</span></div>' +
        '<h3>' + escapeHTML(displayName) + '</h3><p>Team ' + escapeHTML(teamId) + ' page</p>' +
        '<div class="page-access-pin" id="pageAccessPin' + teamId + '">••••••</div>' +
        '<div class="page-access-actions"><button type="button" class="admin-button page-access-generate" data-team="' + teamId + '">GENERATE DEMO PIN</button>' +
        '<button type="button" class="page-access-copy" data-team="' + teamId + '" disabled>COPY</button></div></article>';
    }).join("");
  }
  const pinStatus = document.getElementById("pageAccessStatus");
  readCommunityApi("getTeamEditorPinStatus").then(response => {
    if (!response || response.ok !== true || !Array.isArray(response.teams)) throw new Error(response?.error || "PIN status unavailable.");
    response.teams.forEach(entry => {
      const teamId = String(entry.teamId || "");
      if (!["A", "B", "C", "D", "E"].includes(teamId)) return;
      const pinDisplay = document.getElementById("pageAccessPin" + teamId);
      const card = pinDisplay?.closest(".page-access-team");
      const badge = card?.querySelector(".page-access-status");
      const button = card?.querySelector(".page-access-generate");
      if (entry.configured) {
        if (pinDisplay) pinDisplay.textContent = "••••••";
        if (badge) { badge.textContent = "PIN SET"; badge.classList.add("is-demo"); }
        if (button) button.textContent = "REGENERATE PIN";
      }
    });
    if (pinStatus) pinStatus.textContent = "PIN status loaded from the shared Google Sheet. Existing PINs are hidden; regenerate one if it has been lost.";
  }).catch(error => {
    if (pinStatus) pinStatus.textContent = "Could not load PIN status. Deploy the updated Apps Script backend and try again.";
    console.error("Could not load Team Editor PIN status:", error);
  });

  /* ─────────────────────────────
     GAMES PER TEAM
  ───────────────────────────── */

  const slider =
    document.getElementById(
      "gamesPerTeamSlider"
    );

  const value =
    document.getElementById(
      "gamesPerTeamValue"
    );


  slider.addEventListener(
    "input",
    () => {

      value.textContent =
        slider.value;

    }
  );


  /* ─────────────────────────────
     SAVE TEAM NAMES
  ───────────────────────────── */

  document.getElementById("adminSaveNames").addEventListener("click", async event => {
    const button = event.currentTarget;
    const status = document.getElementById("teamNamesStatus");

    const names = {
      "Team A": document.getElementById("teamNameA").value,
      "Team B": document.getElementById("teamNameB").value,
      "Team C": document.getElementById("teamNameC").value,
      "Team D": document.getElementById("teamNameD").value,
      "Team E": document.getElementById("teamNameE").value
    };

    button.disabled = true;
    if (status) {
      status.className = "admin-info";
      status.textContent = "Saving names to the shared database and verifying the saved values…";
    }

    try {
      await saveSharedTeamNames(names);
      if (status) {
        status.className = "admin-success";
        status.textContent = "Saved and verified. All visitors will now see these team names.";
      }
    } catch (error) {
      console.error("Could not save shared team names:", error);
      if (status) {
        status.className = "admin-warning";
        status.textContent = "Could not verify the shared save: " + (error?.message || "Unknown error");
      }
    } finally {
      button.disabled = false;
    }
  });



  /* ─────────────────────────────
     SAVE COMPETITION SETTING
  ───────────────────────────── */


  /* SAVE OFFICIAL MATCH RESULT */
  const resultMatch = document.getElementById("adminResultMatch");
  const resultHome = document.getElementById("adminResultHome");
  const resultAway = document.getElementById("adminResultAway");
  const resultStatus = document.getElementById("adminResultStatus");
  const resultSave = document.getElementById("adminSaveResult");
  if (resultMatch && resultMatch.options.length === 0) {
    games.slice().sort((a,b) => a.id-b.id).forEach(game => {
      const option = document.createElement("option");
      option.value = String(game.id);
      option.textContent = "Game " + game.id + " · " + (game.home || "Home TBD") + " vs " + (game.away || "Away TBD") + " · " + (normalizeStage(game.stage) === "REGULAR" ? "REGULAR" : normalizeStage(game.stage));
      resultMatch.appendChild(option);
    });
  }
  function fillResultInputs() {
    const id = Number(resultMatch?.value), current = scores[id];
    if (resultHome) resultHome.value = current && current.home !== "" ? current.home : "";
    if (resultAway) resultAway.value = current && current.away !== "" ? current.away : "";
    if (resultStatus) {
      resultStatus.className = "admin-info";
      resultStatus.textContent = current ? "Current saved score: " + current.home + "–" + current.away + "." : "No result is currently recorded for this match.";
    }
  }
  if (resultMatch) { resultMatch.addEventListener("change", fillResultInputs); fillResultInputs(); }
  if (resultSave) resultSave.addEventListener("click", async () => {
    const matchId = Number(resultMatch?.value), homeScore = resultHome?.value, awayScore = resultAway?.value;
    const fixture = games.find(game => Number(game.id) === matchId);
    if (!adminToken || !fixture) { if (resultStatus) resultStatus.textContent = "Admin session or selected fixture is unavailable. Unlock Admin again."; return; }
    if (homeScore === "" || awayScore === "" || !Number.isInteger(Number(homeScore)) || !Number.isInteger(Number(awayScore)) ||
        Number(homeScore) < 0 || Number(awayScore) < 0 || Number(homeScore) > 99 || Number(awayScore) > 99) {
      if (resultStatus) resultStatus.textContent = "Enter whole-number scores from 0 to 99 for both teams.";
      return;
    }
    if (!confirm("Save Game " + matchId + " (" + fixture.home + " " + homeScore + "–" + awayScore + " " + fixture.away + ")? This will update the official result.")) return;
    resultSave.disabled = true; resultSave.textContent = "SAVING…";
    if (resultStatus) { resultStatus.className = "admin-info"; resultStatus.textContent = "Writing the score to Google Sheets and verifying the saved values…"; }
    try {
      await postCommunityAction({ action: "submitMatchResult", adminToken, matchId, homeScore: Number(homeScore), awayScore: Number(awayScore) });
      let verified = false;
      for (let attempt = 0; attempt < 8; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 500));
        try {
          const response = await readCommunityApi("getMatchResults");
          const saved = response?.ok && Array.isArray(response.results) ? response.results.find(row => Number(row.matchId) === matchId) : null;
          if (saved && Number(saved.homeScore) === Number(homeScore) && Number(saved.awayScore) === Number(awayScore)) { verified = true; break; }
        } catch (_) {}
      }
      if (!verified) throw new Error("The save could not be verified. Check the Apps Script deployment and RESULTS_* Script Properties.");
      scores[matchId] = { home: Number(homeScore), away: Number(awayScore) };
      await loadScoresFromSheet();
      if (resultStatus) { resultStatus.className = "admin-success"; resultStatus.textContent = "Saved and verified in Google Sheets. The ladder, ratings and match pages have been refreshed."; }
    } catch (error) {
      console.error("Official match result save failed:", error);
      if (resultStatus) { resultStatus.className = "admin-warning"; resultStatus.textContent = "Could not verify the result: " + (error?.message || "Unknown error"); }
    } finally { resultSave.disabled = false; resultSave.textContent = "SAVE MATCH RESULT"; }
  });

  document
    .getElementById("adminSave")
    .addEventListener("click", async event => {
      const button = event.currentTarget;
      const desired = Number(slider.value);
      const status = document.getElementById("gamesPerTeamStatus");

      button.disabled = true;
      if (status) {
        status.className = "admin-info";
        status.textContent = "Saving season length to the shared database and verifying…";
      }

      try {
        await saveSharedGamesPerTeam(desired);
        renderAdminPage();
        const refreshedStatus = document.getElementById("gamesPerTeamStatus");
        if (refreshedStatus) {
          refreshedStatus.className = "admin-success";
          refreshedStatus.textContent = "Saved and verified. All visitors now use " + desired + " games per team.";
        }
      } catch (error) {
        console.error("Could not save shared competition settings:", error);
        if (status) {
          status.className = "admin-warning";
          status.textContent = "Could not verify the shared season-length save: " + (error?.message || "Unknown error");
        }
      } finally {
        button.disabled = false;
      }
    });


  /* ─────────────────────────────
     LOCK ADMIN
  ───────────────────────────── */

  document
    .getElementById(
      "adminLock"
    )
    .addEventListener(
      "click",
      () => {

        adminUnlocked = false;
        adminToken = "";

        renderAdminPage();

      }
    );

  document.querySelectorAll(".page-access-generate").forEach(button => {
    button.addEventListener("click", async () => {
      const teamId = button.dataset.team;
      const pin = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
      const pinDisplay = document.getElementById("pageAccessPin" + teamId);
      const copyButton = document.querySelector('.page-access-copy[data-team="' + teamId + '"]');
      const status = document.getElementById("pageAccessStatus");
      const badge = button.closest(".page-access-team")?.querySelector(".page-access-status");
      if (!adminToken) {
        if (status) status.textContent = "Unlock Admin before generating a PIN.";
        return;
      }
      button.disabled = true;
      button.textContent = "SAVING…";
      if (status) status.textContent = "Saving Team " + teamId + " PIN to the shared Google Sheet…";
      try {
        await postCommunityAction({ action: "updateTeamEditorPin", adminToken, teamId, pin });
        let verified = false;
        for (let attempt = 0; attempt < 5; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 700));
          const result = await readCommunityApi("verifyTeamEditorPin", { pin });
          if (result?.ok === true && result.teamId === teamId) { verified = true; break; }
        }
        if (!verified) throw new Error("The save could not be verified. Make sure the updated Apps Script is deployed.");
        if (pinDisplay) pinDisplay.textContent = pin;
        if (copyButton) { copyButton.disabled = false; copyButton.textContent = "COPY"; }
        button.textContent = "REGENERATE PIN";
        if (badge) { badge.textContent = "PIN READY"; badge.classList.add("is-demo"); }
        if (status) status.textContent = "Team " + teamId + " PIN saved and verified in Google Sheets. Copy it now and share it with that team's manager.";
      } catch (error) {
        button.textContent = "TRY AGAIN";
        if (status) status.textContent = "Could not save Team " + teamId + " PIN: " + (error?.message || "Unknown error");
      } finally {
        button.disabled = false;
      }
    });
  });

  document.querySelectorAll(".page-access-copy").forEach(button => {
    button.addEventListener("click", async () => {
      const teamId = button.dataset.team;
      const pinDisplay = document.getElementById("pageAccessPin" + teamId);
      const status = document.getElementById("pageAccessStatus");
      if (!pinDisplay || !/^\d{6}$/.test(pinDisplay.textContent.trim())) return;
      try {
        await navigator.clipboard.writeText(pinDisplay.textContent.trim());
        button.textContent = "COPIED";
        if (status) status.textContent = "PIN copied. It is saved in the shared Google Sheet."; 
      } catch (error) {
        if (status) status.textContent = "Clipboard access was blocked. Select the PIN and copy it manually."; 
      }
    });
  });

}
async function unlockAdmin() {
  const input = document.getElementById("adminTokenInput");
  const error = document.getElementById("adminError");

  if (!input || !input.value.trim()) {
    if (error) error.textContent = "Enter your API admin token.";
    if (input) input.focus();
    return;
  }

  if (error) error.textContent = "Checking token with the server…";

  const token = input.value.trim();
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");

  try {
    // The Apps Script deployment validates the token. No token hash is shipped
    // in the public dashboard source, so every fork can use its own secret.
    adminToken = token;
    adminUnlocked = false;
    socialAdminSessionToken = "";

    await postCommunityAction({ action: "createModerationSession", adminToken: token, nonce });

    for (let attempt = 0; attempt < 8 && !socialAdminSessionToken; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 350));
      try {
        const session = await readCommunityApi("getModerationSession", { nonce });
        if (session && session.ok && session.sessionToken) {
          socialAdminSessionToken = session.sessionToken;
        }
      } catch {}
    }

    if (!socialAdminSessionToken) {
      adminToken = "";
      adminUnlocked = false;
      if (error) error.textContent = "Token rejected or server unavailable. Check the Apps Script deployment and try again.";
      input.focus();
      input.select();
      return;
    }

    adminUnlocked = true;
    renderAdminPage();
  } catch (err) {
    adminToken = "";
    adminUnlocked = false;
    socialAdminSessionToken = "";
    if (error) error.textContent = "Could not verify the token with Apps Script. Check the deployment and try again.";
  }
}

/* =========================================================
   PAGE SYSTEM
========================================================= */

let currentPage = "home";
let selectedTeamIndex = 0;
let teamWheelRotation = 0;

function setPrimaryMenuOpen(open) {
  const menu = document.getElementById("primary-nav");
  const toggle = document.getElementById("menu-toggle");
  if (!menu || !toggle) return;
  clearTimeout(window.__primaryMenuCloseTimer);

  if (open) {
    menu.hidden = false;
    menu.classList.remove("is-closing");
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-label", "Close navigation menu");
    toggle.classList.add("is-open");
    requestAnimationFrame(() => menu.classList.add("is-open"));
    return;
  }

  menu.classList.remove("is-open");
  menu.classList.add("is-closing");
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-label", "Open navigation menu");
  toggle.classList.remove("is-open");
  window.__primaryMenuCloseTimer = setTimeout(() => {
    menu.hidden = true;
    menu.classList.remove("is-closing");
  }, 400);
}

function showPage(pageName) {
  updateTeamNavNames();
  setPrimaryMenuOpen(false);

  const isTeamProfile = /^team-[a-e]$/.test(pageName);
  const navPageName = isTeamProfile ? "teams" : pageName === "finals" ? "matches" : pageName;
  const page = document.getElementById(`${pageName}-page`);
  const button = document.querySelector(`.nav-button[data-page="${navPageName}"]`);
  if (!page || !button) return;

  const commitPageChange = () => {
    document.querySelectorAll(".page").forEach(item => item.classList.remove("active-page"));
    document.querySelectorAll(".nav-button").forEach(item => item.classList.remove("active"));
    page.classList.add("active-page");
    button.classList.add("active");
    currentPage = pageName;

    if (isTeamProfile) {
      renderTeamPage(getTeamNameFromPage(pageName));
      const container = document.getElementById(pageName + "-page");
      if (container) {
        const back = document.createElement("button");
        back.type = "button";
        back.className = "team-back-to-wheel";
        back.textContent = "← Back to teams";
        back.addEventListener("click", () => showPage("teams"));
        container.prepend(back);
      }
    }
    if (pageName === "teams") {
      syncTeamWheelNames();
      renderTeamWheelSelection(selectedTeamIndex, false);
    }
    if (pageName === "finals") renderFinalsPage();
    if (pageName === "admin") renderAdminPage();

    // Re-measure shared filter indicators only after their page has become visible.
    requestAnimationFrame(() => {
      if (pageName === "socials" && typeof positionSocialFilterIndicator === "function") {
        const filters = document.querySelector("#socials-page .social-feed-filters");
        positionSocialFilterIndicator(filters, filters?.querySelector("[data-social-filter].is-active"));
      }
      if (pageName === "matches" && typeof positionMatchFilterIndicator === "function") {
        const matchPage = document.getElementById("matches-page");
        if (matchPage) positionMatchFilterIndicator(matchPage);
      }
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (document.startViewTransition && !reduceMotion) {
    document.startViewTransition(commitPageChange);
  } else {
    commitPageChange();
  }
}

document.querySelectorAll("[data-page]").forEach(button => {
  button.addEventListener("click", () => showPage(button.dataset.page));
});

const menuToggle = document.getElementById("menu-toggle");
const primaryNav = document.getElementById("primary-nav");
if (menuToggle && primaryNav) {
  menuToggle.addEventListener("click", () => {
    setPrimaryMenuOpen(!primaryNav.classList.contains("is-open"));
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && primaryNav.classList.contains("is-open")) {
      setPrimaryMenuOpen(false);
      menuToggle.focus();
    }
  });
}

// The competition ladder is permanently expanded; no toggle is required.


function syncTeamWheelNames() {
  const names = getTeamNames();
  document.querySelectorAll(".ccm-11__stop").forEach((stop, index) => {
    stop.textContent = names[TEAMS[index]] || TEAMS[index];
  });
}

function renderTeamWheelSelection(index, announce = true) {
  const stops = [...document.querySelectorAll(".ccm-11__stop")];
  const wheel = document.querySelector(".ccm-11__wheel");
  const current = document.querySelector(".ccm-11__current");
  const live = document.querySelector(".ccm-11__live");
  if (!stops.length || !wheel || !current) return;

  selectedTeamIndex = (index + TEAMS.length) % TEAMS.length;
  const step = 360 / TEAMS.length;
  const target = -selectedTeamIndex * step;
  const delta = ((target - (teamWheelRotation % 360) + 540) % 360) - 180;
  teamWheelRotation += delta;
  wheel.style.setProperty("--rot", teamWheelRotation + "deg");
  stops.forEach((stop, i) => {
    stop.style.rotate = (-teamWheelRotation) + "deg";
    stop.classList.toggle("is-active", i === selectedTeamIndex);
    stop.setAttribute("aria-pressed", String(i === selectedTeamIndex));
  });
  const names = getTeamNames();
  current.textContent = names[TEAMS[selectedTeamIndex]] || TEAMS[selectedTeamIndex];
  if (announce && live) live.textContent = current.textContent + " selected";
}

document.querySelectorAll(".ccm-11__stop").forEach((stop, index) => {
  stop.addEventListener("click", () => renderTeamWheelSelection(index));
});
document.querySelector(".ccm-11__prev")?.addEventListener("click", () => renderTeamWheelSelection(selectedTeamIndex - 1));
document.querySelector(".ccm-11__next")?.addEventListener("click", () => renderTeamWheelSelection(selectedTeamIndex + 1));
document.querySelector(".ccm-11__view-profile")?.addEventListener("click", () => {
  showPage("team-" + String.fromCharCode(97 + selectedTeamIndex));
});

/* =========================================================
   TEAM PAGES
========================================================= */

function getTeamMatches(
  teamName
) {

  const matches = [];


  getActiveRegularGames()
    .forEach(game => {

      if (
        !isPlayed(game)
      ) {
        return;
      }


      if (
        game.home !== teamName &&
        game.away !== teamName
      ) {
        return;
      }


      const isHome =
        game.home === teamName;


      const teamScore =
        Number(
          scores[game.id][
            isHome
              ? "home"
              : "away"
          ]
        );


      const opponentScore =
        Number(
          scores[game.id][
            isHome
              ? "away"
              : "home"
          ]
        );


      let result = "D";


      if (
        teamScore >
        opponentScore
      ) {
        result = "W";
      }

      else if (
        teamScore <
        opponentScore
      ) {
        result = "L";
      }


      matches.push({

        game: game.id,

        opponent:
          isHome
            ? game.away
            : game.home,

        teamScore,

        opponentScore,

        result,

        stage:
          game.stage

      });

    });


  return matches.sort(
    (a, b) =>
      a.game - b.game
  );

}


function getTeamEloHistory(
  teamName,
  eloRows
) {

  const history = [];


  eloRows.forEach(row => {

    if (
      row.scoreA === "" ||
      row.scoreB === ""
    ) {
      return;
    }


    if (
      row.teamA !== teamName &&
      row.teamB !== teamName
    ) {
      return;
    }


    const isTeamA =
      row.teamA === teamName;


    history.push({

      game:
        row.game,

      opponent:
        isTeamA
          ? row.teamB
          : row.teamA,

      teamScore:
        Number(
          isTeamA
            ? row.scoreA
            : row.scoreB
        ),

      opponentScore:
        Number(
          isTeamA
            ? row.scoreB
            : row.scoreA
        ),

      pre:
        isTeamA
          ? row.preA
          : row.preB,

      change:
        isTeamA
          ? row.changeA
          : row.changeB,

      post:
        isTeamA
          ? row.postA
          : row.postB

    });

  });


  return history;
}


function buildTeamEloGraph(teamName, historyOrTeams, selectionMode = false) {
  const elo = calculateElo();
  const isTeamList = selectionMode || (Array.isArray(historyOrTeams) && historyOrTeams.length > 0 && typeof historyOrTeams[0] === "string");
  const selectedTeams = isTeamList
    ? historyOrTeams.filter(name => TEAMS.includes(name))
    : [teamName];
  const histories = {};
  TEAMS.forEach(name => {
    histories[name] = (!isTeamList && name === teamName && Array.isArray(historyOrTeams))
      ? historyOrTeams
      : getTeamEloHistory(name, elo.rows);
  });
  const colors = ["#d8b45a", "#55b8ff", "#d879f9", "#a8b3c2", "#4fd6a0"];
  const series = selectedTeams.map(name => ({
    name,
    color: colors[TEAMS.indexOf(name) % colors.length],
    rows: histories[name] || [],
    points: (() => {
      const rows = histories[name] || [];
      if (!rows.length) return [];
      return [
        { game: Math.max(0, Number(rows[0].game) - 1), rating: Number(rows[0].pre), label: "Starting rating", change: null, clickGame: null },
        ...rows.map(row => ({
          game: Number(row.game), rating: Number(row.post), opponent: String(row.opponent || ""),
          score: String(row.teamScore) + "–" + String(row.opponentScore), change: Number(row.change),
          label: "Game " + row.game, clickGame: Number(row.game)
        }))
      ].filter(point => Number.isFinite(point.game) && Number.isFinite(point.rating));
    })()
  }));
  const primaryRows = histories[teamName] || [];
  const primaryPoints = primaryRows.length ? [
    { game: Math.max(0, Number(primaryRows[0].game) - 1), rating: Number(primaryRows[0].pre) },
    ...primaryRows.map(row => ({ game: Number(row.game), rating: Number(row.post) }))
  ].filter(point => Number.isFinite(point.game) && Number.isFinite(point.rating)) : [];
  const first = primaryPoints[0], last = primaryPoints[primaryPoints.length - 1];
  const net = first && last ? last.rating - first.rating : 0;
  const netClass = net > 0.000001 ? "is-up" : net < -0.000001 ? "is-down" : "is-flat";
  const netLabel = (net > 0 ? "+" : "") + net.toFixed(1);
  const plotted = series.flatMap(item => item.points);
  let chart = '<div class="elo-graph-empty">' +
    (selectedTeams.length ? "Complete matches to build the selected teams’ rating timelines." : "Select one or more teams to compare their rating histories.") +
    '</div>';

  if (plotted.length >= 2) {
    const W = 900, H = 310, left = 60, right = 24, top = 24, bottom = 42;
    const plotW = W - left - right, plotH = H - top - bottom;
    let min = Math.min(...plotted.map(point => point.rating));
    let max = Math.max(...plotted.map(point => point.rating));
    const pad = Math.max(35, (max - min) * 0.16);
    min = Math.floor((min - pad) / 25) * 25;
    max = Math.ceil((max + pad) / 25) * 25;
    if (max - min < 100) { const mid = (max + min) / 2; min = Math.floor((mid - 50) / 25) * 25; max = min + 100; }
    const minGame = Math.min(...plotted.map(point => point.game));
    const maxGame = Math.max(...plotted.map(point => point.game));
    const x = game => left + (maxGame === minGame ? plotW / 2 : ((game - minGame) / (maxGame - minGame)) * plotW);
    const y = rating => top + ((max - rating) / (max - min)) * plotH;
    const grid = [0, 1, 2, 3, 4].map(i => {
      const value = max - ((max - min) * i / 4), yy = y(value);
      return '<line class="elo-graph-grid" x1="' + left + '" y1="' + yy.toFixed(2) + '" x2="' + (W - right) + '" y2="' + yy.toFixed(2) + '"/><text class="elo-graph-label" x="' + (left - 10) + '" y="' + (yy + 4).toFixed(2) + '" text-anchor="end">' + Math.round(value) + '</text>';
    }).join("");
    const xLabels = [...new Set([minGame, Math.round((minGame + maxGame) / 2), maxGame])].map(game =>
      '<text class="elo-graph-label" x="' + x(game).toFixed(2) + '" y="' + (H - 14) + '" text-anchor="middle">Game ' + game + '</text>'
    ).join("");
    const lines = series.map((item, si) => {
      const coords = item.points.map(point => ({ ...point, x: x(point.game), y: y(point.rating) }));
      if (coords.length < 2) return "";
      const path = coords.map((point, index) => (index ? "L" : "M") + point.x.toFixed(2) + "," + point.y.toFixed(2)).join(" ");
      const line = '<path class="elo-series-line ' + (item.name === teamName ? "elo-series-primary" : "") + '" data-team="' + escapeHTML(item.name) + '" d="' + path + '" stroke="' + item.color + '"/>';
      const dots = coords.map((point, index) => {
        const hasChange = Number.isFinite(point.change);
        const dotColor = !hasChange ? item.color : point.change > 0.000001 ? "#4caf7d" : point.change < -0.000001 ? "#d96666" : "#929aa5";
        const changeText = hasChange ? "Rating change: " + (point.change > 0 ? "+" : "") + point.change.toFixed(2) : "Starting rating";
        const title = item.name + " · " + point.label + "\nRating: " + point.rating.toFixed(2) + "\n" + changeText +
          (point.opponent ? "\nvs " + getTeamDisplayName(point.opponent) + " · " + point.score : "") +
          (point.clickGame ? "\nClick to open match" : "");
        return '<circle class="elo-graph-point ' + (point.clickGame ? "is-match-point" : "is-start-point") + '" cx="' + point.x.toFixed(2) + '" cy="' + point.y.toFixed(2) + '" r="' + (index === coords.length - 1 ? 4.8 : 3.8) + '" fill="' + dotColor + '"' +
          ' data-series-team="' + escapeHTML(item.name) + '" data-team="' + escapeHTML(getTeamDisplayName(item.name)) + '" data-label="' + escapeHTML(point.label) + '" data-rating="' + point.rating.toFixed(2) + '" data-change="' + (hasChange ? point.change.toFixed(2) : "") + '" data-opponent="' + escapeHTML(point.opponent ? getTeamDisplayName(point.opponent) : "") + '" data-score="' + escapeHTML(point.score || "") + '"' +
          ' onmouseenter="showEloGraphTooltip(event,this)" onmousemove="moveEloGraphTooltip(event)" onmouseleave="hideEloGraphTooltip()"' +
          (point.clickGame ? ' tabindex="0" role="button" aria-label="' + escapeHTML(title.replace(/\n/g, ". ")) + '" onclick="jumpToGame(' + point.clickGame + ')" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();jumpToGame(' + point.clickGame + ')}"' : "") +
          '><title>' + escapeHTML(title) + '</title></circle>';
      }).join("");
      return line + dots;
    }).join("");
    chart = '<svg class="elo-graph" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Rating history comparison">' +
      '<defs><linearGradient id="elo-gold-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#c5a15d" stop-opacity=".16"/><stop offset="100%" stop-color="#c5a15d" stop-opacity="0"/></linearGradient></defs>' +
      grid + '<line class="elo-graph-axis" x1="' + left + '" y1="' + (top + plotH) + '" x2="' + (W - right) + '" y2="' + (top + plotH) + '"/>' + lines + xLabels + '</svg>';
  }

  const checkboxes = TEAMS.map(name =>
    '<label class="elo-team-option"><input type="checkbox" value="' + escapeHTML(name) + '"' + (selectedTeams.includes(name) ? " checked" : "") +
    ' onchange="updateTeamEloGraph(this, \'TEAM\', \' ' + escapeHTML(teamName) + '\')"><span class="elo-team-swatch" style="--team-series-color:' + colors[TEAMS.indexOf(name) % colors.length] + '"></span>' +
    escapeHTML(getTeamDisplayName(name)) + '</label>'
  ).join("");
  const allChecked = selectedTeams.length === TEAMS.length;
  return '<section class="card elo-trend-card" data-primary-team="' + escapeHTML(teamName) + '">' +
    '<div class="elo-trend-heading"><div><div class="section-title">PERFORMANCE OVER TIME</div><h2>Rating trajectory</h2><p class="elo-trend-subtitle">Compare rating changes after completed matches. Select any teams or all teams.</p></div>' +
    '<div class="elo-trend-summary"><span class="elo-trend-current">' + (last ? last.rating.toFixed(1) : "—") + '<small>CURRENT RATING</small></span><span class="elo-trend-net ' + netClass + '">' + (last ? netLabel : "—") + '<small>NET CHANGE</small></span></div></div>' +
    '<div class="elo-team-picker"><label class="elo-team-option elo-team-all"><input type="checkbox" value="ALL"' + (allChecked ? " checked" : "") +
    ' onchange="updateTeamEloGraph(this, \'ALL\', \' ' + escapeHTML(teamName) + '\')"><strong>All teams</strong></label><div class="elo-team-options">' + checkboxes + '</div></div>' +
    '<div class="elo-graph-wrap">' + chart + '<div class="elo-graph-tooltip" role="status" aria-live="polite"></div></div><div class="elo-graph-legend"><span class="elo-graph-legend-item"><i class="elo-graph-legend-dot" style="background:#c5a15d"></i>Rating trajectory</span><span class="elo-graph-legend-item"><i class="elo-graph-legend-dot" style="background:#4caf7d"></i>Rating gain</span><span class="elo-graph-legend-item"><i class="elo-graph-legend-dot" style="background:#d96666"></i>Rating loss</span><span class="elo-graph-legend-item">' + primaryRows.length + ' matches for ' + escapeHTML(getTeamDisplayName(teamName)) + '</span></div></section>';
}

function showEloGraphTooltip(event, point) {
  if (!point) return;
  // Keep the tooltip outside the graph/card overflow containers so it cannot be clipped.
  let tooltip = document.getElementById("elo-graph-tooltip");
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.id = "elo-graph-tooltip";
    tooltip.className = "elo-graph-tooltip";
    tooltip.setAttribute("role", "status");
    tooltip.setAttribute("aria-live", "polite");
    document.body.appendChild(tooltip);
  }
  const change = point.dataset.change;
  const changeNumber = change === "" ? null : Number(change);
  const changeClass = changeNumber === null ? "flat" : changeNumber > 0.000001 ? "up" : changeNumber < -0.000001 ? "down" : "flat";
  const changeLabel = changeNumber === null ? "Starting rating" : (changeNumber > 0 ? "+" : "") + changeNumber.toFixed(2) + " rating";
  tooltip.innerHTML =
    '<span class="elo-tooltip-team">' + escapeHTML(point.dataset.team || "") + '</span>' +
    '<span class="elo-tooltip-match">' + escapeHTML(point.dataset.label || "") +
    (point.dataset.opponent ? ' · vs ' + escapeHTML(point.dataset.opponent) : '') +
    (point.dataset.score ? ' · ' + escapeHTML(point.dataset.score) : '') + '</span>' +
    '<span class="elo-tooltip-values"><span>Rating <strong>' + Number(point.dataset.rating).toFixed(2) + '</strong></span>' +
    '<span class="elo-tooltip-change ' + changeClass + '">Change <strong>' + escapeHTML(changeLabel) + '</strong></span></span>' +
    (point.classList.contains("is-match-point") ? '<span class="elo-tooltip-hint">Click to open match</span>' : '');
  tooltip.classList.add("visible");
  moveEloGraphTooltip(event);
}
function moveEloGraphTooltip(event) {
  const tooltip = document.querySelector(".elo-graph-tooltip.visible");
  if (!tooltip || !event) return;
  const gap = 14, pad = 10;
  const rect = tooltip.getBoundingClientRect();
  let left = event.clientX + gap;
  let top = event.clientY + gap;
  if (left + rect.width > window.innerWidth - pad) left = event.clientX - rect.width - gap;
  if (top + rect.height > window.innerHeight - pad) top = event.clientY - rect.height - gap;
  tooltip.style.left = Math.max(pad, left) + "px";
  tooltip.style.top = Math.max(pad, top) + "px";
}
function hideEloGraphTooltip() {
  document.querySelectorAll(".elo-graph-tooltip.visible").forEach(tooltip => tooltip.classList.remove("visible"));
}

function getEloGraphLineProgress(root) {
  const progress = new Map();
  if (!root) return progress;

  root.querySelectorAll(".elo-series-line[data-team]").forEach(path => {
    let length = 0;
    try { length = path.getTotalLength(); } catch (_) {}
    if (!Number.isFinite(length) || length <= 0) return;

    const offset = Number.parseFloat(getComputedStyle(path).strokeDashoffset);
    const fraction = path.style.strokeDasharray === "none" || !Number.isFinite(offset)
      ? 1
      : Math.max(0, Math.min(1, 1 - offset / length));
    const animation = path._eloDrawAnimation || path._eloUndrawAnimation;
    const duration = animation?.effect?.getTiming?.().duration;
    const currentTime = animation?.currentTime;
    const remaining = Number.isFinite(duration) && Number.isFinite(currentTime)
      ? Math.max(0, duration - currentTime)
      : 0;
    progress.set(path.dataset.team, {
      fraction,
      remaining,
      undrawing: Boolean(path._eloUndrawAnimation)
    });
  });

  return progress;
}

function updateTeamEloGraph(control, mode, primaryTeam) {
  const card = control && control.closest(".elo-trend-card");
  if (!card) return;
  const primary = String(primaryTeam || card.dataset.primaryTeam || "").trim();
  const previousProgress = getEloGraphLineProgress(card);
  const previouslyDrawn = new Set(
    Array.from(card.querySelectorAll(".elo-series-line[data-team]"))
      .map(path => path.dataset.team)
  );
  let selected;
  if (mode === "ALL") {
    selected = control.checked ? TEAMS.slice() : [];
  } else {
    selected = Array.from(card.querySelectorAll('.elo-team-options input[type="checkbox"]:checked'))
      .map(input => input.value);
  }

  const newlySelected = new Set(selected.filter(name => !previouslyDrawn.has(name)));
  const newlyDeselected = new Set([...previouslyDrawn].filter(name => !selected.includes(name)));
  const teamsToRender = [...selected, ...[...newlyDeselected].filter(name => !selected.includes(name))];
  const wrapper = document.createElement("div");
  wrapper.innerHTML = buildTeamEloGraph(primary, teamsToRender, true);
  const replacement = wrapper.firstElementChild;
  if (!replacement) return;

  replacement.querySelectorAll('.elo-team-options input[type="checkbox"]').forEach(input => {
    input.checked = selected.includes(input.value);
  });
  const allCheckbox = replacement.querySelector('.elo-team-all input[type="checkbox"]');
  if (allCheckbox) allCheckbox.checked = selected.length === TEAMS.length;

  card.replaceWith(replacement);
  requestAnimationFrame(() => {
    // Continue each surviving line from its own previous visible fraction.
    // Rebuilding the SVG must not make unrelated teams restart in lockstep.
    replacement.querySelectorAll(".elo-series-line[data-team]").forEach(path => {
      const team = path.dataset.team;
      const previous = previousProgress.get(team);
      if (!previous || newlySelected.has(team) || newlyDeselected.has(team)) return;
      resumeEloGraphLine(path, previous);
    });
    animateEloGraphLines(replacement, newlySelected);
    undrawEloGraphLines(replacement, newlyDeselected);
  });
}

function resumeEloGraphLine(path, previous) {
  let length = 0;
  try { length = path.getTotalLength(); } catch (_) {}
  if (!Number.isFinite(length) || length <= 0) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion || typeof path.animate !== "function" || previous.fraction >= 0.999) {
    path.style.strokeDasharray = "none";
    path.style.strokeDashoffset = "0";
    return;
  }

  const startOffset = length * (1 - previous.fraction);
  path.style.strokeDasharray = String(length);
  path.style.strokeDashoffset = String(startOffset);
  const duration = previous.remaining > 0 ? previous.remaining : 1400 * (1 - previous.fraction);
  if (duration <= 0) {
    path.style.strokeDasharray = "none";
    path.style.strokeDashoffset = "0";
    return;
  }

  path._eloDrawAnimation = path.animate(
    [{ strokeDashoffset: startOffset }, { strokeDashoffset: 0 }],
    { duration, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" }
  );
  path._eloDrawAnimation.onfinish = () => {
    path.style.strokeDashoffset = "0";
    path.style.strokeDasharray = "none";
    path._eloDrawAnimation = null;
  };
}

function undrawEloGraphLines(root, teamsToUndraw) {
  if (!root || !teamsToUndraw || !teamsToUndraw.size) return;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  teamsToUndraw.forEach(team => {
    const path = Array.from(root.querySelectorAll(".elo-series-line[data-team]"))
      .find(line => line.dataset.team === team);
    if (!path) return;

    let length = 0;
    try { length = path.getTotalLength(); } catch (_) {}
    const points = Array.from(root.querySelectorAll(".elo-graph-point[data-series-team]"))
      .filter(point => point.dataset.seriesTeam === team);

    if (!Number.isFinite(length) || length <= 0 || reduceMotion || typeof path.animate !== "function") {
      path.remove();
      points.forEach(point => point.remove());
      return;
    }

    if (path._eloDrawAnimation) path._eloDrawAnimation.cancel();
    path.style.strokeDasharray = String(length);
    const computedOffset = Number.parseFloat(getComputedStyle(path).strokeDashoffset);
    const startOffset = Number.isFinite(computedOffset)
      ? Math.max(0, Math.min(length, computedOffset))
      : 0;
    path.style.strokeDashoffset = String(startOffset);
    const animation = path.animate(
      [{ strokeDashoffset: startOffset }, { strokeDashoffset: length }],
      { duration: Math.max(160, 700 * (1 - startOffset / length)), easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" }
    );
    path._eloUndrawAnimation = animation;

    points.forEach(point => {
      point.style.pointerEvents = "none";
      if (point._eloFadeAnimation) point._eloFadeAnimation.cancel();
      point._eloFadeAnimation = point.animate(
        [{ opacity: 1 }, { opacity: 0 }],
        { duration: 240, easing: "ease-out", fill: "forwards" }
      );
    });

    animation.onfinish = () => {
      path.remove();
      points.forEach(point => point.remove());
    };
  });
}


function getTeamPageId(
  teamName
) {

  return (
    teamName
      .toLowerCase()
      .replace(" ", "-") +
    "-page"
  );

}


function getTeamNameFromPage(
  pageName
) {

  const letter =
    pageName
      .replace(
        "team-",
        ""
      )
      .toUpperCase();

  return `Team ${letter}`;

}


/* =========================================================
   TEAM PAGE
========================================================= */

const publishedTeamPageCache = new Map();
const publishedTeamPageRequests = new Map();

function requestPublishedTeamPage(teamId) {
  return new Promise((resolve, reject) => {
    const callback = "publishedPage_" + Date.now() + "_" + Math.floor(Math.random() * 1000000);
    const script = document.createElement("script");
    const url = new URL(COMMUNITY_API_URL);
    url.searchParams.set("action", "getPublishedTeamPage");
    url.searchParams.set("teamId", teamId);
    url.searchParams.set("callback", callback);
    url.searchParams.set("_", String(Date.now()));
    const timeout = setTimeout(() => {
      delete window[callback];
      script.remove();
      reject(new Error("Published page request timed out."));
    }, 8000);
    window[callback] = data => {
      clearTimeout(timeout);
      delete window[callback];
      script.remove();
      resolve(data);
    };
    script.onerror = () => {
      clearTimeout(timeout);
      delete window[callback];
      script.remove();
      reject(new Error("Could not load the published team page."));
    };
    script.src = url.toString();
    document.head.appendChild(script);
  });
}

function safePublishedColor(value, fallback) {
  const color = String(value || "").trim();
  if (/^#[0-9a-f]{3,8}$/i.test(color) || /^(transparent|white|black|red|blue|green|orange|purple|gray|grey)$/i.test(color) || /^rgba?\([0-9.,%\s]+\)$/i.test(color) || /^hsla?\([0-9.,%\s]+\)$/i.test(color)) return color;
  return fallback;
}

function publishedNumber(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function publishedStatValue(metric, team) {
  const values = {
    elo: Number(team.elo).toFixed(1),
    rank: team.rank ? "#" + team.rank : "—",
    played: team.played,
    wins: team.wins,
    losses: team.losses,
    draws: team.draws,
    pointsFor: team.pf,
    pointsAgainst: team.pa,
    diff: (team.diff > 0 ? "+" : "") + team.diff,
    winPct: (Number(team.winPercent || 0) * 100).toFixed(1) + "%",
    form: Array.isArray(team.form) && team.form.length ? team.form.map(item => item.result).join(" ") : "—"
  };
  return values[metric] === undefined ? "—" : String(values[metric]);
}

function publishedBlockHTML(block, team) {
  const b = block || {};
  const type = String(b.type || "text");
  const text = String(b.text || "");
  const escaped = escapeHTML(text);
  const color = safePublishedColor(b.color, "#263247");
  const bg = safePublishedColor(b.bg, "transparent");
  const fontSize = publishedNumber(b.fontSize, 16, 10, 96);
  const padding = publishedNumber(b.padding, 8, 0, 100);
  const radius = publishedNumber(b.radius, 0, 0, 100);
  const align = ["left", "center", "right"].includes(b.align) ? b.align : "left";
  const common = "box-sizing:border-box;width:100%;text-align:" + align + ";color:" + color + ";background:" + bg + ";padding:" + padding + "px;border-radius:" + radius + "px;font-size:" + fontSize + "px;";
  const lines = text.split("\n");
  let inner = "";

  if (type === "heading") {
    const tag = b.tag === "h2" ? "h2" : "h1";
    inner = "<" + tag + " style='font-size:" + fontSize + "px;color:" + color + ";text-align:" + align + ";margin:0;white-space:pre-wrap'>" + escaped + "</" + tag + ">";
  } else if (type === "text") {
    inner = "<p style='font-size:" + fontSize + "px;color:" + color + ";text-align:" + align + ";margin:0;white-space:pre-wrap'>" + escaped + "</p>";
  } else if (type === "image") {
    const src = String(b.src || "");
    const allowedSrc = /^https?:\/\//i.test(src) || /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(src);
    inner = allowedSrc && src.length < 6000000
      ? "<img src='" + escapeHTML(src) + "' alt='" + escapeHTML(String(b.alt || "")) + "' loading='lazy' style='width:100%;max-height:620px;object-fit:cover;border-radius:" + radius + "px;margin:auto;display:block'>"
      : "<div style='padding:24px;text-align:center;color:#667085'>Image unavailable. Use a hosted image URL.</div>";
  } else if (type === "button") {
    inner = "<div style='text-align:" + align + "'><span style='display:inline-block;background:" + safePublishedColor(b.bg, "#6254e8") + ";color:" + safePublishedColor(b.color, "#ffffff") + ";padding:" + padding + "px 20px;border-radius:" + radius + "px;font-weight:750'>" + escaped + "</span></div>";
  } else if (type === "card") {
    inner = "<div style='" + common + ";border:1px solid #e0e5ef;white-space:pre-wrap'><div style='font-size:" + Math.round(fontSize * 1.35) + "px;font-weight:800;margin-bottom:8px'>" + escapeHTML(lines[0]) + "</div>" + escapeHTML(lines.slice(1).join("\n")) + "</div>";
  } else if (type === "stat") {
    const label = text || String(b.metric || "wins");
    inner = "<div style='" + common + ";border:1px solid #e0e5ef'><span style='display:block;font-size:12px;font-weight:750;letter-spacing:.08em;text-transform:uppercase'>" + escapeHTML(label) + "</span><strong style='display:block;font-size:" + Math.round(fontSize * 2) + "px;margin-top:7px'>" + escapeHTML(publishedStatValue(String(b.metric || "wins"), team)) + "</strong><small style='display:block;margin-top:5px;font-size:10px;letter-spacing:.08em;text-transform:uppercase;opacity:.65'>Live competition data</small></div>";
  } else if (type === "ratingGraph") {
    const history = getTeamEloHistory(team.team, calculateElo().rows);
    inner = "<div class='published-infographic'><h3 style='margin:0 0 12px;color:" + color + "'>" + escapeHTML(text || "Rating trajectory") + "</h3>" + buildTeamEloGraph(team.team, history) + "</div>";
  } else if (type === "recentForm") {
    const form = Array.isArray(team.form) ? team.form.slice(0, 5) : [];
    const rows = form.map(item => {
      const result = String(item.result || "D").toUpperCase();
      const tone = result === "W" ? "#7ed9b1" : result === "L" ? "#ff9f9f" : "#c7d0dc";
      const bgTone = result === "W" ? "#173d32" : result === "L" ? "#48242d" : "#303b4a";
      const score = item.score || ((item.scoreFor == null ? "" : item.scoreFor) + "–" + (item.scoreAgainst == null ? "" : item.scoreAgainst));
      return "<div style='display:grid;grid-template-columns:28px minmax(0,1fr) auto;align-items:center;gap:9px;padding:10px;border:1px solid #304a66;border-radius:9px;background:#0b1929;color:#b9c9dc;font-size:12px;margin-top:7px'><span style='display:grid;place-items:center;width:25px;height:25px;border-radius:7px;background:" + bgTone + ";color:" + tone + ";font-weight:900'>" + escapeHTML(result) + "</span><span>Game " + escapeHTML(item.game) + " · vs " + escapeHTML(getTeamDisplayName(item.opponent || "")) + "</span><strong style='color:#edf3fb'>" + escapeHTML(score) + "</strong></div>";
    }).join("");
    inner = "<div style='" + common + "'><h3 style='margin:0 0 12px;color:" + color + "'>" + escapeHTML(text || "Recent form") + "</h3>" + (rows || "<div style='padding:20px;text-align:center;color:#93a7c0'>No completed matches yet.</div>") + "</div>";
  } else if (type === "divider") {
    inner = "<div style='height:2px;background:" + safePublishedColor(b.color, "#d7dce5") + ";margin:" + padding + "px 0'></div>";
  } else if (type === "spacer") {
    inner = "<div style='height:" + publishedNumber(b.height, 48, 8, 600) + "px'></div>";
  } else if (type === "badge") {
    inner = "<div><span style='display:inline-block;background:" + safePublishedColor(b.bg, "#e8e5ff") + ";color:" + safePublishedColor(b.color, "#5547b8") + ";font-size:" + fontSize + "px;padding:" + Math.max(3, padding / 2) + "px " + padding + "px;border-radius:" + radius + "px'>" + escaped + "</span></div>";
  } else if (type === "quote") {
    inner = "<blockquote style='" + common + ";font-weight:650;font-style:italic;white-space:pre-wrap;margin:0;border-left:4px solid " + color + "'>" + escaped + "</blockquote>";
  } else {
    inner = "<p style='margin:0;white-space:pre-wrap'>" + escaped + "</p>";
  }

  const span = Math.min(4, Math.max(1, Math.round((Number(b.width) || 100) / 25)));
  const position = ["left", "center", "right"].includes(b.position) ? b.position : "auto";
  let column = "span " + span;
  if (position === "left") column = "1 / span " + span;
  else if (position === "right") column = (5 - span) + " / span " + span;
  else if (position === "center") column = (Math.floor((4 - span) / 2) + 1) + " / span " + span;
  const valign = b.verticalAlign === "middle" ? "center" : b.verticalAlign === "bottom" ? "end" : "start";
  return "<section class='published-page-block' style='grid-column:" + column + ";align-self:" + valign + ";min-width:0'>" + inner + "</section>";
}

function renderPublishedTeamPage(container, design, team) {
  if (!design || !Array.isArray(design.blocks)) return;
  const pageBg = safePublishedColor(design.pageBg, "#f5f7fb");
  const pagePadding = publishedNumber(design.pagePadding, 30, 0, 100);
  const pageTitle = String(design.pageTitle || "").trim();
  const titleHTML = pageTitle ? "<h1 class='published-page-title'>" + escapeHTML(pageTitle) + "</h1>" : "";
  const blocksHTML = design.blocks.map(block => publishedBlockHTML(block, team)).join("");
  container.innerHTML =
    "<style>.published-team-page{box-sizing:border-box;width:100%;min-height:100%;background:var(--published-page-bg);padding:var(--published-page-padding);border-radius:16px}.published-page-title{margin:0 0 22px;font-size:clamp(24px,4vw,40px);line-height:1.15;color:#182033}.published-page-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}.published-page-block{min-width:0;overflow-wrap:anywhere}.published-page-block img{max-width:100%}.published-infographic{width:100%;min-width:0;overflow:hidden}.published-infographic .elo-trend-heading{display:flex;flex-wrap:wrap}.published-infographic .elo-team-picker{margin-top:10px}.published-infographic .elo-graph-wrap{padding:10px}.published-infographic .elo-graph{width:100%;height:auto;display:block}.published-infographic .elo-graph-label{fill:#8b98a8}.published-infographic .elo-graph-grid{stroke:#26303b}@media(max-width:720px){.published-page-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.published-page-block{grid-column:span 2!important}}@media(max-width:420px){.published-team-page{padding:16px}}</style>" +
    "<div class='published-team-page' style='--published-page-bg:" + pageBg + ";--published-page-padding:" + pagePadding + "px'>" +
    titleHTML + "<div class='published-page-grid'>" + blocksHTML + "</div></div>";
  // Keep the rating timeline available even when a custom Team Studio design
  // replaces the default profile layout.
  const ratingData = calculateElo();
  const ratingHistory = getTeamEloHistory(team.team, ratingData.rows);
  if (!design.blocks.some(block => block && block.type === "ratingGraph")) {
    container.insertAdjacentHTML("beforeend", buildTeamEloGraph(team.team, ratingHistory));
  }
  renderTeamNewsSection(container, String(team.team || "").slice(-1).toUpperCase());
}
function renderTeamNewsSection(container, teamId) {
  const id = String(teamId || "").toUpperCase();
  if (!container || !["A", "B", "C", "D", "E"].includes(id)) return;
  const sectionId = "team-public-news-" + id;
  container.querySelector("#" + sectionId)?.remove();
  const posts = (Array.isArray(socialFeedPosts) ? socialFeedPosts : [])
    .filter(post => String(post.teamId || "").toUpperCase() === id && post.publicationStatus === "Published")
    .slice()
    .sort((a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)) || (new Date(b.publishedAt || 0).getTime() || 0) - (new Date(a.publishedAt || 0).getTime() || 0))
    .slice(0, 3);
  if (!posts.length) return;
  if (!document.getElementById("team-public-news-styles")) {
    const style = document.createElement("style");
    style.id = "team-public-news-styles";
    style.textContent = ".team-public-news{margin-top:22px;padding:clamp(17px,3vw,26px);border:1px solid #293f58;border-radius:16px;background:#0b1726;color:#edf3fb}.team-public-news-head{display:flex;justify-content:space-between;align-items:end;gap:14px;margin-bottom:17px}.team-public-news-eyebrow{margin:0 0 5px;color:#e0b95a;font-size:9px;font-weight:900;letter-spacing:.16em;text-transform:uppercase}.team-public-news-head h2{margin:0;font-size:clamp(19px,2.6vw,26px);letter-spacing:-.035em}.team-public-news-count{color:#93a7c0;font-size:10px;white-space:nowrap}.team-public-news-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.team-public-news-card{overflow:hidden;min-width:0;border:1px solid #2b435d;border-radius:12px;background:#102036}.team-public-news-card.is-featured{border-color:#846e3e;box-shadow:inset 0 2px #e0b95a}.team-public-news-copy{padding:13px}.team-public-news-meta{display:flex;align-items:center;gap:7px;flex-wrap:wrap;color:#93a7c0;font-size:9px;font-weight:850;letter-spacing:.06em;text-transform:uppercase}.team-public-news-featured{color:#f4d57f}.team-public-news-copy h3{margin:9px 0 7px;font-size:13px;line-height:1.45}.team-public-news-copy p{margin:0;color:#adbed1;font-size:11px;line-height:1.65;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-line;overflow-wrap:anywhere}.team-public-news-date{display:block;margin-top:12px;color:#8096af;font-size:9px}@media(max-width:700px){.team-public-news-grid{grid-template-columns:1fr}.team-public-news-card{display:block}.team-public-news-copy{padding:12px}.team-public-news-copy p{-webkit-line-clamp:3}}";
    document.head.appendChild(style);
  }
  const cards = posts.map(post => {
    const featured = post.featured ? "<span class='team-public-news-featured'>◆ Featured</span>" : "";
    return "<article class='team-public-news-card" + (post.featured ? " is-featured" : "") + "'><div class='team-public-news-copy'><div class='team-public-news-meta'>" + featured + "<span>" + escapeHTML(post.category || "Team news") + "</span></div><h3>" + escapeHTML(post.title) + "</h3><p>" + escapeHTML(post.body) + "</p><time class='team-public-news-date' datetime='" + escapeHTML(post.publishedAt || "") + "'>" + escapeHTML(formatSocialDate(post.publishedAt)) + "</time></div></article>";
  }).join("");
  const section = document.createElement("section");
  section.id = sectionId;
  section.className = "team-public-news";
  section.innerHTML = "<div class='team-public-news-head'><div><p class='team-public-news-eyebrow'>TEAM " + id + " · UPDATES</p><h2>Latest stories</h2></div><span class='team-public-news-count'>" + posts.length + (posts.length === 1 ? " published story" : " published stories") + "</span></div><div class='team-public-news-grid'>" + cards + "</div>";
  container.appendChild(section);
}
function refreshRenderedTeamNews() {
  ["A", "B", "C", "D", "E"].forEach(id => {
    const container = document.getElementById("team-" + id.toLowerCase() + "-page");
    if (container && (container.querySelector(".team-hero") || container.querySelector(".published-team-page"))) renderTeamNewsSection(container, id);
  });
}
function loadPublishedTeamPage(teamName, container, team) {
  const teamId = String(teamName).slice(-1).toUpperCase();
  if (!/^[A-E]$/.test(teamId)) return;
  if (publishedTeamPageCache.has(teamId)) {
    const design = publishedTeamPageCache.get(teamId);
    if (design) renderPublishedTeamPage(container, design, team);
    else renderTeamNewsSection(container, teamId);
    return;
  }
  if (publishedTeamPageRequests.has(teamId)) {
    publishedTeamPageRequests.get(teamId).then(design => {
      if (design) renderPublishedTeamPage(container, design, team);
      else renderTeamNewsSection(container, teamId);
    }).catch(() => {});
    return;
  }
  const request = requestPublishedTeamPage(teamId).then(result => {
    const design = result && result.ok && result.design && Array.isArray(result.design.blocks) ? result.design : null;
    publishedTeamPageCache.set(teamId, design);
    if (design) renderPublishedTeamPage(container, design, team);
    else renderTeamNewsSection(container, teamId);
    return design;
  }).catch(error => {
    console.warn("Could not load published page for Team " + teamId + "; showing the original page.", error);
    renderTeamNewsSection(container, teamId);
    throw error;
  }).finally(() => publishedTeamPageRequests.delete(teamId));
  publishedTeamPageRequests.set(teamId, request);
}
function renderTeamPage(teamName) {
  console.log("RENDERING TEAM:", teamName);
  const container =
  document.getElementById(
    getTeamPageId(teamName)
  );

if (!container) {
  console.error(
    "Team page container not found:",
    getTeamPageId(teamName)
  );
  return;
}

  const elo = calculateElo();
  const ladder = calculateLadder(elo.finalRatings);
  const team = ladder.find(t => t.team === teamName);

  console.log("LOOKUP:", teamName);
  console.log("FOUND TEAM:", team);
  console.log("LADDER:", ladder.map(t => t.team));
  if (!team) {
    container.innerHTML = `
      <div class="card">
        <div class="empty">Team not found.</div>
      </div>
    `;
    return;
  }

  const matches = getTeamMatches(teamName);
  const eloHistory = getTeamEloHistory(teamName, elo.rows);

  /* ─────────────────────────
     ELO MOVEMENT
  ───────────────────────── */

  let eloMovement = `<span class="neutral">→ 0.0</span>`;

  if (team.latestEloChange > 0.000001) {
    eloMovement =
      `<span class="positive">↑ +${team.latestEloChange.toFixed(1)}</span>`;
  } else if (team.latestEloChange < -0.000001) {
    eloMovement =
      `<span class="negative">↓ ${team.latestEloChange.toFixed(1)}</span>`;
  }

  /* ─────────────────────────
     RECENT FORM
  ───────────────────────── */

  const formHTML = team.form.length
    ? team.form.map(form => {

        const resultClass =
          form.result === "W"
            ? "form-win"
            : form.result === "L"
            ? "form-loss"
            : "form-draw";

        return `
          <button
            class="team-form-item"
            onclick="jumpToGame(${form.game})"
          >
            <span class="form-result ${resultClass}">
              ${form.result}
            </span>

            <span class="team-form-game">
              GAME ${form.game}
            </span>

            <span class="team-form-opponent">
  vs ${escapeHTML(getTeamDisplayName(form.opponent))}
</span>

            <span class="team-form-score">
              ${form.scoreFor} – ${form.scoreAgainst}
            </span>
          </button>
        `;
      }).join("")
    : `
      <div class="empty">
        No completed games yet.
      </div>
    `;

  /* ─────────────────────────
     MATCH HISTORY
  ───────────────────────── */

  const matchHTML = matches.length
  ? matches.map(match => {

      const opponent =
  escapeHTML(getTeamDisplayName(match.opponent));
      const teamScore = match.teamScore;
      const opponentScore = match.opponentScore;

      let result = "D";

      if (Number(teamScore) > Number(opponentScore)) {
        result = "W";
      } else if (Number(teamScore) < Number(opponentScore)) {
        result = "L";
      }

        return `
  <div class="team-match-row">

    <div
      class="team-match-game"
      onclick="jumpToGame(${match.game})"
      style="cursor:pointer"
    >
      GAME ${match.game}
    </div>

    <div class="team-match-opponent">
      vs ${opponent}
    </div>

    <div class="team-match-score">
      ${teamScore} – ${opponentScore}
    </div>

    <div class="team-match-result">
      ${result}
    </div>

    <div class="team-match-stage">
      ${match.stage}
    </div>

  </div>
`;
      }).join("")
    : `
      <div class="empty">
        No completed games yet.
      </div>
    `;

  /* ─────────────────────────
     ELO HISTORY
  ───────────────────────── */

  const eloHistoryHTML = eloHistory.length
    ? eloHistory.map(row => {

        const change = Number(row.change);

        let changeHTML =
          `<span class="elo-zero">→ 0.0</span>`;

        if (change > 0.000001) {
          changeHTML =
            `<span class="elo-up">↑ +${change.toFixed(1)}</span>`;
        } else if (change < -0.000001) {
          changeHTML =
            `<span class="elo-down">↓ ${change.toFixed(1)}</span>`;
        }

        return `
          <button
            class="team-elo-row"
            onclick="jumpToGame(${row.game})"
          >
            <div class="team-elo-game">
              GAME ${row.game}
            </div>

            <div class="team-elo-opponent">
  vs ${escapeHTML(getTeamDisplayName(row.opponent))}
</div>

            <div class="team-elo-score">
              ${row.teamScore} – ${row.opponentScore}
            </div>

            <div class="team-elo-before">
              ${Number(row.pre).toFixed(1)}
            </div>

            <div class="team-elo-change">
              ${changeHTML}
            </div>

            <div class="team-elo-after">
              ${Number(row.post).toFixed(1)}
            </div>
          </button>
        `;
      }).join("")
    : `
      <div class="empty">
        No Elo history yet.
      </div>
    `;

  /* ─────────────────────────
     TEAM PAGE
  ───────────────────────── */

  container.innerHTML = `
    <div class="team-hero">

      <div class="team-page-label">
        TEAM PROFILE
      </div>

      <h1 class="team-page-name">
  ${escapeHTML(getTeamDisplayName(team.team))}
</h1>

      <div class="team-page-subtitle">
        Rank #${team.rank} · ${team.played} games played
      </div>

    </div>

    <div class="team-stat-grid">

      <div class="team-stat">
        <div class="team-stat-label">
          ELO
        </div>

        <div class="team-stat-value">
          ${team.elo.toFixed(1)}
        </div>

        <div>
          ${eloMovement}
        </div>
      </div>

            <div class="team-stat">
        <div class="team-stat-label">
          WINS
        </div>

        <div class="team-stat-value">
          ${team.wins}
        </div>
      </div>

      <div class="team-stat">
        <div class="team-stat-label">
          LOSSES
        </div>

        <div class="team-stat-value">
          ${team.losses}
        </div>
      </div>

      <div class="team-stat">
        <div class="team-stat-label">
          DRAWS
        </div>

        <div class="team-stat-value">
          ${team.draws}
        </div>
      </div>

      <div class="team-stat">
        <div class="team-stat-label">
          POINT DIFF
        </div>

        <div class="team-stat-value ${
          team.diff > 0
            ? "positive"
            : team.diff < 0
            ? "negative"
            : ""
        }">
          ${team.diff > 0 ? "+" : ""}${team.diff}
        </div>
      </div>

      <div class="team-stat">
        <div class="team-stat-label">
          WIN %
        </div>

        <div class="team-stat-value">
          ${(team.winPercent * 100).toFixed(1)}%
        </div>
      </div>

    </div>

    ${buildTeamEloGraph(teamName, eloHistory)}

    <div class="card">

      <div class="section-title">
        RECENT FORM
      </div>

      <h2>
        Last 5 Games
      </h2>

      <div class="team-form-large">
        ${formHTML}
      </div>

    </div>

    <div class="card">

      <div class="section-title">
        MATCH HISTORY
      </div>

      <h2>
        Completed Games
      </h2>

      <div class="team-match-history">
        ${matchHTML}
      </div>

    </div>

    <div class="card">

      <div class="section-title">
        ELO HISTORY
      </div>

      <h2>
        Rating Changes
      </h2>

      <div class="team-elo-history">
        ${eloHistoryHTML}
      </div>

    </div>
  `;
  loadPublishedTeamPage(teamName, container, team);
}
 

/* =========================================================
   CSV PARSER
========================================================= */


function parseCSV(text) {

  const rows = [];

  let row = [];
  let value = "";
  let insideQuotes = false;


  for (
    let i = 0;
    i < text.length;
    i++
  ) {

    const char =
      text[i];

    const next =
      text[i + 1];


    if (
      char === '"' &&
      insideQuotes &&
      next === '"'
    ) {

      value += '"';
      i++;

      continue;
    }


    if (
      char === '"'
    ) {

      insideQuotes =
        !insideQuotes;

      continue;
    }


    if (
      char === "," &&
      !insideQuotes
    ) {

      row.push(value);
      value = "";

      continue;
    }


    if (
      (
        char === "\n" ||
        char === "\r"
      ) &&
      !insideQuotes
    ) {

      if (
        char === "\r" &&
        next === "\n"
      ) {
        i++;
      }


      row.push(value);
      value = "";


      if (
        row.some(
          cell =>
            cell.trim() !== ""
        )
      ) {

        rows.push(row);

      }


      row = [];

      continue;

    }


    value += char;

  }


  if (
    value !== "" ||
    row.length > 0
  ) {

    row.push(value);


    if (
      row.some(
        cell =>
          cell.trim() !== ""
      )
    ) {

      rows.push(row);

    }

  }


  return rows;

}


/* =========================================================
   LOAD GOOGLE SHEET
========================================================= */


async function overlayMatchResultsFromApi_() {
  try {
    const response = await readCommunityApi("getMatchResults");
    if (!response?.ok || !Array.isArray(response.results)) return;
    response.results.forEach(result => {
      const id = Number(result.matchId), home = Number(result.homeScore), away = Number(result.awayScore);
      if (!Number.isInteger(id) || !Number.isInteger(home) || !Number.isInteger(away) ||
          home < 0 || away < 0 || result.homeScore === null || result.awayScore === null) return;
      if (!games.some(item => Number(item.id) === id)) return;
      scores[id] = { home, away };
    });
  } catch (error) { console.warn("Could not overlay official results from the community API:", error); }
}

async function loadScoresFromSheet() {

  try {

    const response =
      await fetch(
        SHEET_URL +
        "&cacheBust=" +
        Date.now()
      );


    if (!response.ok) {

      throw new Error(
        `HTTP ${response.status}`
      );

    }


    const csv =
      await response.text();


    const rows =
      parseCSV(csv);


    if (
      rows.length < 2
    ) {

      throw new Error(
        "No game data found"
      );

    }


    Object.keys(scores)
      .forEach(id => {

        delete scores[id];

      });


    rows
      .slice(1)
      .forEach(row => {

        if (
          !row ||
          row.length < 5
        ) {
          return;
        }


        const gameId =
          Number(
            String(
              row[0]
            ).trim()
          );


        if (
          !Number.isInteger(
            gameId
          )
        ) {
          return;
        }


        let game =
  games.find(
    g =>
      g.id === gameId
  );

if (!game) {

  game = {
    id: gameId,
    home: "",
    away: "",
    stage: "REGULAR"
  };

  games.push(game);
}


        /*
          IMPORTANT:
          Read team names from the Sheet too.
        */

        const sheetHome =
          String(
            row[1] ?? ""
          ).trim();


        const sheetAway =
          String(
            row[3] ?? ""
          ).trim();
          const sheetStage =
             String(
             row[5] ?? "REGULAR"
            )
            .trim()
            .toUpperCase();

game.stage =
  sheetStage || "REGULAR";

game.referee =
  String(row[6] ?? "").trim();

        if (
          sheetHome !== ""
        ) {

          game.home =
            sheetHome;

        }


        if (
          sheetAway !== ""
        ) {

          game.away =
            sheetAway;

        }


        const homeScore =
          String(
            row[2] ?? ""
          ).trim();


        const awayScore =
          String(
            row[4] ?? ""
          ).trim();


        if (
          homeScore === "" ||
          awayScore === ""
        ) {
          return;
        }


        const homeNumber =
          Number(homeScore);


        const awayNumber =
          Number(awayScore);


        if (
          !Number.isFinite(
            homeNumber
          ) ||
          !Number.isFinite(
            awayNumber
          )
        ) {
          return;
        }


        scores[gameId] = {

          home:
            homeNumber,

          away:
            awayNumber

        };

      });


    await overlayMatchResultsFromApi_();

    await overlayMatchResultsFromApi_();

    calculate();
    renderGames();
    renderFinalsPage();
    if (typeof renderMatchCentre === "function") renderMatchCentre();

    showSheetStatus(true);


  }

  catch (error) {

    console.error(
      "Could not load Google Sheet:",
      error
    );


    calculate();
    renderGames();
    renderFinalsPage();
    if (typeof renderMatchCentre === "function") renderMatchCentre();

    showSheetStatus(false);

  }

}


/* =========================================================
   SHEET STATUS
========================================================= */

function showSheetStatus(
  connected
) {

  let status =
    document.getElementById(
      "sheet-status"
    );


  if (!status) {

    status =
      document.createElement(
        "div"
      );

    status.id =
      "sheet-status";

    status.style.textAlign =
      "center";

    status.style.fontSize =
      "12px";

    status.style.marginTop =
      "10px";

    status.style.opacity =
      "0.7";


    const gamesContainer =
      document.getElementById(
        "games"
      );


    if (gamesContainer) {

      gamesContainer
        .parentElement
        .appendChild(
          status
        );

    }

    else {

      document.body
        .appendChild(
          status
        );

    }

  }


  if (connected) {

    status.textContent =
      "Results are up to date";

    status.style.color =
      "#52d273";

  }

  else {

    status.textContent =
      "Results are currently unavailable";

    status.style.color =
      "#ff5964";

  }

}


/* =========================================================
   MAIN CALCULATION
========================================================= */

function renderHomeSpotlight() {
  const latestContainer = document.getElementById("home-latest-results");
  const upcomingContainer = document.getElementById("home-upcoming-matches");
  if (!latestContainer || !upcomingContainer) return;

  const regular = getActiveRegularGames();
  const upcoming = regular.filter(game => !isPlayed(game)).sort((a, b) => a.id - b.id).slice(0, 4);

  const renderMatch = (game, played) => {
    const score = played ? scores[game.id] : null;
    const winner = played
      ? (Number(score.home) === Number(score.away) ? "Draw" : Number(score.home) > Number(score.away) ? game.home : game.away)
      : null;
    return `<button type="button" class="home-match-item" data-match-id="${Number(game.id)}">
      <span class="home-match-number">GAME ${Number(game.id)}</span>
      <span class="home-match-teams">
        <span class="${winner === game.home ? "home-match-winner" : ""}">${escapeHTML(getTeamDisplayName(game.home || "TBD"))}</span>
        <span class="home-match-versus">${played ? escapeHTML(String(score.home)) + " – " + escapeHTML(String(score.away)) : "VS"}</span>
        <span class="${winner === game.away ? "home-match-winner" : ""}">${escapeHTML(getTeamDisplayName(game.away || "TBD"))}</span>
      </span>
      <span class="home-match-arrow" aria-hidden="true">↗</span>
    </button>`;
  };

  upcomingContainer.innerHTML = upcoming.length
    ? upcoming.map(game => renderMatch(game, false)).join("")
    : '<div class="home-empty-state">All regular-season matches have been played.</div>';

  document.querySelectorAll("#home-upcoming-matches .home-match-item").forEach(button => {
    button.addEventListener("click", () => {
      const id = Number(button.dataset.matchId);
      if (typeof openMatchDetail === "function") {
        showPage("matches");
        openMatchDetail(id);
      } else {
        jumpToGame(id);
      }
    });
  });
}

function calculate() {

  const elo =
    calculateElo();


  const ladder =
    calculateLadder(
      elo.finalRatings
    );


  renderLadder(
    ladder
  );


  renderEloTable(
    elo.rows
  );


  updateGameResults();
  renderHomeSpotlight();


  if (
    currentPage !== "home" &&
    currentPage !== "matches" &&
    currentPage !== "finals" &&
    currentPage !== "admin"
  ) {

    renderTeamPage(
      getTeamNameFromPage(
        currentPage
      )
    );

  }

}


/* =========================================================
   START
========================================================= */

let socialFeedPosts = [];
let socialFeedFilter = "All posts";
renderAdminPage();
loadScoresFromSheet();
loadCommunitySettings();
loadSharedCompetitionSettings();
loadSocialFeed();


/* PUBLIC SOCIAL FEED */
function formatSocialDate(value) {
  if (!value) return "Recently";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
async function loadSocialFeed() {
  const feed = document.getElementById("social-feed");
  const count = document.getElementById("social-feed-count");
  if (!feed) return;
  try {
    const result = await readCommunityApi("getSocialPosts");
    if (!result || result.ok !== true || !Array.isArray(result.posts)) throw new Error(result?.error || "Feed unavailable.");
    socialFeedPosts = result.posts;
    renderSocialFeed();
    refreshRenderedTeamNews();
  } catch (error) {
    feed.innerHTML = '<div class="social-feed-empty"><strong>News feed unavailable</strong><span>The feed service may need to be deployed or configured.</span><button type="button" class="admin-button" id="socialFeedRetry">TRY AGAIN</button></div>';
    if (count) count.textContent = "Connection unavailable";
    document.getElementById("socialFeedRetry")?.addEventListener("click", loadSocialFeed);
    console.error("Could not load Socials:", error);
  }
}
function renderSocialFeed() {
  const feed = document.getElementById("social-feed");
  const count = document.getElementById("social-feed-count");
  if (!feed) return;
  const posts = socialFeedPosts
    .filter(p => socialFeedFilter === "All posts" || p.category === socialFeedFilter)
    .slice()
    .sort((a, b) => {
      // Official communications always lead the feed; featured team posts follow.
      const officialPriority = Number(b.teamId === "OFFICIAL") - Number(a.teamId === "OFFICIAL");
      if (officialPriority) return officialPriority;
      const featuredPriority = Number(Boolean(b.featured)) - Number(Boolean(a.featured));
      if (featuredPriority) return featuredPriority;
      const dateA = new Date(a.publishedAt || 0).getTime() || 0;
      const dateB = new Date(b.publishedAt || 0).getTime() || 0;
      return dateB - dateA;
    });
  if (count) count.textContent = socialFeedPosts.length + (socialFeedPosts.length === 1 ? " published story" : " published stories");
  if (!posts.length) {
    feed.innerHTML = '<div class="social-feed-empty"><strong>No stories here yet</strong><span>Published announcements and match reports will appear here after moderation.</span></div>';
    return;
  }
  feed.innerHTML = posts.map(post => {
    const identity = post.teamId === "OFFICIAL"
      ? '<span class="social-official-crest" aria-hidden="true"><svg viewBox="0 0 240 250" fill="none"><path d="M120 18L204 48V112C204 165 171 207 120 232C69 207 36 165 36 112V48L120 18Z" fill="#0A1728" stroke="#E0B95A" stroke-width="9"/><path d="M66 145L96 85H112L82 145H66Z" fill="#F4D57F"/><path d="M96 145L126 85H142L112 145H96Z" fill="#6EBCE7"/><path d="M126 145L156 85H172L142 145H126Z" fill="#F4D57F"/><path d="M74 160H166" stroke="#E0B95A" stroke-width="4" stroke-linecap="round"/></svg></span><strong>Competition Official</strong><span class="social-verified-label">OFFICIAL</span>'
      : '<span class="social-team-dot">' + escapeHTML(post.teamId || "") + '</span><strong>' + escapeHTML(getTeamDisplayName("Team " + post.teamId) || ("Team " + post.teamId)) + '</strong><span class="social-author-context">Competition team</span>';
    return '<article class="social-post' + (post.featured ? ' is-featured' : '') + '">' +
      '<div class="social-post-content">' +
        '<div class="social-post-byline">' + identity + '<span class="social-post-date">' + escapeHTML(formatSocialDate(post.publishedAt)) + '</span></div>' +
        '<div class="social-post-meta">' + (post.featured ? '<span class="social-featured-label"><span aria-hidden="true">◆</span> FEATURED</span>' : '') + '<span class="social-category">' + escapeHTML(post.category || "Team news") + '</span></div>' +
        '<h3>' + escapeHTML(post.title) + '</h3>' +
        '<p>' + escapeHTML(post.body).replace(/\n/g, "<br>") + '</p>' +
      '</div></article>';
  }).join("");
}
function positionSocialFilterIndicator(container, button, previousRect = null) {
  if (!container || !button) return;
  let indicator = container.querySelector(".social-filter-indicator");
  if (!indicator) {
    indicator = document.createElement("span");
    indicator.className = "social-filter-indicator";
    indicator.setAttribute("aria-hidden", "true");
    container.appendChild(indicator);
  }
  const containerRect = container.getBoundingClientRect();
  const target = { left: button.offsetLeft + 13, top: button.offsetTop + button.offsetHeight - 3, width: Math.max(0, button.offsetWidth - 26) };
  indicator.style.transition = "none";
  if (previousRect) {
    indicator.style.left = (previousRect.left - containerRect.left) + "px";
    indicator.style.top = (previousRect.top - containerRect.top) + "px";
    indicator.style.width = previousRect.width + "px";
    void indicator.offsetWidth;
    requestAnimationFrame(() => {
      indicator.style.transition = "";
      indicator.style.left = target.left + "px";
      indicator.style.top = target.top + "px";
      indicator.style.width = target.width + "px";
    });
  } else {
    indicator.style.left = target.left + "px";
    indicator.style.top = target.top + "px";
    indicator.style.width = target.width + "px";
  }
}
const socialFilterContainer = document.querySelector("#socials-page .social-feed-filters");
if (socialFilterContainer) {
  positionSocialFilterIndicator(socialFilterContainer, socialFilterContainer.querySelector("[data-social-filter].is-active"));
}
document.querySelectorAll("[data-social-filter]").forEach(button => button.addEventListener("click", () => {
  const filter = button.dataset.socialFilter || "All posts";
  if (filter === socialFeedFilter) return;
  const container = button.closest(".social-feed-filters");
  const oldIndicator = container?.querySelector(".social-filter-indicator");
  const previousRect = oldIndicator ? oldIndicator.getBoundingClientRect() : null;
  socialFeedFilter = filter;
  document.querySelectorAll("[data-social-filter]").forEach(item => item.classList.toggle("is-active", item === button));
  positionSocialFilterIndicator(container, button, previousRect);
  const feed = document.getElementById("social-feed");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  renderSocialFeed();
  if (feed && feed.animate && !reduceMotion) {
    feed.animate([{ opacity: .55, transform: "translateY(9px)" }, { opacity: 1, transform: "translateY(0)" }],
      { duration: 230, easing: "cubic-bezier(.2,.7,.25,1)" });
  }
}));

/* ADMIN SOCIAL MODERATION */
let socialModerationData = { posts: [], bans: {}, audit: [] };
let socialModerationTab = "Unviewed";
async function refreshSocialModeration() {
  const status = document.getElementById("socialModStatus");
  if (!socialAdminSessionToken) {
    if (status) status.textContent = "Moderation session unavailable. Re-lock and unlock Admin after deploying the Apps Script changes.";
    return;
  }
  if (status) status.textContent = "Refreshing moderation data…";
  try {
    const result = await readCommunityApi("getModerationQueue", { sessionToken: socialAdminSessionToken });
    if (!result || result.ok !== true) throw new Error(result?.error || "Moderation queue unavailable.");
    socialModerationData = { posts: result.posts || [], bans: result.bans || {}, audit: result.audit || [] };
    renderSocialModerationContent();
    if (status) status.textContent = "Queue refreshed from the shared spreadsheet.";
  } catch (error) {
    if (status) status.textContent = "Could not load moderation queue: " + (error?.message || "Unknown error");
  }
}
function initSocialModerationPanel() {
  document.getElementById("officialPostForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget, button = form.querySelector('button[type="submit"]'), status = document.getElementById("officialPostStatus");
    const title = document.getElementById("officialPostTitle").value.trim();
    const body = document.getElementById("officialPostBody").value.trim();
    const category = document.getElementById("officialPostCategory").value;
    if (!socialAdminSessionToken) { if (status) status.textContent = "Admin session expired. Lock and unlock Admin again."; return; }
    if (!confirm("Publish this immediately as Competition Official? It will be visible on the public Socials page.")) return;
    button.disabled = true; button.textContent = "PUBLISHING…";
    if (status) status.textContent = "Publishing and verifying the official post…";
    try {
      await postCommunityAction({ action: "submitOfficialSocialPost", sessionToken: socialAdminSessionToken, title, body, category });
      let verified = false;
      for (let attempt = 0; attempt < 6; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 650));
        const result = await readCommunityApi("getSocialPosts");
        if (result?.ok === true && Array.isArray(result.posts) && result.posts.some(post => post.teamId === "OFFICIAL" && post.title === title && post.body === body)) { verified = true; break; }
      }
      if (!verified) throw new Error("The post could not be verified in the public feed. Check the Apps Script deployment.");
      form.reset();
      if (status) status.textContent = "Published and verified on Socials as Competition Official.";
      await loadSocialFeed();
      await refreshSocialModeration();
    } catch (error) {
      if (status) status.textContent = "Could not verify publication: " + (error?.message || "Unknown error");
    } finally {
      button.disabled = false; button.textContent = "PUBLISH AS OFFICIAL";
    }
  });
  document.getElementById("socialModRefresh")?.addEventListener("click", refreshSocialModeration);
  document.querySelectorAll("[data-mod-tab]").forEach(button => button.addEventListener("click", () => {
    socialModerationTab = button.dataset.modTab;
    document.querySelectorAll("[data-mod-tab]").forEach(item => item.classList.toggle("is-active", item === button));
    renderSocialModerationContent();
  }));
  refreshSocialModeration();
}
function socialModAction(payload) {
  const status = document.getElementById("socialModStatus");
  if (status) status.textContent = "Sending moderation action…";
  return postCommunityAction({ ...payload, sessionToken: socialAdminSessionToken }).then(() =>
    new Promise(resolve => setTimeout(resolve, 650))
  ).then(refreshSocialModeration);
}
function renderSocialModerationContent() {
  const host = document.getElementById("socialModContent");
  const unviewed = socialModerationData.posts.filter(p => p.reviewStatus !== "Viewed");
  const viewed = socialModerationData.posts.filter(p => p.reviewStatus === "Viewed");
  const count = document.getElementById("socialModUnviewedCount");
  if (count) count.textContent = String(unviewed.length);
  const navCount = document.getElementById("social-mod-nav-count");
  if (navCount) { navCount.textContent = String(unviewed.length); navCount.hidden = unviewed.length === 0; }
  if (!host) return;
  if (socialModerationTab === "Bans") {
    host.innerHTML = TEAMS.map(team => {
      const id = team.slice(-1), ban = socialModerationData.bans[id] || { banned: false, reason: "" };
      return '<article class="social-mod-ban"><div><strong>' + escapeHTML(getTeamDisplayName(team)) + '</strong><span>' + (ban.banned ? 'Posting blocked' : 'Posting enabled') + '</span>' + (ban.banned ? '<p>' + escapeHTML(ban.reason || "No reason recorded") + '</p>' : '') + '</div><button type="button" class="admin-button" data-ban-team="' + id + '" data-ban-state="' + (!ban.banned) + '">' + (ban.banned ? 'LIFT BAN' : 'BAN POSTING') + '</button></article>';
    }).join("");
    host.querySelectorAll("[data-ban-team]").forEach(button => button.addEventListener("click", async () => {
      const teamId = button.dataset.banTeam, banned = button.dataset.banState === "true";
      if (banned && !confirm("Block Team " + teamId + " from submitting social posts? This does not affect fixtures, results or the team profile.")) return;
      const reason = prompt(banned ? "Reason for the posting ban:" : "Reason for lifting the posting ban:", "");
      if (reason === null) return;
      if (banned && reason.trim().length < 4) { alert("Enter a clear reason of at least four characters."); return; }
      await socialModAction({ action: "setSocialPostingBan", teamId, banned, reason });
    }));
    return;
  }
  if (socialModerationTab === "Audit") {
    host.innerHTML = socialModerationData.audit.length ? socialModerationData.audit.map(item => '<article class="social-mod-audit"><strong>' + escapeHTML(item.action) + '</strong><span>' + escapeHTML(item.timestamp) + '</span><p>' + escapeHTML([item.teamId ? (item.teamId === "OFFICIAL" ? "Competition Official" : "Team " + item.teamId) : "", item.postId ? "Post " + item.postId.slice(0, 8) : "", item.reason || ""].filter(Boolean).join(" · ")) + '</p></article>').join("") : '<div class="social-mod-empty">No moderation actions recorded yet.</div>';
    return;
  }
  const list = socialModerationTab === "Unviewed" ? unviewed : viewed;
  host.innerHTML = list.length ? list.map(post => '<article class="social-mod-post" data-post-card="' + escapeHTML(post.postId) + '"><div class="social-mod-post-top"><div><span class="social-category">' + escapeHTML(post.category) + '</span><span class="social-mod-status">' + escapeHTML(post.publicationStatus) + '</span></div><time>' + escapeHTML(formatSocialDate(post.submittedAt)) + '</time></div><h3>' + escapeHTML(post.title) + '</h3><p class="social-mod-summary">' + escapeHTML(post.body.slice(0, 170)) + (post.body.length > 170 ? "…" : "") + '</p><div class="social-mod-post-bottom"><span>Team ' + escapeHTML(post.teamId) + ' · ' + escapeHTML(post.reviewStatus) + '</span><button type="button" class="admin-button" data-open-post="' + escapeHTML(post.postId) + '">OPEN POST</button></div><div class="social-mod-detail" hidden><p>' + escapeHTML(post.body).replace(/\n/g, "<br>") + '</p>' + '<label>Moderation note <input class="admin-input" data-note-for="' + escapeHTML(post.postId) + '" maxlength="500" placeholder="Reason for rejection/removal"></label><div class="social-mod-actions"><button type="button" class="admin-button" data-decision="publish" data-post="' + escapeHTML(post.postId) + '">PUBLISH</button><button type="button" class="admin-button" data-decision="feature" data-post="' + escapeHTML(post.postId) + '">FEATURE</button><button type="button" class="admin-button" data-decision="reject" data-post="' + escapeHTML(post.postId) + '">REJECT</button>' + (post.publicationStatus === "Published" ? '<button type="button" class="admin-button" data-decision="remove" data-post="' + escapeHTML(post.postId) + '">REMOVE</button><button type="button" class="admin-button" data-decision="unfeature" data-post="' + escapeHTML(post.postId) + '">UNFEATURE</button>' : '') + '</div></div></article>').join("") : '<div class="social-mod-empty">' + (socialModerationTab === "Unviewed" ? "No unviewed posts. The inbox is behaving for once." : "No viewed posts yet.") + '</div>';
  host.querySelectorAll("[data-open-post]").forEach(button => button.addEventListener("click", async () => {
    const id = button.dataset.openPost, card = host.querySelector('[data-post-card="' + CSS.escape(id) + '"]'), detail = card?.querySelector(".social-mod-detail");
    if (!detail) return;
    detail.hidden = !detail.hidden;
    button.textContent = detail.hidden ? "OPEN POST" : "CLOSE POST";
    if (!detail.hidden) {
      const post = socialModerationData.posts.find(p => p.postId === id);
      if (post && post.reviewStatus !== "Viewed") {
        await socialModAction({ action: "markSocialPostViewed", postId: id });
        socialModerationTab = "Viewed";
        document.querySelectorAll("[data-mod-tab]").forEach(item => item.classList.toggle("is-active", item.dataset.modTab === "Viewed"));
        renderSocialModerationContent();
      }
    }
  }));
  host.querySelectorAll("[data-decision]").forEach(button => button.addEventListener("click", async () => {
    const decision = button.dataset.decision, postId = button.dataset.post;
    const note = host.querySelector('[data-note-for="' + CSS.escape(postId) + '"]')?.value.trim() || "";
    if (["reject", "remove"].includes(decision) && note.length < 4) { alert("Add a moderation reason before rejecting or removing a post."); return; }
    if (["reject", "remove"].includes(decision) && !confirm(decision.toUpperCase() + " this post?")) return;
    await socialModAction({ action: "moderateSocialPost", decision, postId, reason: note });
    if (decision === "publish" || decision === "feature") {
      socialModerationTab = "Viewed";
      document.querySelectorAll("[data-mod-tab]").forEach(item => item.classList.toggle("is-active", item.dataset.modTab === "Viewed"));
    }
  }));
}

// Animate rating-series paths on demand. Calling this after a checkbox change
// resets each path so it visibly grows from the first match to the last.
function animateEloGraphLines(root, teamsToAnimate = null) {
  if (!root) return;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  root.querySelectorAll(".elo-series-line").forEach(path => {
    // A provided set means checkbox-driven updates: leave every pre-existing
    // team line alone and animate only the newly selected team's path.
    if (teamsToAnimate && !teamsToAnimate.has(path.dataset.team)) return;

    let length = 0;
    try { length = path.getTotalLength(); } catch (_) {}
    if (!Number.isFinite(length) || length <= 0) return;

    if (path._eloDrawAnimation) path._eloDrawAnimation.cancel();
    path.style.animation = "none";
    path.style.strokeDasharray = String(length);
    path.style.strokeDashoffset = String(length);

    if (reduceMotion || typeof path.animate !== "function") {
      path.style.strokeDasharray = "none";
      path.style.strokeDashoffset = "0";
      return;
    }

    // Start from the leftmost point and reveal the SVG path in its authored
    // order, which follows the team's rating history from oldest to newest.
    void path.getBoundingClientRect();
    path._eloDrawAnimation = path.animate(
      [{ strokeDashoffset: length }, { strokeDashoffset: 0 }],
      {
        duration: 1400,
        easing: "cubic-bezier(.4,0,.2,1)",
        fill: "forwards"
      }
    );
    path._eloDrawAnimation.onfinish = () => {
      path.style.strokeDashoffset = "0";
      path.style.strokeDasharray = "none";
      path._eloDrawAnimation = null;
    };
  });
}
