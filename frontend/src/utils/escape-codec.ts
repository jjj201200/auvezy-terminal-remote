/**
 * 控制字符 ↔ 可读转义字符串
 *
 * 用于 ShortcutSettings / CommandSettings 的 input：
 *  - 文件层（落盘 / 协议）：真控制字节（'\x1b'、'\r' 等）
 *  - UI 编辑层：可读转义（'\e'、'\r' 字面量）
 *
 * 转义规则（与 codec 双向等价）：
 *   '\\' → '\\\\'
 *   '\x1b' → '\\e'
 *   '\r' '\n' '\t' → '\\r' '\\n' '\\t'
 *   其它 0x00–0x1F + 0x7F → '\\xHH'（小写 hex）
 *   其它字符（含 Unicode 可打印）→ 原样
 *
 * 不支持 \\u / \\u{}：UI 用不到，且会引入歧义。
 */

const ENCODE_MAP: Record<string, string> = {
  '\\': '\\\\',
  '\x1b': '\\e',
  '\r': '\\r',
  '\n': '\\n',
  '\t': '\\t',
};

/** 把真控制字节转为可读转义字符串 */
export function encodeForInput(raw: string): string {
  let out = '';
  for (const ch of raw) {
    const direct = ENCODE_MAP[ch];
    if (direct !== undefined) {
      out += direct;
      continue;
    }
    const code = ch.charCodeAt(0);
    // ASCII 控制字符 (0x00-0x1F) 与 DEL (0x7F)
    if (code <= 0x1f || code === 0x7f) {
      out += '\\x' + code.toString(16).padStart(2, '0');
    } else {
      out += ch;
    }
  }
  return out;
}

const DECODE_SHORT: Record<string, string> = {
  '\\': '\\',
  e: '\x1b',
  r: '\r',
  n: '\n',
  t: '\t',
};

/** 解析可读转义字符串回真字节；非法转义保留原样并报 warning */
export function decodeFromInput(s: string): { value: string; warning: string | null } {
  let out = '';
  let warning: string | null = null;
  let i = 0;
  while (i < s.length) {
    const ch = s[i] ?? '';
    if (ch !== '\\') {
      out += ch;
      i += 1;
      continue;
    }
    // 反斜杠：看下一个字符
    if (i + 1 >= s.length) {
      warning ??= '末尾悬空反斜杠';
      out += '\\';
      i += 1;
      continue;
    }
    const next = s[i + 1] ?? '';
    if (next === 'x') {
      const hex = s.slice(i + 2, i + 4);
      if (hex.length !== 2 || !/^[0-9a-fA-F]{2}$/.test(hex)) {
        warning ??= '不合法的 \\xHH 序列';
        out += s.slice(i, i + Math.min(4, s.length - i));
        i += Math.min(4, s.length - i);
        continue;
      }
      out += String.fromCharCode(parseInt(hex, 16));
      i += 4;
      continue;
    }
    const direct = DECODE_SHORT[next];
    if (direct !== undefined) {
      out += direct;
      i += 2;
      continue;
    }
    warning ??= `未识别的转义 \\${next}`;
    out += '\\' + next;
    i += 2;
  }
  return { value: out, warning };
}
