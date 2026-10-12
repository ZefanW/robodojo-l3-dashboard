/* Public read UI. All evidence strings enter DOM through textContent. */
"use strict";
const byId = id => document.getElementById(id);
const make = (tag, text, className) => {const n=document.createElement(tag); if(text!==undefined)n.textContent=String(text);if(className)n.className=className;return n;};
const pct = v => typeof v === "number" && Number.isFinite(v) ? (v*100).toFixed(1)+"%" : "—";
const decimals = v => typeof v === "number" && Number.isFinite(v) ? v.toFixed(3) : "—";
const known = v => v === null || v === undefined ? "unknown" : String(v);
let ledger = {runs:[],groups:[]};
let loading=false, lastPayload="";
const configurations = new Map();
const simulatorVersion = r => configurations.get(r.run_id)?.simulator_package_isaacsim || "unrecorded / unavailable";
function safeLink(raw, local=false) {
  if(typeof raw!=="string" || /[\x00-\x20\\]/.test(raw))return null;
  if(local){if(!/^data\/runs\/[A-Za-z0-9._/-]+$/.test(raw)||raw.split("/").some(x=>x===".."||x==="."))return null;return raw;}
  try{const u=new URL(raw);if(u.protocol!=="https:"||u.username||u.password||!["","?dl=1","?raw=1"].includes(u.search)||u.hash)return null;return u.href;}catch{return null;}
}
function link(label,url,local=false){const safe=safeLink(url,local);if(!safe)return make("span",label+" · unavailable");const a=make("a",label);a.href=safe;a.target="_blank";a.rel="noopener noreferrer";return a;}
function renderGroups(){
  const host=byId("groups");host.replaceChildren();
  if(!ledger.groups.length){host.append(make("p","Harness summaries appear after native evidence is published.","small"));return;}
  for(const g of ledger.groups){
    const card=make("article",undefined,"group");
    card.append(make("h3",g.protocol.profile+" · "+g.model.name),
      make("div",g.model.thinking_effort+" effort · Codex "+g.model.client_version+" · "+g.protocol.native_control_cap+" controls / EEF · "+g.protocol.max_decisions+" decisions / episode","small"));
    const multiRound=(g.rounds||[]).length>1;
    const complete=g.aggregation_status==="complete",ambiguous=g.aggregation_status==="ambiguous_multiple_attempts";
    const metrics=make("div",undefined,"metrics");
    for(const [value,label] of [[g.metrics.completed+" / "+g.metrics.expected,"completed & published"],[pct(complete?g.metrics.score:g.metrics.observed_score),complete?"Score":multiRound?"Completed-round score":"Current score"],[pct(complete?g.metrics.success_rate:g.metrics.observed_success_rate),complete?"Success rate":multiRound?"Completed-round SR":"Current success rate"]]){
      const item=make("div",undefined,"metric");item.append(make("strong",value),make("span",label));metrics.append(item);
    }
    card.append(metrics);
    const progress=make("progress");progress.max=g.metrics.expected;progress.value=g.metrics.completed;
    progress.setAttribute("aria-label",g.metrics.completed+" of "+g.metrics.expected+" episodes completed and published");card.append(progress);
    card.append(make("p",ambiguous?"Multiple attempts overlap an episode. Scores are withheld until its result is resolved.":complete?"All selected episodes are complete.":multiRound?"The campaign score averages completed rounds equally. Partial rounds are listed below and excluded from the round mean and variance.":"Current scores use completed episodes only. The final score appears at full coverage.","small"));
    renderRounds(card,g);
    const dimensions=make("details"),dimensionTitle=make("summary","Capability scores and coverage");dimensions.append(dimensionTitle);
    for(const [name,m]of Object.entries(g.dimensions)){
      const row=make("div",undefined,"dimension"),bar=make("div",undefined,"bar"),fill=make("span");
      fill.style.width=(typeof m.observed_score==="number"?Math.max(0,Math.min(100,m.observed_score*100)):0)+"%";bar.append(fill);
      row.append(make("span",name),bar,make("span",pct(m.observed_score)),make("span",m.completed+"/"+m.expected));dimensions.append(row);
    }
    card.append(dimensions);
    const environments=g.environments||[];
    if(environments.length){
      const versions=[...new Set(environments.map(e=>e.simulator||"unrecorded"))].sort();
      card.append(make("p","Isaac Sim: "+versions.join(" / ")+(versions.length>1?" · mixed environments":""),"small"));
      const details=make("details");details.append(make("summary","Environment and source breakdown"));
      if(g.mixed_execution_provenance)details.append(make("p","This campaign summary retains the listed original execution environments and sources. Read reused-result labels when comparing protocols; this is not a single-environment reproduction score.","small"));
      const table=make("table"),head=make("tr");
      for(const label of ["Isaac Sim","Runtime / original protocol","Policy / reuse","Client binary","Completed","Current score","Current SR"])head.append(make("th",label));table.append(head);
      for(const e of environments){const row=make("tr");for(const value of [e.simulator||"unrecorded",(e.source_commit?e.source_commit.slice(0,7):"unversioned")+" · "+(e.original_protocol_id||g.protocol.id),(e.original_policy_sha256?e.original_policy_sha256.slice(0,12):"unrecorded")+(e.reused_original?" · reused original":""),e.client_binary_sha256?e.client_binary_sha256.slice(0,12):"unknown",e.completed,pct(e.observed_score),pct(e.observed_success_rate)])row.append(make("td",value));table.append(row);}
      const wrap=make("div",undefined,"table-wrap");wrap.append(table);details.append(wrap);card.append(details);
    }
    card.append(make("p","Selection: "+g.selection_id+" · "+g.submitted+" episode records","small"));host.append(card);
  }
}
function roundConfiguration(r){
  if(r.configuration_cells){
    const grouped=new Map();
    for(const c of r.configuration_cells){
      const label=c.capability==="Generalization"?"Generalization":"Other tasks";
      const key=JSON.stringify([label,c.variant,c.seed,c.scene]);
      const cell=grouped.get(key)||{label,variant:c.variant,seed:c.seed,scene:c.scene,count:0};
      cell.count+=c.tasks.length;grouped.set(key,cell);
    }
    return [...grouped.values()].map(c=>c.label+": "+c.count+" "+c.variant+" · seed "+c.seed+" / scene "+c.scene).join("; ");
  }
  const variants=Object.entries(r.variant_counts).map(([name,n])=>n+" "+name).join(" + ");
  const generalization=(r.capability_variants.Generalization||[]).join(" / ");
  return "seed "+r.seed+" · scene "+r.scene+" · "+variants+(generalization?" · Generalization: "+generalization:"");
}
function renderRounds(card,g){
  const rounds=g.rounds||[],stats=g.round_statistics;
  if(!rounds.length||!stats)return;
  const section=make("section",undefined,"rounds");
  section.append(make("h4","Rounds · "+stats.completed_rounds+" / "+stats.expected_rounds+" complete"));
  if(g.selection_title)section.append(make("p",g.selection_title,"small"));
  if(g.preserved_unselected_run_ids?.length)section.append(make("p",g.preserved_unselected_run_ids.length+" original records are preserved in the episode ledger but are outside this round selection and excluded from its score and variance.","small"));
  if(g.historical_campaign)section.append(make("p","Historical campaign: original outcomes are regrouped by the declared round selection. Reused results retain their original policy and protocol in the source breakdown.","small"));
  const table=make("table"),head=make("tr");
  for(const label of ["Round","Configuration","Published","Score","SR"])head.append(make("th",label));table.append(head);
  for(const r of rounds){
    const config=roundConfiguration(r);
    const row=make("tr"),status=r.status==="complete"?"complete":r.status==="ambiguous_multiple_attempts"?"overlapping attempts":"partial";
    for(const value of [r.round,config,r.metrics.completed+" / "+r.metrics.expected+" · "+status,pct(r.metrics.score),pct(r.metrics.success_rate)])row.append(make("td",value));table.append(row);
  }
  const wrap=make("div",undefined,"table-wrap");wrap.append(table);section.append(wrap);
  const variation=make("p",undefined,"small round-variance");
  variation.textContent=stats.completed_rounds<2?"Round variance: — · at least 2 complete, unambiguous rounds are required.":
    "Sample variance (n = "+stats.completed_rounds+", ddof = 1): Score "+decimals(stats.score_variance_pp2)+" pp² · SR "+decimals(stats.success_rate_variance_pp2)+" pp². Standard deviation: Score "+decimals(stats.score_stddev_pp)+" pp · SR "+decimals(stats.success_rate_stddev_pp)+" pp.";
  section.append(variation,make("p","Round statistics describe variation across the listed seed, scene and variant selections; they are not variance from repeated seeds under an identical configuration. Each round weights its selected capabilities equally.","small"));card.append(section);
}
function renderRuns(){const q=byId("search").value.toLowerCase(),variant=byId("variant").value,profile=byId("profile").value;const rows=ledger.runs.filter(r=>(variant==="all"||r.episode.variant===variant)&&(profile==="all"||r.protocol.profile===profile)&&[r.run_id,r.episode.task,r.protocol.profile,r.episode.seed,r.episode.scene].join(" ").toLowerCase().includes(q));const host=byId("episodes");host.replaceChildren();byId("empty").hidden=ledger.runs.length>0;for(const r of rows){const tr=make("tr"),task=make("td",r.episode.task);task.append(make("small",r.episode.variant+" · seed "+r.episode.seed+" · scene "+r.episode.scene));const profileCell=make("td",r.protocol.profile);profileCell.append(make("small","Isaac Sim "+simulatorVersion(r)));tr.append(task,profileCell,make("td",pct(r.outcome.score)),make("td",r.outcome.success===true?"Yes":r.outcome.success===false?"No":"—"),make("td",r.outcome.model_decisions+" / "+r.outcome.native_controls));const cell=make("td"),button=make("button","Inspect ↗");button.type="button";button.addEventListener("click",()=>showRun(r));cell.append(button);tr.append(cell);host.append(tr);}if(!rows.length&&ledger.runs.length){const row=make("tr"),cell=make("td","No episodes match these filters.");cell.colSpan=6;row.append(cell);host.append(row);}}
async function showRun(r){const host=byId("detail-body");host.replaceChildren();byId("detail-title").textContent=r.episode.task;byId("detail").hidden=false;host.append(make("p",r.run_id+" · "+r.outcome.status+" · "+r.evidence_level,"small"));const grid=make("div",undefined,"detail-grid");for(const [title,obj] of [["Episode & protocol",{episode:r.episode,protocol:r.protocol,model:r.model,simulator:simulatorVersion(r),effective_parameters:configurations.get(r.run_id)||null}],["Costs",r.costs],["Versions & hashes",r.versions]]){const panel=make("div");panel.append(make("h3",title),make("pre",JSON.stringify(obj,null,2)));grid.append(panel);}host.append(grid,make("h3","Evidence files"));const list=make("ul");list.append(make("li"));list.lastChild.append(link("Public manifest",r.manifest_path,true));for(const a of r.artifacts){const row=make("li");row.append(link(a.kind+" · "+a.path,a.site_path||a.url,Boolean(a.site_path)),make("span"," · "+a.bytes+" bytes · SHA "+a.sha256.slice(0,12)+"…","small"));list.append(row);}host.append(list,make("p","Raw-video links do not imply browser playback/seek verification. Missing external links remain unavailable until reviewed upload registration.","small"));if(r.limitations.length){host.append(make("h3","Limitations"));for(const item of r.limitations)host.append(make("p",item,"small"));}host.append(make("h3","Actions & native feedback"));const traceHost=make("div","Loading public action feedback…","small");host.append(traceHost);byId("detail").scrollIntoView({behavior:"smooth",block:"start"});const trace=r.artifacts.find(a=>a.kind==="action_feedback");try{const url=trace&&safeLink(trace.site_path,true);if(!url)throw new Error();const response=await fetch(url,{credentials:"omit",redirect:"error"});if(!response.ok)throw new Error();const events=await response.json();if(!Array.isArray(events))throw new Error();traceHost.replaceChildren();for(const e of events){const item=make("div",undefined,"trace-event");item.append(make("strong",(e.decision_index===null?"Non-model event":"Decision "+e.decision_index)+" · "+(e.tool===null?"no tool returned":e.tool)+" · "+e.native_controls+" native controls"),make("p","Action: "+e.action),make("p","Feedback: "+e.feedback),make("span",e.acknowledged?(e.tool===null?"Model rejection recorded; no native action":"Native acknowledgement recorded"):"Unresolved","small"));traceHost.append(item);}}catch{traceHost.textContent="Public action feedback is unavailable. This does not change the recorded outcome.";}}
function showLoadedStatus(data){byId("status").textContent=data.runs.some(r=>r.evidence_level==="native_terminal"&&r.outcome.status==="complete")?"Published evidence loaded. Read each protocol and coverage before comparing results.":"Fresh ledger · No real benchmark scores have been published.";}
async function load(){if(loading)return;loading=true;try{const response=await fetch("data/index.json",{cache:"no-store",credentials:"omit",redirect:"error"});if(!response.ok)throw new Error();const payload=await response.text();if(payload===lastPayload){showLoadedStatus(ledger);return;}const data=JSON.parse(payload);if(!["l3-index-v1","l3-index-v2"].includes(data.schema_version)||!Array.isArray(data.runs)||!Array.isArray(data.groups))throw new Error();ledger=data;configurations.clear();await Promise.all(data.runs.map(async r=>{const config=r.artifacts.find(a=>a.kind==="config"),url=config&&safeLink(config.site_path,true);if(!url)return;try{const response=await fetch(url,{credentials:"omit",redirect:"error"});if(!response.ok)return;const content=await response.json();if(content.schema_version!=="l3-public-config-v1"||!Array.isArray(content.parameters))return;configurations.set(r.run_id,Object.fromEntries(content.parameters.map(p=>[p.name,p.value])));}catch{}}));const complete=data.runs.filter(r=>r.evidence_level==="native_terminal"&&r.outcome.status==="complete");byId("run-count").textContent=complete.length;byId("group-count").textContent=data.groups.length;byId("control-count").textContent=complete.reduce((n,r)=>n+r.outcome.native_controls,0).toLocaleString();showLoadedStatus(data);const selectedProfile=byId("profile").value;byId("profile").replaceChildren(make("option","All profiles"));byId("profile").firstChild.value="all";for(const profile of [...new Set(data.runs.map(r=>r.protocol.profile))].sort()){const option=make("option",profile);option.value=profile;byId("profile").append(option);}byId("profile").value=[...byId("profile").options].some(o=>o.value===selectedProfile)?selectedProfile:"all";renderGroups();renderRuns();lastPayload=payload;}catch{byId("status").textContent="The result index could not be loaded. Existing evidence is retained; automatic refresh will retry.";}finally{loading=false;}}
for(const id of ["search","variant","profile"])byId(id).addEventListener(id==="search"?"input":"change",renderRuns);
byId("close-detail").addEventListener("click",()=>{byId("detail").hidden=true;});
load();
setInterval(()=>{if(!document.hidden)load();},60000);
document.addEventListener("visibilitychange",()=>{if(!document.hidden)load();});
