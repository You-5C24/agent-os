# agent-os

飞书是操作界面，Claude Code / Cursor 是执行引擎（Codex 仅作备用）；本项目实现中间的个人生产系统指挥层。一个话题 = 一个 CLI 会话；bot 之间可以互相 @ 协作；cron 定时巡检；本地 Dashboard 管理任务。

## 运行

```bash
pnpm start       # watch 模式启动，源码变化后自动重启
pnpm dev         # pnpm start 的别名
pnpm start:once  # 单次启动
```

## 约定

- ESM only，Node 22+，pnpm
- 飞书凭证只放 `.env`（已 gitignore）；Claude Code 模型后端与第三方 API Key 放在用户级 `~/.claude/settings.json`，绝不硬编码、绝不提交
- 测试话题群 chat_id 见 `.env`
- 执行入口始终调用真实 `claude` 命令；没有 Anthropic 订阅时按 DeepSeek 官方指南配置模型后端
- `CLAUDE_WORKDIR` 指向 Claude Code 实际处理任务的项目目录

## 错题本

> 踩坑后追加一行：现象 → 原因 → 正确做法。给未来的 AI 和人看。

- pnpm v11 默认拒绝依赖的构建脚本（esbuild 装完不可用）→ 在 `pnpm-workspace.yaml` 写 `allowBuilds: { esbuild: true }` 放行
