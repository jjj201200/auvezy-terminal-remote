/**
 * 后端 lang short id → Shiki bundled lang。
 *
 * 后端 mime-detect 输出的 lang 短名跟 Shiki BundledLanguage 已对齐(同表),
 * 这里**白名单接受**所有 shiki 4.x 支持的常见 lang;命中即直接透传给 shiki 的
 * `codeToHtml({ lang })`。未识别 → 'txt'(高亮模块走 escapeHtml 降级)。
 *
 * 选择白名单而非"任何字符串都传"的原因:
 *  - 防御未来后端误传非 shiki id(grammar 加载会抛运行时错)
 *  - 透明:看本 set 就知道前端实际支持哪些
 *
 * 维护:Shiki 升级时按 `node_modules/.pnpm/shiki@<ver>/.../langs-bundle-full-*.d.mts`
 * 里的 BundledLanguage union 增删。
 */

export function toShikiLang(backendLang: string): string {
  if (KNOWN.has(backendLang)) return backendLang;
  return 'txt';
}

/**
 * 接受的 Shiki bundled lang(short id 优先,alias 也加),覆盖项目常见文本类型。
 *
 * 分类:
 *  - JS/TS:js/jsx/ts/tsx
 *  - 数据/配置:json/jsonc/json5/jsonl/yaml/toml/ini/dotenv/xml/csv
 *  - 文档:markdown/mdx/mdc/rst/asciidoc/latex/bibtex/log
 *  - Web:html/css/scss/sass/less/stylus/vue/svelte/astro/handlebars/pug/erb/
 *    liquid/twig/jinja
 *  - shell/系统:shell/bash/fish/powershell/bat/awk/nginx/systemd/docker
 *  - 后端语言:python/go/rust/ruby/php/java/kotlin/swift/c/cpp/csharp/fsharp/
 *    objective-c/objective-cpp/scala/elixir/erlang/haskell/lua/r/dart/perl/
 *    groovy/clojure/common-lisp/emacs-lisp/scheme/ocaml/julia/zig/nim/crystal/v/vb
 *  - 数据库:sql/prisma/graphql
 *  - IaC:nix/terraform/hcl/cmake/makefile/proto
 *  - 其它:diff/regex/http/po/ignore
 */
const KNOWN = new Set<string>([
  // JS/TS
  'js', 'jsx', 'ts', 'tsx',

  // 数据/配置
  'json', 'jsonc', 'json5', 'jsonl',
  'yaml', 'toml',
  'ini', 'dotenv', 'properties',
  'xml',
  'csv', 'tsv',

  // 文档
  'markdown', 'mdx', 'mdc',
  'rst', 'asciidoc',
  'latex', 'bibtex',
  'log',
  'txt',

  // Web
  'html',
  'css', 'scss', 'sass', 'less', 'stylus', 'postcss',
  'vue', 'vue-html', 'svelte', 'astro',
  'handlebars', 'pug', 'erb',
  'liquid', 'twig', 'jinja',

  // 系统/脚本/容器
  'shell', 'bash', 'fish', 'powershell',
  'bat', 'awk',
  'nginx', 'systemd', 'apache',
  'docker',
  'cmake', 'makefile',

  // 语言
  'python', 'go', 'rust', 'ruby', 'php',
  'java', 'kotlin', 'swift',
  'c', 'cpp', 'csharp',
  'fsharp',
  'objective-c', 'objective-cpp',
  'scala', 'elixir', 'erlang', 'haskell',
  'lua', 'r', 'dart',
  'perl', 'groovy',
  'clojure', 'common-lisp', 'emacs-lisp', 'scheme',
  'ocaml', 'julia',
  'zig', 'nim', 'crystal',
  'v', 'vala', 'vb',

  // 数据库 / 接口
  'sql', 'prisma',
  'graphql',
  'http',

  // IaC / 配置语言
  'nix',
  'terraform', 'hcl',
  'proto',

  // 其它
  'diff', 'regex',
  'po',
  'just',
]);
