# 存储脚本契约

命令入口为 Skill 目录下的 `scripts/brief-store.mjs`，输出 JSON；错误退出码为 1。配置只包含六项，下面的记录字段属于内部运行数据。

## 命令

```text
node <脚本路径> init --config <已有配置文件>
node <脚本路径> begin --config <配置文件>
node <脚本路径> history --config <配置文件> --offset 0 --limit 50
node <脚本路径> publish --config <配置文件> --run-id <运行标识>
node <脚本路径> fail --config <配置文件> --run-id <运行标识> --reason <失败原因>
node <脚本路径> feedback --config <配置文件> --brief-id <YYYY-MM-DD> --text <反馈>
```

初始化前先写配置 JSON，至少提供 `keywords`。`init` 补齐六项并创建默认模板；自定义模板路径必须已存在。不能对非空且未初始化的输出目录强行初始化。普通生成不会创建丢失的历史根目录。

`begin` 返回：

- `ready`：`run_id`、`business_date`、`draft_dir`、`snapshot_path`、`history_count`、`history_digest`。读取快照文件获取当次配置、模板内容与反馈。
- `reused`：`brief_id`、`brief_path`，当天已发布，直接打开返回。
- `busy`：已有运行的标识和开始时间。不要重复生成，也不要自行抢锁。

`history` 返回 `total`、`history_digest`、本页 `entries` 与 `next_offset`。持续读取到 `next_offset: null`。索引条目包含学习问题、成果、关键结论、增量、来源与全文绝对路径。脚本从成功归档核验并派生索引，缺失索引可修复，归档损坏必须停止。

`ready` 后在 `draft_dir` 下写正文和记录，图片及 `.mmd` 源文件也放在该目录或其子目录。正文中本地图像用相对路径。禁止符号链接、越过草稿目录的图片引用、缺失图片与远程图片；外部资料可以用普通 Markdown 链接引用。

## 草稿 record.json

以下为结构示例，不是可直接发布的资料。所有来源及取舍理由必须来自本次真实阅读和历史比较。

```json
{
  "topic": "一个具体主题",
  "learning_question": "今天究竟回答什么问题？",
  "learning_outcome": "读完新增的解释、操作或判断能力",
  "key_claims": ["带条件的核心结论"],
  "content_type": "经典知识",
  "related_brief_ids": [],
  "new_learning_delta": "首次覆盖此问题；有历史时具体说明增量",
  "dedup_review": {
    "decision": "pass",
    "history_digest": "begin 返回的历史摘要标识",
    "compared_brief_ids": [],
    "closest_brief_ids": [],
    "rationale": "与最接近历史相比，为什么有实质增量"
  },
  "sources": [
    {
      "url": "https://example.org/original-paper",
      "title": "实际阅读的标题",
      "author": "作者或机构",
      "published_at": null,
      "accessed_at": "2026-11-06T01:00:00.000Z",
      "version": null,
      "supports": ["带条件的核心结论"]
    }
  ],
  "candidate_reviews": [
    {
      "question": "候选学习问题",
      "decision": "selected",
      "reason": "选中或拒绝的简短依据"
    }
  ]
}
```

- `content_type` 只能是“新进展”或“经典知识”。`compared_brief_ids` 必须覆盖全部历史简报日期，`closest_brief_ids`、`related_brief_ids` 只能引用已有日期。空历史才能全部为空。
- 每条 `key_claims` 至少被一条来源的 `supports` 引用。推断需在结论文本及正文中标注，并提供推断依据。`published_at` 未知填 `null`，不猜日期；`version` 无版本填 `null`。
- `candidate_reviews` 最多 5 条，恰有一条 `selected`；其他为 `rejected`。只保存简短依据，不保存内部推理。
- 不手填运行日期、配置快照、模板快照、正文哈希或规范化 URL，它们由脚本写入。快照来自 `begin`，即使运行途中配置变化，也不会悄悄改变本次生成条件。
- 脚本会拦截相同正文或相同学习成果；这只是确定性兜底。换措辞的语义重复仍须由 Skill 对照历史拒绝。

## 落盘与恢复

完整日目录是成功产物，包含 `brief.md`、补齐后的 `record.json` 和图表附件。按 `YYYY/MM/YYYY-MM-DD` 归档；`index.jsonl` 是派生索引；`feedback.jsonl` 保存反馈；`runs/<run-id>.json` 保存每次尝试。`.store.json` 标识已初始化历史，`.lock` 与 `.drafts/` 为内部运行文件。

运行锁跨多次脚本调用保留，用 `run_id` 关联所有者，不把已经退出的短命 CLI 进程 PID 当成长期锁。`publish` 和 `fail` 只处理指定的拥有者，不会抢占其他运行。

发布通过同一输出根目录内的目录重命名完成，再更新索引和运行状态。发布后发生错误，返回 `succeeded` 和警告，不能把已经归档的简报改记为失败。确认原调用已结束后，执行同一运行的 `fail` 可识别已发布目录并恢复成功、重建索引、释放锁。不得对仍在生成的调用执行恢复。

普通失败保留草稿及失败原因并释放本轮锁；存储不可写时错误返回 `persisted: false`。同一文件系统必须支持独占文件创建和目录重命名；首版面向单机持久目录，不宣称分布式锁或跨设备协调。

全部候选被拒绝时，可先在草稿 `record.json` 只写 `candidate_reviews`，再执行 `fail`，脚本会把候选摘要保存到失败运行记录。若中断发生在创建锁之后、写入运行文件之前，确认原调用已结束后，仍可使用锁中的标识执行 `fail`，补齐失败记录并释放该锁。
