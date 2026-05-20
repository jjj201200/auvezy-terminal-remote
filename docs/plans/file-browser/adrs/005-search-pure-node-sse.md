# ADR-005: 搜索用纯 Node + SSE,不依赖 ripgrep

## 状态

已采纳(2026-05-20)

## 上下文

文件名搜索 + 内容搜索是核心功能。后端实现路径:
- **方案 A**:`fs.promises` + readline 自实现;
- **方案 B**:`spawn('rg', ...)` 调用 ripgrep;
- **方案 C**:`fast-glob` + 自实现 grep。

## 决策

**方案 A 纯 Node**(`fs.opendir` / `readline.createInterface`)+ HTTP **SSE 流式**返回,所有运行时零外部依赖。

## 拒绝的替代方案

### 方案 B:调 ripgrep

- 性能最佳,但**用户机器不一定装 rg**;
- 跨平台分发要打包 native binary(Windows / macOS / Linux × x64 / arm64 = 6 份),违反项目"zero-runtime-deps"路线;
- npm 全局安装会膨胀很多;
- 项目目标是"打开 web 一键能跑",不应假设 PATH 里有 rg。

### 方案 C:`fast-glob` + 自实现 grep

- `fast-glob` 增加一个新依赖,提升不大(我们的扫描深度限制 6 层,fast-glob 优势在巨型仓库,我们截到 5000 entries);
- 不如纯 Node 透明,排错难度高。

## 理由

1. **零外部依赖**:与 README "npm i -g 一键能跑"承诺一致;
2. **可控的性能边界**:单文件 100 ms / 全请求 5 s / 并发 4 → 任何卡死场景都能短路;
3. **SSE 流式**:用户第一条命中 100 ms 内可看到,移动端体验好;`EventSource.close()` 即可取消;
4. **与现有 SSE 实践对齐**:`/api/instances/stream` 已用 SSE。

## 后果

- ✅ 安装即用,无 native 依赖;
- ✅ 取消语义清晰(EventSource close → server 端 `req.on('close')` 终止扫描);
- ⚠️ 巨型仓库(>50k 文件)首条结果会慢一些,但项目定位是"工作目录"非"代码索引",可接受;
- ⚠️ ReDoS 防护要自己实现(单文件超时 + 拒跨行 regex),已在 design §5.5 写明;
- ⚠️ 未来需要"完整 grep" 体验时,可加 opt-in `ATR_USE_RIPGREP=1` env(spawn rg fallback),架构不需要重构。
