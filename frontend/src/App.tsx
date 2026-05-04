/**
 * 应用根组件
 *
 * 阶段 0：仅显示骨架占位，验证 React 加载、shared 包可导入、样式生效。
 * 后续阶段会在此挂载 AuthPage / ConsolePage 路由切换。
 */

import { useEffect, useState, type JSX } from 'react';
import { DEFAULT_PORT } from '@ocr/shared';

interface HealthInfo {
  ok: boolean;
  timestamp: string;
  uptime: number;
}

export function App(): JSX.Element {
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then((res) => res.json() as Promise<HealthInfo>)
      .then((data) => {
        if (!cancelled) setHealth(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="app-shell">
      <header className="app-header">
        <h1>Open-Claude-Remote</h1>
        <p className="app-subtitle">阶段 0 · 骨架就绪</p>
      </header>

      <section className="app-status">
        <h2>健康检查</h2>
        {error && <p className="error">连接失败：{error}</p>}
        {!error && !health && <p>请求中…</p>}
        {health && (
          <ul>
            <li>状态：{health.ok ? '✓ ok' : '✗ 异常'}</li>
            <li>时间：{health.timestamp}</li>
            <li>运行：{health.uptime} 秒</li>
          </ul>
        )}
      </section>

      <footer className="app-footer">
        <p>默认端口：{DEFAULT_PORT}</p>
        <p>开发模式：Vite 5173 → Backend {DEFAULT_PORT}</p>
      </footer>
    </main>
  );
}
