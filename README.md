# knowledge-brief

结合配置关键词、本次提示词和历史简报清单查询资料，确定有实质新增的主题，按模板生成知识简报并保存。

Skill 直接维护在 [.agents/skills/knowledge-brief](.agents/skills/knowledge-brief/SKILL.md)，当前项目使用这一份文件。由宿主 Agent 使用现有工具完成，无额外运行依赖。

设计说明见 [docs/知识简报Skill设计方案.md](docs/知识简报Skill设计方案.md)，[流程图](docs/assets/knowledge-brief-flow.svg)展示完整流程。

## 使用

在宿主中拉起 `knowledge-brief`，附上配置文件路径和本次提示词，例如：

```text
使用 knowledge-brief，配置文件是 ./knowledge-brief.config.json。
今天重点解释方法的适用边界，结合历史选一个没有重复讲过的问题。
```

首次配置可直接告诉 Agent 想探索的关键词和说明，委托它创建配置与模板；没有初始化命令。也可手动复制 [配置样例](.agents/skills/knowledge-brief/assets/config.example.json) 和 [默认模板](.agents/skills/knowledge-brief/references/brief-template.md) 到项目根目录并编辑。

配置只保留六项，路径相对于配置文件所在目录：

```json
{
  "keywords": ["你想探索的关键词"],
  "description": "关注什么、希望解决什么问题",
  "style": "准确、简洁、通俗易懂，重点突出",
  "source": "优先原始研究、权威资料和可信的一手实践，关键结论追溯原始来源",
  "output_dir": "./src",
  "template": "./brief-template.md"
}
```

配置给出长期范围，本次提示词给出当前重点；不自动改写配置。Skill 先检索历史清单，必要时读相近原文，再查询资料和确定主题，默认不逐次询问。需要先看选题时，在本次提示词中说明。

Skill 会沿资料线索主动探索和调整选题。模板只是写作框架，可按主题自由组织；例子、练习和小标题按需选择。重要依据和适用条件贴近相关结论说明，不设置固定的“证据与边界”栏目。

## 输出与历史

```text
src/
├── list.json
└── confidence-interval-coverage/
    ├── brief.md
    └── images/                      # 有图片时创建
```

每篇使用具体的英文主题目录名；日期、结论、实际来源和必要的旧文链接保留在正文中。逻辑、流程和交互用图表，方案比较用表格；图片及图表源文件保存在 `images/`。

`src/list.json` 是唯一历史清单，每条仅含：

```json
{
  "date": "2026-11-06",
  "topic": "95% 置信区间如何理解？",
  "summary": "用 1–2 句话概括本篇的核心认识或方法。",
  "output_dir": "confidence-interval-coverage"
}
```

清单最外层为数组，条目中的 `output_dir` 相对于 `src/`，原文为该目录下的 `brief.md`。先保存正文和图片，再保留旧条目追加清单，回读核对后返回文件链接。已有文件不覆盖；同一天可以生成不同主题。

本项目的 [src/list.json](src/list.json) 已建立，初始为空；正式简报按你提供的配置生成。

来源不足或无法确认新意时换题或说明原因；清单损坏时停止，不清空历史。语义去重依赖 Agent 对照历史判断，每日自动触发由宿主调度。
