# File Browser 设计稿

> **状态**：设计稿 v1
> **日期**：2026-05-20
> **目标版本**：0.8.0(纳入下一个 minor;无 breaking change)
> **作者**:Drowsy + 咕咕

---

## 0. 一句话陈述

**为已经活跃中的实例增加只读的目录浏览 + 文件预览面板(文本/图片),配语法高亮与文件搜索,统一挂在 broker `/api/files` 之下,复用现有 workdir-policy 做安全边界。**

---

## 1. 为什么要做

- 用户在手机/平板上接管 PC 终端时,常常需要"对着代码或日志找一行"——目前必须切回 PC 才能做。
- 已有 web push、PWA、broker 反代等基础设施齐备,扩一个只读 explorer 是低风险增量。
- ROADMAP 把 "SFTP/SCP 文件管理"列为不做(完整产品级文件管理偏离定位)。本功能定位**实例上下文内的只读 explorer + 预览**,边界明确,不冲突。

### 1.1 明确不做

| 维度 | 决策 |
|---|---|
| 写操作(新增/删除/重命名/编辑) | ❌ 不做 |
| 上传 | ❌ 不做 |
| 下载到本地磁盘(`Content-Disposition: attachment`) | ❌ 不做 |
| 视频 / 音频预览 | ❌ 不做 |
| zip / tar 内部浏览 | ❌ 不做 |
| git 集成(blame / diff) | ❌ 不做 |
| 多选 / 批量操作 | ❌ 不做 |
| `.gitignore` 解析 | ❌ MVP 不做(用硬编码忽略列表) |

> **关于"下载"与 `/raw`**:`/api/files/raw` 是**预览渲染用**(让浏览器 `<img>` 直接消费),不带 `Content-Disposition: attachment`,不算"下载"。"不做下载"指不提供"保存到本地磁盘"按钮 / API。后续若加图片右键"另存为"(浏览器原生能力),不算违反此边界——只是没有 dedicated 端点。

---

## 2. 名词

- **实例 cwd**:`InstanceInfo.cwd`,worker 进程启动时的工作目录绝对路径。每个实例独立。
- **path-root**:本次浏览的视图根。默认 = 实例 cwd,但允许通过"上级"按钮越界到祖先目录,只要不命中 workdir-policy 黑名单。
- **workdir-policy**:`backend/src/utils/workdir-policy.ts` 的 `checkWorkdir(cwd, allow, deny)`,本项目里 spawn 实例时已经在用的"路径白/黑名单"判定函数。

---

## 3. 架构与归属

### 3.1 路由归属:broker,不放 worker

| 维度 | broker | worker |
|---|---|---|
| 端口暴露 | LAN | loopback(127.0.0.1) |
| 鉴权基础设施 | ✅ AuthModule | ❌(WS-only) |
| workdir-policy 快照 | ✅(`/api/workdir-policy` 已挂) | ❌ |
| 文件系统访问能力 | ✅(broker 与 worker 同机) | ✅ |

文件系统是宿主机的事,跟"实例进程"无强绑定。broker 既有鉴权又有 policy 快照,worker 只持有"实例级"路由(`/api/health` / `/api/hook` / `/ws`),不破坏 0.7.0 v2 拆分原则(见 path-routing ADR-011)。

### 3.2 与现有模块的关系

```
浏览器 (PWA)
   │  (相对路径 /api/files/...,落在 broker)
   ▼
broker:3737
   ├── /api/auth          (已有)
   ├── /api/config        (已有)
   ├── /api/instances     (已有)
   ├── /api/workdir-policy(已有,复用 checkWorkdir)
   ├── /api/files/list    (新)
   ├── /api/files/read    (新)
   ├── /api/files/raw     (新)
   ├── /api/files/stat    (新)
   ├── /api/files/search  (新,SSE)
   └── /i/<id>/*          → worker(反代,不变)
```

新模块挂 `backend/src/api/file-routes.ts`(与 share-routes / workdir-policy-routes 同层),底层逻辑落 `backend/src/files/`(新建)。

### 3.3 单元分层

```
backend/src/files/
├── path-resolver.ts        # resolve + realpath + 安全闸门
├── path-resolver.test.ts
├── mime-detect.ts          # 扩展名 → mime + previewable kind
├── mime-detect.test.ts
├── list-dir.ts             # readdir + stat 包装
├── read-file.ts            # 读文本(带大小上限 + 截断)
├── search-engine.ts        # 文件名 + 内容搜索 + 取消信号 + 限速
└── search-engine.test.ts
```

每个文件单一职责,可独立测试。`path-resolver` 是"安全核",所有路由都先过它。

---

## 4. 协议

### 4.1 类型定义(放 shared)

```ts
// shared/src/files.ts(新建)

export type FilePreviewKind = 'text' | 'image' | 'none';

export interface FileEntry {
  /** 仅文件名(basename),不含路径 */
  name: string;
  kind: 'file' | 'dir' | 'symlink' | 'other';
  /** 字节数;dir 固定 0 */
  size: number;
  mtimeMs: number;
  /** name 以 . 开头 */
  hidden: boolean;
  /** 仅 file 有 */
  mime?: string;
  previewable?: FilePreviewKind;
}

export interface FileListResponse {
  ok: true;
  /** 实例 cwd 绝对路径(永远不变,UI 用作"回 cwd"按钮的目标) */
  cwd: string;
  /** 当前展示的绝对路径 */
  path: string;
  /** 上级目录绝对路径;为 null 表示越界已到 workdir-policy 边界 */
  parent: string | null;
  entries: FileEntry[];
}

export interface FileReadResponse {
  ok: true;
  path: string;
  mime: string;
  /** UTF-8 文本;二进制路径走 /raw,不会走 /read */
  content: string;
  /** content 是否已被截断到 2 MiB 边界 */
  truncated: boolean;
  /** 字节数(原始,非 content.length) */
  size: number;
  /** 后端推断的 lang(供前端 Shiki 用,unknown → 'txt') */
  lang: string;
}

export interface FileStatResponse {
  ok: true;
  path: string;
  kind: 'file' | 'dir' | 'symlink' | 'other';
  size: number;
  mtimeMs: number;
  mime?: string;
  previewable?: FilePreviewKind;
}

// 搜索 SSE
export interface SearchNameMatch {
  kind: 'name';
  path: string;          // 绝对路径
  size: number;
  mtimeMs: number;
}
export interface SearchContentMatch {
  kind: 'content';
  path: string;
  line: number;          // 1-based
  preview: string;       // 单行裁到 200 字符
  matchStart: number;    // preview 内的高亮区间
  matchEnd: number;
}
export interface SearchDone {
  truncated: boolean;
  scanned: number;
  elapsedMs: number;
}
```

### 4.2 端点

| 方法 | 路径 | 鉴权 | 用途 |
|---|---|---|---|
| GET | `/api/files/list?instanceId=&path=` | ✅ | 列目录一层 → `FileListResponse` |
| GET | `/api/files/stat?instanceId=&path=` | ✅ | 单文件元信息 → `FileStatResponse` |
| GET | `/api/files/read?instanceId=&path=` | ✅ | 读文本 → `FileReadResponse` |
| GET | `/api/files/raw?instanceId=&path=` | ✅(cookie) | 二进制原文(图片);响应 `Content-Type` + `Cache-Control: private, max-age=0` |
| GET | `/api/files/search?instanceId=&q=&mode=&scope=&caseSensitive=&regex=` | ✅ | SSE 流式;事件:`match`(name/content 互斥联合体)、`done`、`error` |

参数约束:
- `path`:**接受相对或绝对**;省略 = 落在实例 cwd。后端统一 `path.resolve(cwd, path || '.')` + `realpathSync`,**前端不需要自行 normalize**。"上级"按钮在当前路径就是 cwd 时,仍指向 cwd 的物理父目录,但该父目录必须过 workdir-policy 闸门(命中 deny 或 allow 未中 → parent 字段为 `null`,前端禁用按钮)。
- `instanceId`:必填(即使 FS 全局共享,接口按"哪个实例发起的"鉴权 + 派 base = 该实例的 cwd)。
  - 省略 / 空 → 400 `BAD_REQUEST`(参数错误);
  - 给了但 instances.json 不存在该 id → 404 `INSTANCE_NOT_FOUND`(实例已死或拼错)。
  - 两个状态码语义严格区分,前端 toast 文案不同。
- `q`:1-200 字符,UTF-8。
- `mode`:`name`(默认) / `content` / `both`。
- `scope`:**目录绝对路径**(不允许文件路径——给文件返回 400),默认 cwd;同样过 path-resolver 闸门。
- `caseSensitive`、`regex`:`'0'|'1'`,默认 `0`。

### 4.3 错误码增量

新增 `ErrorCode`:

```ts
BAD_REQUEST       = 'BAD_REQUEST',       // 参数缺失 / 格式错误(400 通用)
PATH_NOT_FOUND    = 'PATH_NOT_FOUND',    // resolve 后 lstat ENOENT
PATH_FORBIDDEN    = 'PATH_FORBIDDEN',    // 命中 deny / allow 未中
FILE_TOO_LARGE    = 'FILE_TOO_LARGE',
FILE_BINARY       = 'FILE_BINARY',       // 试图 /read 二进制
FILE_TYPE_FORBID  = 'FILE_TYPE_FORBID',  // socket/fifo/device
SEARCH_INVALID_Q  = 'SEARCH_INVALID_Q',  // regex 编译失败 / 含 \n / 超长
SEARCH_TIMEOUT    = 'SEARCH_TIMEOUT',    // SSE done 携带 truncated=true 时用作 reason
```

`BAD_REQUEST` 是通用 400,本设计同时用于"参数格式错"(如 scope 指向文件、q 为空、mode 非枚举值)。`INSTANCE_NOT_FOUND` 沿用现有 code(已在 `shared/src/errors.ts`,语义"id 存在但实例不在"→ 404)。

新增 `AppError` 子类 `FileError`,与 InstanceError/AuthError 同模式。

`raw` 端点错误特殊处理:**不返 JSON**(浏览器 `<img>` 不认),返 4xx 空 body + `X-ATR-Error: <code>` header,前端 `<img onError>` 显示占位。

---

## 5. 安全模型(最关键)

### 5.1 路径解析三段闸

每次外部 path 输入都过 `resolveSafePath(cwd, input, policy)`(路由层先按 `instanceId` 查 cwd + policy 快照,再传入):

1. **resolve**:`path.resolve(cwd, input || '.')`(input 可相对可绝对,统一变绝对)。
2. **realpath**:`fs.realpathSync(resolved)` 解 symlink → `real`。
   - 失败(ENOENT)→ 抛 `PATH_NOT_FOUND`(404)。
3. **policy 复审**:`checkWorkdir(real, allow, deny)`。
   - 命中 deny → 抛 `PATH_FORBIDDEN`(403)。
   - allow 非空且未命中 → 抛 `PATH_FORBIDDEN`(403)。
   - allow 为空 → 放行(与现有 spawn 一致)。

### 5.2 文件类型闸

`fs.lstat` 检查:
- `isFile() || isDirectory()` → 通过。
- `isSymbolicLink()` → 在 realpath 后再次过闸(等于把 symlink 解到底再 lstat)。
- `isSocket() || isFIFO() || isBlockDevice() || isCharacterDevice()` → 抛 `FILE_TYPE_FORBID`。

### 5.3 大小闸

- `/read`:>2 MiB → 截断到 2 MiB 边界,`truncated: true`。**不直接拒**(用户大概率就是想看大日志开头)。
- `/raw`:>8 MiB → 拒 `FILE_TOO_LARGE`(图片渲染防爆内存)。
- 搜索:单文件 >2 MiB 跳过(`scanned` 不计入)。

### 5.4 字符集闸(顺序严格)

两步,顺序不可换:

1. **字节级闸**(解码前):
   - `fs.open` + 读前 4 KiB → `Buffer`;
   - 命中任意 `0x00`(NUL)→ 抛 `FILE_BINARY`(409)。前端引导走 `/raw` 或显示占位。
2. **字符级闸**(解码后):
   - `fs.readFile(path, { encoding: 'utf-8' })` 全文读;
   - 统计 `�` 替换字符密度,>5% → 同样抛 `FILE_BINARY`(409)。

这是因为字节级闸只能挡掉"明确含 NUL 的二进制",对非法 UTF-8(如某些 GBK 编码文本)无效;字符级闸做最终兜底。

### 5.5 ReDoS / 卡死防护(搜索专用)

- `regex=1` 时 `new RegExp(q, ...)` try/catch,失败 → 400 `SEARCH_INVALID_Q`。
- 内容搜索按行处理(`readline.createInterface`),**不允许跨行**——`q` 里含 `\n` 时拒 400。
- 单文件总扫描预算 **100 ms 硬超时**;超时则该文件中断,继续下一个。
- 全请求总预算 **5000 ms**;到点 emit `done { truncated: true }` 并关流。
- 单请求并发文件数 ≤ **8**(平衡 IO 利用与单请求资源占用;经验值,可调)。

### 5.6 审计

`logger.info({ instanceId, action, path, verdict, sizeMs })`,落 broker 日志按天 rotate(沿用现有 `~/.auvezy/terminal-remote/broker-YYYY-MM-DD.log`)。

### 5.7 速率限制

复用现有 `auth` 模块的速率限制思路:对 `/api/files/*` 整体加 **每会话每分钟 120 次**(list 切目录密集场景需要),搜索独立 **每会话每分钟 20 次**。`429 Too Many Requests`。

---

## 6. mime / 语言推断

### 6.1 后端

`backend/src/files/mime-detect.ts`:

```ts
const TEXT_EXT = new Set([
  '.md','.markdown','.txt','.log','.json','.jsonc','.yml','.yaml','.toml',
  '.ini','.conf','.cfg','.env','.example','.gitignore','.dockerignore',
  '.ts','.tsx','.js','.jsx','.mjs','.cjs','.py','.go','.rs','.rb','.php',
  '.java','.kt','.swift','.c','.h','.cc','.cpp','.hpp','.cs','.sh','.bash',
  '.zsh','.fish','.ps1','.html','.htm','.css','.scss','.sass','.less',
  '.xml','.svg','.sql','.csv','.tsv','.lock','.makefile',
]);
const IMAGE_EXT = new Set([
  '.png','.jpg','.jpeg','.gif','.webp','.svg','.bmp','.ico','.avif',
]);

// 返回 { mime, kind: 'text'|'image'|'none', lang: string }
```

`.svg` 同时在两个集合——优先按 image 渲染(`<img>`),但 raw 端点保留 text/xml mime;`/read` 也接受(用户能看到源码)。

### 6.2 前端 lang 映射(Shiki)

`frontend/src/utils/lang-map.ts`:把后端返回的 `lang`(短名)映射到 Shiki bundleId。未知 → `txt`(无高亮)。

---

## 7. 前端

### 7.1 入口

Console 顶部新增 `IconFolder` 按钮:
- 桌面:挨着 `IconSearch / IconSettings / IconShare2`(`ConsolePage.tsx` 顶栏)。
- 移动:进 toolbar(单行横向滚动条);保留触控目标 ≥ 44px。

### 7.2 面板:`FileBrowserSheet`

复用 `Sheet` primitive,布局:

- **桌面**:两栏 grid `300px 1fr`,左侧 list + 面包屑,右侧预览。
- **移动**:单栏栈,预览作为二级 sheet 推上来,后退手势 / ESC 回列表。

组件树:
```
FileBrowserSheet
├── Breadcrumb            (面包屑;首项 = cwd basename)
├── Toolbar               (回 cwd、上级、隐藏文件 toggle、刷新)
├── SearchBox             (输入 + 模式 toggle + 取消 X)
├── FileList / SearchResults  (依输入框是否非空切换)
│   └── FileRow * N
└── PreviewPane           (右侧或二级 sheet)
    ├── TextPreview       (用 Shiki 渲染 HTML)
    ├── ImagePreview      (<img> + 点开 lightbox)
    └── UnsupportedNotice
```

### 7.3 状态管理

新 hook `useFiles(instanceId)`:
- `list(path)`:返回 promise + 内部缓存 `Map<path, FileListResponse>`,**stale-while-revalidate**。
- `read(path)` / `stat(path)`:无缓存,直接 fetch。
- `search(q, opts)`:返 `AsyncGenerator<SearchEvent>`;底层 `EventSource`;`opts.signal` 触发 `EventSource.close()`。
- 切实例时整个 hook 重置(`useMemo` by instanceId)。

不引入新状态库——zustand 现有 `app-store` 不参与,这部分是局部状态。

### 7.4 语法高亮:Shiki

`frontend/src/utils/syntax-highlight.ts`:

```ts
import type { Highlighter, BundledLanguage, BundledTheme } from 'shiki';

let _highlighterPromise: Promise<Highlighter> | null = null;
const _loadedLangs = new Set<BundledLanguage>();

export async function highlight(
  code: string,
  lang: string,
  theme: 'github-dark' | 'github-light',
): Promise<string> {
  if (code.length > 200 * 1024) return escapeHtml(code);  // 超大降级
  const lng = normalizeLang(lang);  // 未识别 → 'txt'
  try {
    const h = await ensureHighlighter([theme]);
    if (!_loadedLangs.has(lng) && lng !== 'txt') {
      await h.loadLanguage(lng);
      _loadedLangs.add(lng);
    }
    return h.codeToHtml(code, { lang: lng, theme });
  } catch {
    return escapeHtml(code);   // 加载失败/未知 → 纯文本
  }
}
```

- 主 bundle 几乎零成本(shiki 1.x 把 onig WASM 与 grammar 都拆为 chunk,只在 import 时加载)。
- 主题跟随项目 dark/light(沿用现有 `themes/` 体系)。
- **超大文本**(>200 KB)直接 `<pre>` + `escapeHtml`,UI 角标提示"已禁用高亮"。
- **lang 失败/未知** → escapeHtml,不报错。

新依赖:`shiki ^1.x`(prod dep)。

### 7.5 搜索 UI

输入框上方提示:
- `> 3` 字符自动触发(防止 1 字符 q 把 IO 打满);
- 实时显示扫描计数(`已扫 234 文件 · 12 个命中…`);
- `Esc` 或点 X 取消(`EventSource.close()`);
- 命中行点击 → 关搜索结果 → 打开预览 + `scrollIntoView` 到对应行(Shiki 输出包了 `data-line` 属性)。

移动端:输入框 sticky top;键盘弹出时面板自动适配(沿用 `safe-bottom`)。

### 7.6 i18n

新键空间 `files.*` 同时加 zh-CN / en-US。覆盖标题、按钮、错误 toast、占位文案。

---

## 8. 错误处理

### 8.1 后端

- 所有路由层 catch → 转 `FileError`,统一 `res.status(e.httpStatus).json({ error: e.toPayload() })`。
- `/raw` 错误特殊:不返 JSON,4xx + `X-ATR-Error: <code>` header。

### 8.2 前端

- list / read / stat 失败 → toast `<译文>`(按 ErrorCode 映射);
- raw 失败 → `<img onError>` 切占位,UI 显示"无法预览"+ size/mtime;
- 搜索 SSE `error` event → toast,流自动关。

---

## 9. 性能预算

| 操作 | 目标 P95 | 上限 |
|---|---|---|
| list 1000 项 | <80 ms | 5000 项截断 |
| read 100 KB | <30 ms | 2 MiB |
| raw 1 MiB 图 | <50 ms | 8 MiB |
| 搜索 cwd 5k 文件 | <5 s | 5 s 硬超时(到点 emit done.truncated=true) |
| 高亮 50 KB 代码 | <100 ms(首次 lang +200 ms) | 200 KB 降级 |

---

## 10. 测试策略

### 10.1 后端

- `path-resolver.test.ts`:相对/绝对/`..` 越界/symlink 越界/不存在/deny 命中/allow 未中。
- `mime-detect.test.ts`:扩展名映射、未知扩展、双扩展(`.tar.gz`)。
- `list-dir.test.ts`:1k 项性能、隐藏文件过滤、socket/fifo 过滤、stat 失败容错。
- `read-file.test.ts`:文本读、>2 MiB 截断、NUL 字节拒、UTF-8 替换字符密度判定。
- `search-engine.test.ts`:文件名命中、内容命中、忽略目录、二进制跳过、超时短路、ReDoS 短路、取消信号、SSE 事件顺序。
- `file-routes.test.ts`:端到端 supertest(已有同类测试模式),覆盖鉴权、参数缺失、200 / 4xx 行为。

测试用 `os.tmpdir()` + `fs.mkdtemp` 创建真实 fixture,**不 mock fs**(沿用 CLAUDE.md "测试要真打")。

### 10.2 前端

- `syntax-highlight.test.ts`:lang normalize、>200 KB 降级、动态加载失败回退。
- `useFiles.test.ts`:缓存命中、切实例重置、搜索取消。
- `FileBrowserSheet.test.tsx`:RTL — 列目录、点文件预览、点搜索结果跳预览。

### 10.3 Smoke

`pnpm dev` + 浏览器手动用例(沿用 CLAUDE.md broker 重启流程):

1. 启 broker + vite。
2. 浏览器开 `http://localhost:5173/`,登录,创建实例(cwd = repo 根)。
3. 点顶部 `IconFolder`:列出 repo 根。
4. 点 `README.md`:预览 Markdown,语法高亮生效。
5. 切深目录 → 上级 → 回 cwd 按钮。
6. 搜索 `checkWorkdir`:看到 `name` 命中(文件) + `content` 命中(行号)。
7. 搜索 `..`(越界尝试):无文件被读出 cwd 之上(除非 workdir-policy 允许)。
8. 试图 `/api/files/read?path=/etc/passwd`:403 `PATH_FORBIDDEN`(默认 deny 含 `/etc/**`)。
9. **测试后**:kill broker PID,`ss -tln | grep 3737` 应无输出。

---

## 11. 阶段拆分

| 阶段 | 内容 | 工作量 |
|---|---|---|
| 1 | shared 类型 + ErrorCode + FileError 子类 | 0.3d |
| 2 | path-resolver + mime-detect + list-dir + 单测 | 0.8d |
| 3 | read-file + /api/files/list /read /stat /raw + 路由测试 | 0.8d |
| 4 | search-engine + /api/files/search SSE + 测试 | 1.0d |
| 5 | 前端 FileBrowserSheet(无高亮)+ useFiles + i18n | 1.0d |
| 6 | Shiki 集成 + 主题跟随 + lang 映射 + 降级 | 0.5d |
| 7 | 搜索 UI + 命中跳预览 + 取消 | 0.7d |
| 8 | smoke + 性能调优 + 文档(progress + ADR) | 0.5d |
| **总计** | | **~5.6d** |

---

## 12. ADR 索引

- [ADR-001](./adrs/001-broker-not-worker.md):文件 API 挂 broker,不挂 worker
- [ADR-002](./adrs/002-readonly-only.md):MVP 严格只读
- [ADR-003](./adrs/003-workdir-policy-reuse.md):复用 checkWorkdir 而非新增白名单
- [ADR-004](./adrs/004-syntax-highlight-shiki.md):选 Shiki 而非 Prism / highlight.js
- [ADR-005](./adrs/005-search-pure-node-sse.md):搜索用纯 Node + SSE,不依赖 ripgrep
