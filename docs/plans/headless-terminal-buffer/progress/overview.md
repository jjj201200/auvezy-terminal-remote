# 进度总览

| # | 阶段 | 状态 | 备注 |
|---|------|------|------|
| 1 | 计划文档 + ADR | ✅ | design.md + ADR-001（grid 模型）+ ADR-002（AnsiFilter 退役） |
| 2 | 依赖引入 | ⬜ | @xterm/headless@5.5.0 + @xterm/addon-serialize@0.14.0 |
| 3 | TerminalState 组件 | ✅ | | backend/src/pty/terminal-state.ts，接口对齐旧 OutputBuffer |
| 4 | SessionController / WsServer 接线 | ✅ | | broadcast exclude 参数 + history_sync 顺序保证 |
| 5 | 测试重写 | ✅ | 694 全绿 | | 单测 + serialize 回放保真度 |
| 6 | build + smoke + commit | ⬜ | 连真实 claude 验证回放/重连/翻阅/resize |
