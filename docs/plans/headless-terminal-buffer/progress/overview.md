# 进度总览

| # | 阶段 | 状态 | 备注 |
|---|------|------|------|
| 1 | 计划文档 + ADR | ✅ | design.md + ADR-001（grid 模型）+ ADR-002（AnsiFilter 退役） |
| 2 | 依赖引入 | ✅ | @xterm/headless@5.5.0 + @xterm/addon-serialize@0.14.0，spike 验证通过 |
| 3 | TerminalState 组件 | ✅ | backend/src/pty/terminal-state.ts，接口对齐旧 OutputBuffer |
| 4 | SessionController / WsServer 接线 | ✅ | broadcast exclude 参数 + history_sync 顺序保证 |
| 5 | 测试重写 | ✅ | terminal-state 12 项 + session 30 项，全量 694 通过 |
| 6 | build + smoke + commit | ✅ | bash PTY WS smoke 全过：scrollback/TUI 帧/3J strip/重连回放 |
