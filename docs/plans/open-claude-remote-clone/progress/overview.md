# Open-Claude-Remote 复刻总进度

**计划**：`docs/plans/open-claude-remote-clone/design.md`
**状态**：✅ 已完成
**起始日期**：2026-05-05
**完成日期**：2026-05-05

---

## 阶段总览

| 阶段 | 主题 | 状态 | 进度 | 文档 |
|---|---|---|---|---|
| 0  | 项目骨架与协议层            | ✅ 完成   | 7/7  | [stage-00.md](./stage-00.md) |
| 1  | PTY ↔ WS ↔ xterm 闭环      | ✅ 完成   | 12/12 | [stage-01.md](./stage-01.md) |
| 2  | 认证与安全                  | ✅ 完成   | 11/11 | [stage-02.md](./stage-02.md) |
| 3  | 审批通知                    | ✅ 完成   | 8/8  | [stage-03.md](./stage-03.md) |
| 4  | 配置体系                    | ✅ 完成   | 11/11 | [stage-04.md](./stage-04.md) |
| 5  | 文件锁 + 共享 Token + 二维码 | ✅ 完成   | 7/7  | [stage-05.md](./stage-05.md) |
| 6a | 多实例（后端）              | ✅ 完成   | 7/7  | [stage-06a.md](./stage-06a.md) |
| 6b | 多实例（前端 + Web 创建）   | ✅ 完成   | 6/6  | [stage-06b.md](./stage-06b.md) |
| 7  | attach 子命令               | ✅ 完成   | 6/6  | [stage-07.md](./stage-07.md) |
| 8  | IP 漂移 + ANSI 过滤         | ✅ 完成   | 7/7  | [stage-08.md](./stage-08.md) |
| 9  | Web Push                    | ✅ 完成   | 7/7  | [stage-09.md](./stage-09.md) |
| 10 | 打磨与发布                  | ✅ 完成   | 7/7  | [stage-10.md](./stage-10.md) |
| ✦  | 前端整体改造与移动端适配     | ✅ 完成   | 31/31 | [stage-frontend-overhaul.md](./stage-frontend-overhaul.md) |
|    | **总计**                    |          | **127/127** ||

**状态图例**：⏳ 待开始 · 🔄 进行中 · ✅ 完成 · ⚠ 阻塞

---

## 关键决策日志

每个 ADR 在对应阶段开始前补写于 `docs/plans/open-claude-remote-clone/adrs/`：

| ADR | 状态 | 说明 |
|---|---|---|
| 001 | ⏳ | PTY + Hooks 审批方案 |
| 002 | ✅ | mkdir-as-lock 文件锁选型 |
| 003 | ✅ | Cookie 名后缀绑端口 |
| 004 | ✅ | webapp/attach 主从仲裁 |
| 005 | ⏳ | WS 输出三阈值批合并 |
| 006 | ⏳ | 单调 seq 仅作版本戳 |
| 007 | ✅ | 启用 AlternateScreenFilter |
| 008 | ✅ | Web Push VAPID 三优先级 |
| 009 | ✅ | 错误体系（AppError + ErrorCode） |
| 010 | ✅ | 裁剪 OnboardingGuide 与钉钉通知 |
| 011 | ✅ | 前端样式栈选型 Tailwind v4 + Radix + vaul |

---

## 当前阻塞

无。

---

## 上次更新

2026-05-05 · 前端整体改造与移动端适配完成（31/31 步骤）。
私货清扫 + 快捷键乱码修复（escape codec + 28 单测）+ Tailwind v4/Radix/vaul/lucide 样式重写
+ `100dvh` + visualViewport 修移动端布局根因。CSS 体积 24KB（gzip 6.2KB），
JS 增量约 28KB gzip。frontend typecheck / build / 308 backend tests 全过。
**累计进度 127/127，包含初版交付 + 前端整体改造。**

2026-05-05（初版）· 阶段 10 完成（7/7 步骤）。install.sh 一键安装（Node/pnpm/编译依赖三检）
+ README 用户视角 + ARCHITECTURE 模块图与数据流 + CHANGELOG 0.1.0；smoke-cross 跨阶段集成
6/6 全过（health / 登录 / WS 收发 / 配置双向 / instances / vapid）；
backend 284 单测 + shared 15 单测 + frontend typecheck/build 全过；端口与临时 HOME 已清理。
总进度 96/96，项目交付完成。
