# 阶段 5 进度：文件锁 + 共享 Token + 二维码

## 目标

- 多个 claude-remote 实例并发启动时不会各自生成不同 token
- LAN IP 自动检测，banner 打印可扫码的完整 URL（含 token）
- 启动 banner 用 QR code 让手机扫码秒进

## 验收标准

- [x] mkdir-as-lock 在并发竞态下确保唯一持有人
- [x] 锁僵尸（持有者崩溃留下的目录）超过 STALE 阈值后自动清理
- [x] shared token 文件不存在 → 生成 + 写盘 + 返回；存在 → 直接读
- [x] 同时起 N 个实例，token 唯一（共享）
- [x] detectDisplayIp 在多网卡时优先选 RFC1918 私有段
- [x] banner 显示扫码 URL（http://<displayIp>:<port>?token=<token>）+ ASCII QR
- [x] CORS 白名单含 displayIp（让 LAN 上其它设备能访问 /api 与 WS）

## 步骤清单

- [x] **5.1** backend/utils/file-lock.ts（mkdir + 僵尸清理 + 重试）+ 7 单测
- [x] **5.2** backend/utils/network.ts（isPrivateIp / detectDisplayIp / buildPublicUrl）+ 14 单测
- [x] **5.3** backend/registry/shared-token.ts（withFileLock + double-check）+ 6 单测
- [x] **5.4** backend/utils/qrcode-banner.ts（renderQrCode）+ 3 单测
- [x] **5.5** index.ts：接 detectDisplayIp / shared-token / 扫码 URL + QR banner
- [x] **5.6** CORS 白名单加 displayIp + 端到端 smoke
- [x] **5.7** 阶段收尾 + ADR 002

## 实施日志

### 5.1 file-lock
- mkdir-as-lock，不依赖 flock（跨平台行为不一致）
- 僵尸清理：mtime > staleMs 且 pid.txt 中 pid 已不存活 → 强制清理
- LockError(LOCK_TIMEOUT) 默认 httpStatus=503
- 7 单测：单次/重入/异常释放/超时/僵尸清理/5 路并发 race-free 累加/默认 status

### 5.2 network
- isPrivateIp：RFC1918（10/8、172.16/12、192.168/16）严格判定
- detectDisplayIp(hostHint?)：用户显式 host > 私有段 > link-local > 127.0.0.1
- buildPublicUrl：拼带 token 的扫码 URL
- 14 单测覆盖各 IP 段边界 + IPv6 + hostHint 各分支

### 5.3 shared-token
- withFileLock + double-check：拿锁后再读一次文件，确保没被先到者写入
- 与已有 config.json 字段合并保留（fontScale 等不会丢）
- JSON 损坏当作不存在重新生成
- 6 单测：generated / shared / 字段合并 / 损坏覆盖 / 5 路并发唯一 / 父目录自创建

### 5.4 qrcode-banner
- 包装 qrcode-terminal 的 callback API 为同步返回
- 失败/空 URL 返回 ''（不阻塞启动）
- 3 单测

### 5.5 index.ts 集成
- AppConfig.tokenSource 新增 'shared' 来源
- 启动序列 1.4：cli/env 都没指定 token 时 acquireSharedToken
- 启动序列 1.6：detectDisplayIp + buildPublicUrl
- banner 改写：监听 host + 扫码 URL + Token 来源；仅 generated 印完整 token；
  末尾追加 ASCII QR + 完整链接

### 5.6 CORS + smoke
- CORS 白名单加 displayIp
- backend/scripts/smoke-stage5.mjs：HOME 隔离 + 4 项验收：
  1) instance A 启动 → generated；banner 含 ASCII QR + 来源标记
  2) tokenA 写入 tmpHome/.claude-remote/config.json
  3) kill A 后起 instance B（同 HOME）→ shared
  4) /api/auth 用 tokenA 登录 B 成功（证明 token 真共享）

### 5.7 阶段收尾
- ADR 002 mkdir-as-lock 文件锁选型已写入 adrs/002-mkdir-as-lock.md
- 全量 typecheck 干净
- 全量单测 210 backend + 15 shared 通过
- stage-05 smoke 4/4 通过
- 端口 / 临时目录已清理

## 当前阻塞

无。

## 验证结果

- ✅ typecheck（shared/backend/frontend）干净
- ✅ 单测 210 backend + 15 shared 通过（本阶段新增 30 单测：file-lock 7 + network 14 + shared-token 6 + qrcode 3）
- ✅ stage-05 smoke 4/4 通过
- ✅ ADR 002 已记录决策
