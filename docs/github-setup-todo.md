# GitHub 设置与配套基础设施 — 待办清单

> 日期：2026-05-08 · 仓库：[jjj201200/auvezy-terminal-remote](https://github.com/jjj201200/auvezy-terminal-remote)
> 当前状态：v0.5.0 已发布到 npm + GitHub tag。这份清单覆盖**尚未完成**的开源项目配套设置，按"投入产出比"排序。

按"做与不做的差距 / 付出时间"分四档。每条标注：
- 🔧 **代码侧**（我能直接帮你写文件 / 配置）
- 🌐 **GitHub UI 侧**（必须你自己点击操作，我无法代劳）
- ⏱️ 预计耗时

---

## ✅ 已完成（仅供对照）

- LICENSE 文件（PolyForm-Noncommercial-1.0.0）
- README 顶部 4 个徽章（npm / license / node / stars）
- CHANGELOG.md（Keep a Changelog 格式，覆盖 0.4.x → 0.5.0）
- README 中英双语
- npm 发布
- Git tag `v0.5.0` 推到 GitHub + Gitee 镜像
- docs/ 子文档体系（FEATURES / ROADMAP / CLI / WSL）

---

## 🔥 必做（影响第一印象 / 总计 30-60 分钟）

### 1. 🌐 Social preview 图片（5 分钟）

**位置**：Settings → General → Social preview → "Upload an image..."
**操作**：上传 `frontend/public/screenshots/desktop.png`（472KB，1280×~676，符合 GitHub 推荐 1280×640）
**收益**：在 Twitter / 微信 / Slack / Discord 分享 repo 链接时，预览卡用大图替代默认灰底 logo。**视觉转化率差 3-5 倍**。

### 2. 🌐 About 区填写（5 分钟）

**位置**：repo 主页右上角 ⚙️ 齿轮按钮（About 区右上）
**填法**：

| 字段 | 值 |
|---|---|
| Description | `Remote-control any terminal program on your PC from a phone or tablet browser over LAN. One \`atr\` command, multi-instance, mobile-first PWA.` |
| Website | `https://www.npmjs.com/package/auvezy-terminal-remote` |
| Topics | `terminal` `remote-terminal` `pty` `xterm` `xtermjs` `websocket` `nodejs` `typescript` `react` `pwa` `claude-code` `lan` `tailscale` `wsl2` |
| Display | ☑ Releases · ☑ Packages |

### 3. 🌐 v0.5.0 Release notes（5 分钟）

**当前**：Tag v0.5.0 已推到 GitHub，但**没有 release notes**（默认显示 commit message）
**操作**：访问 https://github.com/jjj201200/auvezy-terminal-remote/releases/new?tag=v0.5.0 → 把 CHANGELOG.md 里 `## [0.5.0]` 那段全部粘贴 → "Publish release"
**或者**：在 `gh auth login` 之后，告诉我我用 `gh release create` 一键搞定

### 4. 🌐 默认分支保护（5 分钟）

**位置**：Settings → Branches → "Add branch protection rule" → Branch name pattern: `main`
**勾选**：
- ☑ Require a pull request before merging
- ☑ Require linear history（禁 merge commit，git log 干净）
- ☑ Include administrators（保护对自己生效，防手滑 force-push）
- ☐ Require status checks（等 CI 加上后再勾）

**收益**：防止意外 `git push --force` 损毁 main。

### 5. 🔧 GitHub Actions CI（30 分钟，我来写）

**当前**：代码审查报告里点过：「无 .github/workflows，测试只靠开发者自觉」
**我会帮你做**：写 `.github/workflows/ci.yml`，在 push / PR 上跑 `pnpm test` + `pnpm typecheck` + `pnpm build`，矩阵 Node 20 / 22 × ubuntu-latest，缓存 pnpm store
**之后**：
- README 顶部加 "build passing" 徽章
- 上面 #4 的 branch protection 启用 status check 要求

---

## ⭐ 强烈推荐（社区基础设施 / 总计 2-3 小时）

### 6. 🔧 CONTRIBUTING.md（30 分钟，我来写）

**当前缺失** —— 代码审查报告里指出过
**内容**：
- 本地开发起步（`bash install.sh` + `pnpm dev`）
- commit message 风格（看 git log 是 `type(scope): zh description` 风格 —— 写下来）
- PR 流程
- 提交规范（CLAUDE.md 里"严禁 AI 署名"摘到这里）
- 测试要求（typecheck + test 必须通过）

### 7. 🔧 SECURITY.md（20 分钟，我来写）

**LAN-only 项目也需要**——你的代码暴露 PTY，安全是核心卖点
**内容**：
- 报告流程（私邮 / GitHub Security advisories tab）
- 红线（CLAUDE.md 里 5 条摘录）
- 已知边界（仅 LAN、需 Node 20+、token 时长建议）
- supported versions 表（当前只 0.5.x 受支持）

### 8. 🔧 Issue templates（30 分钟，我来写）

**位置**：`.github/ISSUE_TEMPLATE/*.yml`
**模板**：
- **Bug report**（要求填：版本 `atr -v`、OS、浏览器、复现步骤、log 片段）
- **Feature request**（"是不是 ROADMAP 里的？"前置筛选）
- **Question** → 引导去 Discussions

**真正作用**：减少你回 issue 80% 的沟通成本。

### 9. 🔧 PR template（10 分钟，我来写）

**位置**：`.github/pull_request_template.md`
**模板字段**：Summary（≤3 句）/ Test plan / 关联 issue（`Closes #N`）/ Screenshots / Breaking changes 标记

### 10. 🌐 启用 Discussions（2 分钟）

**位置**：Settings → Features → ☑ Discussions
**作用**：bug 进 Issues，使用问题 / feature 讨论 / show & tell 进 Discussions。**早期开启比晚期迁移老 issue 简单**。

### 11. 🔧 Dependabot 配置（10 分钟，我来写）

**位置**：`.github/dependabot.yml`
**作用**：自动开依赖升级 PR。配合 CI status check，"小版本依赖更新"基本不用人管。
**风险**：xterm.js / vite / react 等大版本会需要人工合并，但 patch 升级可以自动 merge

### 12. 🌐 启用 CodeQL（5 分钟）

**位置**：Settings → Code security → "Set up code scanning" → Default
**作用**：GitHub 自带的静态安全扫描，能找代码审查漏的安全问题（命令注入、原型污染等）。**对 PTY/auth 这类敏感项目特别有价值**。
**成本**：每次 push 跑约 2 分钟，免费

---

## 🌱 长期价值（达到一定规模再做 / 总计 2-4 小时）

### 13. 🔧 README 加 CI / coverage 徽章（5 分钟）

**前提**：上面 #5 / #14 完成
**位置**：README.md 顶部徽章群

```markdown
[![ci](https://github.com/jjj201200/auvezy-terminal-remote/actions/workflows/ci.yml/badge.svg)](https://github.com/jjj201200/auvezy-terminal-remote/actions/workflows/ci.yml)
[![downloads](https://img.shields.io/npm/dm/auvezy-terminal-remote?style=flat-square&color=b6f09c&labelColor=0a0c0f)](https://www.npmjs.com/package/auvezy-terminal-remote)
```

### 14. 🌐 Codecov 接入（30 分钟）

**前提**：上面 #5 已有 vitest + v8 coverage
**操作**：codecov.io 关联 repo → 安装 GitHub App → CI 加 upload 步骤
**收益**：PR 里看 coverage diff，README 加 coverage 徽章

### 15. 🌐 GitHub Sponsors / FUNDING.yml（10 分钟）

**位置**：Settings → Features → "Set up Sponsor button" 或 `.github/FUNDING.yml`
**作用**：repo 顶部加 ❤️ Sponsor 按钮（即使你没在 GitHub Sponsors 上，可以指 Open Collective / 微信赞赏码 / Buy Me a Coffee）
**信号意义**：项目"看起来认真维护"——比实际收到赞助更重要

### 16. 🔧 CHANGELOG 自动化（视情况）

**工具**：[changesets](https://github.com/changesets/changesets) 或 [release-please](https://github.com/googleapis/release-please)
**前提**：commit 改用 conventional commits
**何时做**：到 1.0 之前可不做，手写更精准；当你每月发 ≥ 2 版时才有 ROI

### 17. 🌐 Pinned issue 引导新用户（5 分钟）

**操作**：建一个 issue 标题如 "👋 Welcome — start here"，pin 到 Issues 列表顶部
**内容**：常见问题 FAQ（PWA 安装步骤 / WSL 配置 / 多实例怎么用 / 已知边界）
**目的**：第一次访问 issue 列表的人不会被技术 bug 吓退

---

## 🎁 项目特定加分项（针对 auvezy-terminal-remote）

这些是**通用清单不会提**但你这个项目专门有收益的：

### 18. 🔧 Demo GIF / 视频替换 README hero（1-3 小时）

**当前**：用 `desktop.png` 静态截图
**升级**：30 秒录屏（手机扫码 → 浏览器接管 → 输入命令）
**工具**：
- [VHS](https://github.com/charmbracelet/vhs) — Charm 出品，纯 CLI 录屏，输出 GIF / mp4 / webm，可脚本化
- LICEcap / Kap — 鼠标手动录屏
- iOS QuickTime + 手机投屏 — 录手机端

**ROI**：GitHub 列表 + Twitter 卡 + npm 页面三个地方同时受益

### 19. 🔧 README 加 "Featured by" / 用户案例区段（持续）

**作用**：当任何外部讨论 / blog / HN 提到你的项目时，立刻贴到这里
**预留模板**：

```markdown
## Featured by

- [Some HN discussion 2026]
- [Blog post title — Author, 2026-XX]
```

**早做的价值**：哪怕只有 1 条也是社会证明，比等 100 stars 才加要早

### 20. 🔧 Alternatives 章节（README 或 docs/）

**模式**：ttyd / gotty / bat 等同领域工具的 README 都有
**写法**：

```markdown
## Compared to alternatives

|  | auvezy-terminal-remote | ttyd | gotty | wetty |
|---|:---:|:---:|:---:|:---:|
| LAN-only by default | ✓ | ✗ | ✗ | ✗ |
| Multi-instance built-in | ✓ | ✗ | ✗ | ✗ |
| Mobile-first PWA | ✓ | ✗ | ✗ | △ |
| WSL2 auto-config | ✓ | ✗ | ✗ | ✗ |
| Tailscale / VPN aware | ✓ | ✗ | ✗ | ✗ |
| Master/slave arbitration | ✓ | ✗ | ✗ | ✗ |
```

**位置**：放 docs/ALTERNATIVES.md，README 里加一行链接即可
**作用**：搜 "ttyd alternative" 的用户能找到你

### 21. 🌐 GitHub Topic curator（被动）

GitHub 有些 topic 是"官方 curated 列表"（比如 [`terminal`](https://github.com/topics/terminal)）。当 stars > 50 后，你的 repo 会自动出现在这些 topic 页 —— 加 topics（已在 #2 中）就行。

### 22. 🔧 OG image 自动生成（5 分钟，仅链接 SEO）

如果你以后建项目主页（GitHub Pages / 独立域名），用 [og-image](https://og-image.vercel.app/) 服务可以自动生成 OG 图。**不是 GitHub 内的事**，但 SEO 价值高。

---

## 推荐执行顺序（按 ROI）

### 今天就做（1 小时内可完成）

1. ✅ Social preview（你 5 分钟）
2. ✅ About 区填写（你 5 分钟）
3. ✅ v0.5.0 release notes（你 5 分钟，或我用 gh CLI）
4. ✅ Branch protection rule（你 5 分钟）
5. ✅ CI workflow（**我来写 30 分钟**）

### 这周做（2-3 小时）

6. CONTRIBUTING.md（**我**）
7. SECURITY.md（**我**）
8. Issue templates（**我**）
9. PR template（**我**）
10. Discussions 开关（你 2 分钟）
11. Dependabot 配置（**我**）
12. CodeQL 启用（你 5 分钟）

### 下个版本之前（半天）

13. CI 徽章 / downloads 徽章
14. Codecov 接入
15. FUNDING.yml

### 长期 / 视情况

16. CHANGELOG 自动化
17. Pinned welcome issue
18. Demo GIF（**我帮你写 VHS 脚本**）
19. Featured by 区段
20. Alternatives 章节（**我**）

---

## 我能立刻动手做的（一声招呼即可）

✅ **代码侧**（不需要你做任何 GitHub UI 操作）：

- 写 `.github/workflows/ci.yml`（GitHub Actions CI）
- 写 `CONTRIBUTING.md`（中英双语）
- 写 `SECURITY.md`
- 写 `.github/ISSUE_TEMPLATE/bug-report.yml` + `feature-request.yml` + `question.yml`
- 写 `.github/pull_request_template.md`
- 写 `.github/dependabot.yml`
- 写 `docs/ALTERNATIVES.md`
- 写 `README.md` 加 CI / downloads 徽章
- 用 `gh release create` 创建 v0.5.0 release notes（需要你先 `gh auth login`）

🔒 **必须你做**（GitHub UI / 个人决策）：

- Social preview 上传
- About 区填写
- Branch protection rule
- Discussions 开关
- CodeQL 启用
- Codecov 关联
- GitHub Sponsors 设置

---

## 小结

**最高 ROI 的 5 件事**（如果只做 5 件就这 5 件）：

1. **Social preview**（视觉冲击 + 5 分钟）
2. **About + Topics**（被搜索发现 + 5 分钟）
3. **CI workflow**（质量门 + 30 分钟）
4. **Branch protection**（防自残 + 5 分钟）
5. **v0.5.0 release notes**（让 release 页面美观 + 5 分钟）

剩下的清单按你节奏推进即可。
