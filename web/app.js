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
function renderAudit(g){
  const host=byId("audit-body");host.replaceChildren();
  if(!ledger.groups.length){host.append(make("p","Harness summaries appear after native evidence is published.","small"));return;}
  {
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
// Experiment membership comes from the published index, never from name matching.
let selectedGroupId = null, selectedRound = "1", selectedCapability = "all";
let selectedRowKey = null, selectedRowSignature = null, visibleRows = [], activeVideo = null, detailGeneration = 0;
const episodeKey = e => JSON.stringify([e.task,e.variant,e.seed,e.scene]);
const rowKey = row => JSON.stringify([row.round,episodeKey(row.episode)]);
const experimentName = g => g.model.name + " · " + g.protocol.profile + " · " + g.model.thinking_effort;
const selectedGroup = () => ledger.groups.find(g=>g.group_id===selectedGroupId);
const outcomeLabel = row => row.runs.length>1?"结果待核对":!row.runs.length?"未发布":row.runs[0].outcome.success===true?"成功":row.runs[0].outcome.success===false?"失败":"未知";
const outcomeClass = row => row.runs.length!==1?"pending":row.runs[0].outcome.success===true?"success":row.runs[0].outcome.success===false?"failure":"pending";
function experimentRows(g, roundNumber){
  const groupIds=new Set(g.run_ids), members=ledger.runs.filter(r=>groupIds.has(r.run_id));
  const overlay=(ledger.round_selections||[]).find(s=>s.id===g.selection_id);
  let expected=[];
  if(!overlay && members.length){
    expected=members[0].selection?.expected_episodes||[];
    const signature=items=>JSON.stringify(items.map(e=>[episodeKey(e),e.capability]).sort());
    if(members.some(r=>signature(r.selection?.expected_episodes||[])!==signature(expected)))throw new Error("Inconsistent experiment selection");
  }
  return (g.rounds||[]).filter(r=>roundNumber==="all"||String(r.round)===String(roundNumber)).flatMap(round=>{
    const wanted=overlay ? (overlay.rounds.find(r=>r.round===round.round)?.expected_episodes||[]) : expected.filter(e=>e.seed===round.seed&&e.scene===round.scene);
    const ids=new Set(round.run_ids), runs=members.filter(r=>ids.has(r.run_id));
    return wanted.map(episode=>({episode,round:round.round,runs:runs.filter(r=>episodeKey(r.episode)===episodeKey(episode)&&r.episode.capability===episode.capability)}));
  }).sort((a,b)=>a.episode.task.localeCompare(b.episode.task)||a.round-b.round||a.episode.variant.localeCompare(b.episode.variant));
}
function releaseVideo(){if(activeVideo){activeVideo.pause();activeVideo.removeAttribute("src");activeVideo.load();activeVideo=null;}}
function clearDetail(){detailGeneration++;releaseVideo();selectedRowKey=null;selectedRowSignature=null;byId("detail-body").replaceChildren();byId("detail-title").textContent="选择一个任务";byId("detail-caption").textContent="查看原生结果、三路视频与动作反馈。";}
function selectExperiment(g){
  if(selectedGroupId===g.group_id)return;
  clearDetail();selectedGroupId=g.group_id;selectedRound=String(g.rounds?.[0]?.round||1);selectedCapability="all";
  byId("search").value="";byId("variant").value="all";byId("outcome").value="all";
  renderExperiments();renderExperiment();
}
function renderExperiments(){
  const host=byId("experiments"),q=byId("experiment-search").value.trim().toLowerCase();host.replaceChildren();
  const ordered=[...ledger.groups].sort((a,b)=>["low","medium","high","xhigh"].indexOf(a.model.thinking_effort)-["low","medium","high","xhigh"].indexOf(b.model.thinking_effort));
  for(const g of ordered.filter(g=>[experimentName(g),g.selection_id,g.protocol.id,g.selection_title].join(" ").toLowerCase().includes(q))){
    const button=make("button",undefined,"experiment-card"+(g.group_id===selectedGroupId?" selected":""));button.type="button";
    button.setAttribute("aria-pressed",String(g.group_id===selectedGroupId));button.setAttribute("aria-label",experimentName(g));
    button.append(make("span",g.model.thinking_effort.toUpperCase(),"effort"),make("strong",g.protocol.profile),make("span",g.model.name,"small"),make("span",g.metrics.completed+" / "+g.metrics.expected+" 已发布 · "+(g.rounds||[]).length+" 轮","card-coverage"),make("span",g.selection_id,"experiment-id"));
    button.addEventListener("click",()=>selectExperiment(g));host.append(button);
  }
  if(!host.children.length)host.append(make("p","没有匹配的实验。试试 medium、cap20 或实验 ID。","small"));
}
function renderExperiment(){
  const g=selectedGroup();byId("workspace").hidden=!g;if(!g)return;
  byId("experiment-title").textContent=experimentName(g);
  byId("experiment-id").textContent=g.selection_id;
  const rounds=byId("round-tabs");rounds.replaceChildren();
  for(const [value,label] of [["all","全部轮次"],...(g.rounds||[]).map(r=>[String(r.round),"R"+r.round+" · "+r.metrics.completed+"/"+r.metrics.expected])]){
    if(value==="all"&&g.rounds.length===1)continue;
    const b=make("button",label,"pill"+(selectedRound===value?" active":""));b.type="button";b.setAttribute("aria-pressed",String(selectedRound===value));
    b.addEventListener("click",()=>{clearDetail();selectedRound=value;renderExperiment();});rounds.append(b);
  }
  const round=g.rounds.find(r=>String(r.round)===selectedRound),m=round?round.metrics:g.metrics;
  const isComplete=round?round.status==="complete":g.aggregation_status==="complete";
  const metrics=byId("experiment-metrics");metrics.replaceChildren();
  for(const [value,label] of [[m.completed+" / "+m.expected,"已发布"],[pct(m.score),"Score"],[pct(m.success_rate),"成功率 SR"]]){
    const item=make("div",undefined,"metric");item.append(make("strong",value),make("span",label));metrics.append(item);
  }
  byId("round-config").textContent=round?roundConfiguration(round):"各轮的 seed、scene 和 variant 按原始轮次定义分别列出。";
  byId("coverage-note").textContent=isComplete?"本范围已完整发布 · 五类能力等权。" : "本范围尚未完整发布；完整 Score / SR 暂不显示。未发布不代表未运行或失败。";
  if(!isComplete && typeof m.observed_score==="number")byId("coverage-note").textContent+=" 已发布部分 Score "+pct(m.observed_score)+" / SR "+pct(m.observed_success_rate)+"。";
  renderAudit(g);renderCapabilities();renderRuns();
}
function renderCapabilities(){
  const g=selectedGroup(),host=byId("capabilities");host.replaceChildren();if(!g)return;
  let rows;try{rows=experimentRows(g,selectedRound);}catch{return;}
  const names=["all",...new Set(rows.map(r=>r.episode.capability))];
  if(!names.includes(selectedCapability))selectedCapability="all";
  for(const name of names){const count=name==="all"?rows.length:rows.filter(r=>r.episode.capability===name).length;
    const b=make("button",(name==="all"?"全部能力":name)+" · "+count,"pill"+(selectedCapability===name?" active":""));b.type="button";b.setAttribute("aria-pressed",String(name===selectedCapability));
    b.addEventListener("click",()=>{selectedCapability=name;renderCapabilities();renderRuns();});host.append(b);
  }
}
function renderRuns(){
  const g=selectedGroup(),host=byId("episodes");host.replaceChildren();if(!g)return;
  const q=byId("search").value.trim().toLowerCase(),variant=byId("variant").value,outcome=byId("outcome").value;
  let rows;try{rows=experimentRows(g,selectedRound);}catch{clearDetail();byId("task-count").textContent="实验范围不一致，暂不合并结果。";return;}
  visibleRows=rows.filter(row=>(selectedCapability==="all"||row.episode.capability===selectedCapability)&&(variant==="all"||row.episode.variant===variant)&&(outcome==="all"||outcomeLabel(row)===outcome)&&[row.episode.task,...row.runs.map(r=>r.run_id)].join(" ").toLowerCase().includes(q));
  byId("task-count").textContent=visibleRows.length+" / "+rows.length+" 条任务结果";
  const retained=visibleRows.find(row=>rowKey(row)===selectedRowKey);
  if(!retained){clearDetail();if(visibleRows.length)showRow(visibleRows[0]);}
  else if(JSON.stringify(retained.runs.map(r=>r.run_id))!==selectedRowSignature)showRow(retained);
  for(const row of visibleRows){
    const b=make("button",undefined,"task-item"+(rowKey(row)===selectedRowKey?" selected":""));b.type="button";b.setAttribute("aria-pressed",String(rowKey(row)===selectedRowKey));
    const title=make("span",row.episode.task,"task-name"),result=make("span",outcomeLabel(row),"badge "+outcomeClass(row));
    const heading=make("span",undefined,"task-line");heading.append(title,result);
    const score=row.runs.length===1?pct(row.runs[0].outcome.score):"—";
    b.append(heading,make("span","R"+row.round+" · "+row.episode.variant+" · seed "+row.episode.seed+" / scene "+row.episode.scene,"task-meta"),make("span",row.episode.capability+" · Score "+score,"task-meta"));
    b.addEventListener("click",()=>{showRow(row);renderRuns();if(typeof matchMedia!=="undefined"&&matchMedia("(max-width: 760px)").matches)byId("detail").scrollIntoView({behavior:"smooth",block:"start"});});host.append(b);
  }
  if(!visibleRows.length)host.append(make("p","没有匹配的任务，请调整筛选条件。","empty"));
}
function showRow(row){
  clearDetail();selectedRowKey=rowKey(row);selectedRowSignature=JSON.stringify(row.runs.map(r=>r.run_id));const host=byId("detail-body");
  byId("detail-title").textContent=row.episode.task;
  byId("detail-caption").textContent="R"+row.round+" · "+row.episode.capability+" · "+row.episode.variant+" · seed "+row.episode.seed+" / scene "+row.episode.scene;
  if(!row.runs.length){host.append(make("div","此任务尚未发布结果。原生结果和证据完成登记后会显示在这里。","unpublished"));return;}
  if(row.runs.length>1){host.append(make("p","同一任务有多条记录，尚未确定唯一结果；不会自动选取最高分。","unpublished"));for(const r of row.runs){const b=make("button",r.run_id);b.type="button";b.addEventListener("click",()=>{releaseVideo();detailGeneration++;host.replaceChildren();showRun(r);});host.append(b);}return;}
  showRun(row.runs[0]);
}
function renderVideo(host,r){
  const videos=r.artifacts.filter(a=>a.kind==="raw_video"),section=make("section",undefined,"video-section");
  const tabs=make("div",undefined,"camera-tabs");tabs.setAttribute("aria-label","相机视角");
  const video=make("video");video.controls=true;video.playsInline=true;video.preload="none";video.setAttribute("aria-label",r.episode.task+" 原始视频");
  const stage=make("div",undefined,"video-stage"),play=make("button","▶ 播放视频","play-video");play.type="button";
  stage.append(video,play);play.addEventListener("click",()=>{video.play().catch(()=>{hint.textContent="暂时无法播放，请重试或打开原视频。";});});
  video.addEventListener("play",()=>{play.hidden=true;});
  const hint=make("p","点击播放观看原始视频，可拖动进度或全屏查看。","small");hint.setAttribute("role","status");
  const original=make("div",undefined,"video-source"),buttons=[];
  const labels={"head.mp4":"主视角","left_wrist.mp4":"左腕相机","right_wrist.mp4":"右腕相机"};
  function choose(a,index){
    releaseVideo();video.preload="none";play.hidden=false;hint.textContent="点击播放观看原始视频，可拖动进度或全屏查看。";
    const url=safeLink(a.url);original.replaceChildren(link("打开原视频 ↗",a.url),make("span",a.path+" · SHA "+a.sha256.slice(0,12)+"…","small"));
    buttons.forEach((b,i)=>{b.className="pill"+(i===index?" active":"");b.setAttribute("aria-pressed",String(i===index));});
    video.setAttribute("aria-label",r.episode.task+" · "+(labels[a.path]||a.path));
    if(url){video.src=url;activeVideo=video;}else hint.textContent="视频链接不可用，请查看证据文件。";
  }
  videos.forEach((a,i)=>{const b=make("button",labels[a.path]||a.path,"pill");b.type="button";b.addEventListener("click",()=>choose(a,i));buttons.push(b);tabs.append(b);});
  video.addEventListener("error",()=>{if(activeVideo===video)hint.textContent="视频暂时无法播放，可尝试其他视角或打开原视频。";});
  section.append(tabs,stage,hint,original);host.append(section);if(videos.length)choose(videos[0],0);else{stage.hidden=true;hint.textContent="此记录没有可用的原始视频。";}
}
function showRun(r){
  const host=byId("detail-body"),generation=detailGeneration;
  const metrics=make("div",undefined,"episode-metrics");
  for(const [value,label] of [[pct(r.outcome.score),"Score"],[r.outcome.success===true?"成功":r.outcome.success===false?"失败":"未知","原生结果"],[r.outcome.model_decisions,"模型决策"],[r.outcome.native_controls,"控制步"]]){const box=make("div");box.append(make("strong",value),make("span",label));metrics.append(box);}host.append(metrics);
  host.append(make("p","Isaac Sim "+simulatorVersion(r)+" · "+r.model.thinking_effort+" · "+r.protocol.profile,"small"));renderVideo(host,r);
  const traces=make("details",undefined,"evidence-section");traces.append(make("summary","动作与原生反馈"));const traceHost=make("div","展开后读取动作记录…","small");traces.append(traceHost);host.append(traces);let traceLoaded=false;
  traces.addEventListener("toggle",async()=>{
    if(!traces.open||traceLoaded)return;traceLoaded=true;traceHost.textContent="正在读取动作反馈…";
    try{const trace=r.artifacts.find(a=>a.kind==="action_feedback"),url=trace&&safeLink(trace.site_path,true);if(!url)throw new Error();const response=await fetch(url,{credentials:"omit",redirect:"error"});if(!response.ok)throw new Error();const events=await response.json();if(generation!==detailGeneration)return;if(!Array.isArray(events))throw new Error();traceHost.replaceChildren();
      for(const e of events){const item=make("div",undefined,"trace-event");item.append(make("strong",(e.decision_index===null?"Non-model event":"Decision "+e.decision_index)+" · "+(e.tool===null?"no tool returned":e.tool)+" · "+e.native_controls+" native controls"),make("p","Action: "+e.action),make("p","Feedback: "+e.feedback),make("span",e.acknowledged?(e.tool===null?"Model rejection recorded; no native action":"Native acknowledgement recorded"):"Unresolved","small"));traceHost.append(item);}
    }catch{if(generation===detailGeneration)traceHost.textContent="暂时无法读取动作反馈，已登记的结果不变。";}
  });
  const evidence=make("details",undefined,"evidence-section");evidence.append(make("summary","配置、费用与原始证据"),make("p",r.run_id+" · "+r.outcome.status+" · "+r.evidence_level,"small"));
  const grid=make("div",undefined,"detail-grid");for(const [title,obj] of [["Episode & protocol",{episode:r.episode,protocol:r.protocol,model:r.model,simulator:simulatorVersion(r),effective_parameters:configurations.get(r.run_id)||null}],["Costs",r.costs],["Versions & hashes",r.versions]]){const panel=make("div");panel.append(make("h3",title),make("pre",JSON.stringify(obj,null,2)));grid.append(panel);}evidence.append(grid);
  const list=make("ul"),manifest=make("li");manifest.append(link("Public manifest",r.manifest_path,true));list.append(manifest);
  for(const a of r.artifacts){const item=make("li");item.append(link(a.kind+" · "+a.path,a.site_path||a.url,Boolean(a.site_path)),make("span"," · "+a.bytes+" bytes · SHA "+a.sha256.slice(0,12)+"…","small"));list.append(item);}evidence.append(list);
  if(r.limitations?.length){evidence.append(make("h3","Limitations"));for(const item of r.limitations)evidence.append(make("p",item,"small"));}host.append(evidence);
}
function showLoadedStatus(data){byId("status").textContent=data.runs.some(r=>r.evidence_level==="native_terminal"&&r.outcome.status==="complete")?"已加载公开结果 · 每 60 秒刷新，播放与筛选保持不变。":"Fresh ledger · No real benchmark scores have been published.";}
async function load(){if(loading)return;loading=true;try{
  const response=await fetch("data/index.json",{cache:"no-store",credentials:"omit",redirect:"error"});if(!response.ok)throw new Error();const payload=await response.text();if(payload===lastPayload){showLoadedStatus(ledger);return;}
  const data=JSON.parse(payload);if(!["l3-index-v1","l3-index-v2"].includes(data.schema_version)||!Array.isArray(data.runs)||!Array.isArray(data.groups))throw new Error();
  const nextConfigurations=new Map();await Promise.all(data.runs.map(async r=>{const config=r.artifacts.find(a=>a.kind==="config"),url=config&&safeLink(config.site_path,true);if(!url)return;try{const response=await fetch(url,{credentials:"omit",redirect:"error"});if(!response.ok)return;const content=await response.json();if(content.schema_version!=="l3-public-config-v1"||!Array.isArray(content.parameters))return;nextConfigurations.set(r.run_id,Object.fromEntries(content.parameters.map(p=>[p.name,p.value])));}catch{}}));
  ledger=data;configurations.clear();for(const [key,value] of nextConfigurations)configurations.set(key,value);
  const complete=data.runs.filter(r=>r.evidence_level==="native_terminal"&&r.outcome.status==="complete");byId("run-count").textContent=complete.length;byId("group-count").textContent=data.groups.length;byId("control-count").textContent=complete.reduce((n,r)=>n+r.outcome.native_controls,0).toLocaleString();showLoadedStatus(data);
  if(!selectedGroup()){selectedGroupId=[...data.groups].sort((a,b)=>b.metrics.completed-a.metrics.completed)[0]?.group_id||null;selectedRound=String(selectedGroup()?.rounds?.[0]?.round||1);clearDetail();}
  renderExperiments();renderExperiment();lastPayload=payload;
}catch{byId("status").textContent="The result index could not be loaded. Existing evidence is retained; automatic refresh will retry.";}finally{loading=false;}}
for(const id of ["search","variant","outcome"])byId(id).addEventListener(id==="search"?"input":"change",renderRuns);
byId("experiment-search").addEventListener("input",renderExperiments);
byId("close-detail").addEventListener("click",()=>{clearDetail();});
load();setInterval(()=>{if(!document.hidden)load();},60000);
document.addEventListener("visibilitychange",()=>{if(!document.hidden)load();});
