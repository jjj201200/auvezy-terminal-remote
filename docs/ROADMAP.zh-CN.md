# 路线图

> 下面列的全部是 **计划中 / 评估中 / 明确不做** 的功能 —— 尚未实现。
> 当前版本已经实现的内容见 [已实现特性](./FEATURES.zh-CN.md)。
> 各档按"投入产出比"排序,越靠后的优先级越低。
>
> **上次审查日期**:2026-05-20(对照 0.7.6 代码盘点;Push 通知已从计划下移到 FEATURES)

[English](./ROADMAP.md) · [简体中文](./ROADMAP.zh-CN.md)

## 第一档 — 计划中(移动端必加,工作量小,明显改善体验)

1. **Local Echo 本地预回显**(参考 Mosh / Blink / code-server)
   移动端 4G / 弱网下输入延迟的杀手。xterm 预测插件让按键立刻显示,PTY 回包覆盖。
   投入低收益巨大。
2. **多行粘贴警告 + bracketed paste**(参考 VS Code、Tabby)
   移动端从微信 / 邮件粘贴多行命令直接进 PTY 风险高,检测多行 → 弹确认。
3. **Shell Integration 子集(OSC 633/133)**
   - command decorations(绿 / 红圆点)
   - Run Recent Command 跨会话 fuzzy 历史 quick pick

   对手机用户极友好(手机打字慢 → 跨会话历史搜索是核心需求)。
4. **Auto Reply(自动应答)**(参考 VS Code)
   匹配 prompt 自动回 y/N,免去手机敲 `[y/N]` 的麻烦。
5. **Process Revive(终端复活)**(参考 VS Code)
   把 scrollback 序列化进 instances.json,重启后 webapp 能看到上次的内容。

## 第二档 — 计划中(移动端体验加分)

6. **SmartKeys 长按出菜单**(参考 Blink)
   屏幕键盘扩展行:长按 Tab → Shift+Tab;长按 Esc → `^[`;长按 Ctrl → 黏滞到
   下个键。当前 Toolbar 快捷键面板已成型 + LongPressIndicator 组件已有(用于
   focus InputBar),缺"长按弹菜单" + "修饰键黏滞"。
7. **拇指拖光标条**(参考 Termius 的"长按空格当 trackpad")
   终端区底部 8px 透明条,拖动 = 发方向键序列。手机精确移光标的最优解。
8. **OSC 8 hyperlinks + word-link / file-link**(参考 VS Code)
   xterm.js 原生 LinkProvider,加几行就能让 `src/foo.ts:42` 变可点击。
9. **多 chord 快捷键 / 修饰键黏滞**(参考 Tabby、Blink)
   手机虚拟修饰键 + `Cmd-K Cmd-S` 这类两步组合,比堆按钮更节省屏幕。
10. **Quick Fixes**(参考 VS Code)
    扫描输出推荐修复,例如 `fatal: ... --set-upstream` 一键应用。投入大但很出彩。

## 第三档 — 计划中(写权限 / 安全 / 协作)

11. **Writable / Read-only 分离**(参考 ttyd `-W`、gotty `-w`)
    多设备同时连入同一实例时可设其他人只读。投入很小(WS 握手时区分)。
12. **Broadcast Input 多终端同步输入**(参考 Termius)
    多个 webapp 同连一个实例时,把同一输入广播给所有 PTY。当前多实例架构很
    容易加。
13. **TLS 自签证书**(参考 ttyd `-S`、gotty `-t`)
    LAN 内 HTTPS。**当前主要驱动**:iOS PWA Web Push 在 LAN HTTP 下不可用,
    需要 HTTPS。Tailscale 用户已经有了(走 ts.net 证书),其他用户需要自签 +
    本地 CA 安装流程。
14. **OAuth / 客户端证书鉴权**(参考 ttyd 客户端证书)
    在现有 token 之上加客户端证书做硬鉴权。优先级低 —— token 已经够用。

## 第四档 — 不会做(明确放弃)

- ❌ **插件系统**(Tabby):LAN-only 单 binary 没必要
- ❌ **云端 Settings Sync**(VS Code):跟 LAN-only 红线冲突
- ❌ **Sixel / iTerm 图像协议**:移动端价值低,xterm.js 不原生
- ❌ **asciinema 公网分享**:跟 LAN-only 冲突;要做就只做本地 `.cast` 导出
- ❌ **SFTP / SCP 文件管理**(Termius / Wetty):偏离"远程 PTY 控制"定位
  > 注:0.8.0 新增的"文件浏览器(只读 + 预览 + 搜索)"**不**算违反此禁区——
  > 它仅限当前活跃实例 cwd + workdir-policy 白名单范围,无写 / 上传 / 下载,
  > 用途是手机查代码 / 看日志,与完整文件管理产品的定位不同。详见
  > `docs/plans/file-browser/`。
- ❌ **端到端加密 Vault**:家庭 LAN 不需要
