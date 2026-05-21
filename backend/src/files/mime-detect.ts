/**
 * mime-detect:扩展名 / 全名 → mime + previewable kind + lang
 *
 * 不读文件内容,仅基于路径。二进制识别在 read-file.ts 做(NUL 字节 + 替换字符)。
 *
 * 决策优先级:
 *   1. SPECIAL_NAMES 全名命中(Makefile / Dockerfile / .gitignore / package.json …)
 *   2. IMAGE_EXT_TO_MIME 扩展名(SVG 也走 image,虽然其本质是 XML)
 *   3. TEXT_EXT_TO_MIME 扩展名(几百个常见文本/源码类型)
 *   4. 兜底:application/octet-stream, previewable=none
 *
 * lang 与 mime 同源(各自表),前端把 lang 喂给 Shiki(详见 detectLang)。
 */

import { basename, extname } from 'node:path';
import type { FilePreviewKind } from 'auvezy-terminal-remote-shared';

// ────────────────────────────────────────────────────────────────────
// 全名命中表(优先于扩展名)
// 项目里大量"以无后缀 / 双扩展 / 约定式 dotfile"出现的文件,扩展名匹配不准
// ────────────────────────────────────────────────────────────────────

/**
 * 全名 → { mime, lang, previewable }
 *
 * key 大小写敏感(README ≠ readme,与文件系统一致;extname 路径走 toLowerCase
 * 仅对纯扩展名)。匹配规则在 detectMime 内显式 case-by-case 处理大小写。
 */
interface SpecialEntry {
  mime: string;
  lang: string;
  previewable: FilePreviewKind;
}

const SPECIAL_NAMES: Record<string, SpecialEntry> = {
  // ─── 构建/容器 ───
  'Makefile': { mime: 'text/x-makefile', lang: 'makefile', previewable: 'text' },
  'GNUmakefile': { mime: 'text/x-makefile', lang: 'makefile', previewable: 'text' },
  'Dockerfile': { mime: 'text/x-dockerfile', lang: 'docker', previewable: 'text' },
  'Containerfile': { mime: 'text/x-dockerfile', lang: 'docker', previewable: 'text' },
  'CMakeLists.txt': { mime: 'text/plain', lang: 'cmake', previewable: 'text' },

  // ─── 包管理 / 工程 ───
  'package.json': { mime: 'application/json', lang: 'json', previewable: 'text' },
  'package-lock.json': { mime: 'application/json', lang: 'json', previewable: 'text' },
  'tsconfig.json': { mime: 'application/json', lang: 'jsonc', previewable: 'text' },
  'tsconfig.base.json': { mime: 'application/json', lang: 'jsonc', previewable: 'text' },
  'jsconfig.json': { mime: 'application/json', lang: 'jsonc', previewable: 'text' },
  'turbo.json': { mime: 'application/json', lang: 'jsonc', previewable: 'text' },
  'nx.json': { mime: 'application/json', lang: 'json', previewable: 'text' },
  'lerna.json': { mime: 'application/json', lang: 'json', previewable: 'text' },
  'biome.json': { mime: 'application/json', lang: 'jsonc', previewable: 'text' },
  'composer.json': { mime: 'application/json', lang: 'json', previewable: 'text' },
  'composer.lock': { mime: 'application/json', lang: 'json', previewable: 'text' },
  'pnpm-workspace.yaml': { mime: 'application/yaml', lang: 'yaml', previewable: 'text' },
  'pnpm-lock.yaml': { mime: 'application/yaml', lang: 'yaml', previewable: 'text' },
  'yarn.lock': { mime: 'text/plain', lang: 'yaml', previewable: 'text' },
  'bun.lockb': { mime: 'application/octet-stream', lang: 'txt', previewable: 'none' },
  'bun.lock': { mime: 'text/plain', lang: 'toml', previewable: 'text' },
  // shiki 没有 go-mod grammar,降级 txt(纯文本仍可读,只是无着色)
  'go.mod': { mime: 'text/x-go-mod', lang: 'txt', previewable: 'text' },
  'go.sum': { mime: 'text/plain', lang: 'txt', previewable: 'text' },
  'Cargo.toml': { mime: 'application/toml', lang: 'toml', previewable: 'text' },
  'Cargo.lock': { mime: 'application/toml', lang: 'toml', previewable: 'text' },
  'pyproject.toml': { mime: 'application/toml', lang: 'toml', previewable: 'text' },
  'poetry.lock': { mime: 'application/toml', lang: 'toml', previewable: 'text' },
  'Pipfile': { mime: 'application/toml', lang: 'toml', previewable: 'text' },
  'Pipfile.lock': { mime: 'application/json', lang: 'json', previewable: 'text' },
  'requirements.txt': { mime: 'text/plain', lang: 'txt', previewable: 'text' },
  'requirements-dev.txt': { mime: 'text/plain', lang: 'txt', previewable: 'text' },
  'Rakefile': { mime: 'text/x-ruby', lang: 'ruby', previewable: 'text' },
  'Gemfile': { mime: 'text/x-ruby', lang: 'ruby', previewable: 'text' },
  'Gemfile.lock': { mime: 'text/plain', lang: 'txt', previewable: 'text' },
  'Procfile': { mime: 'text/plain', lang: 'txt', previewable: 'text' },
  'Brewfile': { mime: 'text/x-ruby', lang: 'ruby', previewable: 'text' },
  'Vagrantfile': { mime: 'text/x-ruby', lang: 'ruby', previewable: 'text' },
  'Justfile': { mime: 'text/x-just', lang: 'just', previewable: 'text' },
  'justfile': { mime: 'text/x-just', lang: 'just', previewable: 'text' },
  'Taskfile.yml': { mime: 'application/yaml', lang: 'yaml', previewable: 'text' },
  'Taskfile.yaml': { mime: 'application/yaml', lang: 'yaml', previewable: 'text' },

  // ─── 配置 dotfile ───
  '.gitignore': { mime: 'text/x-gitignore', lang: 'txt', previewable: 'text' },
  '.gitattributes': { mime: 'text/plain', lang: 'txt', previewable: 'text' },
  '.gitmodules': { mime: 'text/x-properties', lang: 'ini', previewable: 'text' },
  '.gitconfig': { mime: 'text/x-properties', lang: 'ini', previewable: 'text' },
  '.dockerignore': { mime: 'text/x-gitignore', lang: 'txt', previewable: 'text' },
  '.npmignore': { mime: 'text/x-gitignore', lang: 'txt', previewable: 'text' },
  '.eslintignore': { mime: 'text/x-gitignore', lang: 'txt', previewable: 'text' },
  '.prettierignore': { mime: 'text/x-gitignore', lang: 'txt', previewable: 'text' },
  '.editorconfig': { mime: 'text/x-properties', lang: 'ini', previewable: 'text' },
  '.env': { mime: 'text/plain', lang: 'dotenv', previewable: 'text' },
  '.env.local': { mime: 'text/plain', lang: 'dotenv', previewable: 'text' },
  '.env.development': { mime: 'text/plain', lang: 'dotenv', previewable: 'text' },
  '.env.production': { mime: 'text/plain', lang: 'dotenv', previewable: 'text' },
  '.env.test': { mime: 'text/plain', lang: 'dotenv', previewable: 'text' },
  '.env.example': { mime: 'text/plain', lang: 'dotenv', previewable: 'text' },
  '.npmrc': { mime: 'text/x-properties', lang: 'ini', previewable: 'text' },
  '.yarnrc': { mime: 'text/plain', lang: 'yaml', previewable: 'text' },
  '.yarnrc.yml': { mime: 'application/yaml', lang: 'yaml', previewable: 'text' },
  '.nvmrc': { mime: 'text/plain', lang: 'txt', previewable: 'text' },
  '.node-version': { mime: 'text/plain', lang: 'txt', previewable: 'text' },
  '.python-version': { mime: 'text/plain', lang: 'txt', previewable: 'text' },
  '.ruby-version': { mime: 'text/plain', lang: 'txt', previewable: 'text' },
  '.tool-versions': { mime: 'text/plain', lang: 'txt', previewable: 'text' },
  '.eslintrc': { mime: 'application/json', lang: 'json', previewable: 'text' },
  '.eslintrc.json': { mime: 'application/json', lang: 'json', previewable: 'text' },
  '.eslintrc.js': { mime: 'text/javascript', lang: 'js', previewable: 'text' },
  '.eslintrc.cjs': { mime: 'text/javascript', lang: 'js', previewable: 'text' },
  '.eslintrc.yml': { mime: 'application/yaml', lang: 'yaml', previewable: 'text' },
  '.eslintrc.yaml': { mime: 'application/yaml', lang: 'yaml', previewable: 'text' },
  '.prettierrc': { mime: 'application/json', lang: 'json', previewable: 'text' },
  '.prettierrc.json': { mime: 'application/json', lang: 'json', previewable: 'text' },
  '.prettierrc.js': { mime: 'text/javascript', lang: 'js', previewable: 'text' },
  '.prettierrc.cjs': { mime: 'text/javascript', lang: 'js', previewable: 'text' },
  '.prettierrc.yml': { mime: 'application/yaml', lang: 'yaml', previewable: 'text' },
  '.prettierrc.yaml': { mime: 'application/yaml', lang: 'yaml', previewable: 'text' },
  '.stylelintrc': { mime: 'application/json', lang: 'json', previewable: 'text' },
  '.stylelintrc.json': { mime: 'application/json', lang: 'json', previewable: 'text' },
  '.babelrc': { mime: 'application/json', lang: 'json', previewable: 'text' },
  '.babelrc.json': { mime: 'application/json', lang: 'json', previewable: 'text' },
  '.swcrc': { mime: 'application/json', lang: 'json', previewable: 'text' },
  '.huskyrc': { mime: 'application/json', lang: 'json', previewable: 'text' },
  '.atrrc': { mime: 'application/json', lang: 'json', previewable: 'text' },
  '.bashrc': { mime: 'text/x-shellscript', lang: 'bash', previewable: 'text' },
  '.zshrc': { mime: 'text/x-shellscript', lang: 'bash', previewable: 'text' },
  '.profile': { mime: 'text/x-shellscript', lang: 'bash', previewable: 'text' },
  '.bash_profile': { mime: 'text/x-shellscript', lang: 'bash', previewable: 'text' },
  '.zprofile': { mime: 'text/x-shellscript', lang: 'bash', previewable: 'text' },
  '.zshenv': { mime: 'text/x-shellscript', lang: 'bash', previewable: 'text' },

  // ─── 文档约定(无扩展或带各种扩展,通常 markdown) ───
  'README': { mime: 'text/plain', lang: 'markdown', previewable: 'text' },
  'CHANGELOG': { mime: 'text/markdown', lang: 'markdown', previewable: 'text' },
  'LICENSE': { mime: 'text/plain', lang: 'txt', previewable: 'text' },
  'COPYING': { mime: 'text/plain', lang: 'txt', previewable: 'text' },
  'AUTHORS': { mime: 'text/plain', lang: 'txt', previewable: 'text' },
  'CONTRIBUTORS': { mime: 'text/plain', lang: 'txt', previewable: 'text' },
  'NOTICE': { mime: 'text/plain', lang: 'txt', previewable: 'text' },
  'TODO': { mime: 'text/plain', lang: 'txt', previewable: 'text' },
};

// ────────────────────────────────────────────────────────────────────
// 扩展名 → mime + lang(几百种,主要是 shiki 支持的)
// ────────────────────────────────────────────────────────────────────

/** 扩展名 → mime(image,优先于 text) */
const IMAGE_EXT_TO_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.jpe': 'image/jpeg', '.jfif': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.apng': 'image/apng',
  '.tiff': 'image/tiff', '.tif': 'image/tiff',
};

/** 扩展名 → mime(text 类) */
const TEXT_EXT_TO_MIME: Record<string, string> = {
  // 纯文本 / 文档
  '.txt': 'text/plain', '.text': 'text/plain', '.log': 'text/plain',
  '.md': 'text/markdown', '.markdown': 'text/markdown', '.mkd': 'text/markdown',
  '.mdx': 'text/markdown', '.mdc': 'text/markdown',
  '.rst': 'text/x-rst',
  '.adoc': 'text/asciidoc', '.asciidoc': 'text/asciidoc',
  '.tex': 'text/x-tex',
  '.bib': 'text/x-bibtex',

  // 数据 / 配置
  '.json': 'application/json', '.jsonc': 'application/json', '.json5': 'application/json',
  '.jsonl': 'application/x-jsonlines', '.ndjson': 'application/x-ndjson',
  '.yml': 'application/yaml', '.yaml': 'application/yaml',
  '.toml': 'application/toml',
  '.ini': 'text/x-properties', '.cfg': 'text/x-properties', '.conf': 'text/plain',
  '.properties': 'text/x-properties',
  '.env': 'text/plain', '.example': 'text/plain',
  '.gitignore': 'text/x-gitignore', '.dockerignore': 'text/x-gitignore',
  '.csv': 'text/csv', '.tsv': 'text/tab-separated-values',
  '.lock': 'text/plain',
  '.xml': 'application/xml', '.xsl': 'application/xml', '.xsd': 'application/xml',
  '.plist': 'application/xml',
  '.po': 'text/x-gettext', '.pot': 'text/x-gettext',
  '.proto': 'text/x-protobuf',
  '.graphql': 'application/graphql', '.gql': 'application/graphql',

  // Web
  '.html': 'text/html', '.htm': 'text/html', '.xhtml': 'application/xhtml+xml',
  '.css': 'text/css', '.scss': 'text/x-scss',
  '.sass': 'text/x-sass', '.less': 'text/x-less', '.styl': 'text/x-stylus',
  '.vue': 'text/x-vue', '.svelte': 'text/x-svelte', '.astro': 'text/x-astro',
  '.hbs': 'text/x-handlebars', '.handlebars': 'text/x-handlebars',
  '.pug': 'text/x-pug', '.jade': 'text/x-pug',
  '.ejs': 'text/x-ejs', '.erb': 'text/x-erb',
  '.liquid': 'text/x-liquid', '.twig': 'text/x-twig', '.njk': 'text/x-jinja',
  '.jinja': 'text/x-jinja', '.jinja2': 'text/x-jinja', '.j2': 'text/x-jinja',

  // JS/TS 系
  '.ts': 'text/typescript', '.tsx': 'text/tsx', '.mts': 'text/typescript', '.cts': 'text/typescript',
  '.js': 'text/javascript', '.jsx': 'text/jsx',
  '.mjs': 'text/javascript', '.cjs': 'text/javascript',
  '.d.ts': 'text/typescript',

  // 系统/脚本
  '.sh': 'text/x-shellscript', '.bash': 'text/x-shellscript', '.zsh': 'text/x-shellscript',
  '.fish': 'text/x-shellscript', '.ksh': 'text/x-shellscript',
  '.ps1': 'text/x-powershell', '.psm1': 'text/x-powershell',
  '.bat': 'text/x-batchfile', '.cmd': 'text/x-batchfile',
  '.awk': 'text/x-awk', '.sed': 'text/x-sed',
  '.nginx': 'text/x-nginx-conf', '.nginxconf': 'text/x-nginx-conf',
  '.service': 'text/x-systemd', '.timer': 'text/x-systemd',

  // Python / Ruby / Go / Rust / 其它语言
  '.py': 'text/x-python', '.pyi': 'text/x-python', '.pyw': 'text/x-python',
  '.rb': 'text/x-ruby', '.rake': 'text/x-ruby',
  '.go': 'text/x-go',
  '.rs': 'text/x-rust',
  '.php': 'text/x-php', '.php3': 'text/x-php', '.phtml': 'text/x-php',
  '.java': 'text/x-java',
  '.kt': 'text/x-kotlin', '.kts': 'text/x-kotlin',
  '.swift': 'text/x-swift',
  '.c': 'text/x-c', '.h': 'text/x-c',
  '.cc': 'text/x-c++', '.cpp': 'text/x-c++', '.cxx': 'text/x-c++',
  '.hh': 'text/x-c++', '.hpp': 'text/x-c++', '.hxx': 'text/x-c++',
  '.cs': 'text/x-csharp',
  '.fs': 'text/x-fsharp', '.fsx': 'text/x-fsharp',
  '.m': 'text/x-objective-c', '.mm': 'text/x-objective-c++',
  '.scala': 'text/x-scala', '.sc': 'text/x-scala',
  '.ex': 'text/x-elixir', '.exs': 'text/x-elixir',
  '.erl': 'text/x-erlang', '.hrl': 'text/x-erlang',
  '.hs': 'text/x-haskell', '.lhs': 'text/x-haskell',
  '.lua': 'text/x-lua',
  '.r': 'text/x-r', '.R': 'text/x-r',
  '.dart': 'text/x-dart',
  '.pl': 'text/x-perl', '.pm': 'text/x-perl',
  '.groovy': 'text/x-groovy', '.gradle': 'text/x-groovy',
  '.clj': 'text/x-clojure', '.cljs': 'text/x-clojure', '.cljc': 'text/x-clojure',
  '.lisp': 'text/x-common-lisp', '.lsp': 'text/x-common-lisp',
  '.el': 'text/x-emacs-lisp',
  '.scheme': 'text/x-scheme', '.scm': 'text/x-scheme',
  '.ml': 'text/x-ocaml', '.mli': 'text/x-ocaml',
  '.jl': 'text/x-julia',
  '.zig': 'text/x-zig',
  '.nim': 'text/x-nim',
  '.cr': 'text/x-crystal',
  '.v': 'text/x-v',
  '.vala': 'text/x-vala',
  '.vb': 'text/x-vb',

  // 数据库 / 数据
  '.sql': 'application/sql', '.psql': 'application/sql', '.mysql': 'application/sql',
  '.prisma': 'text/x-prisma',

  // 配置 / IaC
  '.nix': 'text/x-nix',
  '.tf': 'text/x-terraform', '.tfvars': 'text/x-terraform', '.hcl': 'text/x-hcl',
  '.dockerfile': 'text/x-dockerfile',
  '.cmake': 'text/x-cmake',
  '.make': 'text/x-makefile', '.mk': 'text/x-makefile', '.makefile': 'text/x-makefile',
  '.gn': 'text/x-gn',
  '.bzl': 'text/x-bzl', '.bazel': 'text/x-bzl',

  // 其它
  '.diff': 'text/x-diff', '.patch': 'text/x-diff',
  '.regex': 'text/x-regex',
  '.http': 'message/http',
  '.cmake.in': 'text/x-cmake',
  '.gitcommit': 'text/x-git-commit',
};

/** 扩展名 → Shiki bundled lang short id */
const LANG_MAP: Record<string, string> = {
  // 纯文本 / 文档
  '.md': 'markdown', '.markdown': 'markdown', '.mkd': 'markdown',
  '.mdx': 'mdx', '.mdc': 'mdc',
  '.rst': 'rst',
  '.adoc': 'asciidoc', '.asciidoc': 'asciidoc',
  '.tex': 'latex',
  '.bib': 'bibtex',
  '.log': 'log',

  // 数据 / 配置
  '.json': 'json', '.jsonc': 'jsonc', '.json5': 'json5',
  '.jsonl': 'jsonl', '.ndjson': 'jsonl',
  '.yml': 'yaml', '.yaml': 'yaml',
  '.toml': 'toml',
  '.ini': 'ini', '.cfg': 'ini', '.properties': 'ini', '.conf': 'ini',
  '.env': 'dotenv', '.example': 'dotenv',
  '.xml': 'xml', '.xsl': 'xml', '.xsd': 'xml',
  '.plist': 'xml',
  '.proto': 'proto',
  '.graphql': 'graphql', '.gql': 'graphql',
  '.po': 'po', '.pot': 'po',

  // Web
  '.html': 'html', '.htm': 'html', '.xhtml': 'html',
  '.css': 'css', '.scss': 'scss', '.sass': 'sass',
  '.less': 'less', '.styl': 'stylus',
  '.vue': 'vue', '.svelte': 'svelte', '.astro': 'astro',
  '.hbs': 'handlebars', '.handlebars': 'handlebars',
  '.pug': 'pug', '.jade': 'pug',
  '.erb': 'erb',
  '.liquid': 'liquid', '.twig': 'twig',
  '.jinja': 'jinja', '.jinja2': 'jinja', '.j2': 'jinja', '.njk': 'jinja',

  // JS / TS 系
  '.ts': 'ts', '.tsx': 'tsx', '.mts': 'ts', '.cts': 'ts',
  '.js': 'js', '.jsx': 'jsx',
  '.mjs': 'js', '.cjs': 'js',
  '.d.ts': 'ts',

  // 系统 / 脚本
  '.sh': 'shell', '.bash': 'bash', '.zsh': 'bash',
  '.fish': 'fish', '.ksh': 'shell',
  '.ps1': 'powershell', '.psm1': 'powershell',
  '.bat': 'bat', '.cmd': 'bat',
  '.awk': 'awk',
  '.nginx': 'nginx', '.nginxconf': 'nginx',
  '.service': 'systemd', '.timer': 'systemd',
  '.dockerfile': 'docker',

  // 语言
  '.py': 'python', '.pyi': 'python', '.pyw': 'python',
  '.rb': 'ruby', '.rake': 'ruby',
  '.go': 'go',
  '.rs': 'rust',
  '.php': 'php',
  '.java': 'java',
  '.kt': 'kotlin', '.kts': 'kotlin',
  '.swift': 'swift',
  '.c': 'c', '.h': 'c',
  '.cc': 'cpp', '.cpp': 'cpp', '.cxx': 'cpp',
  '.hh': 'cpp', '.hpp': 'cpp', '.hxx': 'cpp',
  '.cs': 'csharp',
  '.fs': 'fsharp', '.fsx': 'fsharp',
  '.m': 'objective-c', '.mm': 'objective-cpp',
  '.scala': 'scala', '.sc': 'scala',
  '.ex': 'elixir', '.exs': 'elixir',
  '.erl': 'erlang', '.hrl': 'erlang',
  '.hs': 'haskell', '.lhs': 'haskell',
  '.lua': 'lua',
  '.r': 'r', '.R': 'r',
  '.dart': 'dart',
  '.pl': 'perl', '.pm': 'perl',
  '.groovy': 'groovy', '.gradle': 'groovy',
  '.clj': 'clojure', '.cljs': 'clojure', '.cljc': 'clojure',
  '.lisp': 'common-lisp', '.lsp': 'common-lisp',
  '.el': 'emacs-lisp',
  '.scm': 'scheme',
  '.ml': 'ocaml', '.mli': 'ocaml',
  '.jl': 'julia',
  '.zig': 'zig',
  '.nim': 'nim',
  '.cr': 'crystal',
  '.v': 'v',
  '.vb': 'vb',

  // 数据库
  '.sql': 'sql', '.psql': 'sql', '.mysql': 'sql',
  '.prisma': 'prisma',

  // IaC
  '.nix': 'nix',
  '.tf': 'terraform', '.tfvars': 'terraform', '.hcl': 'hcl',
  '.cmake': 'cmake',
  '.make': 'makefile', '.mk': 'makefile', '.makefile': 'makefile',

  // 其它
  '.diff': 'diff', '.patch': 'diff',
  '.svg': 'xml',
  '.http': 'http',
};

export interface MimeInfo {
  mime: string;
  previewable: FilePreviewKind;
}

/**
 * 按文件名(或绝对路径)推断 mime + previewable。
 * 不接触文件内容,只看 basename + extname。
 */
export function detectMime(filename: string): MimeInfo {
  const base = basename(filename);
  const special = lookupSpecial(base);
  if (special) {
    return { mime: special.mime, previewable: special.previewable };
  }

  // 双扩展名兜底:foo.d.ts / foo.test.tsx 等先用末段扩展名
  const ext = extname(base).toLowerCase();

  // 图片优先(svg 走 image 渲染)
  if (ext in IMAGE_EXT_TO_MIME) {
    return { mime: IMAGE_EXT_TO_MIME[ext]!, previewable: 'image' };
  }
  if (ext in TEXT_EXT_TO_MIME) {
    return { mime: TEXT_EXT_TO_MIME[ext]!, previewable: 'text' };
  }
  return { mime: 'application/octet-stream', previewable: 'none' };
}

/**
 * 按文件名推断 Shiki bundled lang short id;未识别 → 'txt'(前端走 escapeHtml 降级)。
 */
export function detectLang(filename: string): string {
  const base = basename(filename);
  const special = lookupSpecial(base);
  if (special) return special.lang;
  const ext = extname(base).toLowerCase();
  return LANG_MAP[ext] ?? 'txt';
}

/**
 * 查全名映射,处理两类:
 *  1. 完全匹配(Makefile, Dockerfile, package.json …)
 *  2. 带数字后缀 / 变体(README.md → README;CHANGELOG.txt → CHANGELOG …)
 *     仅当 basename(no ext) 命中且 ext 为空 / .md / .txt 时按 SPECIAL 处理
 */
function lookupSpecial(base: string): SpecialEntry | null {
  // 完全匹配
  if (base in SPECIAL_NAMES) return SPECIAL_NAMES[base]!;

  // README / CHANGELOG / LICENSE 等带扩展(README.md / CHANGELOG.txt / LICENSE.md)
  const ext = extname(base).toLowerCase();
  if (ext === '' || ext === '.md' || ext === '.markdown' || ext === '.txt') {
    const stem = base.slice(0, base.length - ext.length);
    const upper = stem.toUpperCase();
    if (upper === 'README' || upper === 'CHANGELOG' || upper === 'LICENSE' ||
        upper === 'COPYING' || upper === 'AUTHORS' || upper === 'CONTRIBUTORS' ||
        upper === 'NOTICE' || upper === 'TODO') {
      // 用 .md 后缀的 lang 升级为 markdown
      const isMd = ext === '.md' || ext === '.markdown';
      const baseEntry = SPECIAL_NAMES[upper];
      if (baseEntry) {
        return isMd
          ? { ...baseEntry, lang: 'markdown', mime: 'text/markdown' }
          : baseEntry;
      }
    }
  }

  return null;
}
