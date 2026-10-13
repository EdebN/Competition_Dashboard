let matchCentreFilter = "all", selectedMatchId = null;

let matchPolls = {};
let matchPollsLoaded = false;
let matchPollsLoading = false;
let matchPollsError = "";
const localVotedMatches = new Set();
function getVoterToken() {
  try {
    let token = localStorage.getItem("competitionMatchVoterToken");
    if (!token) {
      token = Array.from(crypto.getRandomValues(new Uint8Array(24))).map(v => v.toString(16).padStart(2, "0")).join("");
      localStorage.setItem("competitionMatchVoterToken", token);
    }
    return token;
  } catch (error) {
    return Array.from(crypto.getRandomValues(new Uint8Array(24))).map(v => v.toString(16).padStart(2, "0")).join("");
  }
}
function loadMatchPolls() {
  if (matchPollsLoading) return;
  matchPollsLoading = true;
  readCommunityApi("getMatchPolls").then(response => {
    if (!response || response.ok !== true || !response.polls) throw new Error(response?.error || "Poll totals unavailable.");
    matchPolls = response.polls; matchPollsLoaded = true; matchPollsError = "";
  }).catch(error => { matchPollsError = error?.message || "Polls are temporarily unavailable."; })
  .finally(() => { matchPollsLoading = false; if (typeof renderMatchCentre === "function") renderMatchCentre(); });
}
function getMatchPrediction(g) {
  const e = matchElo(g), a = Number(e?.preA), b = Number(e?.preB);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return { home: 50, away: 50 };
  const home = 100 / (1 + Math.pow(10, (b - a) / 400));
  return { home, away: 100 - home };
}
function getPollCounts(g) {
  const row = matchPolls[String(g.id)] || {};
  const home = Number(row[String(g.home || "").slice(-1)] || 0), away = Number(row[String(g.away || "").slice(-1)] || 0);
  return { home, away, total: home + away };
}
function hasVoted(g) {
  try { return localVotedMatches.has(String(g.id)) || localStorage.getItem("competitionMatchVoted:" + g.id) === "1"; }
  catch (error) { return localVotedMatches.has(String(g.id)); }
}
function getSavedVote(matchId) {
  try { return String(localStorage.getItem("competitionMatchVote:" + matchId) || "").toUpperCase(); }
  catch (error) { return ""; }
}
async function castMatchVote(matchId, team) {
  const g = games.find(x => Number(x.id) === Number(matchId));
  if (!g || isPlayed(g) || ![g.home, g.away].includes(team)) return;
  document.querySelectorAll('[id^="vote-' + Number(matchId) + '-"]').forEach(button => { button.disabled = true; });
  try {
    await postCommunityAction({ action: "submitMatchVote", matchId: Number(matchId), teamId: team.slice(-1), voterToken: getVoterToken() });
    localVotedMatches.add(String(matchId));
    try {
      localStorage.setItem("competitionMatchVoted:" + matchId, "1");
      localStorage.setItem("competitionMatchVote:" + matchId, team.slice(-1));
    } catch (error) {}
    await delayCommunityApi(500);
    const response = await readCommunityApi("getMatchPolls");
    if (!response || response.ok !== true) throw new Error("Vote sent, but totals could not be refreshed.");
    matchPolls = response.polls || {}; matchPollsLoaded = true; matchPollsError = "";
  } catch (error) { matchPollsError = error?.message || "Could not submit vote."; }
  renderMatchCentre();
}
function pollMarkup(g) {
  const counts = getPollCounts(g), prediction = getMatchPrediction(g), voted = hasVoted(g), selectedVote = getSavedVote(g.id), closed = isPlayed(g);
  const pct = (n, total) => total ? Math.round(n * 100 / total) : 0;
  const bar = (name, count, total) => '<div class="poll-result"><div><span>' + escapeHTML(name) + '</span><b>' + pct(count, total) + '% <small>(' + count + ')</small></b></div><div class="poll-track"><i style="width:' + pct(count, total) + '%"></i></div></div>';
  const voteButton = team => {
    const id = String(team).slice(-1), selected = voted && selectedVote === id;
    return '<button type="button" class="' + (selected ? 'vote-selected' : '') + '" id="vote-' + Number(g.id) + '-' + id + '" onclick="castMatchVote(' + Number(g.id) + ',\'' + team + '\')">' + escapeHTML(getTeamDisplayName(team)) + (selected ? ' · Your pick' : '') + '</button>';
  };
  let actions = closed
    ? '<p class="poll-note">Voting is closed because a result is recorded.</p>'
    : '<div class="poll-vote-buttons">' + voteButton(g.home) + voteButton(g.away) + '</div>' + (voted
      ? '<p class="poll-note">' + (selectedVote ? 'Your vote is recorded. You can change it until the result is entered.' : 'Your vote is recorded. Select either team to update your vote.') + '</p>'
      : '<p class="poll-note">You can change your vote until the result is entered.</p>');
  return '<section class="card match-poll-card"><div class="section-title">COMMUNITY POLL</div><h2>Who will win?</h2><div class="poll-results">' + bar(getTeamDisplayName(g.home), counts.home, counts.total) + bar(getTeamDisplayName(g.away), counts.away, counts.total) + '</div><p class="poll-total">' + counts.total + ' vote' + (counts.total === 1 ? '' : 's') + '</p>' + (!matchPollsLoaded ? '<p class="poll-note">' + (matchPollsError ? 'Poll totals temporarily unavailable.' : 'Loading shared votes…') + '</p>' : actions) + '<div class="prediction-block"><div><span>ELO PREDICTION</span><b>' + prediction.home.toFixed(0) + '% <small>vs</small> ' + prediction.away.toFixed(0) + '%</b></div><p>Calculated from pre-match Elo ratings, not the community vote.</p></div></section>';
}

function matchRound(g) {
 const a=getActiveRegularGames(), i=a.findIndex(x=>Number(x.id)===Number(g.id));
 if(i<0)return "Finals";
 const r=Math.floor(i/2)%5+1,c=Math.floor(i/10)+1;
 return "Round "+r+(c>1?" · Cycle "+c:"");
}
function matchScore(g){return isPlayed(g)?{home:Number(scores[g.id].home),away:Number(scores[g.id].away)}:null}
function matchWinner(g){const s=matchScore(g);return !s?"":s.home>s.away?g.home:s.away>s.home?g.away:"Draw"}
function teamResult(g,t){const s=matchScore(g);if(!s)return "";const a=g.home===t?s.home:s.away,b=g.home===t?s.away:s.home;return a>b?"W":a<b?"L":"D"}
function matchElo(g){
 const ratings=calculateElo();
 const regularRow=ratings.rows.find(r=>Number(r.game)===Number(g.id));
 if(regularRow)return regularRow;
 const stage=normalizeStage(g.stage);
 if(stage!=="FINAL"&&stage!=="GRAND FINAL")return null;
 const preA=ratings.finalRatings[g.home],preB=ratings.finalRatings[g.away];
 if(!Number.isFinite(Number(preA))||!Number.isFinite(Number(preB)))return null;
 return {game:g.id,teamA:g.home,teamB:g.away,preA:Number(preA),preB:Number(preB),postA:null,postB:null,changeA:null,changeB:null,finals:true};
}
function recentMatches(t,currentGame){
 const all=getActiveRegularGames();
 const currentIndex=all.findIndex(g=>Number(g.id)===Number(currentGame?.id));
 // Only use games scheduled up to and including this match. For finals or
 // matches outside the regular-season list, all regular-season results qualify.
 const eligible=currentIndex<0?all:all.slice(0,currentIndex+1);
 return eligible
  .filter(g=>isPlayed(g)&&(g.home===t||g.away===t))
  .slice(-5);
}
function formMarkup(t,list){
 if(!list.length)return '<div class="match-muted">No completed matches recorded.</div>';
 return '<div class="match-form-list">'+list.map(g=>'<button class="match-form-chip '+(teamResult(g,t)==="W"?"form-win":teamResult(g,t)==="L"?"form-loss":"form-draw")+'" onclick="openMatchDetail('+Number(g.id)+')" type="button"><b>'+teamResult(g,t)+'</b><small>G'+Number(g.id)+'</small></button>').join("")+'</div>';
}
function withMatchViewTransition(update) {
 const reduceMotion=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
 const page=document.getElementById("matches-page");
 if(document.startViewTransition&&!reduceMotion&&page) {
   page.style.viewTransitionName="dashboard-page";
   const transition=document.startViewTransition(update);
   transition.finished.finally(()=>{page.style.viewTransitionName="";});
 } else update();
}
function positionMatchFilterIndicator(page, previousRect = null) {
 const filters=page.querySelector(".match-filters");
 const active=filters?.querySelector(".match-filter[data-filter].active");
 if(!filters||!active)return;
 let indicator=filters.querySelector(".match-filter-indicator");
 if(!indicator){
  indicator=document.createElement("span");
  indicator.className="match-filter-indicator";
  indicator.setAttribute("aria-hidden","true");
  filters.prepend(indicator);
 }
 const rect=filters.getBoundingClientRect();
 const target={left:active.offsetLeft,top:active.offsetTop,width:active.offsetWidth,height:active.offsetHeight};
 if(previousRect){
  indicator.style.transition="none";
  indicator.style.left=(previousRect.left-rect.left)+"px";
  indicator.style.top=(previousRect.top-rect.top)+"px";
  indicator.style.width=previousRect.width+"px";
  indicator.style.height=previousRect.height+"px";
  void indicator.offsetWidth;
  requestAnimationFrame(()=>{
   indicator.style.transition="";
   indicator.style.left=target.left+"px";
   indicator.style.top=target.top+"px";
   indicator.style.width=target.width+"px";
   indicator.style.height=target.height+"px";
  });
 }else{
  indicator.style.left=target.left+"px";
  indicator.style.top=target.top+"px";
  indicator.style.width=target.width+"px";
  indicator.style.height=target.height+"px";
 }
}
function renderMatchCentre(){
 const page=document.getElementById("matches-page");if(!page)return;
 const previousIndicatorRect=page.querySelector(".match-filter-indicator")?.getBoundingClientRect()||null;
 if(selectedMatchId!==null){renderMatchDetail(selectedMatchId);return}
 const all=getActiveRegularGames(),visible=all.filter(g=>matchCentreFilter==="played"?isPlayed(g):matchCentreFilter==="upcoming"?!isPlayed(g):true);
 let rows="";
 visible.forEach(g=>{
  const s=matchScore(g),w=matchWinner(g),e=matchElo(g),num=all.findIndex(x=>x.id===g.id)+1;
  rows+='<button class="match-centre-row" type="button" onclick="openMatchDetail('+Number(g.id)+')"><span class="match-centre-number"><b>GAME '+num+'</b><small>'+escapeHTML(matchRound(g))+'</small></span><span class="match-centre-teams"><span class="'+(w===g.home?"match-team-winner":"")+'">'+escapeHTML(getTeamDisplayName(g.home||"TBD"))+'<b>'+(s?s.home:"–")+'</b></span><span class="'+(w===g.away?"match-team-winner":"")+'">'+escapeHTML(getTeamDisplayName(g.away||"TBD"))+'<b>'+(s?s.away:"–")+'</b></span>'+(g.referee?'<small>REFEREE · '+escapeHTML(getTeamDisplayName(g.referee))+'</small>':"")+'</span><span class="match-centre-summary"><b class="'+(s?"match-status-played":"match-status-upcoming")+'">'+(s?(w==="Draw"?"DRAW":"FINAL"):"UPCOMING")+'</b><small>'+(s&&e?"Elo "+e.preA.toFixed(0)+" → "+e.postA.toFixed(0):"Elo "+getMatchPrediction(g).home.toFixed(0)+"% win chance")+'</small></span><span class="match-open-arrow">›</span></button>';
 });
 page.innerHTML='<div class="match-page-heading"><div><div class="section-title">COMPETITION</div><h1 class="match-page-title">Match Centre</h1><p class="match-page-subtitle">Fixtures, results and rating changes for the competition.</p><button type="button" class="match-filter" onclick="showPage(\'finals\')">View finals →</button></div><div class="match-count"><strong>'+all.filter(isPlayed).length+'</strong><span>of '+all.length+' played</span></div></div><section class="card"><div class="match-toolbar"><div><div class="section-title">FIXTURES & RESULTS</div><h2>Regular season</h2></div><div class="match-filters"><button class="match-filter '+(matchCentreFilter==="all"?"active":"")+'" data-filter="all">All</button><button class="match-filter '+(matchCentreFilter==="played"?"active":"")+'" data-filter="played">Results</button><button class="match-filter '+(matchCentreFilter==="upcoming"?"active":"")+'" data-filter="upcoming">Upcoming</button></div></div><div class="match-centre-list">'+(rows||'<div class="empty">No matches match this filter.</div>')+'</div></section>';
 positionMatchFilterIndicator(page,previousIndicatorRect);
 page.querySelectorAll("[data-filter]").forEach(b=>b.addEventListener("click",()=>{if(matchCentreFilter===b.dataset.filter)return;matchCentreFilter=b.dataset.filter;renderMatchCentre()}));
}
function openMatchDetail(id){if(!games.some(g=>Number(g.id)===Number(id)))return;if(typeof currentPage!=="undefined"&&currentPage!=="matches"){selectedMatchId=Number(id);showPage("matches");requestAnimationFrame(()=>withMatchViewTransition(()=>renderMatchDetail(id)));return;}withMatchViewTransition(()=>{selectedMatchId=Number(id);renderMatchDetail(id)})}
function renderMatchDetail(id){
 const page=document.getElementById("matches-page"),g=games.find(x=>Number(x.id)===Number(id));if(!page||!g){selectedMatchId=null;renderMatchCentre();return}
 const s=matchScore(g),w=matchWinner(g),e=matchElo(g),home=getTeamDisplayName(g.home||"TBD"),away=getTeamDisplayName(g.away||"TBD");
 const meetings=getActiveRegularGames().filter(x=>isPlayed(x)&&((x.home===g.home&&x.away===g.away)||(x.home===g.away&&x.away===g.home))).sort((a,b)=>Number(a.id)-Number(b.id));
 let hw=0,aw=0,d=0;meetings.forEach(x=>{const z=matchWinner(x);if(z==="Draw")d++;else if(z===g.home)hw++;else if(z===g.away)aw++});
 const recentH=recentMatches(g.home,g),recentA=recentMatches(g.away,g),hc=s&&e&&!e.finals?e.changeA:null,ac=s&&e&&!e.finals?e.changeB:null;
 const ch=v=>v===null?"Pending":(v>0?"+":"")+v.toFixed(2);
 const history=meetings.slice(-4).reverse().map(x=>{const z=matchScore(x),win=matchWinner(x);return '<button onclick="openMatchDetail('+Number(x.id)+')" type="button"><span>GAME '+Number(x.id)+'</span><b>'+z.home+' – '+z.away+'</b><small>'+(win==="Draw"?"DRAW":escapeHTML(getTeamDisplayName(win))+" WON")+'</small></button>'}).join("");
 page.innerHTML='<div class="match-detail-topline"><button id="matchBack" class="match-back-button">‹ ALL MATCHES</button><span class="match-detail-status '+(s?"match-status-played":"match-status-upcoming")+'">'+(s?(w==="Draw"?"MATCH DRAWN":"MATCH COMPLETE"):"AWAITING RESULT")+'</span></div>'+
 '<section class="match-detail-hero card"><div class="section-title">'+escapeHTML(normalizeStage(g.stage)||"REGULAR")+' SEASON</div><div class="match-detail-meta">GAME '+Number(g.id)+' · '+escapeHTML(matchRound(g))+(g.referee?' · REFEREE: '+escapeHTML(getTeamDisplayName(g.referee)):"")+'</div><div class="match-scoreboard"><div class="match-detail-team '+(s&&w===g.home?"match-detail-winner":"")+'"><span class="match-team-initial">'+escapeHTML(String(g.home||"?").slice(-1))+'</span><h2>'+escapeHTML(home)+'</h2><div class="match-team-rating">'+(e?(s&&!e.finals?e.postA:e.preA).toFixed(2):START_ELO.toFixed(2))+'<small>ELO '+(s&&!e.finals?"AFTER":"BEFORE")+'</small></div></div><div class="match-detail-score"><div class="match-score-numbers"><span>'+(s?s.home:"–")+'</span><i>:</i><span>'+(s?s.away:"–")+'</span></div><div class="match-score-caption">'+(s?(w==="Draw"?"DRAW":escapeHTML(getTeamDisplayName(w))+" WON"):"VS")+'</div></div><div class="match-detail-team '+(s&&w===g.away?"match-detail-winner":"")+'"><span class="match-team-initial">'+escapeHTML(String(g.away||"?").slice(-1))+'</span><h2>'+escapeHTML(away)+'</h2><div class="match-team-rating">'+(e?(s&&!e.finals?e.postB:e.preB).toFixed(2):START_ELO.toFixed(2))+'<small>ELO '+(s&&!e.finals?"AFTER":"BEFORE")+'</small></div></div></div></section>'+
 '<div class="match-detail-grid">'+pollMarkup(g)+'<section class="card"><div class="section-title">RATING CHANGE</div><h2>Elo before & after</h2><div class="match-elo-table"><div class="match-elo-head"><span>TEAM</span><span>BEFORE</span><span>CHANGE</span><span>AFTER</span></div><div><span>'+escapeHTML(home)+'</span><b>'+(e?e.preA.toFixed(2):"—")+'</b><b class="'+(hc===null?"":hc>=0?"positive":"negative")+'">'+ch(hc)+'</b><b>'+(s&&e&&!e.finals?e.postA.toFixed(2):"—")+'</b></div><div><span>'+escapeHTML(away)+'</span><b>'+(e?e.preB.toFixed(2):"—")+'</b><b class="'+(ac===null?"":ac>=0?"positive":"negative")+'">'+ch(ac)+'</b><b>'+(s&&e&&!e.finals?e.postB.toFixed(2):"—")+'</b></div></div><p class="match-footnote">'+(e&&e.finals?"Pre-finals ratings use each team’s end-of-regular-season rating. Finals matches do not currently update ratings.":s?"Uses the dashboard’s existing Elo calculation.":"Elo changes appear when both scores are recorded in Google Sheets.")+'</p></section>'+
 '<section class="card"><div class="section-title">HEAD-TO-HEAD</div><h2>Previous meetings</h2><div class="h2h-score"><b>'+hw+'</b><span>WINS</span><i>:</i><b>'+aw+'</b><span>WINS</span></div><div class="h2h-subline">'+d+' draw'+(d===1?"":"s")+' · '+meetings.length+' completed meeting'+(meetings.length===1?"":"s")+' this regular season</div><div class="h2h-history">'+(history||'<div class="match-muted">No previous completed meetings.</div>')+'</div></section>'+
 '<section class="card"><div class="section-title">RECENT FORM</div><h2>'+escapeHTML(home)+'</h2>'+formMarkup(g.home,recentH)+'</section><section class="card"><div class="section-title">RECENT FORM</div><h2>'+escapeHTML(away)+'</h2>'+formMarkup(g.away,recentA)+'</section></div>';
 document.getElementById("matchBack").addEventListener("click",()=>withMatchViewTransition(()=>{selectedMatchId=null;renderMatchCentre()}));
}
document.addEventListener("DOMContentLoaded",()=>{renderMatchCentre();loadMatchPolls();});
