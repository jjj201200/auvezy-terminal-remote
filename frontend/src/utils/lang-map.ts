/**
 * 后端 lang short id → Shiki bundled lang。
 *
 * Why 白名单而不是任何字符串都传:
 *  - 防御未来后端误传非 shiki id(grammar 加载会抛运行时错)
 *  - 升级 Shiki 时按 BundledLanguage union 同步增删,有迹可循
 */

export function toShikiLang(backendLang: string): string {
  if (KNOWN.has(backendLang)) return backendLang;
  return 'txt';
}

const KNOWN = new Set<string>([
  'js', 'jsx', 'ts', 'tsx',

  'json', 'jsonc', 'json5', 'jsonl',
  'yaml', 'toml',
  'ini', 'dotenv', 'properties',
  'xml',
  'csv', 'tsv',

  'markdown', 'mdx', 'mdc',
  'rst', 'asciidoc',
  'latex', 'bibtex',
  'log',
  'txt',

  'html',
  'css', 'scss', 'sass', 'less', 'stylus', 'postcss',
  'vue', 'vue-html', 'svelte', 'astro',
  'handlebars', 'pug', 'erb',
  'liquid', 'twig', 'jinja',

  'shell', 'bash', 'fish', 'powershell',
  'bat', 'awk',
  'nginx', 'systemd', 'apache',
  'docker',
  'cmake', 'makefile',

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

  'sql', 'prisma',
  'graphql',
  'http',

  'nix',
  'terraform', 'hcl',
  'proto',

  'diff', 'regex',
  'po',
  'just',

  // 终端日志(ESC CSI 着色)— shiki 内置 'ansi' grammar
  'ansi',
]);
