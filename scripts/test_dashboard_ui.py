"""Offline browser-script checks; no model, network or real result upload."""
import os
from pathlib import Path
import shutil
import subprocess
import unittest


class DashboardRefreshTests(unittest.TestCase):
    def test_unchanged_payload_clears_transient_failure_and_preserves_periodic_refresh(self):
        node = os.environ.get("NODE_BINARY") or shutil.which("node")
        if not node:
            self.skipTest("Node is required for the offline browser-script check")
        script = r'''
const fs=require("fs"), vm=require("vm"), assert=require("assert");
class Element {
  constructor(){this.children=[];this.value="all";this.textContent="";this.hidden=false;this.style={};}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=children;}
  addEventListener(){} setAttribute(){} scrollIntoView(){}
  get options(){return this.children;}
  get firstChild(){return this.children[0];}
}
const nodes=new Map(), intervals=[], listeners=new Map();
const get=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
let payload=JSON.stringify({schema_version:"l3-index-v1",runs:[],groups:[]});
let fail=false, calls=0;
const context=vm.createContext({URL, console, TextDecoder, crypto:{subtle:{digest:async(_,bytes)=>require("crypto").createHash("sha256").update(Buffer.from(bytes)).digest()}},
 document:{getElementById:get,createElement:()=>new Element(),hidden:false,
   addEventListener:(name,fn)=>listeners.set(name,fn)},
 fetch:async url=>{if(url!=="data/index.json")return {ok:false};calls++;if(fail)throw new Error("Synthetic offline disconnect");return {ok:true,headers:{get:()=>""},arrayBuffer:async()=>Uint8Array.from(Buffer.from(payload)).buffer};},
 setInterval:(fn,ms)=>intervals.push({fn,ms})});
vm.runInContext((fs.readFileSync(require("path").join(require("path").dirname(process.argv[1]),"api-cost.js"),"utf8")+"\n"+fs.readFileSync(process.argv[1],"utf8")),context);
(async()=>{
 await new Promise(resolve=>setImmediate(resolve));
 assert.match(get("status").textContent,/结果目录/);
 fail=true;await vm.runInContext("load()",context);
 assert.match(get("status").textContent,/could not be loaded/);
 fail=false;await vm.runInContext("load()",context);
 assert.match(get("status").textContent,/结果目录/);
 assert.equal(calls,3);assert.equal(intervals[0].ms,60000);
 context.document.hidden=true;intervals[0].fn();assert.equal(calls,3);
 assert(listeners.has("visibilitychange"));
 payload=JSON.stringify({schema_version:"l3-index-v2",runs:[],groups:[],round_selections:[]});
 await vm.runInContext("load()",context);assert.match(get("status").textContent,/结果目录/);
 const config=vm.runInContext(`roundConfiguration({configuration_cells:[
   {capability:"Open",variant:"standard",seed:0,scene:1,tasks:["a","b"]},
   {capability:"Precision",variant:"standard",seed:0,scene:1,tasks:["c"]},
   {capability:"Generalization",variant:"standard",seed:0,scene:0,tasks:["d"]}
 ]})`,context);
 assert.equal(config,"Other tasks: 3 standard · seed 0 / scene 1; Generalization: 1 standard · seed 0 / scene 0");
})().catch(error=>{console.error(error);process.exitCode=1;});
'''
        source = Path(__file__).resolve().parents[1] / 'web' / 'app.js'
        result = subprocess.run([node, "-e", script, str(source)], capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


class DashboardPreferencesNavigationTests(unittest.TestCase):
    """Local preferences and task navigation exercise actual DOM event handlers."""

    def run_ui_check(self, check):
        node = os.environ.get("NODE_BINARY") or shutil.which("node")
        if not node:
            self.skipTest("Node is required for the offline browser-script check")
        script = r'''
const fs=require("fs"), vm=require("vm"), assert=require("assert");
const source=(fs.readFileSync(require("path").join(require("path").dirname(process.argv[1]),"api-cost.js"),"utf8")+"\n"+fs.readFileSync(process.argv[1],"utf8"));
class Element {
 constructor(tag="div"){this.tag=tag;this.children=[];this.value="";this._text="";this.hidden=false;this.style={};this.dataset={};this.listeners=new Map();this.attrs={};this.currentTime=0;this.pauses=0;}
 set textContent(value){this._text=String(value);this.children=[];} get textContent(){return this._text;}
 set innerHTML(value){throw new Error("HTML interpolation is forbidden");}
 append(...children){this.children.push(...children);} replaceChildren(...children){this._text="";this.children=children;}
 addEventListener(type,handler){this.listeners.set(type,handler);} setAttribute(k,v){this.attrs[k]=v;}
 removeAttribute(k){delete this.attrs[k];if(k==="src")this.src="";}
 emit(type){return this.listeners.get(type)?.({target:this,preventDefault(){}});}
 pause(){this.pauses++;} load(){} play(){return Promise.resolve();} scrollIntoView(){}
 get options(){return this.children;} get firstChild(){return this.children[0];}
}
const text=e=>[e.textContent,...e.children.map(text)].join(" ");
const find=(e,p)=>p(e)?e:e.children.map(c=>find(c,p)).find(Boolean);
const all=(e,p)=>[...(p(e)?[e]:[]),...e.children.flatMap(c=>all(c,p))];
const memory=()=>{const data=new Map();return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),data};};
async function boot(storage=memory()){
 const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
 get("variant").value="all";get("outcome").value="all";
 let payload=JSON.stringify({schema_version:"l3-index-v2",runs:[],groups:[]}),evaluationPayload=null,evaluationFail=false,indexStatus=200,evaluationFetches=0;
 const context=vm.createContext({URL,console,TextDecoder,crypto:{subtle:{digest:async(_,bytes)=>require("crypto").createHash("sha256").update(Buffer.from(bytes)).digest()}},localStorage:storage,
  document:{getElementById:get,createElement:tag=>new Element(tag),hidden:false,addEventListener(){}},
  fetch:async url=>{
   if(url==="api/v1/evaluations.json"){evaluationFetches++;if(evaluationFail)throw new Error("API unavailable");return {ok:!!evaluationPayload,json:async()=>JSON.parse(JSON.stringify(evaluationPayload))};}
   return {ok:true,status:indexStatus,headers:{get:()=>"fixture-etag"},arrayBuffer:async()=>Uint8Array.from(Buffer.from(payload)).buffer};
  },setInterval(){}});
 const evaluate=code=>vm.runInContext(code,context);
 evaluate(source);await new Promise(resolve=>setImmediate(resolve));
 return {get,context,evaluate,storage,setPayload:value=>{payload=JSON.stringify(value);},setRawPayload:value=>{payload=value;},
  setEvaluations:value=>{evaluationPayload=value;},setEvaluationFail:value=>{evaluationFail=value;},setIndexStatus:value=>{indexStatus=value;},evaluationFetches:()=>evaluationFetches,
  install:fixture=>{context.fixture=fixture;evaluate('ledger=fixture;ensureVisibleSelection();renderExperiments();renderExperiment()');}};
}
const record=(id,task,variant="standard",seed=0,scene=0,round=1)=>({run_id:id,round,
 episode:{task,variant,seed,scene,capability:"Open"},
 model:{name:"gpt-6-astra",thinking_effort:"medium",client_version:"0.153.4"},
 protocol:{id:"original-"+id,profile:"persistent-cap20",native_control_cap:20,max_decisions:100},
 outcome:{status:"complete",native_terminal:true,score:.5,success:false,model_decisions:2,native_controls:10},
 evidence_level:"native_terminal",costs:{accounting:"known",input_tokens:10,output_tokens:2,cached_input_tokens:0,paid_requests:2,attempts:[]},versions:{},
 artifacts:["head.mp4","left_wrist.mp4"].map(path=>({kind:"raw_video",path,sha256:"a".repeat(64),bytes:10,url:"https://example.test/"+id+"/"+path}))});
function fixture(groups){
 const metrics=records=>({expected:records.length,completed:records.length,score:.5,success_rate:0});
 const result={schema_version:"l3-index-v2",runs:[],groups:[]};
 for(const [id,records] of groups){
  for(const r of records)r.selection={id,expected_episodes:records.map(r=>r.episode)};
  result.runs.push(...records);result.groups.push({group_id:id,selection_id:id,model:records[0].model,protocol:records[0].protocol,
   run_ids:records.map(r=>r.run_id),metrics:metrics(records),dimensions:{},aggregation_status:"complete",round_statistics:{completed_rounds:1},
   rounds:[...new Set(records.map(r=>r.round))].map(round=>{const members=records.filter(r=>r.round===round);return {round,seed:members[0].episode.seed,scene:members[0].episode.scene,run_ids:members.map(r=>r.run_id),metrics:metrics(members),dimensions:{},status:"complete",configuration_cells:members.map(r=>({...r.episode,tasks:[r.episode.task]}))};})});
 }
 return result;
}
(async()=>{
'''+check+r'''
})().catch(error=>{console.error(error);process.exitCode=1;});
'''
        source = Path(__file__).resolve().parents[1] / 'web' / 'app.js'
        result = subprocess.run([node, "-e", script, str(source)], capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_temporary_review_browses_original_cases_without_inventing_rounds(self):
        self.run_ui_check(r'''
 const ui=await boot(),data=fixture([
  ["review",[record("review1","same_task","standard",0,1),record("review2","same_task","standard",0,2)]],
  ["ordinary",[record("ordinary1","original_task")]]
 ]),group=data.groups[0];
 group.temporary_review={schema_version:"l3-temporary-upload-review-v1",status:"awaiting_user_review"};
 group.aggregation_status="awaiting_user_review";group.rounds=[];group.round_statistics=null;
 group.metrics={expected:null,completed:2,score:null,success_rate:null,observed_score:null,observed_success_rate:null};
 group.selection_title="新上传待核查 · O23";data.experiment_names={review:group.selection_title};
 for(const r of data.runs.filter(r=>group.run_ids.includes(r.run_id))){
  r.artifacts.push({kind:"action_feedback",path:"actions.json",site_path:"data/runs/"+r.run_id+"/actions.json",sha256:"b".repeat(64),bytes:10,url:"https://example.test/"+r.run_id+"/actions.json"});
 }
 const original=JSON.stringify(data);ui.install(data);
 assert.equal(ui.get("experiment-title").textContent,group.selection_title);
 assert.equal(ui.get("detail-round").options.length,1);
 assert.equal(ui.get("detail-round").options[0].textContent,"待核查批次");
 assert.equal(text(ui.get("round-tabs"))," 待核查批次");
 const card=ui.get("experiments").children.find(c=>text(c).includes(group.selection_title));
 assert(!/完整轮|R1|0 轮|1 轮|P50_111/.test(text(card)));
 assert.match(text(ui.get("fixed-evaluation-summary")),/当前不声明完整评测或汇总成绩/);
 const rows=ui.evaluate('experimentRows(ledger.groups[0],"all")');
 assert.equal(rows.length,2);assert(rows.every(row=>row.round===null&&row.temporary_review&&row.runs.length===1));
 assert.deepEqual(rows.map(row=>row.runs[0].run_id),["review1","review2"]);
 assert.equal(ui.get("episodes").children.length,2);assert.match(ui.get("task-count").textContent,/2 \/ 2/);
 assert.match(ui.get("detail-caption").textContent,/^待核查批次/);
 assert(!text(ui.get("episodes")).includes("Rnull"));
 let video=ui.evaluate('activeVideo');assert.equal(video.src,"https://example.test/review1/head.mp4");
 const camera=all(ui.get("detail-body"),e=>e.tag==="button"&&e.textContent==="左腕相机")[0];
 camera.emit("click");video=ui.evaluate('activeVideo');assert.equal(video.src,"https://example.test/review1/left_wrist.mp4");
 const fetched=[];
 ui.context.fetch=async url=>{fetched.push(url);return {ok:true,json:async()=>[{decision_index:0,tool:"move_eef",native_controls:10,action:"original action",feedback:"original native feedback",acknowledged:true}]};};
 const trace=find(ui.get("detail-body"),e=>e.tag==="details"&&e.children[0]?.textContent==="动作与原生反馈");
 trace.open=true;await trace.emit("toggle");
 assert.deepEqual(fetched,["data/runs/review1/actions.json"]);
 assert.match(text(trace),/original native feedback/);
 ui.get("episodes").children[1].emit("click");assert.equal(ui.evaluate('activeVideo').src,"https://example.test/review2/head.mp4");
 ui.evaluate('selectExperiment(ledger.groups[1])');
 assert.equal(ui.evaluate('experimentRows(ledger.groups[1],"all").length'),1);
 assert.equal(ui.get("detail-round").options[1].textContent,"R1 · 1 / 1");
 assert.equal(JSON.stringify(data),original,"Temporary browsing must preserve every original record");
''')

    def test_group_display_plan_spans_source_selections_preserves_missing_and_conflicts(self):
        self.run_ui_check(r'''
 const ui=await boot();
 const first=Array.from({length:42},(_,i)=>record("first-"+i,"task_"+i,"standard",0,0));
 const extra=Array.from({length:23},(_,i)=>[1,2,3].map(scene=>record("extra-"+i+"-"+scene,"task_"+i,"standard",0,scene))).flat();
 const data=fixture([["merged",[...first,...extra]]]),group=data.groups[0];
 const expected=data.runs.map(r=>({...r.episode}));
 for(const r of first)r.selection={id:"original42",expected_episodes:first.map(r=>({...r.episode}))};
 for(const r of extra)r.selection={id:"extension69"};
 group.display_round_selection={schema_version:"l3-group-display-round-selection-v1",plan_id:"P50_111",
  rounds:[{round:1,label:"P50_111 · 111例",expected_episodes:expected}]};
 // An older global selection must not hide the extension's other scenes.
 data.round_selections=[{id:"merged",rounds:[{round:1,expected_episodes:first.map(r=>({...r.episode}))}]}];
 const original=JSON.stringify(data);ui.install(data);
 let rows=ui.evaluate('experimentRows(ledger.groups[0],"all")');
 assert.equal(rows.length,111);assert(rows.every(r=>r.runs.length===1));
 assert.equal(new Set(rows.map(r=>JSON.stringify(r.episode))).size,111);
 assert.equal(new Set(rows.flatMap(r=>r.runs.map(x=>x.run_id))).size,111);
 assert.deepEqual([...new Set(rows.map(r=>r.episode.scene))].sort(),[0,1,2,3]);
 assert.equal(ui.evaluate('experimentSummary(ledger.groups[0]).basis'),"完整 P50_111");
 assert(text(ui.get("round-tabs")).includes("P50_111 · 111例"));
 assert(ui.get("detail-round").options.some(o=>o.textContent==="P50_111 · 111例"));
 assert.equal(JSON.stringify(data),original,"Display must not rewrite immutable selections or result data");
 const partial=JSON.parse(original),missingId=extra[0].run_id;
 partial.runs=partial.runs.filter(r=>r.run_id!==missingId);
 partial.groups[0].run_ids=partial.groups[0].run_ids.filter(id=>id!==missingId);
 partial.groups[0].rounds[0].run_ids=partial.groups[0].rounds[0].run_ids.filter(id=>id!==missingId);
 ui.install(partial);rows=ui.evaluate('experimentRows(ledger.groups[0],1)');
 assert.equal(rows.length,111);assert.equal(rows.filter(r=>r.runs.length===0).length,1);
 const empty=rows.find(r=>r.runs.length===0);ui.context.empty=empty;
 assert.equal(ui.evaluate('outcomeLabel(empty)'),"未发布");assert.equal(empty.outcome,undefined);
 const duplicate=JSON.parse(original),copy={...duplicate.runs[0],run_id:"duplicate-case"};
 duplicate.runs.push(copy);duplicate.groups[0].run_ids.push(copy.run_id);duplicate.groups[0].rounds[0].run_ids.push(copy.run_id);
 ui.install(duplicate);rows=ui.evaluate('experimentRows(ledger.groups[0],"all")');
 assert.equal(rows.length,111);assert.equal(rows.filter(r=>r.runs.length===2).length,1);
 ui.context.conflict=rows.find(r=>r.runs.length===2);assert.equal(ui.evaluate('outcomeLabel(conflict)'),"结果待核对");
 const ordinary=fixture([["ordinary",[record("ordinary1","original_task")]]]);ui.install(ordinary);
 assert.equal(ui.evaluate('experimentRows(ledger.groups[0],"all").length'),1);
 assert.equal(ui.evaluate('experimentSummary(ledger.groups[0]).basis'),"完整第一轮");
 assert.equal(ui.get("detail-round").options[1].textContent,"R1 · 1 / 1");
''')

    def test_completed_sort_persists_and_preserves_active_task_video_and_filters(self):
        self.run_ui_check(r'''
 const ui=await boot(),data=fixture([
  ["low",[record("low1","wanted")]],
  ["high",[record("high1","wanted"),record("high2","other")]],
  ["medium",[record("medium1","wanted"),record("medium2","other")]]
 ]);
 for(const g of data.groups){g.model.thinking_effort=g.group_id;data.experiment_names={...(data.experiment_names||{}),[g.group_id]:g.group_id};}
 data.groups[0].metrics.expected=999; // Planned cases must not outrank actual completions.
 const original=JSON.stringify(data);ui.install(data);
 const cards=()=>ui.get("experiments").children.map(c=>find(c,e=>e.tag==="strong").textContent);
 assert.deepEqual(cards(),["low","medium","high"]);
 ui.evaluate('selectExperiment(ledger.groups[0])');
 ui.get("search").value="wanted";ui.get("search").emit("input");
 const video=ui.evaluate('activeVideo'),focus=ui.evaluate('taskFocus'),row=ui.evaluate('selectedRowKey');
 assert(video);const pauses=video.pauses;
 ui.get("experiment-sort").value="completed";ui.get("experiment-sort").emit("change");
 assert.deepEqual(cards(),["medium","high","low"]);
 assert.deepEqual(ui.get("detail-experiment").options.map(o=>o.value),["medium","high","low"]);
 assert.equal(ui.get("detail-experiment").value,"low");assert.equal(ui.get("search").value,"wanted");
 assert.equal(ui.evaluate('activeVideo'),video);assert.equal(video.pauses,pauses);
 assert.equal(ui.evaluate('taskFocus'),focus);assert.equal(ui.evaluate('selectedRowKey'),row);
 ui.get("experiment-search").value="high";ui.get("experiment-search").emit("input");assert.deepEqual(cards(),["high"]);
 ui.get("experiment-sort").value="effort";ui.get("experiment-sort").emit("change");
 assert.equal(ui.get("experiment-search").value,"high");assert.deepEqual(cards(),["high"]);
 ui.get("experiment-search").value="";ui.get("experiment-search").emit("input");assert.deepEqual(cards(),["low","medium","high"]);
 ui.get("experiment-sort").value="completed";ui.get("experiment-sort").emit("change");
 ui.evaluate('updateGroupPreference(ledger.groups[1],{hidden:true})');assert.deepEqual(cards(),["medium","low"]);
 const reload=await boot(ui.storage);reload.install(data);
 assert.equal(reload.get("experiment-sort").value,"completed");
 assert.deepEqual(reload.get("detail-experiment").options.map(o=>o.value),["medium","low"]);
 assert.equal(JSON.stringify(data),original,"Sorting and preferences must not mutate the published catalog");
''')

    def test_completed_sort_with_unavailable_storage_still_works_in_page(self):
        self.run_ui_check(r'''
 const storage={getItem(){throw new Error("blocked");},setItem(){throw new Error("blocked");}};
 const ui=await boot(storage);ui.install(fixture([["a",[record("a1","task")]], ["b",[record("b1","task"),record("b2","other")]]]));
 ui.get("experiment-sort").value="completed";ui.get("experiment-sort").emit("change");
 assert.deepEqual(ui.get("detail-experiment").options.map(o=>o.value),["b","a"]);
 assert.match(ui.get("preferences-status").textContent,/无法持久保存/);
''')

    def test_merged_upload_fields_prefer_primary_source_without_rewriting_originals(self):
        self.run_ui_check(r'''
 const ui=await boot(),data=fixture([["main",[record("pilot","task_a"),record("main_run","task_b")]]]);
 data.runs[0].selection.id="pilot4";data.runs[0].protocol.id="pilot4";
 data.runs[1].protocol.id="main";const original=JSON.stringify(data);ui.install(data);
 const example=ui.evaluate('uploadExample(ledger.groups[0])');
 assert.equal(example.selection.id,"main");assert.equal(example.protocol.id,"main");
 assert.equal(JSON.stringify(data),original);
 data.groups[0].selection_id="display-only-overlay";ui.install(data);
 assert.equal(ui.evaluate('uploadExample(ledger.groups[0]).selection.id'),"pilot4");
''')

    def test_shared_names_replace_legacy_aliases_across_cards_details_and_search(self):
        self.run_ui_check(r'''
 const storage=memory();storage.setItem("robodojo-l3.dashboard.preferences.v1",JSON.stringify({version:1,groups:{a:{alias:"Old local name"}}}));
 const ui=await boot(storage), data=fixture([["a",[record("a1","task")]], ["b",[record("b1","task")]]]);
 const name='<img src=x onerror=alert(1)> 共享实验';data.experiment_names={a:name,b:"persistent-cap20-rerun"};
 ui.install(data);const original=JSON.stringify(data),cards=ui.get("experiments").children;
 assert.equal(find(cards[0],e=>e.tag==="strong").textContent,name);
 assert.equal(ui.get("experiment-title").textContent,name);
 assert.equal(ui.get("detail-experiment").options[0].textContent,name);
 assert(text(ui.get("audit-body")).includes(name));assert(!text(ui.get("experiments")).includes("Old local name"));
 assert(!find(ui.get("experiments"),e=>e.tag==="img"||e.tag==="form"||e.type==="text"));
 ui.get("experiment-search").value="共享实验";ui.get("experiment-search").emit("input");
 assert.equal(ui.get("experiments").children.length,1);
 assert.equal(ui.evaluate('uploadExample(ledger.groups[0]).protocol.profile'),"persistent-cap20");
 assert(text(ui.get("experiment-id")).includes("原始 profile：persistent-cap20"));
 const independentBrowser=await boot();independentBrowser.install(data);
 assert.equal(independentBrowser.get("experiment-title").textContent,name);
 ui.evaluate('updateGroupPreference(ledger.groups[1],{hidden:true,alias:"Ignored"})');
 const saved=JSON.parse(storage.getItem("robodojo-l3.dashboard.preferences.v1"));
 assert.deepEqual(saved,{version:1,groups:{b:{hidden:true}}});
 assert.equal(JSON.stringify(data),original);
''')

    def test_names_require_exact_group_keys_and_invalid_config_keeps_default(self):
        self.run_ui_check(r'''
 const storage=memory();storage.setItem("robodojo-l3.dashboard.preferences.v1",JSON.stringify({version:1,groups:{a:{alias:"Ignored"},b:{alias:"Also ignored",hidden:true}}}));
 const ui=await boot(storage),data=fixture([["a",[record("a1","task")]], ["b",[record("b1","task")]]]);
 const fallback="gpt-6-astra · persistent-cap20 · medium";
 for(const names of [undefined,null,[],"name",{a:12},{a:"  "},{"original-a1":"Wrong identity"}]){
  data.experiment_names=names;ui.install(data);assert.equal(ui.get("experiment-title").textContent,fallback);
 }
 data.experiment_names=Object.create({a:"Inherited name"});ui.install(data);
 assert.equal(ui.get("experiment-title").textContent,fallback);
 assert.equal(ui.evaluate('visibleGroups().length'),1,"Old hidden setting is retained");
 data.experiment_names={a:"Shared A",b:"Shared B"};ui.install(data);
 assert.equal(ui.get("experiment-title").textContent,"Shared A");
 ui.get("restore-hidden").emit("click");assert.equal(ui.evaluate('visibleGroups().length'),2);
 assert.equal(ui.get("detail-experiment").options[1].textContent,"Shared B");
 assert.equal(JSON.parse(storage.getItem("robodojo-l3.dashboard.preferences.v1")).groups.a,undefined);
''')

    def test_hide_all_has_restore_outside_filters_and_persists_without_deleting_groups(self):
        self.run_ui_check(r'''
 const ui=await boot(),data=fixture([["a",[record("a1","task")]], ["b",[record("b1","task")]]]);ui.install(data);
 const before=JSON.stringify(data);
 for(let i=0;i<2;i++){const hide=find(ui.get("experiments"),e=>e.type==="checkbox");hide.checked=true;hide.emit("change");}
 assert(ui.get("workspace").hidden);assert(!ui.get("restore-hidden").hidden);assert(!ui.get("show-hidden").disabled);
 assert.match(text(ui.get("experiments")),/所有实验已隐藏/);assert.equal(ui.evaluate('visibleGroups().length'),0);
 const reload=await boot(ui.storage);reload.install(data);assert(reload.get("workspace").hidden);
 reload.get("show-hidden").emit("click");assert.equal(reload.get("experiments").children.length,2);
 assert(all(reload.get("experiments"),e=>e.className==="experiment-select").every(e=>e.disabled));
 reload.get("experiment-search").value="nothing";reload.get("experiment-search").emit("input");
 assert(!reload.get("restore-hidden").hidden);reload.get("restore-hidden").emit("click");
 assert.equal(reload.evaluate('visibleGroups().length'),2);assert(!reload.get("workspace").hidden);
 assert.equal(reload.get("detail-experiment").options.length,2);assert.equal(JSON.stringify(data),before);
''')

    def test_cross_group_retains_search_and_task_variant_without_silent_fallback(self):
        self.run_ui_check(r'''
 const ui=await boot();ui.install(fixture([
  ["a",[record("a1","wanted")]],
  ["b",[record("b1","wanted","random"),record("b2","other")]],
  ["c",[record("c1","wanted","standard",2,8)]]
 ]));
 ui.evaluate('taskFocus=null;selectExperiment(ledger.groups[0])');
 ui.get("search").value="wanted";ui.get("search").emit("input");
 const oldVideo=ui.evaluate("activeVideo");assert(oldVideo);
 ui.get("detail-experiment").value="b";ui.get("detail-experiment").emit("change");
 assert.equal(ui.get("search").value,"wanted");assert.equal(ui.get("detail-title").textContent,"wanted");
 assert.match(text(ui.get("detail-body")),/没有此任务及变体/);assert.equal(ui.evaluate("activeVideo"),null);assert.equal(oldVideo.src,"");
 assert(!find(ui.get("detail-body"),e=>e.className==="episode-metrics"));
 ui.get("detail-experiment").value="c";ui.get("detail-experiment").emit("change");
 assert.equal(ui.get("detail-title").textContent,"wanted");assert.match(ui.get("detail-caption").textContent,/seed 2 \/ scene 8/);
 ui.get("detail-experiment").value="b";ui.get("detail-experiment").emit("change");
 ui.get("search").value="other";ui.get("search").emit("input");
 assert.equal(ui.get("detail-title").textContent,"other","Explicit new search releases the prior task focus");
''')

    def test_round_switch_and_seed_preference_keep_same_task_or_show_empty_state(self):
        self.run_ui_check(r'''
 const ui=await boot();ui.install(fixture([["a",[
  record("a1","wanted","standard",0,0,1),record("a2","wanted","standard",2,1,2),record("a3","other","standard",3,2,3)
 ]]]));
 ui.get("detail-round").value="2";ui.get("detail-round").emit("change");
 assert.match(ui.get("detail-caption").textContent,/R2.*seed 2 \/ scene 1/);
 ui.get("detail-round").value="3";ui.get("detail-round").emit("change");
 assert.equal(ui.get("detail-title").textContent,"wanted");assert.equal(ui.evaluate("activeVideo"),null);
 assert.match(text(ui.get("detail-body")),/没有此任务及变体/);
 ui.get("episodes").children[0].emit("click");assert.equal(ui.get("detail-title").textContent,"other");
 ui.context.candidates=[{episode:{task:"x",variant:"random",seed:0,scene:4},round:1},
  {episode:{task:"x",variant:"standard",seed:9,scene:4},round:1},
  {episode:{task:"x",variant:"standard",seed:0,scene:8},round:2}];
 assert.equal(ui.evaluate('matchingTask(candidates,{episode:{task:"x",variant:"standard",seed:0,scene:4},round:1}).episode.scene'),8);
''')

    def test_shared_name_refresh_and_other_group_hide_keep_video_camera_and_playhead(self):
        self.run_ui_check(r'''
 const ui=await boot(),data=fixture([["a",[record("a1","wanted")]], ["b",[record("b1","other")]]]);ui.install(data);
 const camera=find(ui.get("detail-body"),e=>e.className==="camera-tabs");camera.children[1].emit("click");
 const video=ui.evaluate("activeVideo");video.currentTime=12.5;const src=video.src,pauses=video.pauses;
 ui.evaluate('updateGroupPreference(ledger.groups[1],{hidden:true})');
 assert.strictEqual(ui.evaluate("activeVideo"),video);assert.equal(video.currentTime,12.5);assert.equal(video.src,src);assert.equal(video.pauses,pauses);
 const changed=JSON.parse(JSON.stringify(data));changed.experiment_names={a:"Shared updated name"};changed.groups[1].submitted=999;ui.setPayload(changed);await ui.evaluate("load()");
 assert.equal(ui.get("experiment-title").textContent,"Shared updated name");
 assert.equal(ui.get("detail-experiment").options[0].textContent,"Shared updated name");
 assert.strictEqual(ui.evaluate("activeVideo"),video);assert.equal(video.currentTime,12.5);assert.equal(video.src,src);assert.equal(video.pauses,pauses);
 await ui.evaluate("load()");assert.strictEqual(ui.evaluate("activeVideo"),video);
''')

    def test_unavailable_or_malformed_storage_never_blocks_session_controls(self):
        self.run_ui_check(r'''
 const denied={getItem(){throw new Error("SecurityError");},setItem(){throw new Error("QuotaExceededError");}};
 const ui=await boot(denied),data=fixture([["a",[record("a1","task")]]]);data.experiment_names={a:"Shared name"};ui.install(data);
 ui.evaluate('updateGroupPreference(ledger.groups[0],{hidden:true})');
 assert.match(ui.get("preferences-status").textContent,/本次页面内仍有效/);assert(!ui.get("restore-hidden").hidden);
 ui.get("restore-hidden").emit("click");assert.equal(ui.get("experiment-title").textContent,"Shared name");
 const malformed=memory();malformed.setItem("robodojo-l3.dashboard.preferences.v1","{broken");
 const fresh=await boot(malformed);fresh.install(fixture([["a",[record("a1","task")]]]));
 assert.equal(fresh.evaluate('visibleGroups().length'),1);
 fresh.evaluate('updateGroupPreference(ledger.groups[0],{hidden:true})');
 assert.deepEqual(JSON.parse(malformed.getItem("robodojo-l3.dashboard.preferences.v1")).groups.a,{hidden:true});
''')

    def test_default_and_shared_duplicate_names_remain_distinct_in_detail_selector(self):
        self.run_ui_check(r'''
 const ui=await boot(),data=fixture([["a",[record("a1","task")]], ["b",[record("b1","task")]]]);ui.install(data);
 const labels=ui.get("detail-experiment").options.map(option=>option.textContent);
 assert.notEqual(labels[0],labels[1]);assert.match(labels[0],/ · a$/);assert.match(labels[1],/ · b$/);
 data.experiment_names={b:"My comparison"};ui.install(data);
 assert.equal(ui.get("detail-experiment").options[1].textContent,"My comparison");
 assert.equal(data.groups[1].selection_id,"b");
 ui.context.sameSelection=[{...data.groups[0],group_id:"first"},{...data.groups[0],group_id:"second"}];
 data.experiment_names={first:"Same shared name",second:"Same shared name"};
 assert.notEqual(ui.evaluate('experimentOptionName(sameSelection[0],sameSelection)'),ui.evaluate('experimentOptionName(sameSelection[1],sameSelection)'));
''')

    def test_all_rounds_survives_refresh_hidden_group_handoff_and_restore(self):
        self.run_ui_check(r'''
 const ui=await boot(),data=fixture([["a",[record("a1","task")]], ["b",[record("b1","task")]]]);ui.install(data);
 ui.get("detail-round").value="all";ui.get("detail-round").emit("change");
 ui.setPayload(data);await ui.evaluate("load()");assert.equal(ui.get("detail-round").value,"all");
 ui.evaluate('updateGroupPreference(ledger.groups[0],{hidden:true})');
 assert.equal(ui.evaluate("selectedGroupId"),"b");assert.equal(ui.get("detail-round").value,"all");
 ui.evaluate('updateGroupPreference(ledger.groups[1],{hidden:true})');
 ui.get("restore-hidden").emit("click");assert.equal(ui.get("detail-round").value,"all");
''')

    def test_fixed_scores_require_complete_exact_coverage_and_survive_round_filters(self):
        self.run_ui_check(r'''
 const ui=await boot(),data=fixture([["a",[record("a1","task")]], ["b",[record("b1","task")]]]);
 const score=(id,n,value)=>({plan_id:id,status:"complete",completed:n,expected:n,score:value,success_rate:.25,missing_cases:[],conflicts:[]});
 const doc={schema_version:"robodojo-api-v1",snapshot_id:require("crypto").createHash("sha256").update(JSON.stringify(data)).digest("hex"),experiments:[
  {experiment_id:"a",evaluation_scores:{first_round:score("first_round",42,.625),spiky2_65:score("spiky2_65",65,.55),P50_111:{...score("P50_111",111,.99),status:"incomplete",completed:80,missing_cases:[{task:"missing_task",variant:"random",seed:0,scene:1}]}}},
  {experiment_id:"b",evaluation_scores:{first_round:score("first_round",42,.2),spiky2_65:{...score("spiky2_65",65,.88),status:"incomplete",completed:64,missing_cases:[{task:"second_spiky_sample",variant:"standard",seed:0,scene:0}]},P50_111:score("P50_111",111,.3)}}]};
 ui.setPayload(data);ui.setEvaluations(doc);await ui.evaluate("load()");
 let displayed=text(ui.get("fixed-evaluation-summary"));
 assert(displayed.includes("62.5%"));assert(displayed.includes("80 / 111"));assert(!displayed.includes("99.0%"));assert(displayed.includes("missing_task"));
 assert(displayed.includes("Spiky-2 · 65例"));assert(displayed.includes("55.0%"));assert(displayed.includes("65 / 65"));
 const labels=all(ui.get("fixed-evaluation-summary"),e=>e.className==="fixed-score-label").map(e=>e.textContent);
 assert.deepEqual(labels,["首轮 Score","Spiky-2 · 65例 Score","P50_111 Score"]);
 assert(text(ui.get("experiments")).includes("62.5%"));assert(text(ui.get("experiments")).includes("30.0%"));
 ui.get("search").value="task";ui.get("search").emit("input");ui.get("detail-round").value="all";ui.get("detail-round").emit("change");
 assert(text(ui.get("fixed-evaluation-summary")).includes("62.5%"));
 ui.get("detail-experiment").value="b";ui.get("detail-experiment").emit("change");
 displayed=text(ui.get("fixed-evaluation-summary"));assert(displayed.includes("64 / 65"));assert(displayed.includes("second_spiky_sample"));assert(!displayed.includes("55.0%"));assert(!displayed.includes("88.0%"));
 assert.equal(ui.get("search").value,"task");assert.equal(ui.get("detail-round").value,"all");
 ui.get("detail-experiment").value="a";ui.get("detail-experiment").emit("change");assert(text(ui.get("fixed-evaluation-summary")).includes("55.0%"));
 doc.experiments[0].evaluation_scores.P50_111=score("P50_111",111,.375);ui.setEvaluations(doc);
 const before=ui.evaluationFetches();await ui.evaluate("load()");
 assert.equal(ui.evaluationFetches(),before+1,"Unchanged index must retry the evaluation API");
 displayed=text(ui.get("fixed-evaluation-summary"));assert(displayed.includes("37.5%"));assert(displayed.includes("111 / 111"));
 assert.equal(ui.get("search").value,"task");assert.equal(ui.get("detail-round").value,"all");
 const retainedNode=ui.get("fixed-evaluation-summary").children[0];await ui.evaluate("load()");
 assert.strictEqual(ui.get("fixed-evaluation-summary").children[0],retainedNode,"Unchanged API and index must not rebuild the view");
 // A misleading complete status must not publish a score with a missing case or conflict.
 doc.experiments[0].evaluation_scores.P50_111.missing_cases=[{task:"not_ready",variant:"standard",seed:0,scene:0}];
 doc.experiments[0].evaluation_scores.spiky2_65.conflicts=[{case:{task:"spiky_conflict",variant:"standard",seed:0,scene:1},run_ids:["spiky-one","spiky-two"]}];
 doc.experiments[0].evaluation_scores.first_round.conflicts=[{case:{task:"overlap",variant:"standard",seed:0,scene:0},run_ids:["one","two"]}];
 await ui.evaluate("load()");displayed=text(ui.get("fixed-evaluation-summary"));assert(!displayed.includes("37.5%"));assert(!displayed.includes("62.5%"));assert(displayed.includes("overlap"));assert(displayed.includes("结果待核对"));
 assert(!displayed.includes("55.0%"));assert(displayed.includes("spiky_conflict"));assert(displayed.includes("spiky-one / spiky-two"));
''')

    def test_fixed_scores_retry_after_snapshot_mismatch_http_304_and_api_failure(self):
        self.run_ui_check(r'''
 const ui=await boot(),data=fixture([["a",[record("a1","task")]]]);
 const result={status:"complete",completed:42,expected:42,score:.625,success_rate:.2,missing_cases:[],conflicts:[]};
 const doc={schema_version:"robodojo-api-v1",snapshot_id:"wrong-snapshot",experiments:[{experiment_id:"a",evaluation_scores:{first_round:result}}]};
 ui.setPayload(data);ui.setEvaluations(doc);await ui.evaluate("load()");
 assert(text(ui.get("fixed-evaluation-summary")).includes("固定评测成绩待同步"));assert(!text(ui.get("fixed-evaluation-summary")).includes("62.5%"));
 doc.snapshot_id=require("crypto").createHash("sha256").update(JSON.stringify(data)).digest("hex");ui.setIndexStatus(304);await ui.evaluate("load()");
 assert(text(ui.get("fixed-evaluation-summary")).includes("62.5%"),"A 304 index response must still retry scores");
 ui.setEvaluationFail(true);await ui.evaluate("load()");assert(!text(ui.get("fixed-evaluation-summary")).includes("62.5%"));assert(text(ui.get("fixed-evaluation-summary")).includes("固定评测成绩待同步"));
 ui.setEvaluationFail(false);await ui.evaluate("load()");assert(text(ui.get("fixed-evaluation-summary")).includes("62.5%"));
 // API scores for a newer index cannot attach to a retained catalog.
 ui.setIndexStatus(200);const newer={...data,experiment_names:{a:"Renamed"}};ui.setPayload(newer);await ui.evaluate("load()");
 assert.equal(ui.get("experiment-title").textContent,"Renamed");assert(!text(ui.get("fixed-evaluation-summary")).includes("62.5%"));
 // UTF-8 BOM changes raw bytes even though TextDecoder yields the same JSON text.
 doc.snapshot_id=require("crypto").createHash("sha256").update(JSON.stringify(newer)).digest("hex");
 ui.setRawPayload("\ufeff"+JSON.stringify(newer));await ui.evaluate("load()");assert(!text(ui.get("fixed-evaluation-summary")).includes("62.5%"));
 doc.snapshot_id=require("crypto").createHash("sha256").update("\ufeff"+JSON.stringify(newer)).digest("hex");
 await ui.evaluate("load()");assert(text(ui.get("fixed-evaluation-summary")).includes("62.5%"));
''')


class DashboardExperimentRowsTests(unittest.TestCase):
    """Exercise public expected-membership joins without a browser or network."""

    def run_mapping_check(self, check):
        node = os.environ.get("NODE_BINARY") or shutil.which("node")
        if not node:
            self.skipTest("Node is required for the offline browser-script check")
        script = r'''
const fs=require("fs"), vm=require("vm"), assert=require("assert");
class Element {
  constructor(){this.children=[];this.value="all";this.textContent="";this.hidden=false;this.style={};this.dataset={};}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=children;}
  addEventListener(){} setAttribute(){} scrollIntoView(){}
  get options(){return this.children;}
  get firstChild(){return this.children[0];}
}
const nodes=new Map();
const get=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
let fetches=0;
const context=vm.createContext({URL, console, TextDecoder, crypto:{subtle:{digest:async(_,bytes)=>require("crypto").createHash("sha256").update(Buffer.from(bytes)).digest()}},
 document:{getElementById:get,createElement:()=>new Element(),hidden:false,addEventListener(){}},
 fetch:async url=>{fetches++;if(url!=="data/index.json")return {ok:false};return {ok:true,headers:{get:()=>""},arrayBuffer:async()=>Uint8Array.from(Buffer.from(JSON.stringify({schema_version:"l3-index-v2",runs:[],groups:[],round_selections:[]}))).buffer};},
 setInterval(){}});
vm.runInContext((fs.readFileSync(require("path").join(require("path").dirname(process.argv[1]),"api-cost.js"),"utf8")+"\n"+fs.readFileSync(process.argv[1],"utf8")),context);
const ep=(task,variant="standard",scene=0,capability="Open")=>({task,variant,seed:0,scene,capability});
const run=(id,episode,selection,expected,score=0)=>({
 run_id:id,episode,selection:{id:selection,expected_episodes:expected},
 model:{name:"gpt-6-astra",thinking_effort:"high",client_version:"0.153.4"},
 protocol:{id:selection,profile:"persistent-cap20"},
 evidence_level:"native_terminal",outcome:{status:"complete",native_terminal:true,score,success:score===1}});
const group=(id,expected,ids)=>({group_id:id,selection_id:id,
 model:{name:"gpt-6-astra",thinking_effort:"high",client_version:"0.153.4"},
 protocol:{id,profile:"persistent-cap20"},run_ids:ids,
 rounds:[{round:1,seed:0,scene:0,run_ids:ids,metrics:{expected:expected.length,completed:ids.length}}]});
const install=(runs,groups,round_selections=[])=>{
 context.fixture={schema_version:"l3-index-v2",runs,groups,round_selections};
 vm.runInContext("ledger=fixture",context);
};
const rows=(g,round="all")=>{
 context.fixtureGroup=g;context.fixtureRound=round;
 return JSON.parse(JSON.stringify(vm.runInContext("experimentRows(fixtureGroup, fixtureRound)",context)));
};
(async()=>{
 await new Promise(resolve=>setImmediate(resolve));
 const initialFetches=fetches;
'''+check+r'''
 assert.equal(fetches,initialFetches,"Membership projection must not fetch data");
})().catch(error=>{console.error(error);process.exitCode=1;});
'''
        source = Path(__file__).resolve().parents[1] / 'web' / 'app.js'
        result = subprocess.run([node, "-e", script, str(source)], capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_medium_explicit_rounds_override_scene_and_original_selection(self):
        self.run_mapping_check(r'''
 const r1=[ep("align_blocks"),ep("stack_bowls","random",0,"Generalization")];
 const r2=[ep("align_blocks","standard",1),ep("stack_bowls","standard",0,"Generalization")];
 // Immutable historical manifests may carry the older, superseded selection.
 const oldExpected=[...r1,ep("align_blocks","standard",2),ep("stack_bowls","standard",1,"Generalization")];
 const published=[run("r1-a",r1[0],"historical-old",oldExpected),run("r1-b",r1[1],"historical-old",oldExpected),
   run("r2-a",r2[0],"historical-new",oldExpected),run("r2-b",r2[1],"historical-new",oldExpected),
   run("wrong-scene",ep("stack_bowls","standard",1,"Generalization"),"historical-new",oldExpected,1)];
 const g=group("medium-round-overlay",r1,published.slice(0,4).map(r=>r.run_id));
 g.model.thinking_effort="medium";
 g.original_selection_ids=["historical-old","historical-new"];
 g.preserved_unselected_run_ids=["wrong-scene"];
 g.rounds=[{round:1,seed:0,scene:0,run_ids:["r1-a","r1-b"]},
   {round:2,seed:0,scene:null,run_ids:["r2-a","r2-b"]}];
 install(published,[g],[{schema_version:"l3-round-selection-v1",id:g.selection_id,
   source_selection_ids:g.original_selection_ids,rounds:[
     {round:1,label:"random scene0",expected_episodes:r1},
     {round:2,label:"non-random scene1; random-capable standard scene0",expected_episodes:r2}]}]);
 const second=rows(g,"2");
 assert.equal(second.length,2);
 assert(second.every(r=>r.round===2));
 assert.deepEqual(second.map(r=>r.episode).sort((a,b)=>a.task.localeCompare(b.task)),r2);
 assert.deepEqual(second.flatMap(r=>r.runs.map(x=>x.run_id)).sort(),["r2-a","r2-b"]);
 assert.equal(second.find(r=>r.episode.task==="stack_bowls").episode.scene,0);
 const all=rows(g,"all");assert.equal(all.length,4);
 assert.deepEqual(all.map(r=>r.round).sort(),[1,1,2,2]);
 assert.deepEqual(all.flatMap(r=>r.runs.map(x=>x.run_id)).sort(),["r1-a","r1-b","r2-a","r2-b"]);
''')

    def test_experiment_card_shows_complete_round_mean_stddev_and_capabilities(self):
        self.run_mapping_check(r'''
 const g=group("low-round-overlay",[],[]), names=["Generalization","Precision","Long-Horizon","Memory","Open"];
 g.model.thinking_effort="low";g.aggregation_status="partial";
 g.metrics={completed:90,expected:168,observed_score:.99};
 g.dimensions=Object.fromEntries(names.map(name=>[name,{completed:18,expected:34,observed_score:.99}]));
 const dims=value=>Object.fromEntries(names.map(name=>[name,{score:value}]));
 g.rounds=[{round:1,status:"complete",dimensions:dims(.2)},{round:2,status:"complete",dimensions:dims(.4)},
   {round:3,status:"partial",dimensions:dims(1)},{round:4,status:"pending",dimensions:dims(null)}];
 g.round_statistics={completed_rounds:2,score_mean:.3,success_rate_mean:.25,score_variance_pp2:200};
 context.g=g;
 const summary=JSON.parse(JSON.stringify(vm.runInContext("experimentSummary(g)",context)));
 assert.equal(summary.score,.3);assert.equal(summary.sr,.25);assert.equal(summary.stddev,Math.sqrt(200));assert.equal(summary.n,2);
 assert(summary.capabilities.every(row=>Math.abs(row.score-.3)<1e-12),"Partial round cannot contaminate capability mean");
 install([],[g]);get("experiment-search").value="";vm.runInContext("renderExperiments()",context);
 const content=e=>[e.textContent,...e.children.map(content)].join(" ");
 const text=content(get("experiments"));
 assert.match(text,/30\.0%/);assert.match(text,/14\.14%/);assert.match(text,/Score 标准差/);assert(!text.includes("方差"));assert.match(text,/完整轮 n=2/);
 for(const label of ["泛化","精细操作","长程","记忆","开放","18\/34"])assert(text.includes(label));
 assert.match(text,/仅完整轮等权均值/);
''')

    def test_single_partial_or_ambiguous_round_never_fabricates_stddev(self):
        self.run_mapping_check(r'''
 const g=group("high-partial",[],[]);g.aggregation_status="partial";
 g.metrics={completed:24,expected:42,observed_score:.38,observed_success_rate:.25};
 g.dimensions={Open:{completed:2,expected:8,observed_score:.5}};
 g.rounds=[{round:1,status:"partial"}];g.round_statistics={completed_rounds:1,score_variance_pp2:0};context.g=g;
 let x=JSON.parse(JSON.stringify(vm.runInContext("experimentSummary(g)",context)));
 assert.equal(x.score,.38);assert.equal(x.stddev,null);assert.equal(x.n,0);assert.match(x.basis,/非最终/);
 assert.equal(x.capabilities.find(row=>row.name==="Open").score,.5);
 g.rounds[0].status="complete";g.aggregation_status="complete";g.metrics.score=.4;g.metrics.success_rate=.3;
 x=JSON.parse(JSON.stringify(vm.runInContext("experimentSummary(g)",context)));assert.equal(x.n,1);assert.equal(x.stddev,null);
 g.aggregation_status="ambiguous_multiple_attempts";
 x=JSON.parse(JSON.stringify(vm.runInContext("experimentSummary(g)",context)));
 assert.equal(x.score,null);assert.equal(x.sr,null);assert.equal(x.stddev,null);assert(x.capabilities.every(row=>row.score===null));
''')

    def test_same_task_in_different_experiments_is_not_joined(self):
        self.run_mapping_check(r'''
 const expected=[ep("align_blocks")];
 const own=run("high-case",expected[0],"high-selection",expected,.2);
 const other=run("medium-case",expected[0],"medium-selection",expected,1);
 other.model.thinking_effort="medium";
 const high=group("high-selection",expected,[own.run_id]);
 const medium=group("medium-selection",expected,[other.run_id]);medium.model.thinking_effort="medium";
 install([other,own],[medium,high]);
 assert.deepEqual(rows(high,"1")[0].runs.map(r=>r.run_id),["high-case"]);
 assert.deepEqual(rows(medium,"1")[0].runs.map(r=>r.run_id),["medium-case"]);
''')

    def test_missing_eighteen_results_still_shows_all_expected_forty_two(self):
        self.run_mapping_check(r'''
 const expected=Array.from({length:42},(_,i)=>ep("task_"+String(i).padStart(2,"0"),
   i<12?"random":"standard",0,i<12?"Generalization":"Open"));
 const published=expected.slice(0,24).map((e,i)=>run("published-"+i,e,"high-selection",expected));
 const g=group("high-selection",expected,published.map(r=>r.run_id));install(published,[g]);
 const projected=rows(g,"1");assert.equal(projected.length,42);
 assert.equal(projected.filter(r=>r.runs.length===1).length,24);
 assert.equal(projected.filter(r=>r.runs.length===0).length,18);
 assert.deepEqual(projected.map(r=>r.episode.task).sort(),expected.map(e=>e.task).sort());
''')

    def test_upload_footer_uses_member_manifest_not_display_names(self):
        self.run_mapping_check(r'''
 const a=run("actual",ep("one"),"original-r1",undefined);
 a.protocol.id="original-protocol";
 const g=group("display-only",[],["actual"]);g.protocol.profile="display-profile";
 g.rounds=[{round:1,run_ids:["actual"]}];
 const overlay={id:"display-only",source_selection_ids:["original-r1"]};
 install([a],[g],[overlay]);context.g=g;
 let example=JSON.parse(JSON.stringify(vm.runInContext("uploadExample(g)",context)));
 assert.deepEqual(example,{selection:{id:"original-r1"},protocol:{id:"original-protocol",profile:"persistent-cap20"},rounds:[1]});
 vm.runInContext('renderUploadFooter(document.getElementById("test-footer"),g)',context);
 const text=e=>[e.textContent,...e.children.map(text)].join(" ");
 const displayed=text(get("test-footer"));
 for(const key of ["selection.id","protocol.id","protocol.profile"])assert(displayed.includes(key));
 assert(displayed.includes("original-r1"));assert(displayed.includes("R1"));
 assert(!displayed.includes("display-only"));assert(!displayed.includes("display-profile"));
 const b=run("next",ep("two"),"next-selection",undefined);b.protocol.id="next-protocol";
 g.run_ids=["next"];g.rounds=[{round:2,run_ids:["next"]}];install([b],[g],[overlay]);
 example=JSON.parse(JSON.stringify(vm.runInContext("uploadExample(g)",context)));
 assert.equal(example.selection.id,"next-selection");assert.deepEqual(example.rounds,[2]);
''')

    def test_token_split_means_recompute_when_catalog_gains_a_run(self):
        self.run_mapping_check(r'''
 const a=run("a",ep("one"),"open",undefined), b=run("b",ep("two","standard",1),"open",undefined);
 a.costs={accounting:"known",input_tokens:10,cached_input_tokens:4,output_tokens:5,known_token_lower_bound:15,paid_requests:1,attempts:[]};
 b.costs={accounting:"partial",input_tokens:null,output_tokens:null,cached_input_tokens:null,known_token_lower_bound:8,paid_requests:2,attempts:[{usage_known:true,input_tokens:6,output_tokens:2,cached_input_tokens:3},{usage_known:false,input_tokens:null,output_tokens:null,cached_input_tokens:null}]};
 const g=group("open",[],["a","b","a"]);g.metrics={completed:2,expected:null};
 install([a,b],[g]);context.g=g;
 const getCosts=()=>JSON.parse(JSON.stringify(vm.runInContext("costsFor(g)",context)));
 let c=getCosts();assert.equal(c.run_count,2);assert.equal(c.known_input_tokens,16);assert.equal(c.known_output_tokens,7);assert.equal(c.known_cached_input_tokens,7);assert.equal(c.known_token_lower_bound,23);
 assert.equal(vm.runInContext('tokenText(costsFor(g),"input_tokens",true)',context),"≥ 8");
 assert.equal(vm.runInContext('tokenText(costsFor(g),"output_tokens",true)',context),"≥ 3.5");
 vm.runInContext("renderTokenSummary(g,null)",context);
 const text=e=>[e.textContent,...e.children.map(text)].join(" ");
 assert.match(text(get("token-summary")),/2 个已发布 run/);
 g.dimensions={};context.g=g;vm.runInContext('renderExperimentSummary(document.getElementById("test-card"),g)',context);
 assert.match(text(get("test-card")),/平均输入 \/ run\s+≥ 8/);assert.match(text(get("test-card")),/平均输出 \/ run\s+≥ 3.5/);
 // A later catalog adds a run, keeping the same page functions and group ID.
 const next=run("c",ep("three","standard",2),"open",undefined);
 next.costs={accounting:"known",input_tokens:20,output_tokens:10,cached_input_tokens:9,known_token_lower_bound:30,paid_requests:1,attempts:[]};
 g.run_ids.push("c");install([a,b,next],[g]);
 c=getCosts();assert.equal(c.run_count,3);assert.equal(c.known_input_tokens,36);assert.equal(c.known_output_tokens,17);assert.equal(c.known_token_lower_bound,53);
 assert.equal(vm.runInContext('tokenText(costsFor(g),"total_tokens",true)',context),"≥ 17.6");
 vm.runInContext("renderTokenSummary(g,null)",context);
 assert.match(text(get("token-summary")),/3 个已发布 run/);assert.match(text(get("token-summary")),/≥ 53/);
 assert(!text(get("token-summary")).includes("2 个已发布 run"));
''')

    def test_unpublished_round_never_claims_zero_actual_spend(self):
        self.run_mapping_check(r'''
 install([],[]);
 assert.equal(vm.runInContext("tokenText(costsFor({run_ids:[]}))",context),"—");
 assert.equal(vm.runInContext("costNote(costsFor({run_ids:[]}))",context),"暂无已发布用量");
 assert.equal(vm.runInContext("tokenText({run_count:0,total_tokens:0})",context),"—");
''')

    def test_api_cost_uses_current_membership_and_assigns_invalid_attempts_once(self):
        self.run_mapping_check(r'''
 const cost=(input,cached,output)=>({accounting:"known",input_tokens:input,cached_input_tokens:cached,output_tokens:output,known_token_lower_bound:input+output,paid_requests:1,
   attempts:[{attempt_id:"0",usage_known:true,input_tokens:input,cached_input_tokens:cached,output_tokens:output,model_responses:1,paid_requests:1}]});
 const a=run("replacement",ep("imitate", "standard",55),"low",undefined),b=run("other",ep("task"),"low",undefined);
 a.costs=cost(10000,8000,100);b.costs=cost(20000,18000,200);
 const g=group("low",[],["replacement","other","replacement"]);g.metrics={completed:2,expected:336};
 g.rounds=[{round:5,run_ids:["replacement"],metrics:{completed:1}},{round:6,run_ids:["other"],metrics:{completed:1}}];
 g.prior_invalid_attempt_costs=[{run_id:"invalid1",...cost(3000,2000,30)},{run_id:"invalid2",...cost(5000,4000,50)}];
 install([a,b],[g]);context.g=g;context.fixture.authorized_episode_substitutions=[{selection_id:"low",selected_run_id:"replacement",round:5,previous_invalid_attempt_ids:["invalid1","invalid2"]}];
 const original=JSON.stringify(context.fixture);
 let c=JSON.parse(JSON.stringify(vm.runInContext("costsFor(g)",context)));
 assert.equal(c.run_count,2);assert.equal(c.extra_attempt_runs,2);assert.equal(c.known_token_lower_bound,38380);
 assert.equal(vm.runInContext("costsFor(g.rounds[0]).extra_attempt_runs",context),2);
 assert.equal(vm.runInContext("costsFor(g.rounds[1]).extra_attempt_runs",context),0);
 let api=JSON.parse(JSON.stringify(vm.runInContext("apiCostsFor(g)",context)));
 assert.equal(api.run_count,2);assert(Math.abs(api.avg_optimistic_min-.0285)<1e-10);
 assert(vm.runInContext("apiCostsFor(g)===apiCostsFor(g)",context),"Unchanged UI interactions reuse the snapshot estimate");
 assert.equal(vm.runInContext("usd(.003456)",context),"$0.0035");
 assert.equal(vm.runInContext("usd(.003456,'down')",context),"$0.0034");
 assert.equal(vm.runInContext("apiReferenceText({avg_observed_min:6.235376,avg_observed_max:6.644466})",context),"$6.23–$6.65");
 assert.notEqual(vm.runInContext("apiReferenceText({avg_observed_min:.0011,avg_observed_max:.0022})",context),"$0.00");
 vm.runInContext("renderTokenSummary(g,null)",context);
 const text=e=>[e.textContent,...e.children.map(text)].join(" ");
 assert.match(text(get("token-summary")),/实测缓存 API/);assert.match(text(get("token-summary")),/全缓存乐观下界/);assert.match(text(get("token-summary")),/分母不增加/);
 assert.equal(JSON.stringify(context.fixture),original,"Price projection cannot alter raw data, scores or costs");
 const next=run("new",ep("next"),"low",undefined);next.costs=cost(10000,9000,100);
 g.run_ids.push("new");context.fixture.runs.push(next);
 api=JSON.parse(JSON.stringify(vm.runInContext("apiCostsFor(g)",context)));
 assert.equal(api.run_count,3);assert(Math.abs(api.avg_optimistic_min-.024)<1e-10);
 assert.equal(vm.runInContext("apiCostsFor({run_ids:[]}).avg_observed_min",context),null);
''')

    def test_open_membership_and_token_total_preserve_unknown(self):
        self.run_mapping_check(r'''
 const a=run("a",ep("one"),"open",undefined), b=run("b",ep("two","standard",1),"open",undefined);
 a.costs={accounting:"known",input_tokens:10,cached_input_tokens:4,output_tokens:5,known_token_lower_bound:15,paid_requests:1,attempts:[{usage_known:true}]};
 b.costs={accounting:"partial",input_tokens:null,output_tokens:null,known_token_lower_bound:7,paid_requests:2,attempts:[{usage_known:true},{usage_known:false}]};
 const g=group("open",[],["a","b"]);g.metrics={completed:2,expected:null};
 g.rounds=[{round:1,seed:0,scene:0,run_ids:["a"],metrics:{completed:1,expected:null}},{round:2,seed:0,scene:1,run_ids:["b"],metrics:{completed:1,expected:null}}];
 install([a,b],[g]);assert.equal(rows(g).length,2);assert.equal(rows(g,"2")[0].episode.task,"two");
 context.g=g;
 const c=JSON.parse(JSON.stringify(vm.runInContext("costsFor(g)",context)));
 assert.equal(c.known_token_lower_bound,22);assert.equal(c.total_tokens,null);assert.equal(c.paid_requests,3);assert.equal(c.unknown_usage_attempts,1);
 assert.equal(vm.runInContext("tokenText(costsFor(g))",context),"≥ 22");
 assert.equal(vm.runInContext("tokenText(costsFor(g.rounds[0]))",context),"15");
 assert.equal(vm.runInContext("coverage(g.metrics)",context),"2");
''')

    def test_duplicate_episode_keeps_both_attempts_instead_of_best_score(self):
        self.run_mapping_check(r'''
 const expected=[ep("align_blocks")];
 const published=[run("attempt-failed",expected[0],"selection",expected,0),
   run("attempt-succeeded",expected[0],"selection",expected,1)];
 const g=group("selection",expected,published.map(r=>r.run_id));install(published,[g]);
 const projected=rows(g,"1");assert.equal(projected.length,1);
 assert.equal(projected[0].runs.length,2);
 assert.deepEqual(projected[0].runs.map(r=>r.run_id).sort(),["attempt-failed","attempt-succeeded"]);
 assert.deepEqual(projected[0].runs.map(r=>r.outcome.score).sort(),[0,1]);
''')

    def test_same_episode_key_with_wrong_capability_cannot_join(self):
        self.run_mapping_check(r'''
 const expected=[ep("align_blocks","standard",0,"Open")];
 const wrong=run("wrong-capability",ep("align_blocks","standard",0,"Precision"),"selection",expected,1);
 const g=group("selection",expected,[wrong.run_id]);install([wrong],[g]);
 const projected=rows(g,"1");assert.equal(projected.length,1);
 assert.deepEqual(projected[0].episode,expected[0]);
 assert.equal(projected[0].runs.length,0);
''')
