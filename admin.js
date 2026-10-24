(() => {
  "use strict";
  const API_URL = "https://script.google.com/macros/s/AKfycbw77wOi2EhaSUkWHwiyowOIFieZqlNCFkDO-s6AUa5X63jbDs5m6n8F0lrsjIouwfHC/exec";
  const titles = {overview:"Overview",moderation:"Moderation",competition:"Competition",matchday:"Matchday & email",access:"Team access",console:"System console"};
  const events = [];
  let clientErrors = 0;
  const $ = id => document.getElementById(id);
  function escapeHTML(value){return String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
  function log(level,message){
    const entry={time:new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit"}),level,message:String(message)};
    events.push(entry);
    if(events.length>250) events.shift();
    renderConsole();
    renderRecent();
    $("admin-error-value").textContent=String(clientErrors);
  }
  function renderConsole(){
    const host=$("admin-console-output"); if(!host)return;
    host.innerHTML=events.map(e=>'<div class="admin-console-line"><time>'+escapeHTML(e.time)+'</time><span class="'+(e.level==="ERROR"?"console-error":e.level==="WARN"?"console-warn":"console-info")+'">['+escapeHTML(e.level)+']</span><code>'+escapeHTML(e.message)+'</code></div>').join("");
    host.scrollTop=host.scrollHeight;
    $("admin-console-count").textContent=events.length+" EVENTS";
  }
  function renderRecent(){
    const host=$("admin-recent-events"); if(!host)return;
    const recent=events.slice(-4).reverse();
    host.innerHTML=recent.map(e=>'<div class="admin-event"><span class="admin-event-dot '+(e.level==="ERROR"?"is-error":e.level==="WARN"?"is-pending":"")+'"></span><div><strong>'+escapeHTML(e.level==="ERROR"?"Check failed":e.level==="WARN"?"Check warning":"System check")+'</strong><p>'+escapeHTML(e.message)+'</p></div><time>'+escapeHTML(e.time)+'</time></div>').join("");
  }
  function jsonp(action){
    return new Promise((resolve,reject)=>{
      const url=new URL(API_URL), callback="__adminControlRoom_"+Date.now()+"_"+Math.random().toString(36).slice(2), script=document.createElement("script");
      let settled=false;
      const timeout=setTimeout(()=>finish(new Error("Timed out after 12 seconds.")),12000);
      function finish(error,data){if(settled)return;settled=true;clearTimeout(timeout);try{delete window[callback]}catch{}script.remove();error?reject(error):resolve(data);}
      window[callback]=data=>finish(null,data);
      url.searchParams.set("action",action);url.searchParams.set("callback",callback);url.searchParams.set("_cacheBust",String(Date.now()));
      script.async=true;script.src=url.toString();script.onerror=()=>finish(new Error("Browser could not load the Apps Script response."));document.head.appendChild(script);
    });
  }
  function setStatus(id,text,kind){const el=$(id);if(!el)return;el.textContent=text;el.classList.toggle("is-warning",kind==="warning");el.classList.toggle("is-error",kind==="error");}
  async function runHealth(){
    $("admin-run-checks").disabled=true;
    $("admin-api-value").textContent="CHECKING";setStatus("admin-api-status","Checking","");
    log("INFO","Requesting Apps Script health endpoint.");
    try{
      const result=await jsonp("health");
      if(!result||result.ok!==true)throw new Error(result?.error||"Health endpoint did not return ok:true.");
      if(result.service!=="competition-community-api")throw new Error("Unexpected service identifier: "+String(result.service||"missing"));
      if(result.configured!==true)throw new Error("API responds, but required Script Properties are not configured.");
      $("admin-api-value").textContent="ONLINE";$("admin-api-detail").textContent="Apps Script responded and reports required configuration present.";
      setStatus("admin-api-status","Healthy","");
      log("INFO","API health passed. Service=competition-community-api; configured=true.");
      if(Array.isArray(result.actions))log("INFO","API reports "+result.actions.length+" supported actions.");
    }catch(error){
      $("admin-api-value").textContent="ISSUE";$("admin-api-detail").textContent=error.message||"Health check failed.";
      setStatus("admin-api-status","Check failed","error");log("ERROR","API health check failed: "+(error.message||error));
    }
    try{
      const result=await jsonp("getTeamSettings");
      if(!result||result.ok===false)throw new Error(result?.error||"Shared team settings unavailable.");
      $("admin-settings-value").textContent="AVAILABLE";$("admin-settings-detail").textContent="Shared team settings endpoint returned a response.";
      setStatus("admin-settings-status","Read succeeded","");
      log("INFO","Shared team settings read succeeded.");
    }catch(error){
      $("admin-settings-value").textContent="UNAVAILABLE";$("admin-settings-detail").textContent=error.message||"Settings check failed.";
      setStatus("admin-settings-status","Read failed","error");log("ERROR","Shared settings check failed: "+(error.message||error));
    }
    $("admin-run-checks").disabled=false;
  }
  function showView(name){
    if(!titles[name])return;
    document.querySelectorAll("[data-admin-panel]").forEach(panel=>panel.classList.toggle("is-active",panel.dataset.adminPanel===name));
    document.querySelectorAll("[data-admin-view]").forEach(button=>button.classList.toggle("is-active",button.dataset.adminView===name));
    $("admin-breadcrumb-current").textContent=titles[name];
    document.title=titles[name]+" · Admin Control Room";
    if(name==="console")renderConsole();
    if(name==="moderation"){$("admin-mod-value").textContent="SESSION REQUIRED";log("WARN","Moderation queue requires admin authentication. Open the secure workspace to create a session.");}
  }
  function runCommand(){
    const input=$("admin-console-input"), command=input.value.trim().toLowerCase();if(!command)return;
    input.value="";
    log("INFO","> "+command);
    if(command==="help")log("INFO","Available read-only commands: help, health, settings, clear.");
    else if(command==="health")runHealth();
    else if(command==="settings")jsonp("getTeamSettings").then(result=>{log("INFO","getTeamSettings response: "+JSON.stringify(result));}).catch(error=>log("ERROR","Settings request failed: "+error.message));
    else if(command==="clear"){events.length=0;renderConsole();log("INFO","Console events cleared.");}
    else log("WARN","Unknown command. Type help to list supported commands.");
  }
  document.querySelectorAll("[data-admin-view]").forEach(button=>button.addEventListener("click",()=>showView(button.dataset.adminView)));
  document.querySelectorAll("[data-open-view]").forEach(button=>button.addEventListener("click",()=>showView(button.dataset.openView)));
  $("admin-run-checks").addEventListener("click",runHealth);
  $("admin-clear-console").addEventListener("click",()=>{events.length=0;renderConsole();log("INFO","Console events cleared.");});
  $("admin-console-run").addEventListener("click",runCommand);
  $("admin-console-input").addEventListener("keydown",event=>{if(event.key==="Enter")runCommand();});
  window.addEventListener("error",event=>{clientErrors++;log("ERROR","Browser error: "+(event.message||"Unknown error")+" ("+(event.filename||"unknown file")+":"+event.lineno+")");});
  window.addEventListener("unhandledrejection",event=>{clientErrors++;log("ERROR","Unhandled promise rejection: "+String(event.reason?.message||event.reason||"Unknown rejection"));});
  log("INFO","Admin Control Room loaded. No admin token is stored by this page.");
  runHealth();
})();