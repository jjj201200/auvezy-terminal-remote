/**
 * 后端 lang short id → Shiki bundleId。未知 → 'txt'(由 highlight 走 escapeHtml 降级)。
 *
 * 与 `backend/src/files/mime-detect.ts` 的 LANG_MAP value 对齐:同一字符串既是
 * 后端推断结果,也是 Shiki BundledLanguage 的合法 id。
 */

export function toShikiLang(backendLang: string): string {
  return KNOWN.has(backendLang) ? backendLang : 'txt';
}

const KNOWN = new Set<string>([
  'ts', 'tsx', 'js', 'jsx',
  'markdown', 'yaml', 'json', 'toml',
  'python', 'go', 'rust', 'ruby', 'php',
  'java', 'kotlin', 'swift',
  'c', 'cpp', 'csharp',
  'shell',
  'html', 'css', 'scss', 'sass', 'less',
  'xml', 'sql',
]);
