# 阶段 5 进度：文件锁 + 共享 Token + 二维码

## 目标

- 多个 claude-remote 实例并发启动时不会各自生成不同 token（用户体验破坏）
- LAN IP 自动检测，banner 打印可扫码的完整 URL（含 token）
- 启动 banner 用 QR code 让手机扫码秒进

## 验收标准

- mkdir-as-lock 在并发竞态下确保唯一持有人
- 锁僵尸（持有者崩溃留下的目录）超过 STALE 阈值后自动清理
- shared token 文件不存在 → 生成 + 写盘 + 返回；存在 → 直接读
- 同时起 N 个实例，token 唯一（共享）
- detectDisplayIp 在多网卡时优先选 RFC1918 私有段
- banner 显示扫码 URL（http://<displayIp>:<port>?token=<token>）+ ASCII QR
- CORS 白名单含 displayIp（让 LAN 上其它设备能访问 /api 与 WS）

## 步骤清单

- [ ] **5.1** backend/utils/file-lock.ts（mkdir + 僵尸清理 + 重试）+ 单测
- [ ] **5.2** backend/utils/network.ts（isPrivateIp / detectDisplayIp）+ 单测
- [ ] **5.3** backend/registry/shared-token.ts（withFileLock + double-check）+ 单测
- [ ] **5.4** backend/utils/qrcode-banner.ts + 简单单测
- [ ] **5.5** index.ts：接 detectDisplayIp / shared-token / 扫码 URL + QR banner
- [ ] **5.6** CORS 白名单加 displayIp + 端到端 smoke
- [ ] **5.7** 阶段收尾 + ADR 002

## 实施日志

### 5.1 file-lock
（待开始）

### 5.2 network
（待开始）

### 5.3 shared-token
（待开始）

### 5.4 qrcode-banner
（待开始）

### 5.5 index.ts 集成
（待开始）

### 5.6 CORS + smoke
（待开始）

### 5.7 阶段收尾
（待开始）

## 当前阻塞

无。

## 验证结果

（阶段完成后填写）
