"use strict";
const FIXPROMPT_ID="o23-depthpro-coding-unlimited-fixprompt";
const FIXPROMPT_CASES=[["play_Xylophone","standard"],["pour_liquid_into_cup","random"],["swap_blocks","standard"],["pack_objects_into_box","random"],["fasten_screws","standard"]];
const PHASES={queued:"等待启动",running:"运行中",held:"已保留现场 · 待处理",native_complete:"原生完成 · 证据核验中"};
function validateSnapshot(s){
  if(s.schema_version!=="fixprompt-running-snapshot-v1"||s.selection_id!==FIXPROMPT_ID||s.profile!==FIXPROMPT_ID+"-v1"||s.execution_id!==FIXPROMPT_ID+"-20261102"||s.simulator!=="5.1.0.0"||s.expected!==5||s.max_decisions!==null||s.native_control_cap!==20||s.rows?.length!==5)throw Error("实验身份或范围不符");
  const ids=new Set();
  s.rows.forEach((r,i)=>{
    const [task,variant]=FIXPROMPT_CASES[i];
    if(r.task!==task||r.variant!==variant||r.seed!==0||r.scene!==0||r.run_id!==s.execution_id+"-"+task+"-"+variant+"-s0-scene0"||ids.has(r.run_id)||!Object.hasOwn(PHASES,r.phase))throw Error("任务身份或状态不符");
    if(r.score!==null||r.success!==null||r.published!==false||!Number.isInteger(r.delivered_decisions)||r.delivered_decisions<0||typeof r.native_launched!=="boolean"||typeof r.native_terminal!=="boolean")throw Error("运行快照不能冒充已发布结果");
    ids.add(r.run_id);
  });
  if(s.started!==s.rows.filter(r=>r.native_launched).length||s.native_completed!==s.rows.filter(r=>r.native_terminal).length||s.published!==0||!Number.isFinite(s.snapshot_unix))throw Error("进度总量不符");
  return s;
}
function node(tag,text){const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);return n;}
function renderSnapshot(s){
  const summary=document.getElementById("run-summary");summary.replaceChildren();
  for(const [v,label]of [[s.started+" / 5","已启动"],[s.native_completed+" / 5","原生终局"],[s.published+" / 5","已审计并发布"]]){const d=node("div");d.append(node("strong",v),node("span",label));summary.append(d);}
  const rows=document.getElementById("status-rows");rows.replaceChildren();
  for(const r of s.rows){const tr=node("tr");for(const v of [r.task,r.variant+" · seed0 / scene0",PHASES[r.phase],r.delivered_decisions,"—"])tr.append(node("td",v));rows.append(tr);}
  const age=Date.now()/1000-s.snapshot_unix;
  document.getElementById("snapshot-status").textContent="公开快照："+new Date(s.snapshot_unix*1000).toLocaleString("zh-CN",{hour12:false})+" · 每60秒检查公开更新"+(age>600?" · 快照超过10分钟，当前运行状态可能已有变化":"");
  document.getElementById("provenance").textContent=JSON.stringify(s.provenance,null,2);
}
let loadingSnapshot=false;
async function refreshSnapshot(){
  if(loadingSnapshot)return;loadingSnapshot=true;
  try{const response=await fetch("data/fixprompt-status.json",{cache:"no-store",credentials:"omit",redirect:"error"});if(!response.ok)throw Error("HTTP "+response.status);renderSnapshot(validateSnapshot(await response.json()));}
  catch(e){document.getElementById("snapshot-status").textContent="运行快照暂时不可用；不据此推断失败。";}
  finally{loadingSnapshot=false;}
}
refreshSnapshot();setInterval(refreshSnapshot,60000);
