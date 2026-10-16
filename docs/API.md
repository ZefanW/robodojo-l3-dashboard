# RoboDojo L3 数据 API v1

入口：<https://zefanw.github.io/robodojo-l3-dashboard/api/v1/index.json>  
在线说明：<https://zefanw.github.io/robodojo-l3-dashboard/api/>  
OpenAPI：<https://zefanw.github.io/robodojo-l3-dashboard/api/v1/openapi.json>

这是公开只读 JSON API，不需要登录、API key、网盘 cookie 或清华云盘 SDK。实验列表、得分、成功状态、配置、动作与反馈、原生终局、源码锁和费用记录直接从 GitHub 网站获取。单个结果详情已经内嵌该结果**全部已公开的非视频 JSON 证据**，无需逐个访问网盘。

视频体积较大，仍存放在原公开存储。API 的 `videos` 提供原文件下载 URL、字节数和 SHA256，调用方不需要操作网盘网页；**API 不代理或托管视频字节**。历史记录实际缺少的材料不会补造，未公开的本地日志、认证材料和原始模型内部记录不属于本 API。

## 接口

基础地址：`https://zefanw.github.io/robodojo-l3-dashboard/api/v1/`

所有接口支持 HTTP GET；保留表中的 `.json` 后缀。

| 路径 | 返回内容 |
| --- | --- |
| `index.json` | API 版本、当前快照 SHA、数量及接口链接 |
| `experiments.json` | 实验组列表、显示名称、原 selection ID、模型、协议、指标和结果数量 |
| `evaluations.json` | 所有实验的固定首轮42 / P50_111成绩、覆盖、缺失样本和入选原记录 |
| `experiments/{experiment_id}.json` | 一个实验组的完整公开汇总，包括逐轮、能力维度、成本及统计限制 |
| `experiments/{experiment_id}/results.json` | 该组结果摘要及各条记录的入选状态、轮次、详情 URL |
| `results.json` | 所有公开结果的轻量摘要，适合自行筛选任务、effort、seed、scene |
| `results/{run_id}.json` | 单条完整结果，包含全部已公开结构化证据及视频链接 |
| `tasks.json` | 任务族列表、各任务结果数量及链接 |
| `tasks/{task}.json` | 同一个任务跨实验、轮次、seed、scene 的所有结果摘要 |
| `round-selections.json` | 看板采用的逐轮选择与来源绑定定义 |
| `status.json` | 上传队列和待核验记录；不表示实时模拟器或实验进程状态 |
| `openapi.json` | OpenAPI 3.1 接口定义 |

这是随看板部署生成的静态 API，没有服务端查询、分页、写入或删除接口。`?task=...`、`?limit=...` 等查询参数**不会筛选数据**；使用任务接口或在客户端筛选。单条详情避免下载整个看板的大索引。

## 最短调用示例

```bash
curl -fsS https://zefanw.github.io/robodojo-l3-dashboard/api/v1/experiments.json
curl -fsS https://zefanw.github.io/robodojo-l3-dashboard/api/v1/tasks/imitate_sorting_sequence.json
```

Python 标准库即可完成“选实验 → 列结果 → 取完整结果”：

```python
import json
from urllib.request import urlopen

BASE = "https://zefanw.github.io/robodojo-l3-dashboard/api/v1/"

def get(path):
    with urlopen(BASE + path, timeout=60) as response:
        return json.load(response)

experiments = get("experiments.json")["experiments"]
# 先列出 ID 与名字，按需要替换下面的选择条件。
for experiment in experiments:
    print(experiment["experiment_id"], experiment["name"])

experiment = next(e for e in experiments
                  if e["protocol"]["profile"] == "persistent-cap20"
                  and e["model"]["thinking_effort"] == "low")
listing = get(f"experiments/{experiment['experiment_id']}/results.json")
run_id = listing["results"][0]["run_id"]
detail = get(f"results/{run_id}.json")
assert listing["snapshot_id"] == detail["snapshot_id"], "期间有新部署，请重新获取"
print(detail["result"]["episode"], detail["result"]["outcome"])
actions = next((e["data"] for e in detail["evidence"]
                if e["kind"] == "action_feedback"), None)
print(actions)  # 原公开动作/反馈 JSON；缺少该证据时为 None。
```

也提供可直接复用的 [Python 客户端](../examples/api_client.py)：

```bash
python3 examples/api_client.py
python3 examples/api_client.py --task imitate_sorting_sequence
python3 examples/api_client.py --experiment EXPERIMENT_ID --task push_T
python3 examples/api_client.py --run RUN_ID
```

浏览器 JavaScript：

```javascript
const base = "https://zefanw.github.io/robodojo-l3-dashboard/api/v1/";
const response = await fetch(base + "tasks/imitate_sorting_sequence.json");
if (!response.ok) throw new Error(`HTTP ${response.status}`);
const { snapshot_id, results } = await response.json();
console.table(results.map(r => ({
  run: r.run_id, score: r.outcome.score, success: r.outcome.success,
  effort: r.model.thinking_effort, seed: r.episode.seed, scene: r.episode.scene
})));
```

## 字段与解释

每个数据响应包含 `schema_version: "robodojo-api-v1"` 和 `snapshot_id`。后者是该次看板索引的 SHA256，不是模型运行 ID。`openapi.json` 使用标准 OpenAPI 格式。

### 实验与结果 ID

- `experiment_id` 对应看板 `group_id`，从 `experiments.json` 获取。分组定义变化时 ID 可能变化，不要根据名字猜 ID。
- `selection_id` 保留原选择方案的 ID，适合重新发现对应组；它与某条原始记录的 `selection.id` 在合并实验中可能不同。
- `name` 是共享显示名称，允许维护者更名，不作为主键。
- `run_id` 保留原运行身份，不因 API 而改名。
- `memberships` 记录每条结果属于哪些实验组、入选轮次，以及 `selected`、`preserved_unselected`、`supplementary`。历史保留但未入选的记录可查询，不能自行混进组成绩。
- `episode.task` 使用任务族名称；随机变体通过 `episode.variant` 区分。`scene` 是真实原生场景号，例如获准的 scene55 替代仍显示 55；逻辑轮次从 `memberships[].rounds` 读取。

### 单条完整结果

`results/{run_id}.json` 返回：

| 字段 | 含义 |
| --- | --- |
| `result` | 完整公开记录：episode、model、protocol、outcome、configuration_parameters、costs、versions、limitations、artifacts 等 |
| `memberships` | 实验组、入选状态与逻辑轮次 |
| `evidence[]` | 每个非视频 JSON 证据的 `kind`、`path`、SHA256、字节数、站内 URL 和解析后的 `data` |
| `videos[]` | 原视频文件公开直链、文件名、字节数、SHA256；可能为空 |
| `original_manifest_url` | 站内原始已接受 manifest；特殊补充/人工指定记录没有正式 manifest 时为 null |

在 `result.artifacts` 中，非视频的 `url` 指向本站公开镜像，`source_url` 保留原发布地址；视频 `url` 保持原文件下载地址。SHA256 和 `bytes` 对应原文件字节；`evidence[].data` 是解析后的 JSON，验证文件 SHA 应下载其 `url` 的原始字节。

### 得分、证据与费用

#### 自动发布首轮和 P50_111 成绩

`evaluations.json` 提供所有组的固定评测结果；实验列表与单组详情同时提供
`evaluation_scores`。它包含 `first_round` 与 `P50_111` 两项，使用同一份
[冻结样本定义](../web/evaluation-plans.json)。每次看板发布自动重算，无需逐组手填成绩。

每项包含 `status`、`completed`、`expected`、`score`、`success_rate`、
`selected_run_ids`、`missing_cases`、`conflicts`、`task_scores` 和
`capability_scores`。只有全部指定样本可用且无冲突时，`status` 为 `complete`，
总分才非空；缺样本或多次尝试有歧义时不输出局部总分。

两项固定评测都采用 seed 0。首轮为30个任务 standard scene0 +12个泛化任务
random scene0。P50_111为23个固定任务各4次、其余19个各1次；4次对应非泛化
scene0–3，泛化 random/standard 的 scene0–1。不会用其他scene、seed或其他组
补齐缺口，也不会因为已上传样本总数达到111就宣告完成。

得分先在task内平均，再在能力内平均，最后五能力等权平均；SR同样处理。
`evidence_basis` 与 `supplementary_run_ids` 保留既有用户接受补件的披露；
该例的 `formal_episode_result` 仍为false，不因此变成严格原生校验结果。
固定成绩与原有完整轮均值是不同统计范围，不能混用。

- `outcome.score` 采用 **0–1**，展示百分制时乘 100；`success` 是独立成功标记。
- 保留原来的 null。未完成组的正式汇总可能为 null，`observed_score` 等只表示已有部分的观察值，不应当作完整实验成绩。
- 保留 `evidence_level` 与 `formal_episode_result`。`user_accepted_supplementary` 和 `user_assigned_zero` 不会被 API 升格为严格原生证据。
- `costs` 原样保留全部已记录尝试；cache 属于 input 的子集，不能再次加到总量里。未知用量仍保持未知。
- 多个结果共享 task/seed/scene 不等于同一个 run；按 `run_id` 去重，按看板已声明的 membership 选择比较集合。

## 更新、缓存与错误

API 与看板使用同一份已接受数据，在每次 GitHub Pages 发布时一同构建，无需手动维护接口内容。上传提交成功和公开 API 可见之间包含接收、验证、同步、部署时间；尚未接收的包不进入 `results`。

跨请求分析请比较 `snapshot_id`；不一致时重新取列表和详情，避免把发布前后两份数据混在一次统计中。API 的路径提供当前快照，不承诺任意历史快照查询。可使用 HTTP 缓存、ETag 或条件请求减少重复下载；需要最新结果时重新验证缓存。

错误 ID/路径返回 HTTP 404，GitHub Pages 的错误正文可能是 HTML；先检查状态码再解析 JSON。公开访问不需要任何网盘认证。服务是 GitHub Pages 静态文件，不提供私有数据、实时实验控制或视频转码代理。
