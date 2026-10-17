/* Public read UI. All evidence strings enter DOM through textContent. */
"use strict";
const byId = id => document.getElementById(id);
const make = (tag, text, className) => {const n=document.createElement(tag); if(text!==undefined)n.textContent=String(text);if(className)n.className=className;return n;};
const pct = v => typeof v === "number" && Number.isFinite(v) ? (v*100).toFixed(1)+"%" : "—";
const decimals = v => typeof v === "number" && Number.isFinite(v) ? v.toFixed(3) : "—";
const standardDeviation = variance => typeof variance === "number" && Number.isFinite(variance) && variance >= 0 ? Math.sqrt(variance) : null;
const points = v => typeof v === "number" && Number.isFinite(v) ? v.toFixed(2)+"%" : "—";
const known = v => v === null || v === undefined ? "unknown" : String(v);
let ledger = {runs:[],groups:[]};
const coverage = m => m.expected == null ? String(m.completed) : m.completed+" / "+m.expected;
const number = (n, decimals=0) => typeof n === "number" && Number.isFinite(n) ? n.toLocaleString("en-US",{maximumFractionDigits:decimals}) : "未知";
// Recomputed from the current catalog on every refresh, with each run counted once.
function runCosts(ids){
  const wanted=new Set(ids), rows=[...new Map(ledger.runs.filter(r=>wanted.has(r.run_id)).map(r=>[r.run_id,r])).values()];
  const costs=rows.map(r=>r.costs), complete=costs.every(c=>c?.accounting==="known");
  const sum=k=>costs.reduce((n,c)=>n+(c?.[k]||0),0);
  const knownPart=k=>costs.reduce((n,c)=>n+(typeof c?.[k]==="number"?c[k]:(c?.attempts||[]).reduce((v,a)=>v+(typeof a[k]==="number"?a[k]:0),0)),0);
  const input=knownPart("input_tokens"),output=knownPart("output_tokens"),cached=knownPart("cached_input_tokens");
  return {run_count:rows.length,total_tokens:complete?input+output:null,
    input_tokens:complete?input:null,output_tokens:complete?output:null,cached_input_tokens:complete?cached:null,
    known_input_tokens:input,known_output_tokens:output,known_cached_input_tokens:cached,
    known_token_lower_bound:sum("known_token_lower_bound"),
    paid_requests:costs.every(c=>typeof c?.paid_requests==="number")?sum("paid_requests"):null,
    unknown_usage_attempts:costs.reduce((n,c)=>n+(c?.attempts||[]).filter(a=>!a.usage_known).length,0),
    incomplete_cost_runs:costs.filter(c=>c?.accounting!=="known").length};
}
const costsFor = g => runCosts(g.run_ids||[]);
const tokenText = (c,field="total_tokens",average=false) => {
  if(c.run_count===0)return "—";
  const lower={total_tokens:"known_token_lower_bound",input_tokens:"known_input_tokens",output_tokens:"known_output_tokens",cached_input_tokens:"known_cached_input_tokens"};
  const missing=c[field]==null, value=missing?c[lower[field]]:c[field];
  const displayed=average?(missing?Math.floor(value/c.run_count*10)/10:value/c.run_count):value;
  return (missing?"≥ ":"")+number(displayed,average?1:0);
};
const costNote = c => c.run_count === 0 ? "暂无已发布用量" : "付费请求 "+number(c.paid_requests)+(c.unknown_usage_attempts?" · "+number(c.unknown_usage_attempts)+" 次用量未知":c.incomplete_cost_runs?" · "+number(c.incomplete_cost_runs)+" 条账目不完整":" · 用量完整");
function tokenLines(c,average=false){return ["输入 "+tokenText(c,"input_tokens",average),"输出 "+tokenText(c,"output_tokens",average),"合计 "+tokenText(c,"total_tokens",average)].join("\n");}
function renderTokenSummary(g,round){
  const host=byId("token-summary");if(!host)return;host.replaceChildren();
  host.append(make("h3","Token 用量"),make("p","随新结果自动更新 · 只统计已发布的 run","small"));
  const grid=make("div",undefined,"token-scopes");
  for(const [label,scope] of [...(round?[["本轮 R"+round.round,round]]:[]),["整个实验",g]]){
    const c=costsFor(scope),section=make("section",undefined,"token-scope");
    section.append(make("h4",label+" · "+c.run_count+" 个已发布 run"));
    const values=make("div",undefined,"token-values");
    for(const [field,title] of [["input_tokens","输入"],["output_tokens","输出"],["total_tokens","合计"]]){
      const cell=make("div");cell.append(make("span",title),make("strong",tokenText(c,field)),make("small","平均 / run "+tokenText(c,field,true)));values.append(cell);
    }
    section.append(values,make("p","输入中缓存 "+tokenText(c,"cached_input_tokens")+" · "+costNote(c),"small"));grid.append(section);
  }
  host.append(grid);
}
let loading=false, lastPayload="", lastEtag="", lastSnapshotId="";
let fixedEvaluationState="pending", fixedEvaluations=new Map();
const fixedPlans=[["first_round","首轮",42],["spiky2_65","Spiky-2 · 65例",65],["P50_111","P50_111",111]];
const fixedResult=(g,id)=>fixedEvaluationState==="ready"?fixedEvaluations.get(g.group_id)?.[id]:null;
function fixedResultComplete(result,expected){
  return result?.status==="complete"&&result.completed===expected&&result.expected===expected
    &&typeof result.score==="number"&&Number.isFinite(result.score)&&result.score>=0&&result.score<=1
    &&Array.isArray(result.missing_cases)&&result.missing_cases.length===0
    &&Array.isArray(result.conflicts)&&result.conflicts.length===0;
}
function fixedResultStatus(result,expected){
  if(!result)return "固定评测成绩待同步";
  if(fixedResultComplete(result,expected))return "完整 · "+expected+" / "+expected;
  const count=Number.isInteger(result.completed)&&result.completed>=0?result.completed:0;
  return count+" / "+expected+" · "+(result.conflicts?.length?"结果待核对":"尚未齐全");
}
function renderFixedScores(host,g,compact=false){
  const grid=make(compact?"span":"div",undefined,"fixed-scores"+(compact?" compact":""));
  for(const [id,label,expected] of fixedPlans){
    const result=fixedResult(g,id),complete=fixedResultComplete(result,expected);
    const cell=make(compact?"span":"section",undefined,"fixed-score"+(complete?" complete":""));
    cell.append(make("span",label+" Score","fixed-score-label"),make("b",complete?pct(result.score):"—","fixed-score-value"),make("span",fixedResultStatus(result,expected),"fixed-score-status"));
    grid.append(cell);
  }
  host.append(grid);
}
const fixedCaseLabel=c=>c.task+" · "+c.variant+" · seed "+c.seed+" / scene "+c.scene;
function renderFixedEvaluationSummary(g){
  const host=byId("fixed-evaluation-summary");if(!host)return;host.replaceChildren();
  host.append(make("h3","固定评测成绩"),make("p","按固定场景顺序统计，样本齐全后自动发布；不随下方轮次筛选改变。","small"));
  renderFixedScores(host,g);
  const details=make("details",undefined,"fixed-score-details");details.append(make("summary","统计规则与待补结果"));
  details.append(make("p","先对每个任务的样本取均值，再在能力内对任务取均值，最后对五类能力等权平均。首轮为 42 个任务；Spiky-2 为 23 个固定 spiky 任务各 2 次、其余 19 个任务各 1 次，共 65 例；P50_111 将同一批 23 个任务扩展为各 4 次。两种扩展均包含首轮。","small"),
    make("p","均使用 seed0。首轮：30 个普通任务使用 standard scene0；12 个泛化任务使用 random scene0。Spiky-2 在首轮上补 23 例：普通任务补 standard scene1，泛化任务补 standard scene0。P50_111 需 4 次的普通任务使用 scene0–3，泛化任务使用 random / standard 的 scene0–1（与前 4 轮一致）。只计入本实验的指定样本，不用较晚场景补位，也不选取最高分。","small"));
  for(const [id,label,expected] of fixedPlans){
    const result=fixedResult(g,id),section=make("section");section.append(make("h4",label+" · "+fixedResultStatus(result,expected)));
    if(result){
      if(fixedResultComplete(result,expected))section.append(make("p","Score "+pct(result.score)+" · SR "+pct(result.success_rate),"small"));
      if(result.evidence_basis==="includes_user_accepted_supplementary")section.append(make("p","包含维护者已接受的补充材料；原始证据标记保持不变。","small"));
      const missing=result.missing_cases||[],conflicts=result.conflicts||[];
      if(missing.length){const list=make("ul");for(const item of missing)list.append(make("li",fixedCaseLabel(item)));section.append(make("p","缺少 "+missing.length+" 个指定样本","small"),list);}
      if(conflicts.length){const list=make("ul");for(const item of conflicts)list.append(make("li",fixedCaseLabel(item.case)+" · "+(item.run_ids||[]).join(" / ")));section.append(make("p","以下样本需核对，暂不发布本项成绩","small"),list);}
    }
    details.append(section);
  }
  host.append(details);
}
async function refreshFixedEvaluations(snapshotId){
  const previous=JSON.stringify([fixedEvaluationState,[...fixedEvaluations]]);
  fixedEvaluationState="pending";fixedEvaluations=new Map();
  try{
    const response=await fetch("api/v1/evaluations.json",{cache:"no-cache",credentials:"omit",redirect:"error"});
    if(!response.ok)throw new Error();const data=await response.json();
    if(data.schema_version!=="robodojo-api-v1"||!snapshotId||data.snapshot_id!==snapshotId||!Array.isArray(data.experiments))throw new Error();
    const ids=data.experiments.map(e=>e.experiment_id);if(new Set(ids).size!==ids.length)throw new Error();
    fixedEvaluations=new Map(data.experiments.map(e=>[e.experiment_id,e.evaluation_scores]));fixedEvaluationState="ready";
  }catch{/* A later refresh retries even when the index has not changed. */}
  return previous!==JSON.stringify([fixedEvaluationState,[...fixedEvaluations]]);
}
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
    card.append(make("h3",experimentName(g)),
      make("div",g.model.thinking_effort+" effort · Codex "+g.model.client_version+" · "+g.protocol.native_control_cap+" controls / EEF · "+g.protocol.max_decisions+" decisions / episode","small"));
    const multiRound=(g.rounds||[]).length>1&&g.metrics.expected!=null;
    const complete=g.aggregation_status==="complete",ambiguous=g.aggregation_status==="ambiguous_multiple_attempts";
    const metrics=make("div",undefined,"metrics");
    for(const [value,label] of [[coverage(g.metrics),"completed & published"],[pct(complete?g.metrics.score:g.metrics.observed_score),complete?"Score":multiRound?"Completed-round score":"Current score"],[pct(complete?g.metrics.success_rate:g.metrics.observed_success_rate),complete?"Success rate":multiRound?"Completed-round SR":"Current success rate"]]){
      const item=make("div",undefined,"metric");item.append(make("strong",value),make("span",label));metrics.append(item);
    }
    card.append(metrics);
    const progress=make("progress");progress.hidden=g.metrics.expected==null;progress.max=g.metrics.expected||1;progress.value=g.metrics.completed;
    progress.setAttribute("aria-label",g.metrics.completed+" of "+g.metrics.expected+" episodes completed and published");card.append(progress);
    card.append(make("p",ambiguous?"Multiple attempts overlap an episode. Scores are withheld until its result is resolved.":complete?"All selected episodes are complete.":multiRound?"The campaign score averages completed rounds equally. Partial rounds are listed below and excluded from the round mean and standard deviation.":g.metrics.expected==null?"总量未设定；仅展示当前已上传样本，不推断实验完成。":"Current scores use completed episodes only. The final score appears at full coverage.","small"));
    renderRounds(card,g);
    const dimensions=make("details"),dimensionTitle=make("summary","Capability scores and coverage");dimensions.append(dimensionTitle);
    for(const [name,m]of Object.entries(g.dimensions)){
      const row=make("div",undefined,"dimension"),bar=make("div",undefined,"bar"),fill=make("span");
      fill.style.width=(typeof m.observed_score==="number"?Math.max(0,Math.min(100,m.observed_score*100)):0)+"%";bar.append(fill);
      row.append(make("span",name),bar,make("span",pct(m.observed_score)),make("span",coverage(m).replaceAll(" ","")));dimensions.append(row);
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
  section.append(make("h4",stats.expected_rounds==null?"按 seed / scene 展示已上传样本（总量未设定）":"Rounds · "+stats.completed_rounds+" / "+stats.expected_rounds+" complete"));
  if(g.selection_title)section.append(make("p",g.selection_title,"small"));
  if(g.preserved_unselected_run_ids?.length)section.append(make("p",g.preserved_unselected_run_ids.length+" original records are preserved in the episode ledger but are outside this round selection and excluded from its score and standard deviation.","small"));
  if(g.historical_campaign)section.append(make("p","Historical campaign: original outcomes are regrouped by the declared round selection. Reused results retain their original policy and protocol in the source breakdown.","small"));
  const table=make("table"),head=make("tr");
  for(const label of ["轮次","场景配置","已发布","Score","SR","Tokens","平均 tokens / run","调用与缺失"])head.append(make("th",label));table.append(head);
  for(const r of rounds){
    const config=roundConfiguration(r);
    const row=make("tr"),status=r.status==="complete"?"complete":r.status==="ambiguous_multiple_attempts"?"overlapping attempts":r.status==="open"?"总量未设定":"partial";
    const c=costsFor(r);
    for(const value of [r.round,config,coverage(r.metrics)+" · "+status,pct(r.metrics.score),pct(r.metrics.success_rate),tokenLines(c),tokenLines(c,true),costNote(c)])row.append(make("td",value));table.append(row);
  }
  const wrap=make("div",undefined,"table-wrap");wrap.append(table);section.append(wrap);
  const variation=make("p",undefined,"small round-stddev");
  variation.textContent=stats.completed_rounds<2?"轮间标准差：— · 至少需要 2 个完整且无歧义的轮次。":
    "轮间标准差：Score "+points(standardDeviation(stats.score_variance_pp2))+" · SR "+points(standardDeviation(stats.success_rate_variance_pp2))+"（"+stats.completed_rounds+" 个完整轮）";
  section.append(variation,make("p","标准差表示这些完整轮次之间的成绩波动。各轮场景或变体可能不同，并非同一配置换 seed 的重复实验；每轮五类能力等权。","small"));card.append(section);
}
// Experiment membership comes from the published index, never from name matching.
let selectedGroupId = null, selectedRound = "1", selectedCapability = "all";
let selectedRowKey = null, selectedRowSignature = null, visibleRows = [], activeVideo = null, detailGeneration = 0;
let taskFocus = null, showHiddenGroups = false, preferencesPersistent = true;
const preferencesKey = "robodojo-l3.dashboard.preferences.v1";
function readPreferences(){
  try{
    const raw=localStorage.getItem(preferencesKey);if(!raw)return new Map();
    const saved=JSON.parse(raw);
    if(saved?.version!==1||!saved.groups||typeof saved.groups!=="object"||Array.isArray(saved.groups))return new Map();
    // Older preferences may contain aliases; shared names never read them.
    return new Map(Object.entries(saved.groups).filter(([,value])=>value&&typeof value==="object"&&value.hidden===true)
      .map(([id])=>[id,{hidden:true}]));
  }catch{preferencesPersistent=false;return new Map();}
}
const groupPreferences = readPreferences();
const preferenceFor = g => groupPreferences.get(g.group_id)||{hidden:false};
const visibleGroups = () => ledger.groups.filter(g=>!preferenceFor(g).hidden);
const episodeKey = e => JSON.stringify([e.task,e.variant,e.seed,e.scene]);
const rowKey = row => JSON.stringify([row.round,episodeKey(row.episode)]);
const originalExperimentName = g => g.model.name + " · " + g.protocol.profile + " · " + g.model.thinking_effort;
// Maintainer-owned catalog contract: experiment_names maps exact group_id to a
// shared display string. It never changes membership or original protocol IDs.
function experimentName(g){
  const names=ledger.experiment_names;
  const value=names&&typeof names==="object"&&!Array.isArray(names)&&Object.prototype.hasOwnProperty.call(names,g.group_id)?names[g.group_id]:null;
  return typeof value==="string"&&value.trim()?value.trim():originalExperimentName(g);
}
function experimentOptionName(g,groups){
  const name=experimentName(g),duplicates=groups.filter(item=>experimentName(item)===name);
  if(duplicates.length<2)return name;
  const suffix=duplicates.filter(item=>item.selection_id===g.selection_id).length>1?g.selection_id+" · "+g.group_id:g.selection_id;
  return name+" · "+suffix;
}
const groupLabel = g => (ledger.round_selections||[]).some(s=>s.id===g.selection_id)?"汇总组":"实验组";
function updateGroupPreference(g,change){
  const next={hidden:typeof change.hidden==="boolean"?change.hidden:preferenceFor(g).hidden};
  if(next.hidden)groupPreferences.set(g.group_id,next);else groupPreferences.delete(g.group_id);
  try{localStorage.setItem(preferencesKey,JSON.stringify({version:1,groups:Object.fromEntries(groupPreferences)}));preferencesPersistent=true;}
  catch{preferencesPersistent=false;}
  ensureVisibleSelection();renderExperiments();renderExperiment();
}
function ensureVisibleSelection(){
  if(selectedGroup()&&!preferenceFor(selectedGroup()).hidden)return;
  const next=[...visibleGroups()].sort((a,b)=>b.metrics.completed-a.metrics.completed)[0];
  clearDetail();selectedGroupId=next?.group_id||null;
  if(next&&selectedRound!=="all"&&!next.rounds.some(r=>String(r.round)===selectedRound))selectedRound=String(next.rounds[0]?.round||1);
}
function renderGroupSettings(card,g){
  const settings=make("details",undefined,"group-settings"),summary=make("summary","显示设置");
  const hideLabel=make("label",undefined,"hide-group"),hide=make("input");hide.type="checkbox";hide.checked=preferenceFor(g).hidden;
  hide.addEventListener("change",()=>updateGroupPreference(g,{hidden:hide.checked}));hideLabel.append(hide,make("span","暂时隐藏本组"));
  settings.append(summary,hideLabel);card.append(settings);
}
function uploadExample(g){
  const members=new Set(g.run_ids||[]);
  const source=ledger.runs.find(r=>members.has(r.run_id)&&r.selection?.id&&r.protocol?.id&&r.protocol?.profile);
  if(!source)return null;
  const matches=r=>r.selection?.id===source.selection.id&&r.protocol?.id===source.protocol.id&&r.protocol?.profile===source.protocol.profile;
  const ids=new Set(ledger.runs.filter(r=>members.has(r.run_id)&&matches(r)).map(r=>r.run_id));
  return {selection:{id:source.selection.id},protocol:{id:source.protocol.id,profile:source.protocol.profile},
    rounds:(g.rounds||[]).filter(r=>(r.run_ids||[]).some(id=>ids.has(id))).map(r=>r.round)};
}
function uploadFields(example){
  return {"selection.id":example.selection.id,"protocol.id":example.protocol.id,"protocol.profile":example.protocol.profile};
}
function renderUploadFooter(card,g){
  const example=uploadExample(g),footer=make("div",undefined,"upload-fields");
  footer.append(make("b","本组上传字段"));
  if(!example){footer.append(make("span","暂无已接入的上传字段","small"));card.append(footer);return;}
  if(example.rounds.length)footer.append(make("span","这组编号对应 "+example.rounds.map(r=>"R"+r).join(" / "),"small"));
  for(const [key,value] of Object.entries(uploadFields(example))){
    const row=make("div");row.append(make("span",key),make("code",value));footer.append(row);
  }
  const copy=make("button","复制这三个字段","copy-upload");copy.type="button";
  const status=make("span","","copy-status");status.setAttribute("role","status");
  copy.addEventListener("click",async()=>{
    const raw=JSON.stringify(uploadFields(example),null,2);
    try{await navigator.clipboard.writeText(raw);status.textContent="已复制";}
    catch{const text=make("textarea");text.value=raw;text.readOnly=true;footer.append(text);text.focus();text.select();status.textContent="已选中，请复制";}
  });
  footer.append(copy,status);card.append(footer);
}
const selectedGroup = () => ledger.groups.find(g=>g.group_id===selectedGroupId);
const outcomeLabel = row => row.runs.length>1?"结果待核对":!row.runs.length?"未发布":row.runs[0].outcome.success===true?"成功":row.runs[0].outcome.success===false?"失败":"未知";
const outcomeClass = row => row.runs.length!==1?"pending":row.runs[0].outcome.success===true?"success":row.runs[0].outcome.success===false?"failure":"pending";
function experimentRows(g, roundNumber){
  const groupIds=new Set(g.run_ids), members=ledger.runs.filter(r=>groupIds.has(r.run_id));
  const overlay=(ledger.round_selections||[]).find(s=>s.id===g.selection_id);
  let expected=[];
  if(!overlay && members.length){
    expected=members.find(r=>r.selection?.expected_episodes)?.selection.expected_episodes||[];
    if(g.metrics?.expected===null)expected=[...new Map(members.map(r=>[episodeKey(r.episode),r.episode])).values()];
    const signature=items=>JSON.stringify(items.map(e=>[episodeKey(e),e.capability]).sort());
    if(g.metrics?.expected!==null&&members.some(r=>r.selection?.expected_episodes&&signature(r.selection.expected_episodes)!==signature(expected)))throw new Error("Inconsistent experiment selection");
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
  if(selectedGroupId===g.group_id||preferenceFor(g).hidden)return;
  clearDetail();selectedGroupId=g.group_id;
  if(selectedRound!=="all"&&!g.rounds.some(r=>String(r.round)===selectedRound))selectedRound=String(g.rounds[0]?.round||1);
  renderExperiments();renderExperiment();
}
function selectRound(value){
  if(selectedRound===value)return;
  clearDetail();selectedRound=value;renderExperiment();
}
function matchingTask(rows,focus){
  const same=rows.filter(row=>row.episode.task===focus.episode.task&&row.episode.variant===focus.episode.variant);
  return same.find(row=>episodeKey(row.episode)===episodeKey(focus.episode)&&row.round===focus.round)
    ||same.find(row=>episodeKey(row.episode)===episodeKey(focus.episode))
    ||same.find(row=>row.episode.seed===focus.episode.seed&&row.round===focus.round)
    ||same.find(row=>row.episode.seed===focus.episode.seed)||same.find(row=>row.round===focus.round)||same[0];
}
function renderDetailNavigation(g){
  const groups=byId("detail-experiment"),rounds=byId("detail-round");groups.replaceChildren();rounds.replaceChildren();
  const available=visibleGroups();
  for(const item of available){const option=make("option",experimentOptionName(item,available));option.value=item.group_id;groups.append(option);}
  groups.value=g.group_id;
  for(const [value,label] of [["all","全部轮次"],...g.rounds.map(r=>[String(r.round),"R"+r.round+" · "+coverage(r.metrics)])]){
    const option=make("option",label);option.value=value;rounds.append(option);
  }
  rounds.value=selectedRound;
}
function experimentSummary(g){
  const rounds=g.rounds||[], completeRounds=rounds.filter(r=>r.status==="complete"), multiple=rounds.length>1&&g.metrics.expected!=null;
  const ambiguous=g.aggregation_status==="ambiguous_multiple_attempts";
  const statistics=g.round_statistics||{}, finite=v=>typeof v==="number"&&Number.isFinite(v);
  const score=ambiguous?null:multiple?statistics.score_mean:g.aggregation_status==="complete"?g.metrics.score:g.metrics.observed_score;
  const sr=ambiguous?null:multiple?statistics.success_rate_mean:g.aggregation_status==="complete"?g.metrics.success_rate:g.metrics.observed_success_rate;
  const n=completeRounds.length;
  const stddev=!ambiguous&&n>=2&&statistics.completed_rounds===n?standardDeviation(statistics.score_variance_pp2):null;
  const capabilities=["Generalization","Precision","Long-Horizon","Memory","Open"].map(name=>{
    const dimension=g.dimensions?.[name]||{};
    const values=completeRounds.map(r=>r.dimensions?.[name]?.score);
    const value=ambiguous?null:multiple?(n&&values.every(finite)?values.reduce((a,b)=>a+b,0)/n:null):dimension.observed_score;
    return {name,score:value,completed:dimension.completed||0,expected:dimension.expected};
  });
  return {score,sr,stddev,n,capabilities,basis:ambiguous?"结果有重叠，成绩暂不归约":multiple?"仅完整轮等权均值":g.aggregation_status==="complete"?"完整第一轮":"当前已发布部分，非最终成绩"};
}
function renderExperimentSummary(button,g){
  renderFixedScores(button,g,true);
  const value=experimentSummary(g),stats=make("span",undefined,"card-stats");
  for(const [text,label] of [[pct(value.score),"已发布轮次汇总 Score"],[points(value.stddev),"Score 标准差"]]){
    const item=make("span",undefined,"card-stat");item.append(make("b",text),make("span",label));stats.append(item);
  }
  const c=costsFor(g),tokens=make("span",undefined,"card-tokens");
  for(const [label,value] of [["平均输入 / run",tokenText(c,"input_tokens",true)],["平均输出 / run",tokenText(c,"output_tokens",true)],["平均合计 / run",tokenText(c,"total_tokens",true)]]){const row=make("span");row.append(make("span",label),make("b",value));tokens.append(row);}
  button.append(tokens,make("span",costNote(c),"card-stat-note"));
  button.append(stats,make("span","SR "+pct(value.sr)+" · 完整轮 n="+value.n+" · 轮间波动","card-stat-note"),make("span",value.basis,"card-stat-note"));
  const divisions=make("span",undefined,"card-capabilities");
  const names={Generalization:"泛化",Precision:"精细操作","Long-Horizon":"长程",Memory:"记忆",Open:"开放"};
  for(const item of value.capabilities){
    const row=make("span",undefined,"card-capability");row.title=item.name;
    row.append(make("span",names[item.name]),make("b",pct(item.score)),make("span",coverage(item).replaceAll(" ","")));divisions.append(row);
  }
  button.append(divisions);
}
function renderExperiments(){
  const host=byId("experiments"),q=byId("experiment-search").value.trim().toLowerCase();host.replaceChildren();
  const hidden=ledger.groups.filter(g=>preferenceFor(g).hidden).length,toggle=byId("show-hidden");
  toggle.textContent=(showHiddenGroups?"收起隐藏组":"显示隐藏组")+" ("+hidden+")";toggle.disabled=!hidden;toggle.setAttribute("aria-pressed",String(showHiddenGroups));
  byId("restore-hidden").hidden=!hidden;
  byId("preferences-status").textContent=preferencesPersistent?"实验名称由维护者统一设置；隐藏设置仅在本浏览器保存。":"实验名称由维护者统一设置；本浏览器无法持久保存隐藏设置，本次页面内仍有效。";
  const ordered=[...ledger.groups].sort((a,b)=>["low","medium","high","xhigh"].indexOf(a.model.thinking_effort)-["low","medium","high","xhigh"].indexOf(b.model.thinking_effort));
  for(const g of ordered.filter(g=>(showHiddenGroups||!preferenceFor(g).hidden)&&[experimentName(g),originalExperimentName(g),g.selection_id,g.protocol.id,g.selection_title].join(" ").toLowerCase().includes(q))){
    const hidden=preferenceFor(g).hidden,card=make("article",undefined,"experiment-card"+(g.group_id===selectedGroupId?" selected":"")+(hidden?" hidden-preview":""));
    const button=make("button",undefined,"experiment-select");button.type="button";
    button.disabled=hidden;
    button.setAttribute("aria-pressed",String(g.group_id===selectedGroupId));button.setAttribute("aria-label",experimentName(g));
    button.append(make("span",g.model.thinking_effort.toUpperCase()+(hidden?" · 已隐藏":""),"effort"),make("span","实验名称","card-label"),make("strong",experimentName(g)),make("span",g.model.name+" · 原始 profile："+g.protocol.profile,"small"),make("span",coverage(g.metrics)+" 已发布 · "+(g.rounds||[]).length+" 轮","card-coverage"));
    renderExperimentSummary(button,g);button.append(make("span",groupLabel(g)+" · "+g.selection_id,"experiment-id"));
    button.addEventListener("click",()=>selectExperiment(g));card.append(button);renderGroupSettings(card,g);renderUploadFooter(card,g);host.append(card);
  }
  if(!host.children.length)host.append(make("p",hidden===ledger.groups.length&&hidden?"所有实验已隐藏。可显示隐藏组，或恢复全部隐藏组。":"没有匹配的实验。试试名称、medium、cap20 或实验 ID。","small"));
}
function renderExperiment(){
  const g=selectedGroup();byId("workspace").hidden=!g;if(!g)return;
  byId("experiment-title").textContent=experimentName(g);
  byId("experiment-id").textContent="原始 profile："+g.protocol.profile+" · "+groupLabel(g)+"："+g.selection_id;
  renderDetailNavigation(g);renderFixedEvaluationSummary(g);
  const rounds=byId("round-tabs");rounds.replaceChildren();
  for(const [value,label] of [["all","全部轮次"],...(g.rounds||[]).map(r=>[String(r.round),"R"+r.round+" · "+coverage(r.metrics)])]){
    if(value==="all"&&g.rounds.length===1)continue;
    const b=make("button",label,"pill"+(selectedRound===value?" active":""));b.type="button";b.setAttribute("aria-pressed",String(selectedRound===value));
    b.addEventListener("click",()=>selectRound(value));rounds.append(b);
  }
  const round=g.rounds.find(r=>String(r.round)===selectedRound),m=round?round.metrics:g.metrics;
  const isComplete=round?round.status==="complete":g.aggregation_status==="complete";
  const metrics=byId("experiment-metrics");metrics.replaceChildren();
  for(const [value,label] of [[coverage(m),"当前范围已发布"],[pct(m.score),round?"本轮 Score":"所有轮次 Score"],[pct(m.success_rate),"当前范围 SR"]]){
    const item=make("div",undefined,"metric");item.append(make("strong",value),make("span",label));metrics.append(item);
  }
  renderTokenSummary(g,round);
  if(byId("cost-note"))byId("cost-note").textContent="平均 / run = 本范围 token 总量 ÷ 已发布 run 数，含失败和重试；缓存已包含在输入中。≥ 表示用量有缺失、这里只显示已知下界。运行中或尚未上传的开销不在此表。";
  byId("round-config").textContent=round?roundConfiguration(round):"各轮的 seed、scene 和 variant 按原始轮次定义分别列出。";
  byId("coverage-note").textContent=m.expected==null?"总量未设定，按已上传样本展示；不声明完整轮或最终成绩。":isComplete?"本范围已完整发布 · 五类能力等权。" : "本范围尚未完整发布；完整 Score / SR 暂不显示。未发布不代表未运行或失败。";
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
    b.addEventListener("click",()=>{selectedCapability=name;taskFocus=null;renderCapabilities();renderRuns();});host.append(b);
  }
}
function renderRuns(){
  const g=selectedGroup(),host=byId("episodes");host.replaceChildren();if(!g)return;
  const q=byId("search").value.trim().toLowerCase(),variant=byId("variant").value,outcome=byId("outcome").value;
  let rows;try{rows=experimentRows(g,selectedRound);}catch{clearDetail();byId("task-count").textContent="实验范围不一致，暂不合并结果。";return;}
  visibleRows=rows.filter(row=>(selectedCapability==="all"||row.episode.capability===selectedCapability)&&(variant==="all"||row.episode.variant===variant)&&(outcome==="all"||outcomeLabel(row)===outcome)&&[row.episode.task,...row.runs.map(r=>r.run_id)].join(" ").toLowerCase().includes(q));
  byId("task-count").textContent=visibleRows.length+" / "+rows.length+" 条任务结果";
  const retained=visibleRows.find(row=>rowKey(row)===selectedRowKey);
  if(!retained){
    clearDetail();const next=taskFocus?matchingTask(visibleRows,taskFocus):visibleRows[0];
    if(next)showRow(next);
    else if(taskFocus){
      byId("detail-title").textContent=taskFocus.episode.task;
      byId("detail-caption").textContent=taskFocus.episode.variant+" · 保留任务选择";
      byId("detail-body").append(make("p","当前实验、轮次或筛选中没有此任务及变体。可切换轮次、调整筛选，或从左侧另选任务。","unpublished"));
    }
  }
  else{
    taskFocus={episode:{...retained.episode},round:retained.round};
    if(JSON.stringify(retained.runs.map(r=>r.run_id))!==selectedRowSignature)showRow(retained);
  }
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
  clearDetail();taskFocus={episode:{...row.episode},round:row.round};selectedRowKey=rowKey(row);selectedRowSignature=JSON.stringify(row.runs.map(r=>r.run_id));const host=byId("detail-body");
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
function showLoadedStatus(data){byId("status").textContent="结果目录 · 每 60 秒检查更新 · 刚刚检查";const pending=data.pending_review||[],queue=data.upload_queue||[];byId("upload-status").hidden=!pending.length&&!queue.length;byId("upload-summary").textContent="上传状态 · "+queue.length+" 条处理中 · "+pending.length+" 条需补充材料";const items=byId("upload-items");items.replaceChildren();for(const row of pending){const reason=row.reason.includes("journal recovery")?"恢复请求的回执尚未被导出器完整收录，请补充正式证据包。":row.reason.includes("Builtin demo")?"含 600 步内置演示，缺少模型归属和原视频完成凭据。":row.reason;items.append(make("p",row.task+"："+reason,"small"));}for(const row of queue)items.append(make("p",row.id.slice(0,12)+" · "+({queued:"已收到，等待校验",receiving:"正在接收",validating:"正在校验",needs_check:"需要核对"}[row.status]||row.status)+(row.reason?" · "+row.reason:""),"small"));}
async function load(){if(loading)return;loading=true;try{
  let indexChanged=false;
  const response=await fetch("data/index.json",{cache:"no-cache",credentials:"omit",redirect:"error",headers:lastEtag?{"If-None-Match":lastEtag}:{}});
  if(response.status!==304){
    if(!response.ok)throw new Error();
    // Hash exactly the response bytes, not JSON reserialization. This prevents
    // a stale API deployment from being paired with a newer result catalog.
    const bytes=await response.arrayBuffer(),payload=new TextDecoder().decode(bytes);
    const digest=await crypto.subtle.digest("SHA-256",bytes);
    const snapshotId=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,"0")).join("");
    if(snapshotId!==lastSnapshotId){
      const data=JSON.parse(payload);if(!["l3-index-v1","l3-index-v2"].includes(data.schema_version)||!Array.isArray(data.runs)||!Array.isArray(data.groups))throw new Error();
      lastSnapshotId=snapshotId;indexChanged=true;
      ledger=data;configurations.clear();for(const r of data.runs)configurations.set(r.run_id,r.configuration_parameters||{});
      lastPayload=payload;
      fixedEvaluationState="pending";fixedEvaluations=new Map();
    }
    lastEtag=response.headers.get("ETag")||"";
  }else if(!lastPayload)throw new Error();
  const complete=ledger.runs.filter(r=>r.evidence_level==="native_terminal"&&r.outcome.status==="complete");
  byId("run-count").textContent=complete.length;byId("group-count").textContent=ledger.groups.length;byId("control-count").textContent=complete.reduce((n,r)=>n+r.outcome.native_controls,0).toLocaleString();
  // This fetch deliberately occurs on unchanged payloads and HTTP 304 too.
  const scoresChanged=await refreshFixedEvaluations(lastSnapshotId);showLoadedStatus(ledger);
  if(indexChanged||scoresChanged){ensureVisibleSelection();renderExperiments();renderExperiment();}
}catch{
  fixedEvaluationState="pending";fixedEvaluations=new Map();
  renderExperiments();renderExperiment();
  byId("status").textContent="The result index could not be loaded. Existing evidence is retained; automatic refresh will retry.";
}finally{loading=false;}}
for(const id of ["search","variant","outcome"])byId(id).addEventListener(id==="search"?"input":"change",()=>{taskFocus=null;renderRuns();});
byId("experiment-search").addEventListener("input",renderExperiments);
byId("detail-experiment").addEventListener("change",event=>{const g=visibleGroups().find(g=>g.group_id===event.target.value);if(g)selectExperiment(g);});
byId("detail-round").addEventListener("change",event=>selectRound(event.target.value));
byId("show-hidden").addEventListener("click",()=>{showHiddenGroups=!showHiddenGroups;renderExperiments();});
byId("restore-hidden").addEventListener("click",()=>{
  for(const g of ledger.groups)groupPreferences.delete(g.group_id);
  const first=ledger.groups[0];if(first)updateGroupPreference(first,{});
});
byId("close-detail").addEventListener("click",()=>{taskFocus=null;clearDetail();});
load();setInterval(()=>{if(!document.hidden)load();},60000);
document.addEventListener("visibilitychange",()=>{if(!document.hidden)load();});
