(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[c]);
  const API_URL = "https://script.google.com/macros/s/AKfycbw77wOi2EhaSUkWHwiyowOIFieZqlNCFkDO-s6AUa5X63jbDs5m6n8F0lrsjIouwfHC/exec";
  const titles = {overview:"Overview",moderation:"Moderation",competition:"Competition",matchday:"Matchday & email",access:"Team access",bugs:"Bugs & reports",console:"System console"};
  const events = [];
  let clientErrors = 0;
  let adminToken = sessionStorage.getItem("admin-control-room-token") || "";
  // Consume the one-time handoff immediately. The credential only remains in this closure's memory.
  sessionStorage.removeItem("admin-control-room-token");
  const authorized = sessionStorage.getItem("admin-control-room-authorized") === "yes" && Boolean(adminToken);
  if (!authorized) {
    sessionStorage.removeItem("admin-control-room-authorized");
    document.body.innerHTML = '<main style="min-height:100vh;display:grid;place-items:center;padding:24px;background:#0b1119;color:#edf2f8;font:15px/1.6 system-ui,-apple-system,sans-serif"><section style="width:min(100%,520px);padding:32px;border:1px solid #293747;border-radius:20px;background:#111b27;box-shadow:0 24px 80px #0005"><p style="margin:0 0 8px;color:#d9b65f;font-size:11px;font-weight:800;letter-spacing:.16em">RESTRICTED WORKSPACE</p><h1 style="margin:0;font-size:32px">Admin sign-in required</h1><p style="color:#aab8c8">Sign in through the dashboard. Direct links cannot create an authenticated session.</p><a href="index.html#admin" style="display:inline-flex;margin-top:12px;padding:13px 16px;border-radius:10px;background:#dfbd69;color:#151a20;font-weight:850;text-decoration:none">OPEN DASHBOARD SIGN-IN ↗</a></section></main>';
    return;
  }

  const shell = document.querySelector(".admin-shell");
  if (shell) shell.style.visibility = "visible";
  let moderationToken = "";
  let moderationData = null;
  let teamSettings = [];
  let reminderSettings = null;
  let clientReady = false;

  function log(level, message) {
    events.push({time:new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit"}),level,message:String(message)});
    if (events.length > 250) events.shift();
    renderConsole(); renderRecent();
    if ($("admin-error-value")) $("admin-error-value").textContent = String(clientErrors);
    if ($("admin-bug-session-count")) $("admin-bug-session-count").textContent = String(clientErrors);
  }
  function renderConsole() {
    const host = $("admin-console-output"); if (!host) return;
    host.innerHTML = events.map(e => '<div class="admin-console-line"><time>'+escapeHTML(e.time)+'</time><span class="'+(e.level==="ERROR"?"console-error":e.level==="WARN"?"console-warn":"console-info")+'">['+escapeHTML(e.level)+']</span><code>'+escapeHTML(e.message)+'</code></div>').join("");
    host.scrollTop = host.scrollHeight;
    if ($("admin-console-count")) $("admin-console-count").textContent = events.length+" EVENTS";
  }
  function renderRecent() {
    const host = $("admin-recent-events"); if (!host) return;
    host.innerHTML = events.slice(-4).reverse().map(e => '<div class="admin-event"><span class="admin-event-dot '+(e.level==="ERROR"?"is-error":e.level==="WARN"?"is-pending":"")+'"></span><div><strong>'+escapeHTML(e.level==="ERROR"?"Check failed":e.level==="WARN"?"Check warning":"System event")+'</strong><p>'+escapeHTML(e.message)+'</p></div><time>'+escapeHTML(e.time)+'</time></div>').join("");
  }
  function setStatus(id, message, kind="") {
    const el=$(id); if(!el)return;
    el.textContent=message;
    el.classList.toggle("is-warning",kind==="warning");
    el.classList.toggle("is-error",kind==="error");
  }
  function jsonp(action, params={}) {
    return new Promise((resolve,reject)=>{
      const url=new URL(API_URL), callback="__adminControlRoom_"+Date.now()+"_"+Math.random().toString(36).slice(2), script=document.createElement("script");
      let settled=false;
      const timeout=setTimeout(()=>finish(new Error("Apps Script request timed out.")),15000);
      function finish(error,data){if(settled)return;settled=true;clearTimeout(timeout);try{delete window[callback]}catch{}script.remove();error?reject(error):resolve(data);}
      window[callback]=data=>finish(null,data);
      url.searchParams.set("action",action);
      Object.entries(params).forEach(([k,v])=>{if(v!==undefined&&v!==null)url.searchParams.set(k,String(v));});
      url.searchParams.set("callback",callback);url.searchParams.set("_cacheBust",String(Date.now()));
      script.async=true;script.src=url.toString();script.onerror=()=>finish(new Error("Browser could not load the Apps Script response."));document.head.appendChild(script);
    });
  }
  async function post(payload) {
    await fetch(API_URL,{method:"POST",mode:"no-cors",headers:{"Content-Type":"text/plain;charset=UTF-8"},body:JSON.stringify(payload)});
  }
  const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
  async function retryRead(fn, attempts=6, interval=450) {
    let last;
    for(let i=0;i<attempts;i++){try{return await fn();}catch(e){last=e;}if(i<attempts-1)await delay(interval);}
    throw last || new Error("Could not verify the saved change.");
  }
  async function createModerationSession() {
    const nonce=Array.from(crypto.getRandomValues(new Uint8Array(24))).map(b=>b.toString(16).padStart(2,"0")).join("");
    await post({action:"createModerationSession",adminToken,nonce});
    const result=await retryRead(async()=>{
      const r=await jsonp("getModerationSession",{nonce});
      if(r?.ok&&r.sessionToken)return r;
      if(r?.error&&r.error!=="Session exchange pending. Try again.")throw new Error(r.error);
      throw new Error("Waiting for admin session exchange.");
    },8,350);
    moderationToken=result.sessionToken;
    log("INFO","Short-lived moderation session established.");
  }
  async function runHealth() {
    if($("admin-run-checks"))$("admin-run-checks").disabled=true;
    if($("admin-api-value"))$("admin-api-value").textContent="CHECKING";
    setStatus("admin-api-status","Checking");
    log("INFO","Checking Apps Script health and shared settings.");
    try{
      const r=await jsonp("health");
      if(!r?.ok||r.service!=="competition-community-api")throw new Error(r?.error||"Unexpected API response.");
      if($("admin-api-value"))$("admin-api-value").textContent=r.configured?"ONLINE":"CONFIG ISSUE";
      if($("admin-api-detail"))$("admin-api-detail").textContent="Build "+String(r.buildId||"unknown")+" · "+(r.actions?.length||0)+" actions advertised.";
      setStatus("admin-api-status",r.configured?"Healthy":"Configuration issue",r.configured?"":"error");
      log("INFO","API health returned build "+String(r.buildId||"unknown")+".");
      if(!r.configured)throw new Error("API is missing required Script Properties.");
    }catch(e){
      if($("admin-api-value"))$("admin-api-value").textContent="ISSUE";
      if($("admin-api-detail"))$("admin-api-detail").textContent=e.message||"Health check failed.";
      setStatus("admin-api-status","Check failed","error");log("ERROR","Health check: "+e.message);
    }
    try{
      const r=await jsonp("getTeamSettings");
      if(!r?.ok||!Array.isArray(r.teams))throw new Error(r?.error||"Invalid team settings response.");
      if($("admin-settings-value"))$("admin-settings-value").textContent="AVAILABLE";
      if($("admin-settings-detail"))$("admin-settings-detail").textContent="Five shared team records loaded from Apps Script.";
      setStatus("admin-settings-status","Read succeeded");log("INFO","Shared team settings loaded.");
    }catch(e){
      if($("admin-settings-value"))$("admin-settings-value").textContent="UNAVAILABLE";
      if($("admin-settings-detail"))$("admin-settings-detail").textContent=e.message;
      setStatus("admin-settings-status","Read failed","error");log("ERROR","Shared settings: "+e.message);
    }
    if($("admin-run-checks"))$("admin-run-checks").disabled=false;
  }
  function showView(name) {
    if(!titles[name])return;
    document.querySelectorAll("[data-admin-panel]").forEach(p=>p.classList.toggle("is-active",p.dataset.adminPanel===name));
    document.querySelectorAll("[data-admin-view]").forEach(b=>b.classList.toggle("is-active",b.dataset.adminView===name));
    if($("admin-breadcrumb-current"))$("admin-breadcrumb-current").textContent=titles[name];
    document.title=titles[name]+" · Admin Control Room";
    if(name==="console")renderConsole();
    if(!clientReady)return;
    if(name==="moderation")loadModeration();
    if(name==="competition")loadCompetition();
    if(name==="matchday")loadMatchday();
    if(name==="access")loadTeamAccess();
  }

  async function loadCompetition() {
    setStatus("admin-team-settings-status","Loading shared team settings…");
    try {
      const [teams,season]=await Promise.all([jsonp("getTeamSettings"),jsonp("getCompetitionSettings")]);
      if(!teams?.ok||!Array.isArray(teams.teams))throw new Error(teams?.error||"Could not load team settings.");
      teamSettings=teams.teams;
      $("admin-team-settings-fields").innerHTML=teamSettings.map(t=>'<div class="admin-team-setting-row" style="display:grid;grid-template-columns:minmax(90px,.45fr) minmax(150px,1fr) 110px 110px;gap:10px;align-items:end;margin:12px 0"><label>Team '+escapeHTML(t.teamId)+' name<input class="admin-input" id="admin-name-'+escapeHTML(t.teamId)+'" maxlength="30" required value="'+escapeHTML(t.displayName)+'"></label><label>Primary colour<input class="admin-input" id="admin-primary-'+escapeHTML(t.teamId)+'" type="text" placeholder="#3366FF" pattern="#[0-9a-fA-F]{6}" value="'+escapeHTML(t.primaryColor||"")+'"></label><label>Secondary<input class="admin-input" id="admin-secondary-'+escapeHTML(t.teamId)+'" type="text" placeholder="#FFFFFF" pattern="#[0-9a-fA-F]{6}" value="'+escapeHTML(t.secondaryColor||"")+'"></label><label>Logo URL<input class="admin-input" id="admin-logo-'+escapeHTML(t.teamId)+'" type="url" placeholder="https://" value="'+escapeHTML(t.logoUrl||"")+'"></label></div>').join("");
      if(season?.ok&&$("admin-games-per-team"))$("admin-games-per-team").value=String(season.gamesPerTeam);
      setStatus("admin-team-settings-status","Loaded from shared Google Sheets settings.");
      setStatus("admin-season-status",season?.ok?"Current shared season length loaded.":(season?.error||"Could not read season length."),season?.ok?"":"error");
      log("INFO","Competition settings loaded.");
    }catch(e){setStatus("admin-team-settings-status",e.message,"error");setStatus("admin-season-status",e.message,"error");log("ERROR","Competition settings failed: "+e.message);}
  }
  async function saveTeamSettings(event) {
    event.preventDefault();
    const teams=["A","B","C","D","E"].map(teamId=>({
      teamId,displayName:$("admin-name-"+teamId).value.trim(),
      primaryColor:$("admin-primary-"+teamId).value.trim(),
      secondaryColor:$("admin-secondary-"+teamId).value.trim(),
      logoUrl:$("admin-logo-"+teamId).value.trim()
    }));
    const button=$("admin-team-settings-form").querySelector('button[type="submit"]');button.disabled=true;
    setStatus("admin-team-settings-status","Saving settings and verifying the shared values…");
    try{
      await post({action:"updateTeamSettings",adminToken,teams});
      const saved=await retryRead(async()=>{const r=await jsonp("getTeamSettings");if(!r?.ok||!Array.isArray(r.teams))throw new Error(r?.error||"Could not verify saved settings.");const ok=teams.every(t=>{const x=r.teams.find(y=>y.teamId===t.teamId);return x&&x.displayName===t.displayName&&x.primaryColor===t.primaryColor&&x.secondaryColor===t.secondaryColor&&x.logoUrl===t.logoUrl;});if(!ok)throw new Error("The API has not returned the new values yet.");return r;});
      teamSettings=saved.teams;setStatus("admin-team-settings-status","Saved and verified. Public team labels use the updated settings.");log("INFO","Team names and branding saved and verified.");
    }catch(e){setStatus("admin-team-settings-status",e.message,"error");log("ERROR","Team settings save failed: "+e.message);}
    finally{button.disabled=false;}
  }
  async function saveSeason(event) {
    event.preventDefault();const value=Number($("admin-games-per-team").value);
    if(!Number.isInteger(value)||value<3||value>32){setStatus("admin-season-status","Enter a whole number from 3 to 32.","error");return;}
    const button=$("admin-season-form").querySelector('button[type="submit"]');button.disabled=true;setStatus("admin-season-status","Saving and verifying season length…");
    try{
      await post({action:"updateCompetitionSettings",adminToken,gamesPerTeam:value});
      await retryRead(async()=>{const r=await jsonp("getCompetitionSettings");if(!r?.ok||Number(r.gamesPerTeam)!==value)throw new Error(r?.error||"Waiting for the saved value.");return r;});
      setStatus("admin-season-status","Saved and verified: "+value+" regular-season games per team.");log("INFO","Season length saved and verified.");
    }catch(e){setStatus("admin-season-status",e.message,"error");log("ERROR","Season length save failed: "+e.message);}
    finally{button.disabled=false;}
  }

  function renderModeration(data) {
    moderationData=data;
    const posts=Array.isArray(data.posts)?data.posts:[];
    const pending=posts.filter(p=>String(p.publicationStatus||p.status||"Pending")==="Pending" && !["Rejected","Removed"].includes(String(p.reviewStatus||"")));
    const bans=data.bans||{};
    if($("admin-mod-value"))$("admin-mod-value").textContent=String(pending.length)+" PENDING";
    if($("admin-mod-pending-count"))$("admin-mod-pending-count").textContent=String(pending.length);
    if($("admin-mod-ban-count"))$("admin-mod-ban-count").textContent=String(Object.values(bans).filter(b=>b?.banned).length);
    const host=$("admin-moderation-content");if(!host)return;
    const postCards=posts.length?posts.map(p=>{
      const id=String(p.postId||"");const status=String(p.publicationStatus||"Pending"),review=String(p.reviewStatus||"Unviewed");
      return '<article class="admin-panel-card" style="margin:12px 0"><div class="admin-panel-heading"><div><span class="admin-eyebrow">TEAM '+escapeHTML(p.teamId||"?")+' · '+escapeHTML(p.category||"Post")+'</span><h2>'+escapeHTML(p.title||"(Untitled post)")+'</h2></div><span class="admin-env-pill">'+escapeHTML(status.toUpperCase())+'</span></div><p>'+escapeHTML(p.body||"")+'</p>'+(p.imageUrl?'<p><a href="'+escapeHTML(p.imageUrl)+'" target="_blank" rel="noopener">Open attached image ↗</a></p>':"")+'<p style="color:#9aa7b7;font-size:11px">Submitted: '+escapeHTML(p.submittedAt||"Unknown")+' · Review: '+escapeHTML(review)+'</p>'+(p.moderationNote?'<p>Note: '+escapeHTML(p.moderationNote)+'</p>':"")+'<label>Decision note<input class="admin-input" id="admin-note-'+escapeHTML(id)+'" maxlength="500" placeholder="Required for reject/remove"></label><div class="admin-action-buttons" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">'+["publish","reject","remove","feature","unfeature","view"].map(a=>'<button type="button" class="admin-primary-button" data-mod-action="'+a+'" data-post-id="'+escapeHTML(id)+'">'+a.toUpperCase()+'</button>').join("")+'</div></article>';
    }).join(""):'<div class="admin-note-card">No social submissions are in the archive yet.</div>';
    const banCards=["A","B","C","D","E"].map(id=>{const b=bans[id]||{};return '<article class="admin-panel-card" style="margin:10px 0"><strong>Team '+id+'</strong><p>'+(b.banned?'Posting blocked':'Posting allowed')+(b.reason?' · '+escapeHTML(b.reason):"")+'</p><label>Reason<input class="admin-input" id="admin-ban-reason-'+id+'" maxlength="500" placeholder="Reason for changing posting access"></label><button type="button" class="admin-primary-button" data-ban-team="'+id+'" data-ban-state="'+(!b.banned)+'">'+(b.banned?'LIFT POSTING BAN':'BAN POSTING')+'</button></article>';}).join("");
    const audit=Array.isArray(data.audit)?data.audit:[];
    host.innerHTML='<h2>Submissions</h2>'+postCards+'<h2 style="margin-top:28px">Team posting access</h2>'+banCards+'<h2 style="margin-top:28px">Recent audit trail</h2>'+(audit.length?'<div class="admin-panel-card">'+audit.map(a=>'<p style="padding:8px 0;border-bottom:1px solid #27313d"><strong>'+escapeHTML(a.action)+'</strong> · Team '+escapeHTML(a.teamId||"—")+' · '+escapeHTML(a.timestamp||"")+(a.reason?' · '+escapeHTML(a.reason):"")+'</p>').join("")+'</div>':'<p class="admin-note-card">No audit events recorded.</p>');
    host.querySelectorAll("[data-mod-action]").forEach(btn=>btn.addEventListener("click",()=>moderatePost(btn)));
    host.querySelectorAll("[data-ban-team]").forEach(btn=>btn.addEventListener("click",()=>changeBan(btn)));
    setStatus("admin-moderation-status","Loaded "+posts.length+" posts, "+Object.keys(bans).length+" team access records and "+audit.length+" audit events.");
  }
  async function loadModeration() {
    setStatus("admin-moderation-status","Loading moderation queue…");
    try{
      if(!moderationToken)await createModerationSession();
      const data=await jsonp("getModerationQueue",{sessionToken:moderationToken});
      if(!data?.ok)throw new Error(data?.error||"Could not load moderation queue.");
      renderModeration(data);log("INFO","Moderation queue loaded.");
    }catch(e){setStatus("admin-moderation-status",e.message,"error");log("ERROR","Moderation queue failed: "+e.message);}
  }
  async function moderatePost(button) {
    const action=button.dataset.modAction,id=button.dataset.postId;
    if(action==="view"){
      button.disabled=true;
      try{await post({action:"markSocialPostViewed",sessionToken:moderationToken,postId:id});await delay(500);await loadModeration();}
      catch(e){setStatus("admin-moderation-status",e.message,"error");}finally{button.disabled=false;}
      return;
    }
    const reason=$("admin-note-"+id)?.value.trim()||"";
    if(["reject","remove"].includes(action)&&reason.length<4){setStatus("admin-moderation-status","Add a decision note of at least four characters before rejecting or removing a post.","error");return;}
    if(["reject","remove"].includes(action)&&!confirm(action.toUpperCase()+" this social post?"))return;
    button.disabled=true;setStatus("admin-moderation-status","Submitting moderation decision…");
    try{
      await post({action:"moderateSocialPost",sessionToken:moderationToken,postId:id,decision:action,reason});
      await delay(500);await loadModeration();log("INFO","Moderation action submitted: "+action+".");
    }catch(e){setStatus("admin-moderation-status",e.message,"error");log("ERROR","Moderation action failed: "+e.message);}
    finally{button.disabled=false;}
  }
  async function changeBan(button) {
    const teamId=button.dataset.banTeam,banned=button.dataset.banState==="true",reason=$("admin-ban-reason-"+teamId)?.value.trim()||"";
    if(banned&&reason.length<4){setStatus("admin-moderation-status","Enter a clear reason of at least four characters before banning a team.","error");return;}
    if(!confirm((banned?"Block":"Restore")+" Team "+teamId+" posting access?"))return;
    button.disabled=true;
    try{await post({action:"setSocialPostingBan",sessionToken:moderationToken,teamId,banned,reason});await delay(500);await loadModeration();log("INFO","Team "+teamId+" posting access updated.");}
    catch(e){setStatus("admin-moderation-status",e.message,"error");}finally{button.disabled=false;}
  }

  let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  function renderMatchdayCalendar(fixtures, saved) {
    const host = $("admin-timetable-fields");
    const year = calendarMonth.getFullYear(), month = calendarMonth.getMonth();
    const first = new Date(year, month, 1), startOffset = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const monthLabel = calendarMonth.toLocaleDateString(undefined, {month:"long",year:"numeric"});
    const byDate = new Map();
    let unscheduled = 0;
    fixtures.forEach(m => {
      const id = Number(m.matchId), v = saved.get(id) || {};
      if (!v.date || !/^\\d{4}-\\d{2}-\\d{2}$/.test(v.date)) { unscheduled++; return; }
      if (!byDate.has(v.date)) byDate.set(v.date, []);
      byDate.get(v.date).push({match:m,details:v});
    });
    const cells = [];
    for (let i=0;i<startOffset;i++) cells.push('<div class="admin-calendar-day is-empty" aria-hidden="true"></div>');
    for (let day=1;day<=daysInMonth;day++) {
      const date = year+"-"+String(month+1).padStart(2,"0")+"-"+String(day).padStart(2,"0");
      const items = (byDate.get(date)||[]).sort((a,b)=>String(a.details.time||"").localeCompare(String(b.details.time||"")));
      const today = date === new Date().getFullYear()+"-"+String(new Date().getMonth()+1).padStart(2,"0")+"-"+String(new Date().getDate()).padStart(2,"0");
      const eventsHTML = items.slice(0,3).map(({match,details}) => '<button type="button" class="admin-calendar-event '+(details.status==="Postponed"||details.status==="Cancelled"?"is-disrupted":"")+'" data-calendar-match="'+Number(match.matchId)+'"><span class="admin-calendar-event-time">'+escapeHTML(details.time||"Time TBC")+'</span><strong>'+escapeHTML(match.home||"Home")+' <i>vs</i> '+escapeHTML(match.away||"Away")+'</strong><small>'+escapeHTML(details.venue||"Venue TBC")+'</small></button>').join("");
      cells.push('<div class="admin-calendar-day'+(today?' is-today':'')+'" data-calendar-date="'+date+'"><div class="admin-calendar-day-number">'+day+(today?'<span>TODAY</span>':"")+'</div><div class="admin-calendar-events">'+eventsHTML+(items.length>3?'<span class="admin-calendar-more">+'+(items.length-3)+' more</span>':"")+'</div></div>');
    }
    while(cells.length%7) cells.push('<div class="admin-calendar-day is-empty" aria-hidden="true"></div>');
    host.innerHTML = '<div class="admin-calendar"><div class="admin-calendar-toolbar"><div><span class="admin-eyebrow">FIXTURE CALENDAR</span><h3>'+escapeHTML(monthLabel)+'</h3><p>'+fixtures.length+' fixtures · '+(fixtures.length-unscheduled)+' scheduled · '+unscheduled+' unscheduled</p></div><div class="admin-calendar-controls"><button type="button" data-calendar-nav="-1" aria-label="Previous month">‹</button><button type="button" data-calendar-today>Today</button><button type="button" data-calendar-nav="1" aria-label="Next month">›</button></div></div><div class="admin-calendar-weekdays">'+["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d=>'<span>'+d+'</span>').join("")+'</div><div class="admin-calendar-grid">'+cells.join("")+'</div><div class="admin-calendar-legend"><span><i></i> Scheduled fixture</span><span>Click a fixture to edit its details below</span></div></div><div class="admin-unscheduled-note"><strong>'+unscheduled+' unscheduled fixture'+(unscheduled===1?'':'s')+'</strong><span>Assign dates in “Edit fixture details” to place them on the calendar.</span></div>';
    host.querySelectorAll("[data-calendar-nav]").forEach(button=>button.addEventListener("click",()=>{calendarMonth=new Date(year,month+Number(button.dataset.calendarNav),1);renderMatchdayCalendar(fixtures,currentTimetableMap(fixtures));}));
    const todayButton=host.querySelector("[data-calendar-today]");
    if(todayButton)todayButton.addEventListener("click",()=>{calendarMonth=new Date(new Date().getFullYear(),new Date().getMonth(),1);renderMatchdayCalendar(fixtures,currentTimetableMap(fixtures));});
    host.querySelectorAll("[data-calendar-match]").forEach(button=>button.addEventListener("click",()=>{
      const row=host.querySelector('[data-timetable-row="'+Number(button.dataset.calendarMatch)+'"]');
      if(row){const details=row.closest("details");if(details)details.open=true;row.scrollIntoView({behavior:"smooth",block:"center"});row.classList.add("admin-fixture-highlight");setTimeout(()=>row.classList.remove("admin-fixture-highlight"),1800);}
    }));
  }
  function currentTimetableMap(fixtures) {
    return new Map(fixtures.map(m=>{
      const id=Number(m.matchId),row=$("admin-timetable-fields")?.querySelector('[data-timetable-row="'+id+'"]');
      return [id,row?{date:row.querySelector("[data-fixture-date]").value,time:row.querySelector("[data-fixture-time]").value,venue:row.querySelector("[data-fixture-venue]").value,status:row.querySelector("[data-fixture-status]").value}:{}];
    }));
  }

  async function loadMatchday() {
    setStatus("admin-matchday-status","Loading timetable and reminder contacts…");
    try{
      if(!moderationToken)await createModerationSession();
      const [settings,results]=await Promise.all([jsonp("getMatchReminderSettings",{sessionToken:moderationToken}),jsonp("getMatchResults")]);
      if(!settings?.ok)throw new Error(settings?.error||"Could not load reminder settings.");
      if(!results?.ok||!Array.isArray(results.results))throw new Error(results?.error||"Could not load fixture list.");
      reminderSettings=settings;
      const saved=new Map((settings.timetable||[]).map(x=>[Number(x.matchId),x]));
      const fixtures=results.results;
      renderMatchdayCalendar(fixtures, saved);
      $("admin-timetable-fields").insertAdjacentHTML("beforeend", '<details class="admin-fixture-editor"><summary>Edit fixture details</summary><div class="admin-timetable-table-wrap" style="overflow:auto"><table class="admin-timetable-table" style="width:100%;min-width:760px;border-collapse:collapse"><thead><tr><th>Game</th><th>Fixture</th><th>Date</th><th>Time</th><th>Venue</th><th>Status</th></tr></thead><tbody>'+fixtures.map(m=>{
        const id=Number(m.matchId),v=saved.get(id)||{date:"",time:"",venue:"",status:"Unscheduled"};
        return '<tr data-timetable-row="'+id+'"><td>'+id+'</td><td>'+escapeHTML(m.home||"Home")+' vs '+escapeHTML(m.away||"Away")+'</td><td><input class="admin-input" type="date" data-fixture-date="'+id+'" value="'+escapeHTML(v.date||"")+'"></td><td><input class="admin-input" type="time" data-fixture-time="'+id+'" value="'+escapeHTML(v.time||"")+'"></td><td><input class="admin-input" data-fixture-venue="'+id+'" maxlength="120" value="'+escapeHTML(v.venue||"")+'" placeholder="Venue"></td><td><select class="admin-input" data-fixture-status="'+id+'">'+["Unscheduled","Scheduled","Postponed","Cancelled","Skipped"].map(st=>'<option'+(st===(v.status||"Unscheduled")?' selected':'')+'>'+st+'</option>').join("")+'</select></td></tr>';
      }).join("")+'</tbody></table></div></details>');
      $("admin-timetable-fields").querySelectorAll("[data-fixture-date]").forEach(input=>input.addEventListener("change",()=>renderMatchdayCalendar(fixtures, new Map(fixtures.map(m=>{const row=$("admin-timetable-fields").querySelector('[data-timetable-row="'+Number(m.matchId)+'"]');return [Number(m.matchId),{date:row.querySelector("[data-fixture-date]").value,time:row.querySelector("[data-fixture-time]").value,venue:row.querySelector("[data-fixture-venue]").value,status:row.querySelector("[data-fixture-status]").value}]}))));
      $("admin-reminder-contact-fields").innerHTML=(settings.contacts||[]).map(c=>'<div class="admin-panel-card" style="margin:10px 0"><label>Team '+escapeHTML(c.teamId)+' email addresses<textarea class="admin-input" data-contact-emails="'+escapeHTML(c.teamId)+'" rows="3" placeholder="one@example.com, another@example.com">'+escapeHTML((c.emails||[]).join("\n"))+'</textarea></label><label style="display:flex;gap:8px;align-items:center;margin-top:8px"><input type="checkbox" data-contact-enabled="'+escapeHTML(c.teamId)+'" '+(c.enabled?'checked':'')+'> Send match-day reminders to this team</label></div>').join("");
      setStatus("admin-matchday-status","Loaded "+fixtures.length+" fixtures and five team contact settings.");
    }catch(e){setStatus("admin-matchday-status",e.message,"error");log("ERROR","Matchday settings failed: "+e.message);}
  }
  async function saveMatchday(event) {
    event.preventDefault();const fixtures=[...document.querySelectorAll("[data-timetable-row]")].map(row=>{
      const matchId=Number(row.dataset.timetableRow);
      return {matchId,date:row.querySelector("[data-fixture-date]").value,time:row.querySelector("[data-fixture-time]").value,venue:row.querySelector("[data-fixture-venue]").value.trim(),status:row.querySelector("[data-fixture-status]").value};
    });
    const contacts=["A","B","C","D","E"].map(teamId=>({teamId,emails:document.querySelector('[data-contact-emails="'+teamId+'"]').value.split(/[\n,;]+/).map(x=>x.trim()).filter(Boolean),enabled:document.querySelector('[data-contact-enabled="'+teamId+'"]').checked}));
    const button=$("admin-matchday-form").querySelector('button[type="submit"]');button.disabled=true;setStatus("admin-matchday-status","Saving timetable and recipients…");
    try{
      await post({action:"saveMatchReminderSettings",adminToken,timetable:fixtures,contacts});
      await retryRead(async()=>{
        const r=await jsonp("getMatchReminderSettings",{sessionToken:moderationToken});
        if(!r?.ok)throw new Error(r?.error||"Could not verify saved timetable.");
        const matches=fixtures.every(f=>{const x=(r.timetable||[]).find(y=>Number(y.matchId)===f.matchId);return x&&x.date===f.date&&x.time===f.time&&x.venue===f.venue&&x.status===f.status;});
        const emails=contacts.every(c=>{const x=(r.contacts||[]).find(y=>y.teamId===c.teamId);return x&&x.enabled===c.enabled&&JSON.stringify((x.emails||[]).map(v=>v.toLowerCase()).sort())===JSON.stringify(c.emails.map(v=>v.toLowerCase()).sort());});
        if(!matches||!emails)throw new Error("Waiting for saved timetable values to appear.");
        return r;
      });
      setStatus("admin-matchday-status","Timetable and email settings saved and verified.");log("INFO","Matchday timetable and recipients saved.");
    }catch(e){setStatus("admin-matchday-status",e.message,"error");log("ERROR","Matchday save failed: "+e.message);}
    finally{button.disabled=false;}
  }

  async function loadTeamAccess() {
    setStatus("admin-access-status","Loading configured PIN status…");
    try{
      const r=await jsonp("getTeamEditorPinStatus");
      if(!r?.ok||!Array.isArray(r.teams))throw new Error(r?.error||"Could not read team PIN status.");
      $("admin-team-access-content").innerHTML=r.teams.map(t=>'<article class="admin-panel-card" style="margin:12px 0"><div class="admin-panel-heading"><div><span class="admin-eyebrow">TEAM '+escapeHTML(t.teamId)+'</span><h2>Team '+escapeHTML(t.teamId)+' workspace</h2></div><span class="admin-env-pill">'+(t.configured?'PIN CONFIGURED':'NO PIN SET')+'</span></div><div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end"><label style="flex:1;min-width:180px">New six-digit PIN<input class="admin-input" id="admin-pin-'+escapeHTML(t.teamId)+'" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="Leave blank to generate"></label><button type="button" class="admin-primary-button" data-generate-pin="'+escapeHTML(t.teamId)+'">'+(t.configured?'REGENERATE PIN':'CREATE PIN')+'</button></div><p id="admin-pin-status-'+escapeHTML(t.teamId)+'" class="admin-note-card" role="status" aria-live="polite"></p></article>').join("");
      $("admin-team-access-content").querySelectorAll("[data-generate-pin]").forEach(b=>b.addEventListener("click",()=>generatePin(b)));
      setStatus("admin-access-status","PIN status loaded. Existing PINs are never displayed.");
    }catch(e){setStatus("admin-access-status",e.message,"error");log("ERROR","Team access status failed: "+e.message);}
  }
  async function generatePin(button) {
    const teamId=button.dataset.generatePin,input=$("admin-pin-"+teamId);
    let pin=input.value.trim();
    if(!pin)pin=String(crypto.getRandomValues(new Uint32Array(1))[0]%1000000).padStart(6,"0");
    if(!/^\d{6}$/.test(pin)){setStatus("admin-pin-status-"+teamId,"PIN must contain exactly six digits.","error");return;}
    if(!confirm("Replace Team "+teamId+"'s existing PIN with a new one? Share the new PIN only with that team's manager."))return;
    button.disabled=true;setStatus("admin-pin-status-"+teamId,"Saving and verifying PIN…");
    try{
      await post({action:"updateTeamEditorPin",adminToken,teamId,pin});
      await retryRead(async()=>{const r=await jsonp("verifyTeamEditorPin",{pin});if(!r?.ok||r.teamId!==teamId)throw new Error(r?.error||"PIN not verified yet.");return r;});
      setStatus("admin-pin-status-"+teamId,"PIN saved and verified: "+pin+". Copy it now and share it securely.");input.value="";await loadTeamAccess();const status=$("admin-pin-status-"+teamId);if(status)status.textContent="PIN saved and verified: "+pin+". Copy it now and share it securely.";
      try{await navigator.clipboard.writeText(pin);log("INFO","Team "+teamId+" PIN generated, verified and copied to clipboard.");}catch{log("INFO","Team "+teamId+" PIN generated and verified.");}
    }catch(e){setStatus("admin-pin-status-"+teamId,e.message,"error");log("ERROR","Team PIN update failed for Team "+teamId+": "+e.message);}
    finally{button.disabled=false;}
  }

  function runCommand() {
    const input=$("admin-console-input"),command=input.value.trim().toLowerCase();if(!command)return;input.value="";log("INFO","> "+command);
    if(command==="help")log("INFO","Commands: help, health, settings, moderation, matchday, access, clear.");
    else if(command==="health")runHealth();
    else if(command==="settings")loadCompetition();
    else if(command==="moderation")loadModeration();
    else if(command==="matchday")loadMatchday();
    else if(command==="access")loadTeamAccess();
    else if(command==="clear"){events.length=0;renderConsole();log("INFO","Console events cleared.");}
    else log("WARN","Unknown command. Type help to list supported commands.");
  }

  document.querySelectorAll("[data-admin-view]").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.adminView)));
  document.querySelectorAll("[data-open-view]").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.openView)));
  if($("admin-run-checks"))$("admin-run-checks").addEventListener("click",runHealth);
  if($("admin-clear-console"))$("admin-clear-console").addEventListener("click",()=>{events.length=0;renderConsole();log("INFO","Console events cleared.");});
  if($("admin-console-run"))$("admin-console-run").addEventListener("click",runCommand);
  if($("admin-console-input"))$("admin-console-input").addEventListener("keydown",e=>{if(e.key==="Enter")runCommand();});
  if($("admin-team-settings-form"))$("admin-team-settings-form").addEventListener("submit",saveTeamSettings);
  if($("admin-season-form"))$("admin-season-form").addEventListener("submit",saveSeason);
  if($("admin-competition-refresh"))$("admin-competition-refresh").addEventListener("click",loadCompetition);
  if($("admin-mod-refresh"))$("admin-mod-refresh").addEventListener("click",loadModeration);
  if($("admin-matchday-refresh"))$("admin-matchday-refresh").addEventListener("click",loadMatchday);
  if($("admin-access-refresh"))$("admin-access-refresh").addEventListener("click",loadTeamAccess);
  if($("admin-matchday-form"))$("admin-matchday-form").addEventListener("submit",saveMatchday);
  window.addEventListener("error",e=>{clientErrors++;log("ERROR","Browser error: "+(e.message||"Unknown error")+" ("+(e.filename||"unknown file")+":"+e.lineno+")");});
  window.addEventListener("unhandledrejection",e=>{clientErrors++;log("ERROR","Unhandled promise rejection: "+String(e.reason?.message||e.reason||"Unknown rejection"));});
  log("INFO","Admin Control Room loaded. Credential handoff consumed; no token is stored by this page.");
  clientReady=true;
  runHealth();
  createModerationSession().then(()=>{if(document.querySelector('[data-admin-panel="moderation"].is-active'))loadModeration();}).catch(e=>log("ERROR","Could not create moderation session: "+e.message));
  // Load the visible panel on entry and attach real controls to every section.
  loadCompetition();
})();