---
name: handoff
description: 将当前对话压缩整理成交接文档，供下一位 agent 接手继续工作。
argument-hint: "下一次会话将用于什么？"
---

编写一份交接文档，总结当前对话，让新的 agent 能够继续推进工作。将文档保存到 `mktemp -t handoff-XXXXXX.md` 生成的临时路径中。

如果下一次会话应使用某些技能，请在交接文档中建议这些技能。

不要重复已经沉淀在其他产物中的内容，例如 PRD、计划、ADR、issue、commit、diff。改为通过路径或 URL 引用它们。

如果用户传入了参数，请将其视为下一次会话的重点描述，并据此调整交接文档。
