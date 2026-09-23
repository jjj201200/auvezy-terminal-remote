/**
 * 输入发送限速器(通用)
 *
 * 背景:键盘 repeat 约 20-30 次/秒,逐键一条 ws 消息既浪费也让远端 TUI
 * 刷新过频。限到 ~16 次/秒(60ms 窗口):
 *  - 窗口空闲时首次输入**立即**发送(单按零延迟),并开启冷却定时器
 *  - 冷却窗口内的后续输入(退格 \x7f / 文本)直接字符串拼接进 pending,
 *    窗口末发一条合并消息——**跨类型交错天然保序**(纯拼接语义)
 *  - flush() 把挂起立即冲出(不重置冷却)——退格后紧跟插入文本等保序
 *    场景**必须**先 flush 再发,否则挂起字节迟到乱序
 *
 * 纯 setTimeout 状态机驱动,不读 Date.now(便于测试与无时钟环境)。
 */

export interface InputThrottler {
  /** 记录一段输入字节(退格/文本任意);冷却中则并入 pending */
  push(data: string): void;
  /** 立即发送挂起的输入(保序场景用;冷却窗口继续) */
  flush(): void;
  /** 丢弃挂起与定时器(组件卸载) */
  cancel(): void;
}

/**
 * @param send       底层发送通道(最终 onSend)
 * @param intervalMs 冷却窗口长度;默认 60ms(≈16 次/秒)
 */
export function createInputThrottler(
  send: (data: string) => void,
  intervalMs = 60,
): InputThrottler {
  /** 冷却定时器;非 null = 处于冷却窗口 */
  let cooldown: ReturnType<typeof setTimeout> | null = null;
  let pending = '';

  const emit = (data: string): void => {
    if (data.length === 0) return;
    send(data);
  };

  /** 开启(或续)冷却窗:窗口末有 pending 则合并发出并续窗,否则复位空闲 */
  const startCooldown = (): void => {
    cooldown = setTimeout(() => {
      cooldown = null;
      const queued = pending;
      pending = '';
      if (queued.length > 0) {
        emit(queued);
        startCooldown(); // 还有连按在途,续窗继续限频
      }
    }, intervalMs);
  };

  return {
    push(data: string): void {
      if (data.length === 0) return;
      if (cooldown === null) {
        // 空闲:立即发,开冷却
        emit(data);
        startCooldown();
        return;
      }
      // 冷却中:拼接进 pending,窗口末合并发出
      pending += data;
    },
    flush(): void {
      const queued = pending;
      pending = '';
      emit(queued);
      // 冷却窗口保持:flush 本身就是一次发送,立即再 push 不应双立即
      if (cooldown === null && queued.length > 0) startCooldown();
    },
    cancel(): void {
      if (cooldown) {
        clearTimeout(cooldown);
        cooldown = null;
      }
      pending = '';
    },
  };
}
