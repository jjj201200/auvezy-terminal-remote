# ADR-002: mkdir-as-lock 文件锁选型

## 状态

已接受（阶段 5 实施）

## 背景

claude-remote 单机多实例并发启动时存在竞争：

- 第一个实例需要把生成的 token 写到 `~/.claude-remote/config.json`
- 同时启动的第二个实例若不等待，可能各自生成不同 token
- 用户体验破坏：两个实例的二维码 token 不同，扫码登录命中率随机

需要一个跨实例的互斥机制，要求：

1. 跨平台（macOS / Linux / Windows）行为一致
2. 不引入额外原生依赖（编译困难、安装复杂度）
3. 持有进程崩溃后能被后续进程清理（无人为干预）
4. 单机本用户作用域足够（不要求 NFS / 分布式）

## 决策

用 `mkdir(lockDir, { recursive: false })` 的原子性当锁：

- 第一个调用者成功 → 持有锁
- 后续调用者 EEXIST → 锁已被占
- 锁目录里写 `pid.txt` 记录持有者 PID
- 释放 = `rm -rf lockDir`
- 僵尸清理：mtime 超过 `FILE_LOCK_STALE_MS`（10s）且 `pid.txt` 中的
  pid 已不在进程表（`process.kill(pid, 0)` 抛 ESRCH）→ 强制清理重试

## 理由

1. **跨平台原子性可靠**：POSIX `mkdir` 与 Win32 `CreateDirectory` 都是
   原子的；EEXIST 是标准化错误码
2. **零原生依赖**：仅用 `node:fs` 内置；不需要 `proper-lockfile` 等
   第三方库带来的安装复杂度
3. **行为可预期**：单文件系统、单用户作用域内不会出现"似乎拿到锁却
   被悄悄抢走"的隐式行为（不像 advisory `flock` 在某些 NFS 上失效）
4. **僵尸自愈**：通过 `kill(pid, 0)` 探活 + mtime 阈值，崩溃残留可被
   后续进程自动清理，无需用户介入
5. **失败模式简单**：拿不到锁 → 重试 N 次 → 抛 `LockError(LOCK_TIMEOUT)`，
   调用方按需降级（如 shared-token 退化成本进程随机 token）

## 后果

- ✅ **正面**
  - 多实例并发启动时 token 一致（5 路并发单测验证）
  - 无第三方依赖，install.sh 链路短
  - WSL / Docker 容器内行为与裸机一致
- ⚠ **负面**
  - 需要额外维护 `pid.txt` 与僵尸清理逻辑（已封装在 `file-lock.ts`）
  - 单纯 mtime 阈值在系统时钟跳变时可能误判为 stale；当前接受这个风险
- 🔵 **中性**
  - `kill(pid, 0)` 仅在同一用户能识别进程。跨用户 / 跨容器场景超出本工具范围
  - 默认 `staleMs = 10s` 是经验值；若发现持锁操作 > 10s 的场景需调整

## 备选方案

- **`proper-lockfile` 库**：底层也是 mkdir + lockfile + 僵尸探活，
  额外依赖 + 自带后台 renew 机制，对我们这种短临界区是 over-engineered
- **`flock(2)` advisory lock**：跨平台兼容性差（Win32 API 不同；NFS 不可靠），
  且与 Node fs API 不天然集成
- **数据库 / 外部锁服务**：单机用例引入网络/进程依赖完全不划算
