---
name: publish-atr
description: 发布 auvezy-terminal-remote 一个 patch/minor/major 版本到 npm,流程含 CHANGELOG / 版本号 / commit / tag / build / smoke / push(github+gitee)/ npm publish。当用户说"发布""发版""publish""发 0.7.x"等触发。
---

# 发布 auvezy-terminal-remote

本仓库的发布流程,固化为单一脚本式 skill。本仓库 origin 同时配了 GitHub +
Gitee 双 remote(`git remote -v` 两条 push URL),`git push origin <ref>` 一次
推两边,**不需要**单独再 push 第二个。

## 前置条件

- 工作树干净或仅含本次发布相关的改动(没有半成品)
- `pnpm exec vitest run` 全绿(在动手发版前必须自己确认一次)
- 知道目标版本号(用户告诉你 / 看 CHANGELOG.md `[Unreleased]` 段决定 patch/minor/major)
- npm 登录态有效(`npm whoami` 能输出用户名)

## 不要做

- **不要** `npm publish` 不经过 OTP — 我们的 npm 账号开了 2FA。**必须等用户给 6 位 OTP**。
- **不要**绕过 git pre-commit hook(没有 `--no-verify`)
- **不要** force push,无论 main 还是 tag。已发布到 npm 的版本号永远不可重复;真要撤就 `npm deprecate` + 发新 patch。
- **不要**自己改 commit message 加 AI 署名(项目 CLAUDE.md 明确禁止)
- **不要**在 publish 前忘了 `pnpm build` —— `prepublishOnly` 当前是 echo 占位,没有自动 build,publish 跑的就是 `backend/dist/` 里的产物
- **不要**在 build 之前 commit `backend/README.md` —— 它是 build 步骤里 `cp README.md backend/README.md` 自动生成的,build 后再 stage 一次

## 流程(顺序严格)

### 1. 写 CHANGELOG

打开 `CHANGELOG.md`,在 `## [Unreleased]` 下新增 `## [<version>] - <today>` 段。
日期从 `~/.claude/...` 系统提示里 `currentDate` 字段读,**不要**自己猜。

分类按 Keep a Changelog 标准:
- `### Breaking changes` — 破坏性
- `### Added` — 新功能
- `### Changed` — 行为/接口调整(非破坏)
- `### Fixed` — bug 修
- `### Internal` — 仅内部(依赖、构建、测试),用户感知为零的可省

每条要写"用户视角的影响 + 关键文件/原因",而不是"我做了 xxx"。

### 2. bump backend version

```
# backend/package.json 里把 "version": "..." 改到目标版本号
```

shared / frontend 的 package.json 不改 — 都是 `private: true`,不发布。
**只**改 `backend/package.json`。

### 3. stage + commit

只 `git add` 本次发版相关的文件。**别用 `git add -A`**。
当前发版常涉及的文件(具体看 `git status`):
- CHANGELOG.md
- backend/package.json
- 本次代码改动
- README*.md(如果文案变了)

commit message 模板:

```
<type>(<scope>|<version>): 一句话主题

可选正文:解释为什么、关键决策、影响范围。
不要写 AI 署名。
```

`<type>` 用 `feat` / `fix` / `docs` / `refactor`(常用前两个)。
`<scope>` 用版本号 `0.7.2` 当 scope 比较直观,或者用模块名。

### 4. 打 tag

```
git tag -a v<version> -m "v<version> — 一句话主题"
```

annotated tag(`-a`),不要 lightweight。tag 名带 `v` 前缀,与历史一致(`git tag -l "v0.7*"` 可见)。

### 5. 推到远端(GitHub + Gitee 一次到位)

```
git push origin main
git push origin v<version>
```

origin 同时配了 GitHub + Gitee 两个 push URL,一条命令两边都到。
`git remote -v` 检查能看到两条 push 行。

### 6. build

```
pnpm build
```

完整 root build,跑:
1. shared / frontend / backend 各自 tsc
2. `copy-frontend-dist` 把 `frontend/dist` 拷到 `backend/frontend-dist`
3. `sync-readme` `cp README.md backend/README.md`
4. `bundle-backend` esbuild 把 backend 打成单文件 `backend/dist/cli.js`(~285KB)

输出最后一行应该是 `[bundle-backend] 输出:.../backend/dist/cli.js (NNNkb)`。

如果 build 后 `backend/README.md` 有 diff,**不再单独 commit**(已经在第 3 步那次 commit 里了 — 因为我们改 README 时同步改了 backend/README.md)。

### 7. smoke test

bundle 后产物冒烟。**必须用 `--port 13737` 这类空闲端口**——本机 3737 常年被
生产版 broker(`atr start --foreground`)占着,不带端口 start 的 broker 起不来,
status 会误报 not running。

**严禁** `atr -p <port> status` 这种写法——`-p` 是全局 flag,后面的 `status`
会被当成要运行的程序名,atr fallback 起交互实例(双 banner + zsh),留下端口
残留。status/stop 从 HOME 下的 `~/.atr/broker.json` 读端口,**不带任何端口参数**。

```
mkdir -p /tmp/atr-smoke/home && rm -rf /tmp/atr-smoke/home/.atr /tmp/atr-smoke/home/.atrrc
ATR=/mnt/d/github/open-terminal-remote/backend/dist/cli.js

# 1. version 必须是新版
HOME=/tmp/atr-smoke/home node $ATR --version
# 2. help 不报错
HOME=/tmp/atr-smoke/home node $ATR --help | head -5
# 3. 完整 lifecycle:start → status → stop(空闲端口;status/stop 不带端口参数)
HOME=/tmp/atr-smoke/home node $ATR start --port 13737
sleep 4
HOME=/tmp/atr-smoke/home node $ATR status | head -8
HOME=/tmp/atr-smoke/home node $ATR stop
sleep 2
ss -tln | grep ':13737' && echo '!! 端口未释放' || echo '✓ 13737 已释放'
rm -rf /tmp/atr-smoke /tmp/atr-smoke.log
```

status 应显示 `status: running` + 正确 version/端口;stop 后端口必须已释放。
任何一步报错 / version 显示不对 → **回头查**,别强发。

### 8. pack dry-run 检查包内容

```
cd backend && pnpm pack --dry-run 2>&1 | tail -25
```

确认 Tarball Contents 只含:
- `dist/cli.js` + `dist/postinstall.mjs`
- `frontend-dist/*`
- `LICENSE` / `package.json` / `README.md`

**不应该**出现 `auvezy-terminal-remote-shared` / `auvezy-terminal-remote-frontend`
依赖 — 它们是 workspace devDep,正确配置下 npm pack 不会含。

### 9. npm publish(等用户给 OTP)

不要先跑命令再问 OTP — npm publish 一次性消耗 OTP,提前问能避免重发。

```
# 用 AskUserQuestion 或直接询问用户当前 OTP(6 位)
# 拿到后:
cd backend && npm publish --otp <6位OTP>
```

成功输出末尾会有 `+ auvezy-terminal-remote@<version>` 一行。

### 10. publish 后验证

```
curl -s --noproxy '*' https://registry.npmjs.org/auvezy-terminal-remote | \
  python3 -c "import sys,json;d=json.load(sys.stdin);print('latest:',d['dist-tags']['latest'])"
```

应输出 `latest: <version>`。npm 注册表 CDN 有 ~30s 缓存,失败再等等重试。

## 出错时

| 失败点 | 处理 |
|---|---|
| 测试不过 | 不要发,先修 |
| build 失败 | 看 esbuild / tsc 报错;通常是新加的 import 没装 dep |
| pack 含 workspace 包 | 检查 backend/package.json `dependencies` 里是不是误把 `auvezy-terminal-remote-shared` 写成 dep 而不是 devDep |
| OTP 错 / 过期 | 让用户重新读认证器,再给一次。**不要**自己反复试 |
| publish 后发现 bug | 不要 unpublish(72h 后不可)。bump 一个 patch 紧急修;旧版本可以 `npm deprecate auvezy-terminal-remote@x.y.z "msg"` 标弃用 |
| push 被远端拒(non-fast-forward) | 先 `git pull --rebase`,**不要** force push |
