# ADR-009: 错误体系（AppError + ErrorCode 枚举）

## 状态

已接受

## 背景

复刻项目的需求里明确要求"良好的错误类型定义和处理"。

观察到的问题：
- 分散的错误处理在多个模块里反复用裸 `Error` 与字符串字面量 code（如 `'pty_error'`）
- 没有统一的 ErrorCode 枚举，前端难以根据错误类别做差异化处理
- HTTP 响应体格式不一致（有的 `{ error: 'string' }`，有的 `{ error: { ... } }`）
- 日志聚合困难（按 message 文本分组容易因措辞变化而失配）

## 决策

引入两层错误抽象：

1. **shared/src/errors.ts** 定义 `ErrorCode` 枚举（28 个分 8 类）和 `ErrorPayload` 接口（HTTP 与 WS 共用）
2. **backend/src/errors.ts** 定义 `AppError` 基类 + 8 个领域子类（Auth / Pty / Ws / Config / Instance / Lock / Hook / Push）

业务模块抛 `AppError` 子类，路由层 catch 后用 `err.toPayload()` 输出统一 JSON 格式。

## 理由

1. **前端可识别**：枚举值跨进程传递，前端能 `switch (err.code)` 做差异化处理（如 `AUTH_SESSION_EXPIRED` 自动跳认证页）
2. **httpStatus 与领域绑定**：子类自动决定状态码（AuthError → 401，LockError → 503），减少调用方决策负担
3. **cause 链保留**：包装第三方错误时不丢失原始 stack，调试友好
4. **日志聚合**：按 `code` 字段聚合，统计稳定（不受措辞变化影响）
5. **类型化 catch**：TypeScript 能根据 `err instanceof AuthError` 缩窄类型

## 后果

- **正面**：错误处理统一、前端可决策、日志可聚合、类型安全
- **负面**：每次新增错误场景需要更新 ErrorCode 枚举（前后端同步 build）
- **中性**：业务代码必须主动选择合适子类，需要团队约定（在 CLAUDE.md 中记录）

## 备选方案

- **沿用上游裸 Error 风格**：放弃，与"清晰错误处理"要求冲突
- **用第三方库（如 @hapi/boom）**：放弃，引入额外依赖且其 API 偏 HTTP 不适合 WS 双通道
