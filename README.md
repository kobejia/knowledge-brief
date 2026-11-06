# knowledge-brief

按关键词和探索说明生成每日知识简报的 Skill。每天聚焦一个问题，保存全文、来源和学习记录；生成前对照全部历史，避免实质重复。

实现位于 [skills/knowledge-brief](skills/knowledge-brief/SKILL.md)，独立包含指令、默认模板、配置示例和存储脚本，不依赖其他方案文档。需要 Node.js 22 或更高版本，无第三方运行依赖。

设计方案保存在 [docs/知识简报Skill设计方案.md](docs/知识简报Skill设计方案.md)。

## 使用

1. 将 `skills/knowledge-brief` 整个目录放入运行宿主支持的 Skill 目录。
2. 告诉 Agent：“使用 knowledge-brief，配置我的简报，关键词是……，说明是……”。初始化会创建六项配置、可编辑模板和历史目录。
3. 后续请求：“按这份配置生成今天的简报”，并提供配置文件绝对路径。也可查询历史或反馈某篇太浅、太深、已掌握、想继续。

配置只保留：

```json
{
  "keywords": ["你想探索的关键词"],
  "description": "关注什么、希望解决什么问题",
  "style": "准确、简洁、通俗易懂，用具体例子解释",
  "source": "优先原始研究、权威资料和可信的一手实践，关键结论追溯原始来源",
  "output_dir": "./briefs",
  "template": "./brief-template.md"
}
```

输出目录与模板路径相对于配置文件解析。仅输入关键词也能初始化，其他字段使用默认值。逻辑、流程与交互使用图表，比较使用表格；来源和图表附件随简报归档。

需要手动初始化时，先创建配置文件，再执行：

```powershell
node skills/knowledge-brief/scripts/brief-store.mjs init --config "D:\my-briefs\knowledge-brief.config.json"
```

完整命令和草稿格式见 [存储契约](skills/knowledge-brief/references/store-contract.md)。存储 CLI 负责确定性文件操作，检索、真实阅读、写作和语义去重由使用 Skill 的 Agent 执行。

## 历史与运行约束

同一输出目录每天北京时间只发布一篇；重复调用返回已有简报。不同配置共用目录时也共用这一约束。更换同一份简报的保存位置时需连同完整历史迁移。

脚本校验正文和附件完整性，历史损坏时停止。语义去重依赖模型对照真实历史，不能承诺永久零误判；没有合格题目时记录失败。中断的生成锁不自动超时抢占，确认原调用结束后按存储契约恢复。

每日触发由外部调度器完成；启用前验证宿主、联网、同一历史目录和结果展示。本仓库不自动创建调度任务，也不提交或同步用户历史。

## 验证

```powershell
npm run check
npm test
```

测试通过真实 CLI 子进程检查配置、同日复用、并发、全历史比较约束、损坏检测、附件与恢复。合成测试资料不代表真实来源阅读或自动语义判断已被证明。独立前向试运行的样稿保存在本地 `.validation/`，该目录不纳入 Git。
