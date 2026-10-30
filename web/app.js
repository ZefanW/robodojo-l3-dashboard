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
const isTemporaryReview = g => g?.temporary_review?.schema_version==="l3-temporary-upload-review-v1"
  &&g.temporary_review.status==="awaiting_user_review"&&g.aggregation_status==="awaiting_user_review";
const batchStatistics = g => g?.batch_statistics?.schema_version==="l3-uploaded-batch-statistics-v1"
  &&g.batch_statistics.basis==="equal_published_run_weight"?g.batch_statistics:null;
// Only the explicitly authorized eight-case diagnostic tab uses its own scope cards.
const isIndependentRerun = g => g?.selection_id==="o23456-compact-first42-eight-sim-rerun-20261030"
  &&g.independent_rerun_scope?.schema_version==="l3-independent-rerun-eight-v1"
  &&g.independent_rerun_scope.selection_id===g.selection_id&&g.independent_rerun_scope.expected===8
  &&g.metrics?.expected===8&&g.display_round_selection?.plan_id===g.selection_id;
const rerunScopeBasis = g => "本页仅含明确指定的8项仿真复跑；已完成结果逐 case 等权，未发布不计零。原111项保留原分数和费用，不合并、不挑最高分。";
function renderRerunScores(host,g,compact=false){
  const b=batchStatistics(g),grid=make(compact?"span":"div",undefined,"fixed-scores"+(compact?" compact":""));
  for(const [label,value,status] of [["已完成",coverage(g.metrics),"指定8项复跑"],["已完成均分",pct(b?.score_mean),"n="+(b?.score_count??0)+" · 逐 case 等权"],["已完成成功率",pct(b?.success_rate),"n="+(b?.success_count??0)]]){
    const cell=make(compact?"span":"section",undefined,"fixed-score");
    cell.append(make("span",label,"fixed-score-label"),make("b",value,"fixed-score-value"),make("span",status,"fixed-score-status"));grid.append(cell);
  }
  host.append(grid);
}
const batchBasis = g => {
  const b=batchStatistics(g);
  return b?"逐 case 等权：平均 Score 按 "+b.score_count+" 个有分数的 case 计算，成功率按 "+b.success_count+" 个有结局的 case 计算。仅统计本批次已上传结果，不随下方筛选改变。":"当前批次统计待同步。";
};
const number = (n, decimals=0) => typeof n === "number" && Number.isFinite(n) ? n.toLocaleString("en-US",{maximumFractionDigits:decimals}) : "未知";
// Recomputed from the current catalog on every refresh, with each run counted once.
function runCosts(ids,extra=[]){
  const wanted=new Set(ids), rows=[...new Map(ledger.runs.filter(r=>wanted.has(r.run_id)).map(r=>[r.run_id,r])).values()];
  const costs=[...rows.map(r=>r.costs),...extra], complete=costs.every(c=>c?.accounting==="known");
  const sum=k=>costs.reduce((n,c)=>n+(c?.[k]||0),0);
  const knownPart=k=>costs.reduce((n,c)=>n+(typeof c?.[k]==="number"?c[k]:(c?.attempts||[]).reduce((v,a)=>v+(typeof a[k]==="number"?a[k]:0),0)),0);
  const input=knownPart("input_tokens"),output=knownPart("output_tokens"),cached=knownPart("cached_input_tokens");
  return {run_count:rows.length,total_tokens:complete?input+output:null,
    input_tokens:complete?input:null,output_tokens:complete?output:null,cached_input_tokens:complete?cached:null,
    known_input_tokens:input,known_output_tokens:output,known_cached_input_tokens:cached,
    known_token_lower_bound:sum("known_token_lower_bound"),
    paid_requests:costs.every(c=>typeof c?.paid_requests==="number")?sum("paid_requests"):null,
    unknown_usage_attempts:costs.reduce((n,c)=>n+(c?.attempts||[]).filter(a=>!a.usage_known).length,0),
    extra_attempt_runs:extra.length,
    declared_usage_runs:costs.filter(c=>c?.receipt_identity_verified===false).length,
    incomplete_cost_runs:costs.filter(c=>c?.accounting!=="known").length};
}
function priorCostsFor(scope){
  const group=scope.group_id?scope:ledger.groups.find(g=>(g.rounds||[]).includes(scope));
  if(!group)return [];
  const published=new Set(ledger.runs.map(r=>r.run_id)), wanted=new Set(scope.run_ids||[]);
  const allowed=new Set((ledger.authorized_episode_substitutions||[])
    .filter(s=>s.selection_id===group.selection_id&&wanted.has(s.selected_run_id))
    .flatMap(s=>s.previous_invalid_attempt_ids||[]));
  return [...new Map((group.prior_invalid_attempt_costs||[])
    .filter(c=>!published.has(c.run_id)&&(scope===group||allowed.has(c.run_id)))
    .map(c=>[c.run_id,c])).values()];
}
const costsFor = g => runCosts(g.run_ids||[],priorCostsFor(g));
let apiCostCatalog=null,apiCostCache=new WeakMap();
function apiCostsFor(scope){
  if(!globalThis.ApiCost)return null;
  // A fetched catalog is immutable; discard projections when a new snapshot
  // arrives. The membership stamp also covers incremental fixture/client adds.
  if(apiCostCatalog!==ledger){apiCostCatalog=ledger;apiCostCache=new WeakMap();}
  const stamp=(scope.run_ids||[]).join("\0")+":"+ledger.runs.length,cached=apiCostCache.get(scope);
  if(cached?.stamp===stamp)return cached.value;
  const wanted=new Set(scope.run_ids||[]), rows=[...new Map(ledger.runs.filter(r=>wanted.has(r.run_id)).map(r=>[r.run_id,r])).values()];
  const owner=scope.group_id?scope:ledger.groups.find(g=>(g.rounds||[]).includes(scope));
  const extra=priorCostsFor(scope);
  const value={...ApiCost.estimate([...rows.map(r=>({run_id:r.run_id,model:r.model,costs:r.costs})),
    ...extra.map(c=>({run_id:c.run_id,model:owner?.model,costs:c}))],rows.length),extra_attempt_runs:extra.length,run_count:rows.length};
  apiCostCache.set(scope,{stamp,value});return value;
}
function usd(v,direction="round"){
  if(typeof v!=="number"||!Number.isFinite(v)||v<0)return "—";
  if(v>0&&v<1e-8)return "<$0.00000001";
  const digits=v>0&&v<.01?Math.min(8,Math.ceil(-Math.log10(v))+1):2;
  const scale=10**digits;
  if(direction==="down")v=Math.floor(v*scale)/scale;
  if(direction==="up")v=Math.ceil(v*scale)/scale;
  return "$"+v.toLocaleString("en-US",{minimumFractionDigits:digits,maximumFractionDigits:digits});
}
function apiReferenceText(c){
  if(!c||c.avg_observed_min==null)return "—";
  const lo=usd(c.avg_observed_min,"down"),hi=usd(c.avg_observed_max,"up");
  return (c.partial?"已知部分 ":"")+(lo===hi?lo:lo+"–"+hi);
}
function appendApiCosts(host,scope,compact=false){
  const c=apiCostsFor(scope),box=make(compact?"span":"div",undefined,compact?"card-api-cost":"api-cost-summary");
  const reference=make("span"),floor=make("span");
  reference.append(make("span","实测缓存 API / 例"),make("b",apiReferenceText(c)));
  floor.append(make("span","全缓存乐观下界 / 例"),make("b",usd(c?.avg_optimistic_min,"down")));
  box.append(reference,floor);
  box.title="美元，按已发布样本数算术平均。沿用实测缓存命中量；区间反映缓存写入量及部分请求长度未知。全缓存下界忽略首次与新输入费用，不是可实现的理想成本。";
  if(!compact){
    const notes=["Standard API 价格 · 2026-10-21 · 当前 "+(c?.run_count||0)+" 例"];
    if(c?.extra_attempt_runs)notes.push("含 "+c.extra_attempt_runs+" 次未计分尝试，分母不增加");
    if(c?.partial)notes.push("仅已知用量；未知用量不按零计，区间上端不是完整成本上界");
    if(c?.unknown_attempts)notes.push(c.unknown_attempts+" 次用量未知");
    if(c?.long_context_ambiguous_attempts)notes.push("部分记录合并多次响应，长上下文费用保留区间");
    if(c?.receipt_flags?.length)notes.push("含补件声明用量");
    if(c?.unknown_model_entries)notes.push("部分模型暂无价格映射");
    box.append(make("p",notes.join(" · "),"small"));
    const link=make("a","计价假设与论文说明 ↗");link.href="api-cost-method.html";link.target="_blank";link.rel="noopener noreferrer";box.append(link);
  }
  host.append(box);
}
const tokenText = (c,field="total_tokens",average=false) => {
  if(c.run_count===0)return "—";
  const lower={total_tokens:"known_token_lower_bound",input_tokens:"known_input_tokens",output_tokens:"known_output_tokens",cached_input_tokens:"known_cached_input_tokens"};
  const missing=c[field]==null, value=missing?c[lower[field]]:c[field];
  const displayed=average?(missing?Math.floor(value/c.run_count*10)/10:value/c.run_count):value;
  return (missing?"≥ ":"")+number(displayed,average?1:0);
};
const costNote = c => c.run_count === 0 ? "暂无已发布用量" : "付费请求 "+number(c.paid_requests)+(c.unknown_usage_attempts?" · "+number(c.unknown_usage_attempts)+" 次用量未知":c.incomplete_cost_runs?" · "+number(c.incomplete_cost_runs)+" 条账目不完整":" · 已记录用量完整")+(c.extra_attempt_runs?" · 含 "+c.extra_attempt_runs+" 次未计分尝试":"")+(c.declared_usage_runs?" · 含补件声明用量":"");
function tokenLines(c,average=false){return ["输入 "+tokenText(c,"input_tokens",average),"输出 "+tokenText(c,"output_tokens",average),"合计 "+tokenText(c,"total_tokens",average)].join("\n");}
function renderTokenSummary(g,round){
  const host=byId("token-summary");if(!host)return;host.replaceChildren();
  host.append(make("h3","Token 与 API 成本估算"),make("p","随新结果自动更新 · 已发布 run 及明确归属的历史失败尝试 · 平均值分母为已发布结果数","small"));
  const grid=make("div",undefined,"token-scopes");
  for(const [label,scope] of [...(round?[["本轮 R"+round.round,round]]:[]),[isTemporaryReview(g)?"待核查批次":"整个实验",g]]){
    const c=costsFor(scope),section=make("section",undefined,"token-scope");
    section.append(make("h4",label+" · "+c.run_count+" 个已发布 run"));
    const values=make("div",undefined,"token-values");
    for(const [field,title] of [["input_tokens","输入"],["output_tokens","输出"],["total_tokens","合计"]]){
      const cell=make("div");cell.append(make("span",title),make("strong",tokenText(c,field)),make("small","平均 / run "+tokenText(c,field,true)));values.append(cell);
    }
    section.append(values,make("p","输入中缓存 "+tokenText(c,"cached_input_tokens")+" · "+costNote(c),"small"));appendApiCosts(section,scope);grid.append(section);
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
  if(isIndependentRerun(g)){renderRerunScores(host,g,compact);return;}
  if(isTemporaryReview(g)){host.append(make(compact?"span":"p","待核查批次 · 已上传样本均值","small"));return;}
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
  if(isIndependentRerun(g)){host.append(make("h3","8项仿真复跑"),make("p",rerunScopeBasis(g),"small"));renderRerunScores(host,g);return;}
  if(isTemporaryReview(g)){host.append(make("h3","当前批次平均成绩"),make("p",batchBasis(g)+" 各方法仍独立展示，核查后再决定合并。","small"));return;}
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

/*
 * The official RoboDojo L3 reference is deliberately kept outside the
 * experiment ledger.  It is an upstream reference, not a result produced by
 * this checkout, so it must never change the experiment count or score cards.
 * The optional JSON file is published beside the catalog and is rendered only
 * after its schema and arrays have been checked.
 */
let officialLeaderboardState="pending", officialLeaderboard=null;
const officialScore=v=>typeof v==="number"&&Number.isFinite(v)?(v>=0&&v<=1?pct(v):v.toFixed(1)+"%"):"—";
const officialCount=(value,expected)=>Number.isInteger(value)?(Number.isInteger(expected)?value+" / "+expected:String(value)):"—";
const officialRate=item=>item?.success_rate??item?.sr;
const officialCompleted=item=>item?.completed??item?.episodes??item?.count;
const officialExpected=item=>item?.expected??item?.episodes;
const officialRoundId=round=>round?.id??round?.round;
function officialMetric(value,label){
  const cell=make("div",undefined,"official-metric");
  cell.append(make("span",label,"official-metric-label"),make("strong",officialScore(value),"official-metric-value"));
  return cell;
}
function officialRoundLabel(round){return round?.label||round?.name||round?.id||"未命名轮次";}
function officialRows(data){
  /* The normalized official export keeps raw 2100 slot records and also
   * publishes one 42-task case list per mapped round.  Prefer the latter for
   * the readable cross-round table, while leaving the raw records in the
   * downloaded data file for provenance. */
  if(Array.isArray(data.rounds)&&data.rounds.some(round=>Array.isArray(round.cases))){
    const grouped=new Map();
    const collections=[...(Array.isArray(data.fixed_plans)?data.fixed_plans:[]),...data.rounds];
    for(const round of collections){
      const key=round.id??officialRoundId(round);
      for(const item of (Array.isArray(round.cases)?round.cases:[])){
        if(!item||typeof item.task!=="string")continue;
        const row=grouped.get(item.task)||{task:item.task,dimension:item.dimension||item.capability,scores:{},_round_scores:[]};
        row.scores[key]=item.score; if(data.rounds.includes(round)&&typeof item.score==="number")row._round_scores.push(item.score);grouped.set(item.task,row);
      }
    }
    return [...grouped.values()].map(row=>{const scores=row._round_scores,copy={task:row.task,dimension:row.dimension,scores:row.scores};if(scores.length)copy.total_score=scores.reduce((a,b)=>a+b,0)/scores.length;return copy;});
  }
  const source=Array.isArray(data.cases)?data.cases:Array.isArray(data.records)?data.records:Array.isArray(data.tasks)?data.tasks:[];
  return source.filter(row=>row&&typeof row.task==="string");
}
function renderOfficialLeaderboard(data){
  const host=byId("official-leaderboard");if(!host)return;
  host.replaceChildren();host.hidden=true;
  if(!data||data.schema_version!=="robodojo-official-l3-v1"||!Array.isArray(data.rounds)||!officialRows(data).length)return;
  const title=typeof data.title==="string"&&data.title.trim()?data.title:"官方 RoboDojo L3 统分结果";
  const source=data.source&&typeof data.source==="object"?data.source:{};
  const head=make("div",undefined,"official-leaderboard-head");
  const heading=make("div"),titleNode=make("h2",title);titleNode.id="official-leaderboard-title";heading.append(make("p","OFFICIAL REFERENCE","eyebrow"),titleNode);
  const sourceLine=make("p","上游参照，独立于本页实验成绩。","small");
  const sourceLinks=[];if(typeof source.url==="string")sourceLinks.push([source.label||"官方来源",source.url]);
  if(source.urls&&typeof source.urls==="object")for(const [key,value] of Object.entries(source.urls))if(typeof value==="string")sourceLinks.push([key,value]);
  if(typeof source.readme_url==="string")sourceLinks.push(["官方说明",source.readme_url]);
  if(typeof source.per_task_url==="string")sourceLinks.push(["逐任务数据",source.per_task_url]);
  if(typeof source.case_url==="string")sourceLinks.push(["原始 case 数据",source.case_url]);
  if(typeof source.records_url==="string")sourceLinks.push(["全量 slot 记录",source.records_url]);
  if(typeof source.official_cases_url==="string")sourceLinks.push(["全量官方 case",source.official_cases_url]);
  if(typeof source.official_leaderboard_url==="string")sourceLinks.push(["官方排行榜",source.official_leaderboard_url]);
  if(typeof source.leaderboard_url==="string")sourceLinks.push(["官方排行榜",source.leaderboard_url]);
  if(typeof source.auxiliary_url==="string")sourceLinks.push(["HF 运行控制台",source.auxiliary_url]);
  for(const [label,url] of sourceLinks){sourceLine.append(make("span"," "),link(label+" ↗",url));}
  if(typeof source.updated_at==="string")sourceLine.append(make("span"," · 更新 "+source.updated_at,"small"));
  heading.append(sourceLine);head.append(heading);
  if(typeof data.note==="string")head.append(make("p",data.note,"official-note"));
  host.append(head);
  const rounds=data.rounds;
  const totalValues=(Array.isArray(data.totals)?data.totals:[]).filter(item=>item&&typeof item==="object");
  for(const item of [data.official_total,data.local_eight_round_total])if(item&&typeof item==="object")totalValues.push(item);
  const summary=make("div",undefined,"official-summary");
  /* Keep the reference block compact: show the official total, the two
   * proxy views, the first-round view, and the aggregate eight-round view.
   * The per-round R1--R8 values remain in the published JSON and per-task
   * table, but do not occupy the main leaderboard surface. */
  const compactIds=new Set(["official_2100","first_round","spiky2_65","P50_111","local_eight_total"]);
  const compactItems=[];
  for(const item of [...totalValues,...(Array.isArray(data.fixed_plans)?data.fixed_plans:[]),...rounds]){
    if(!item||typeof item!=="object")continue;
    const id=item.id??item.round;
    if(!compactIds.has(id)||compactItems.some(entry=>(entry.item.id??entry.item.round)===id))continue;
    compactItems.push({item,total:id==="official_2100"||id==="local_eight_total"});
  }
  const summaryItems=compactItems;
  for(const entry of summaryItems){
    const item=entry.item,card=make("section",undefined,"official-round"+(entry.total?" official-total":""));
    card.append(make("h3",item.label||officialRoundLabel(item)));
    const metrics=make("div",undefined,"official-metrics");
    metrics.append(officialMetric(item.score,"总分"),officialMetric(officialRate(item),"成功率"));
    if(Number.isInteger(officialCompleted(item))||Number.isInteger(officialExpected(item)))metrics.append(make("div",undefined,"official-metric"),make("span","覆盖","official-metric-label"),make("strong",officialCount(officialCompleted(item),officialExpected(item)),"official-metric-value"));
    card.append(metrics);if(typeof item.note==="string")card.append(make("p",item.note,"small"));if(typeof item.description==="string")card.append(make("p",item.description,"small"));summary.append(card);
  }
  host.append(summary);
  const dimensions=Array.isArray(data.dimensions)?data.dimensions:[];
  if(dimensions.length){
    const detail=make("details",undefined,"official-cases");detail.append(make("summary","查看维度 / 阶段统分"));
    const wrap=make("div",undefined,"table-wrap"),table=make("table"),headRow=make("tr");
    for(const label of ["维度","总分","成功率","完成 / 总量"] )headRow.append(make("th",label));table.append(headRow);
    for(const item of dimensions){const row=make("tr");row.append(make("td",item.label||item.dimension||item.name||"—"),make("td",officialScore(item.score)),make("td",officialScore(officialRate(item))),make("td",officialCount(officialCompleted(item),officialExpected(item))));table.append(row);}
    wrap.append(table);detail.append(wrap);host.append(detail);
  }
  const rows=officialRows(data),columns=Array.isArray(data.case_columns)?data.case_columns:[...(Array.isArray(data.fixed_plans)?data.fixed_plans:[]),...rounds].map(round=>({id:round.id??officialRoundId(round),label:officialRoundLabel(round)}));
  if(rows.length){
    const details=make("details",undefined,"official-cases");details.open=false;details.append(make("summary","查看每个 task 的官方成绩（"+rows.length+" 项）"));
    const wrap=make("div",undefined,"table-wrap"),table=make("table"),headRow=make("tr");headRow.append(make("th","task"));
    for(const col of columns){const id=typeof col==="string"?col:col.id,label=typeof col==="string"?col:(col.label||id);const th=make("th",label);th.dataset.column=id;headRow.append(th);}headRow.append(make("th",totalValues.length?totalValues[totalValues.length-1].label||"总分":"总分"));table.append(headRow);
    for(const row of rows){
      const tr=make("tr");tr.append(make("td",row.task));const scores=row.scores&&typeof row.scores==="object"?row.scores:{};
      for(const col of columns){const id=typeof col==="string"?col:col.id;tr.append(make("td",officialScore(scores[id]??row[id])));}
      tr.append(make("td",officialScore(row.total_score??row.score)));table.append(tr);
    }
    wrap.append(table);details.append(wrap);host.append(details);
  }
  if(typeof data.provenance_note==="string")host.append(make("p",data.provenance_note,"small"));
  host.hidden=false;
}
async function refreshOfficialLeaderboard(){
  try{
    const response=await fetch("data/official-robodojo-l3.json",{cache:"no-cache",credentials:"omit",redirect:"error"});
    if(!response.ok)throw new Error();const data=await response.json();
    if(data?.schema_version!=="robodojo-official-l3-v1")throw new Error();
    officialLeaderboard=data;officialLeaderboardState="ready";renderOfficialLeaderboard(data);
  }catch{officialLeaderboard=null;officialLeaderboardState="unavailable";const host=byId("official-leaderboard");if(host){host.replaceChildren();host.hidden=true;}}
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
    const batch=batchStatistics(g);
    const auditMetrics=isTemporaryReview(g)||batch?[[coverage(g.metrics),"已上传 case"],[pct(batch?.score_mean),"已上传平均 Score"],[pct(batch?.success_rate),"已上传成功率"]]:[[coverage(g.metrics),"completed & published"],[pct(complete?g.metrics.score:g.metrics.observed_score),complete?"Score":multiRound?"Completed-round score":"Current score"],[pct(complete?g.metrics.success_rate:g.metrics.observed_success_rate),complete?"Success rate":multiRound?"Completed-round SR":"Current success rate"]];
    for(const [value,label] of auditMetrics){
      const item=make("div",undefined,"metric");item.append(make("strong",value),make("span",label));metrics.append(item);
    }
    card.append(metrics);
    const progress=make("progress");progress.hidden=g.metrics.expected==null;progress.max=g.metrics.expected||1;progress.value=g.metrics.completed;
    progress.setAttribute("aria-label",g.metrics.completed+" of "+g.metrics.expected+" episodes completed and published");card.append(progress);
    card.append(make("p",ambiguous?"Multiple attempts overlap an episode. Scores are withheld until its result is resolved.":complete?"All selected episodes are complete.":multiRound?"The campaign score averages completed rounds equally. Partial rounds are listed below and excluded from the round mean and standard deviation.":g.metrics.expected==null?"总量未设定；仅展示当前已上传样本，不推断实验完成。":"Current scores use completed episodes only. The final score appears at full coverage.","small"));
    renderRounds(card,g);
    const dimensions=make("details"),dimensionTitle=make("summary","Capability scores and coverage");dimensions.append(dimensionTitle);
    const capabilityMetrics=isTemporaryReview(g)||batch?Object.fromEntries(Object.entries(batch?.capabilities||{}).map(([name,c])=>[name,{observed_score:c.score_mean,completed:c.run_count,expected:null}])):g.dimensions;
    for(const [name,m]of Object.entries(capabilityMetrics)){
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
const experimentSortKey = "robodojo-l3.dashboard.experiment-sort.v1";
let sortPersistent = true;
function readExperimentSort(){
  try{return localStorage.getItem(experimentSortKey)==="completed"?"completed":"effort";}
  catch{sortPersistent=false;return "effort";}
}
let experimentSort = readExperimentSort();
function orderedGroups(groups){
  const effortOrder=g=>["low","medium","high","xhigh"].indexOf(g.model.thinking_effort);
  const completed=g=>Number.isFinite(g.metrics?.completed)?g.metrics.completed:0;
  return [...groups].sort((a,b)=>(experimentSort==="completed"?completed(b)-completed(a):0)||effortOrder(a)-effortOrder(b));
}
const preferenceFor = g => groupPreferences.get(g.group_id)||{hidden:false};
const visibleGroups = () => ledger.groups.filter(g=>!preferenceFor(g).hidden);
const episodeKey = e => JSON.stringify([e.task,e.variant,e.seed,e.scene]);
const rowKey = row => JSON.stringify([row.round,episodeKey(row.episode)]);
const rowScopeLabel = row => row.temporary_review===true?"待核查批次":"R"+row.round;
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
const groupLabel = g => isIndependentRerun(g)?"独立复跑组":isTemporaryReview(g)?"待核查批次":(ledger.round_selections||[]).some(s=>s.id===g.selection_id)?"汇总组":"实验组";
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
  if(isTemporaryReview(next))selectedRound="all";
  else if(next&&selectedRound!=="all"&&!next.rounds.some(r=>String(r.round)===selectedRound))selectedRound=String(next.rounds[0]?.round||1);
}
function renderGroupSettings(card,g){
  const settings=make("details",undefined,"group-settings"),summary=make("summary","显示设置");
  const hideLabel=make("label",undefined,"hide-group"),hide=make("input");hide.type="checkbox";hide.checked=preferenceFor(g).hidden;
  hide.addEventListener("change",()=>updateGroupPreference(g,{hidden:hide.checked}));hideLabel.append(hide,make("span","暂时隐藏本组"));
  settings.append(summary,hideLabel);card.append(settings);
}
function uploadExample(g){
  const members=new Set(g.run_ids||[]);
  const candidates=ledger.runs.filter(r=>members.has(r.run_id)&&r.selection?.id&&r.protocol?.id&&r.protocol?.profile);
  const source=candidates.find(r=>r.selection.id===g.selection_id)||candidates[0];
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
  if(isTemporaryReview(g)){
    // Inspection membership is the exact published run list, not an inferred
    // round plan. Preserve each original episode and its ordinary evidence UI.
    if(groupIds.size!==g.run_ids.length||members.length!==groupIds.size||new Set(members.map(r=>r.run_id)).size!==members.length)throw new Error("Invalid temporary review membership");
    return members.map(run=>({episode:run.episode,round:null,temporary_review:true,runs:[run]}))
      .sort((a,b)=>a.episode.task.localeCompare(b.episode.task)||a.episode.variant.localeCompare(b.episode.variant)||a.episode.seed-b.episode.seed||a.episode.scene-b.episode.scene);
  }
  // A group may combine immutable source selections under a fixed display plan.
  const displaySelection=g.display_round_selection;
  if(displaySelection&&(displaySelection.schema_version!=="l3-group-display-round-selection-v1"||!Array.isArray(displaySelection.rounds)))throw new Error("Invalid group display selection");
  const overlay=displaySelection||(ledger.round_selections||[]).find(s=>s.id===g.selection_id);
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
function roundDisplayLabel(g,r){
  const label=g.display_round_selection?.rounds?.find(x=>x.round===r.round)?.label;
  return typeof label==="string"&&label?label:"R"+r.round+" · "+coverage(r.metrics);
}
function releaseVideo(){if(activeVideo){activeVideo.pause();activeVideo.removeAttribute("src");activeVideo.load();activeVideo=null;}}
function clearDetail(){detailGeneration++;releaseVideo();selectedRowKey=null;selectedRowSignature=null;byId("detail-body").replaceChildren();byId("detail-title").textContent="选择一个任务";byId("detail-caption").textContent="查看原生结果、三路视频与动作反馈。";}
function selectExperiment(g){
  if(selectedGroupId===g.group_id||preferenceFor(g).hidden)return;
  clearDetail();selectedGroupId=g.group_id;
  if(isTemporaryReview(g))selectedRound="all";
  else if(selectedRound!=="all"&&!g.rounds.some(r=>String(r.round)===selectedRound))selectedRound=String(g.rounds[0]?.round||1);
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
  const available=orderedGroups(visibleGroups());
  for(const item of available){const option=make("option",experimentOptionName(item,available));option.value=item.group_id;groups.append(option);}
  groups.value=g.group_id;
  for(const [value,label] of [["all",isTemporaryReview(g)?"待核查批次":"全部轮次"],...g.rounds.map(r=>[String(r.round),roundDisplayLabel(g,r)])]){
    const option=make("option",label);option.value=value;rounds.append(option);
  }
  rounds.value=selectedRound;
}
function experimentSummary(g){
  if(isTemporaryReview(g)||batchStatistics(g)){
    const b=batchStatistics(g)||{};
    return {score:b.score_mean??null,sr:b.success_rate??null,stddev:typeof b.score_stddev==="number"?b.score_stddev*100:null,n:b.run_count??g.run_ids.length,
      capabilities:["Generalization","Precision","Long-Horizon","Memory","Open"].filter(name=>!isIndependentRerun(g)||b.capabilities?.[name]).map(name=>{const c=b.capabilities?.[name]||{};return {name,score:c.score_mean??null,completed:c.run_count??0,expected:null};}),
      basis:"当前已上传 case 等权平均"+(isIndependentRerun(g)?" · 独立8项复跑":isTemporaryReview(g)?" · 批次尚未合并":" · 固定评测成绩见上方")+(b.unknown_score_count||b.unknown_success_count?" · 仅统计已知成绩":"")};
  }
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
  return {score,sr,stddev,n,capabilities,basis:ambiguous?"结果有重叠，成绩暂不归约":multiple?"仅完整轮等权均值":g.aggregation_status==="complete"?(g.display_round_selection?.plan_id==="P50_111"?"完整 P50_111":"完整第一轮"):"当前已发布部分，非最终成绩"};
}
function renderExperimentSummary(button,g){
  renderFixedScores(button,g,true);
  const value=experimentSummary(g),stats=make("span",undefined,"card-stats");
  for(const [text,label] of (isTemporaryReview(g)||batchStatistics(g)?[[pct(value.score),"已上传平均 Score"],[pct(value.sr),"已上传成功率"]]:[[pct(value.score),"已发布轮次汇总 Score"],[points(value.stddev),"Score 标准差"]])){
    const item=make("span",undefined,"card-stat");item.append(make("b",text),make("span",label));stats.append(item);
  }
  const c=costsFor(g),tokens=make("span",undefined,"card-tokens");
  for(const [label,value] of [["平均输入 / run",tokenText(c,"input_tokens",true)],["平均输出 / run",tokenText(c,"output_tokens",true)],["平均合计 / run",tokenText(c,"total_tokens",true)]]){const row=make("span");row.append(make("span",label),make("b",value));tokens.append(row);}
  button.append(tokens,make("span",costNote(c),"card-stat-note"));
  appendApiCosts(button,g,true);
  button.append(stats);
  if(isTemporaryReview(g)||batchStatistics(g))button.append(make("span","样本 n="+value.n+" · 单例 Score 标准差 "+points(value.stddev),"card-stat-note"));
  else button.append(make("span","SR "+pct(value.sr)+" · 完整轮 n="+value.n+" · 轮间波动","card-stat-note"));
  button.append(make("span",value.basis,"card-stat-note"));
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
  byId("preferences-status").textContent=preferencesPersistent&&sortPersistent?"实验名称由维护者统一设置；隐藏与排序设置仅在本浏览器保存。":"实验名称由维护者统一设置；部分偏好无法持久保存，本次页面内仍有效。";
  byId("experiment-sort").value=experimentSort;
  const ordered=orderedGroups(ledger.groups);
  for(const g of ordered.filter(g=>(showHiddenGroups||!preferenceFor(g).hidden)&&[experimentName(g),originalExperimentName(g),g.selection_id,g.protocol.id,g.selection_title].join(" ").toLowerCase().includes(q))){
    const hidden=preferenceFor(g).hidden,card=make("article",undefined,"experiment-card"+(g.group_id===selectedGroupId?" selected":"")+(hidden?" hidden-preview":""));
    const button=make("button",undefined,"experiment-select");button.type="button";
    button.disabled=hidden;
    button.setAttribute("aria-pressed",String(g.group_id===selectedGroupId));button.setAttribute("aria-label",experimentName(g));
    button.append(make("span",g.model.thinking_effort.toUpperCase()+(hidden?" · 已隐藏":""),"effort"),make("span","实验名称","card-label"),make("strong",experimentName(g)),make("span",g.model.name+" · 原始 profile："+g.protocol.profile,"small"),make("span",coverage(g.metrics)+" 已发布 · "+(isTemporaryReview(g)?"待核查批次":(g.rounds||[]).length+" 轮"),"card-coverage"));
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
  for(const [value,label] of [["all",isTemporaryReview(g)?"待核查批次":"全部轮次"],...(g.rounds||[]).map(r=>[String(r.round),roundDisplayLabel(g,r)])]){
    if(value==="all"&&g.rounds.length===1)continue;
    const b=make("button",label,"pill"+(selectedRound===value?" active":""));b.type="button";b.setAttribute("aria-pressed",String(selectedRound===value));
    b.addEventListener("click",()=>selectRound(value));rounds.append(b);
  }
  const round=g.rounds.find(r=>String(r.round)===selectedRound),m=round?round.metrics:g.metrics;
  const isComplete=round?round.status==="complete":g.aggregation_status==="complete";
  const metrics=byId("experiment-metrics");metrics.replaceChildren();
  const batch=batchStatistics(g);
  const displayMetrics=isTemporaryReview(g)||batch?[[coverage(m),"当前范围已上传"],[pct(batch?.score_mean),"已上传平均 Score"],[pct(batch?.success_rate),"已上传成功率"]]:[[coverage(m),"当前范围已发布"],[pct(m.score),round?"本轮 Score":"所有轮次 Score"],[pct(m.success_rate),"当前范围 SR"]];
  for(const [value,label] of displayMetrics){
    const item=make("div",undefined,"metric");item.append(make("strong",value),make("span",label));metrics.append(item);
  }
  renderTokenSummary(g,round);
  if(byId("cost-note"))byId("cost-note").textContent="平均 / run = 本范围 token 总量 ÷ 已发布 run 数，含失败和重试；缓存已包含在输入中。≥ 表示用量有缺失、这里只显示已知下界。运行中或尚未上传的开销不在此表。";
  byId("round-config").textContent=isTemporaryReview(g)?"按原始 task / variant / seed / scene 逐条核查，不声明实验轮次。":round?roundConfiguration(round):"各轮的 seed、scene 和 variant 按原始轮次定义分别列出。";
  byId("coverage-note").textContent=m.expected==null?"总量未设定，按已上传样本展示；不声明完整轮或最终成绩。":isComplete?"本范围已完整发布 · 五类能力等权。" : "本范围尚未完整发布；完整 Score / SR 暂不显示。未发布不代表未运行或失败。";
  if(!isComplete && typeof m.observed_score==="number")byId("coverage-note").textContent+=" 已发布部分 Score "+pct(m.observed_score)+" / SR "+pct(m.observed_success_rate)+"。";
  if(isTemporaryReview(g)||batch)byId("coverage-note").textContent=batchBasis(g)+(isIndependentRerun(g)?" "+rerunScopeBasis(g):isTemporaryReview(g)?"":" 固定评测的完成度与成绩见上方。");
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
    b.append(heading,make("span",rowScopeLabel(row)+" · "+row.episode.variant+" · seed "+row.episode.seed+" / scene "+row.episode.scene,"task-meta"),make("span",row.episode.capability+" · Score "+score,"task-meta"));
    b.addEventListener("click",()=>{showRow(row);renderRuns();if(typeof matchMedia!=="undefined"&&matchMedia("(max-width: 760px)").matches)byId("detail").scrollIntoView({behavior:"smooth",block:"start"});});host.append(b);
  }
  if(!visibleRows.length)host.append(make("p","没有匹配的任务，请调整筛选条件。","empty"));
}
function showRow(row){
  clearDetail();taskFocus={episode:{...row.episode},round:row.round};selectedRowKey=rowKey(row);selectedRowSignature=JSON.stringify(row.runs.map(r=>r.run_id));const host=byId("detail-body");
  byId("detail-title").textContent=row.episode.task;
  byId("detail-caption").textContent=rowScopeLabel(row)+" · "+row.episode.capability+" · "+row.episode.variant+" · seed "+row.episode.seed+" / scene "+row.episode.scene;
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
byId("experiment-sort").addEventListener("change",event=>{
  experimentSort=event.target.value==="completed"?"completed":"effort";
  try{localStorage.setItem(experimentSortKey,experimentSort);sortPersistent=true;}catch{sortPersistent=false;}
  renderExperiments();const g=selectedGroup();if(g)renderDetailNavigation(g);
});
byId("detail-experiment").addEventListener("change",event=>{const g=visibleGroups().find(g=>g.group_id===event.target.value);if(g)selectExperiment(g);});
byId("detail-round").addEventListener("change",event=>selectRound(event.target.value));
byId("show-hidden").addEventListener("click",()=>{showHiddenGroups=!showHiddenGroups;renderExperiments();});
byId("restore-hidden").addEventListener("click",()=>{
  for(const g of ledger.groups)groupPreferences.delete(g.group_id);
  const first=ledger.groups[0];if(first)updateGroupPreference(first,{});
});
byId("close-detail").addEventListener("click",()=>{taskFocus=null;clearDetail();});
refreshOfficialLeaderboard();load();setInterval(()=>{if(!document.hidden){refreshOfficialLeaderboard();load();}},60000);
document.addEventListener("visibilitychange",()=>{if(!document.hidden)load();});
