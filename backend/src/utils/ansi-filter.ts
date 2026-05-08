/**
 * AnsiFilter：识别 Alternate Screen Buffer（备用屏幕）的进入/退出，
 * 并在用户希望时把"alt screen 内的输出"丢弃。
 *
 * 为什么要这样：
 *   Claude Code（以及 vim/htop 等）在启动时会发 `\x1b[?1049h` 进入备用屏幕，
 *   退出时发 `\x1b[?1049l` 还原。备用屏幕主要用来"画一个完整 UI 然后清掉
 *   不污染 history"。但 atr 把 PTY 输出存进 OutputBuffer 用作重连
 *   回放——alt screen 的内容是临时的，重连时回放它没有意义还会盖住 history。
 *
 *   AnsiFilter 让 SessionController 在 alt screen 期间 drop 输出，仍把进入/
 *   退出序列本身保留（让 xterm.js 知道状态切换）。
 *
 * 设计：
 *   - filter(chunk) 返回过滤后字符串
 *   - 跨 chunk 拼接：\x1b 在一 chunk 末尾、[?1049h 在下一 chunk 开头也要识别
 *   - 维护内部 mode = 'normal' | 'alt'
 *   - 只识别 1049（最常见，DECSET/DECRST）；47/1047/1048 也存在但用得少，
 *     不实现以减少误判
 *
 * 上游决策不同：上游（open-claude-remote@0.1.1）的 AlternateScreenFilter
 * **关闭**这个过滤，把 alt screen 内容也存进 buffer——理由是某些用户希望
 * 在重连后看到 vim 的当前画面。我们决定**默认开启**：与 webapp 移动端
 * 的"history 友好滚动"心智一致；用户若需要可通过 config 关闭（阶段 8 暂未
 * 暴露开关，留作 ADR 007 的"未来扩展"）。
 */

/** alt screen 进入序列（DECSET 1049） */
const ALT_ENTER = '\x1b[?1049h';
/** alt screen 退出序列（DECRST 1049） */
const ALT_EXIT = '\x1b[?1049l';
/**
 * Erase Saved Lines / Erase scrollback：CSI 3 J（ED with parameter 3）。
 * Claude Code（基于 ink）在 fullscreen render path 里持续发这个序列清前端
 * scrollback，导致用户在 mobile 上无法 swipe 回看历史。我们 strip 掉它，
 * 让 xterm.js 的 normal buffer scrollback 不被擦。这是 ink 的上游已知行为
 * （gist MagnaCapax/94713fe41f0294ada3c4527ea7ff7ebb）的客户端 workaround。
 *
 * 注意：CSI J 跟 CSI 3 J 不同——CSI J / CSI 0 J 是"擦光标到屏末"，CSI 1 J
 * 是"擦屏首到光标"，CSI 2 J 是"擦整屏（不动 scrollback）"。只有 CSI 3 J
 * 擦 scrollback，是我们要 strip 的目标。CSI ?3 J（带 ?）是 DECRST，跟这个
 * 也不一样，不要误删。
 */
const ERASE_SCROLLBACK_RE = /\x1b\[3J/g;

/** 内部状态机模式 */
export type AnsiFilterMode = 'normal' | 'alt';

export interface AnsiFilterOptions {
  /**
   * 是否 strip CSI 3 J (Erase Saved Lines)，默认 true。
   * 关闭 alt-screen filter 但保留 scrollback strip 是合理组合：用户希望在
   * webapp 看到 vim 当前画面的同时，不被 ink 类应用清掉历史。
   */
  stripEraseScrollback?: boolean;
}

export class AnsiFilter {
  private mode: AnsiFilterMode = 'normal';
  /** 跨 chunk 拼接的前缀缓冲（最长保留 ALT_ENTER 长度 - 1） */
  private pending = '';
  private readonly stripEraseScrollback: boolean;

  constructor(opts: AnsiFilterOptions = {}) {
    this.stripEraseScrollback = opts.stripEraseScrollback ?? true;
  }

  /** 当前是否在 alt screen 内 */
  get currentMode(): AnsiFilterMode {
    return this.mode;
  }

  /**
   * 处理一段 PTY 输出，返回应该被广播 / 写入 buffer 的部分
   *
   * 行为：
   *  - 在 normal 模式下：返回 chunk（含 ALT_ENTER 序列本身），切到 alt 模式
   *  - 在 alt 模式下：丢弃所有内容，仅返回 ALT_EXIT 序列本身（让前端 xterm
   *    退出 alt screen），切回 normal
   */
  filter(chunk: string): string {
    let input = this.pending + chunk;
    this.pending = '';
    let output = '';
    let i = 0;
    while (i < input.length) {
      if (this.mode === 'normal') {
        // 找下一个 ALT_ENTER
        const idx = input.indexOf(ALT_ENTER, i);
        if (idx === -1) {
          // 末尾可能有 ESC 前缀挂着等下一 chunk 拼接
          output += this.cutTrailingEsc(input.slice(i));
          break;
        }
        // 把 ENTER 序列连同前面内容一并输出（让 xterm 知道进 alt）
        output += input.slice(i, idx + ALT_ENTER.length);
        i = idx + ALT_ENTER.length;
        this.mode = 'alt';
      } else {
        // alt mode：找下一个 ALT_EXIT
        const idx = input.indexOf(ALT_EXIT, i);
        if (idx === -1) {
          // 末尾可能有 ESC 前缀挂着等下一 chunk
          this.pending = this.captureTrailingEsc(input.slice(i));
          break;
        }
        // alt 内容被丢弃，仅保留 EXIT 序列本身
        output += ALT_EXIT;
        i = idx + ALT_EXIT.length;
        this.mode = 'normal';
      }
    }
    // Strip CSI 3 J（erase saved lines / scrollback）：Claude Code/ink 等应用
    // 在每次 redraw 前发这个序列清前端 scrollback，导致 mobile swipe 看不到
    // 历史。strip 后 xterm.js normal buffer 的 scrollback 自然累积，用户可滑
    // 动回看。
    // 注意：跨 chunk 拼接已由 ALT_ENTER/ALT_EXIT 路径的 pending 兜底，CSI 3 J
    // 长度仅 4 字节，跨 chunk 概率极低；最坏情况漏一次清屏，下次 chunk 来时
    // 该应用照样会再发一次 redraw 序列覆盖（ink 的 render 是高频）。
    if (this.stripEraseScrollback && output.length > 0) {
      output = output.replace(ERASE_SCROLLBACK_RE, '');
    }
    return output;
  }

  /**
   * 重置状态（用于会话结束等）
   */
  reset(): void {
    this.mode = 'normal';
    this.pending = '';
  }

  /**
   * 把字符串末尾"看起来像未完成的 ALT_ENTER 前缀"截下来挂 pending
   *
   * 示例：'foo\x1b[?1049' 截掉 '\x1b[?1049' 留作下次拼接，否则下一 chunk
   * 来个 'h' 就接不上了。
   *
   * 返回的是"前面那段安全可以输出的内容"。
   */
  private cutTrailingEsc(s: string): string {
    // 检查 \x1b 出现在 s 末尾的位置
    const last = s.lastIndexOf('\x1b');
    if (last === -1) return s;
    const tail = s.slice(last);
    // tail 是不是 ALT_ENTER 的前缀？
    if (ALT_ENTER.startsWith(tail) && tail !== ALT_ENTER) {
      this.pending = tail;
      return s.slice(0, last);
    }
    return s;
  }

  /** alt 模式下用：保留 ALT_EXIT 前缀，否则空字符串（其它内容已被丢弃） */
  private captureTrailingEsc(s: string): string {
    const last = s.lastIndexOf('\x1b');
    if (last === -1) return '';
    const tail = s.slice(last);
    if (ALT_EXIT.startsWith(tail) && tail !== ALT_EXIT) {
      return tail;
    }
    return '';
  }
}
