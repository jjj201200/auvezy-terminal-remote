/**
 * useQrScanner
 *
 * 用浏览器摄像头流 + jsQR 做二维码扫描的 hook。
 *
 * 设计：
 *  - 调用方提供一个 ref 给 <video>；hook 通过 getUserMedia 拿到 stream 注入
 *  - 内部用一个 offscreen <canvas> 把视频帧 putImageData 给 jsQR 解码
 *  - 扫到结果立即调 onResult，由调用方决定停 / 跳转
 *  - 失败路径明确返回错误状态：'permission-denied' / 'unsupported' / 'error'
 *
 * 为什么用 jsQR 而不是 BarcodeDetector：
 *  - BarcodeDetector 在 iOS Safari 完全不支持，全平台一致性差
 *  - jsQR 纯 JS 实现，~50KB gzipped，全平台行为一致
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

export type ScannerStatus =
  | 'idle'
  | 'initializing'
  | 'scanning'
  | 'permission-denied'
  | 'unsupported'
  | 'error';

export interface UseQrScannerOptions {
  /** 扫到二维码内容时回调；返回 true 表示已处理（hook 会自动停止扫描），false 则继续扫 */
  onResult: (text: string) => boolean | void;
  /** 是否启用 —— false 时彻底关闭流（关闭面板后释放摄像头） */
  enabled: boolean;
}

export interface UseQrScannerReturn {
  /** 必须挂到 <video> 上 */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  status: ScannerStatus;
  /** 主动重试（permission-denied / error 后） */
  retry: () => void;
}

/** 扫描间隔：每 ~120ms 解一帧（30fps 太耗电、10fps 拖响应） */
const SCAN_INTERVAL_MS = 120;

export function useQrScanner(opts: UseQrScannerOptions): UseQrScannerReturn {
  const { onResult, enabled } = opts;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastScanRef = useRef<number>(0);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  const [status, setStatus] = useState<ScannerStatus>('idle');
  const [retryToken, setRetryToken] = useState(0);

  const stop = useCallback((): void => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const retry = useCallback((): void => {
    setRetryToken((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!enabled) {
      stop();
      setStatus('idle');
      return;
    }

    // 浏览器能力检查
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      setStatus('unsupported');
      return;
    }

    let cancelled = false;
    setStatus('initializing');

    // 优先后置摄像头（手机上扫码场景）
    const constraints: MediaStreamConstraints = {
      audio: false,
      video: { facingMode: { ideal: 'environment' } },
    };

    navigator.mediaDevices
      .getUserMedia(constraints)
      .then(async (stream) => {
        if (cancelled) {
          for (const t of stream.getTracks()) t.stop();
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        // iOS 需要 playsInline 才不全屏；muted 避免 autoplay 限制
        video.setAttribute('playsinline', 'true');
        video.muted = true;
        try {
          await video.play();
        } catch {
          // 某些浏览器要 user gesture 才 play —— AuthPage 是用户点击后调起，应不会触发
        }
        if (cancelled) return;
        setStatus('scanning');
        scheduleScan();
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const name = (err as { name?: string } | null)?.name ?? '';
        if (
          name === 'NotAllowedError' ||
          name === 'PermissionDeniedError' ||
          name === 'SecurityError'
        ) {
          setStatus('permission-denied');
        } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          setStatus('unsupported');
        } else {
          setStatus('error');
        }
      });

    /** 调度下一帧解码（用 requestAnimationFrame + 节流到 SCAN_INTERVAL_MS） */
    function scheduleScan(): void {
      if (cancelled) return;
      rafRef.current = requestAnimationFrame(tick);
    }

    function tick(now: number): void {
      if (cancelled) return;
      if (now - lastScanRef.current < SCAN_INTERVAL_MS) {
        scheduleScan();
        return;
      }
      lastScanRef.current = now;

      const video = videoRef.current;
      if (!video || video.readyState < 2 /* HAVE_CURRENT_DATA */) {
        scheduleScan();
        return;
      }

      const w = video.videoWidth;
      const h = video.videoHeight;
      if (w === 0 || h === 0) {
        scheduleScan();
        return;
      }

      // 离屏 canvas 复用：每次新建会被 GC 抖动，缓存到 closure 即可
      const canvas = getCanvas(w, h);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        scheduleScan();
        return;
      }
      ctx.drawImage(video, 0, 0, w, h);
      const imageData = ctx.getImageData(0, 0, w, h);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert',
      });
      if (code && code.data) {
        const handled = onResultRef.current(code.data);
        if (handled !== false) {
          stop();
          return;
        }
      }
      scheduleScan();
    }

    return () => {
      cancelled = true;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, retryToken, stop]);

  return { videoRef, status, retry };
}

// 模块级缓存 canvas，避免 hook 卸载重建抖动 —— 同一时刻只有一个 scanner 在跑
let cachedCanvas: HTMLCanvasElement | null = null;
function getCanvas(w: number, h: number): HTMLCanvasElement {
  if (!cachedCanvas) cachedCanvas = document.createElement('canvas');
  if (cachedCanvas.width !== w) cachedCanvas.width = w;
  if (cachedCanvas.height !== h) cachedCanvas.height = h;
  return cachedCanvas;
}
