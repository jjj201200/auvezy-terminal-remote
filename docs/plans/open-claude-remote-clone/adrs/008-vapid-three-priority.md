# ADR-008: VAPID 密钥三级优先级

## 状态

已接受（阶段 9 实施）

## 背景

Web Push 协议要求订阅时浏览器把 **VAPID 公钥** 作为 `applicationServerKey`
传给 `pushManager.subscribe()`，服务端推送时再用 **VAPID 私钥** 对请求
做 ECDSA 签名。这意味着同一台服务器在订阅期内 **VAPID 公私钥对必须保持
稳定**——否则浏览器一侧的旧订阅会被 push 服务（FCM、Mozilla 等）拒签。

我们要解决的问题是：

1. **首次启动**：用户没有任何 VAPID，要能"开箱即用"自动生成
2. **多次启动**：同一 HOME 下重启不能重新生成密钥（旧订阅会全废）
3. **多机部署**：用户希望几台机器共享同一对密钥时，能从环境变量注入
4. **不要把私钥写进 git 或 logs**

## 决策

实现一条 **三级优先链**（高优先 → 兜底）决定使用哪对 VAPID：

```
1. 环境变量
   VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY 都存在 → 直接用
   （不写文件，认为外部已是真理来源）

2. 已存在的密钥文件
   ~/.claude-remote/vapid.json 存在 → 读取并用
   文件权限要求 0o600；不满足时 logger.warn 但仍读

3. 自动生成
   web-push.generateVAPIDKeys() → 立即落盘到 vapid.json（0o600）
   下次启动走 (2)
```

`PushService.init()` 在 backend 启动 1.9 步异步执行，结果通过
`getPublicKey()` 暴露给 `/api/push/vapid` 端点。

订阅本身则持久化在独立文件 `~/.claude-remote/push-subscriptions.json`，
内容是 `[{ endpoint, keys: { p256dh, auth }, addedAt }]` 列表。

## 理由

1. **环境变量优先**：DevOps / Docker / k8s 注入是最自然的密钥分发方式，
   高于一切本地状态——尊重外部真理来源
2. **文件持久化**：本地开发模式不需要每次配 env，第一次启动后自然就稳定
3. **自动生成兜底**：让"开箱即用"成立——新用户不需要懂 web-push 协议，
   也不需要去翻 `web-push generate-vapid-keys` 命令
4. **三级而不是两级（少了 env-only）**：纯 env 模式无法解决"多次启动"
   场景；纯文件模式无法解决"多机共享"场景；纯生成模式不持久化。
   三级是最小自洽集
5. **0o600 文件权限**：私钥即凭据，权限必须收紧；与 token / config.json
   保持一致

## 后果

- ✅ **正面**
  - 用户首次启动无须手动 generate VAPID，订阅功能直接可用
  - 重启不会让旧订阅作废（文件持久化）
  - 多机部署能通过 env 共享同一对密钥（不需要文件同步）
  - 环境变量优先级最高 → 与 12-Factor 习惯对齐
- ⚠ **负面**
  - 三级链增加测试维度（`push-service.test.ts` 必须分别覆盖 env / file /
    generate 三条路径，目前 10 个单测已覆盖）
  - 用户若手动改 env 又留着旧文件，env 优先 → 文件失效但仍存在，
    会让"密钥从哪来"的诊断稍复杂；当前用 logger.info 输出 source 缓解
  - 私钥文件落地是攻击面（虽 0o600）；用户能改 HOME 减少风险
- 🔵 **中性**
  - 不支持密钥轮换（rotate）：换密钥意味着所有旧订阅失效，
    web-push 协议本身没有 graceful migration 路径，由用户手动管理

## 备选方案

- **总是从 env 读**：违反"开箱即用"，新用户卡在生成命令上
- **总是自动生成不持久化**：每次启动旧订阅全废，违反 web-push 设计
- **把 VAPID 写进 config.json**：耦合配置层与密钥层；config 经常被改 /
  diff / share，密钥不应在那里
- **集中托管在远端 KMS**：增加部署依赖；与 LAN-first 自托管理念不合
