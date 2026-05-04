# Open-Claude-Remote 复刻总进度

**计划**：`docs/plans/open-claude-remote-clone/design.md`
**状态**：进行中
**起始日期**：2026-05-05

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
| 8  | IP 漂移 + ANSI 过滤         | ⏳ 待开始 | 0/7  | [stage-08.md](./stage-08.md) |
| 9  | Web Push                    | ⏳ 待开始 | 0/7  | [stage-09.md](./stage-09.md) |
| 10 | 打磨与发布                  | ⏳ 待开始 | 0/7  | [stage-10.md](./stage-10.md) |
|    | **总计**                    |          | **75/96** ||

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
| 007 | ⏳ | 启用 AlternateScreenFilter |
| 008 | ⏳ | Web Push VAPID 三优先级 |
| 009 | ✅ | 错误体系（AppError + ErrorCode） |
| 010 | ✅ | 裁剪 OnboardingGuide 与钉钉通知 |

---

## 当前阻塞

无。

---

## 上次更新

2026-05-05 · 阶段 7 完成（6/6 步骤），AttachClient（normalizeAttachUrl + 重连退避，9 单测）
+ attach.ts CLI（stdin raw mode + SIGWINCH + 双 Ctrl+C）+ cli.ts 分发 + SessionController
主从仲裁（webapp 优先 resize，3 仲裁单测）+ ADR 004 已记录。247/247 backend 单测 + 15/15
shared 单测 + stage-07 smoke 6/6 通过。总进度 75/96。
