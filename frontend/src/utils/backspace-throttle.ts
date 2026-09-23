/**
 * 退格发送限速器
 *
 * 背景:键盘长按退格的 repeat 频率约 20-30 次/秒,每次退格一条 ws 消息既
 * 浪费也让远端 TUI 刷新过频。限速到 ~16 次/秒(60ms 窗口):
 *  - 窗口空闲时首次退格**立即**发送(单按零延迟),并开启冷却定时器
 *  - 冷却窗口内的后续退格合并计数,窗口末发一条 '\x7f'×N(数量守恒);
 *    连按时每个窗口末自动续窗,持续限频
 *  - flush() 把挂起立即冲出(不重置冷却,防止 flush+push 双立即超频)——
 *    退格后紧跟插入文本时**必须**先 flush 再发文本,否则挂起的 \x7f
 *    会迟到乱序
 *
 * 纯 setTimeout 状态机驱动,不读 Date.now(便于测试与无时钟环境)。
 */

export interface BackspaceThrottler {
  /** 记录一次(或 N 次)退格;冷却中则并入 pending */
  push(count: number): void;
  /** 立即发送挂起的退格(保序场景用;冷却窗口继续) */
  flush(): void;
  /** 丢弃挂起与定时器(组件卸载) */
  cancel(): void;
}

/**
 * @param send       底层发送通道(最终 onSend)
 * @param intervalMs 冷却窗口长度;默认 60ms(≈16 次/秒)
 */
export function createBackspaceThrottler(
  send: (data: string) => void,
  intervalMs = 60,
): BackspaceThrottler {
  /** 冷却定时器;非 null = 处于冷却窗口 */
  let cooldown: ReturnType<typeof setTimeout> | null = null;
  let pending = 0;

  const emit = (count: number): void => {
    if (count <= 0) return;
    send('\x7f'.repeat(count));
  };

  /** 开启(或续)冷却窗:窗口末有 pending 则合并发出并续窗,否则复位空闲 */
  const startCooldown = (): void => {
    cooldown = setTimeout(() => {
      cooldown = null;
      const n = pending;
      pending = 0;
      if (n > 0) {
        emit(n);
        startCooldown(); // 还有连按在途,续窗继续限频
      }
    }, intervalMs);
  };

  return {
    push(count: number): void {
      if (count <= 0) return;
      if (cooldown === null) {
        // 空闲:立即发,开冷却
        emit(count);
        startCooldown();
        return;
      }
      // 冷却中:并入 pending,窗口末合并发出
      pending += count;
    },
    flush(): void {
      const n = pending;
      pending = 0;
      emit(n);
      // 冷却窗口保持:flush 本身就是一次发送,立即再 push 不应双立即
      if (cooldown === null && n > 0) startCooldown();
    },
    cancel(): void {
      if (cooldown) {
        clearTimeout(cooldown);
        cooldown = null;
      }
      pending = 0;
    },
  };
}
