# agent-os

把飞书变成 AI 编程 CLI（Claude Code / Codex）的指挥台。
一个话题 = 一个任务；bot 之间可互相 @ 协作；cron 定时巡检。

## 运行

pnpm start（watch 模式）/ pnpm start:once（单次启动）

## 模块地图（随开发生长，只列已存在的）

- src/index.ts — 入口：启动 banner + 环境自检
- src/probe-cli.ts — AI CLI 事件流解析器（stdin 读 headless JSON 行，打印时间线）

## 约定

- ESM only，Node 22+，pnpm
- 凭证只放 .env（已 gitignore），绝不硬编码、绝不提交

## 错题本

> 踩坑后追加一行：现象 → 原因 → 正确做法。给未来的 AI 和人看。
