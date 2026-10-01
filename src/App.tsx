import { useMemo, useState } from 'react';
import type { ShutterState, SolveOutcome, Workspace } from './core/types';
import { parseWorkspace } from './core/parser';
import { computeChanges, solveWorkspace } from './core/sat';
import { sortByUtf8 } from './core/utf8';
import { downloadText, serializeTable } from './lib/export';
import { SAMPLE_WORKSPACE } from './lib/sample';
import { cycleLockState, initialTable, toggleLock } from './lib/state';
import { ImportPanel } from './components/ImportPanel';
import { ShutterTable } from './components/ShutterTable';
import { RulesPanel } from './components/RulesPanel';
import { SolutionPanel } from './components/SolutionPanel';

interface Preview {
  outcome: SolveOutcome;
  /** 认证时的规则版本；与当前 specRev 不同则已失效 */
  specRev: number;
}

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [table, setTable] = useState<Record<string, ShutterState>>({});
  const [locks, setLocks] = useState<Record<string, ShutterState>>({});
  /** 规则或锁定每次变化自增：使旧预览立即失效 */
  const [specRev, setSpecRev] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [adopted, setAdopted] = useState(false);

  const orderedIds = useMemo(
    () => (workspace ? sortByUtf8(workspace.ids, (id) => id) : []),
    [workspace],
  );

  const previewStale = preview !== null && preview.specRev !== specRev;

  const handleImport = (text: string): string[] => {
    const result = parseWorkspace(text);
    if (!result.ok || !result.workspace) {
      // 拒绝整份导入，保留当前工作区
      return result.errors;
    }
    setWorkspace(result.workspace);
    setTable(initialTable(result.workspace.ids));
    setLocks({});
    setPreview(null);
    setAdopted(false);
    setSpecRev((r) => r + 1);
    return [];
  };

  const handleToggleLock = (id: string) => {
    // 未锁定时锁定到该快门当前表值，随后可用按钮切换锁定状态
    setLocks((prev) => toggleLock(prev, id, table[id]));
    setSpecRev((r) => r + 1);
  };

  const handleCycleLockState = (id: string) => {
    setLocks((prev) => cycleLockState(prev, id));
    setSpecRev((r) => r + 1);
  };

  const handleSetTable = (id: string, state: ShutterState) => {
    setTable((prev) => ({ ...prev, [id]: state }));
    setAdopted(false);
  };

  const handleRun = () => {
    if (!workspace) return;
    const outcome = solveWorkspace(workspace, locks);
    setPreview({ outcome, specRev });
    setAdopted(false);
  };

  const handleAdopt = () => {
    if (!preview || previewStale || preview.outcome.kind !== 'sat') return;
    setTable({ ...preview.outcome.assignment });
    setAdopted(true);
  };

  const handleDownload = () => {
    if (!workspace || !adopted || previewStale) return;
    downloadText('shutter-table.txt', serializeTable(workspace, table));
  };

  const changes =
    preview && !previewStale && preview.outcome.kind === 'sat'
      ? computeChanges(preview.outcome.orderedIds, preview.outcome.assignment, table)
      : [];

  return (
    <div className="app">
      <header className="app-header">
        <h1>束线快门联锁认证工作台</h1>
        <p className="subtitle">
          离线 2-SAT 蕴含图裁决 · CLOSED 优先字典序最小方案 · 冲突闭环逐条复核
        </p>
      </header>

      {!workspace && (
        <section className="empty-hint" data-testid="empty-state">
          <p>工作区为空。请在下方粘贴或载入示例导入文本，校验通过后即可开始调试。</p>
        </section>
      )}

      <ImportPanel onImport={handleImport} onLoadSample={() => SAMPLE_WORKSPACE} />

      {workspace && (
        <main className="workspace-grid">
          <section className="panel" data-testid="shutter-panel">
            <h2>
              快门表 <span className="count">（{workspace.ids.length}）</span>
            </h2>
            <ShutterTable
              ids={orderedIds}
              table={table}
              locks={locks}
              onSetTable={handleSetTable}
              onToggleLock={handleToggleLock}
              onCycleLockState={handleCycleLockState}
            />
          </section>

          <section className="panel" data-testid="rules-panel">
            <h2>
              联锁规则 <span className="count">（{workspace.rules.length}）</span>
              <span className="rule-semantics">每条规则：两个文字至少一个成立</span>
            </h2>
            <RulesPanel workspace={workspace} />
          </section>

          <section className="panel panel-wide" data-testid="certify-panel">
            <h2>认证</h2>
            <div className="certify-controls">
              <button
                type="button"
                className="primary"
                data-testid="run-certify"
                onClick={handleRun}
              >
                运行认证
              </button>
              <button
                type="button"
                data-testid="adopt-plan"
                onClick={handleAdopt}
                disabled={
                  !preview ||
                  previewStale ||
                  preview.outcome.kind !== 'sat'
                }
              >
                采纳方案
              </button>
              <button
                type="button"
                data-testid="download-plan"
                onClick={handleDownload}
                disabled={!adopted || previewStale}
              >
                下载采纳稿
              </button>
              <span className="lock-summary">
                已锁定 {Object.keys(locks).length} 个快门
                {Object.keys(locks).length > 0 &&
                  `：${sortByUtf8(Object.keys(locks), (id) => id)
                    .map((id) => `${id}=${locks[id]}`)
                    .join('，')}`}
              </span>
            </div>
            {preview && previewStale && (
              <div className="warning" data-testid="stale-warning">
                ⚠ 规则或锁定已变化，此预览已失效，请重新运行认证。
              </div>
            )}
            {adopted && !previewStale && (
              <div className="ok-banner" data-testid="adopted-banner">
                ✓ 方案已采纳，快门表与认证结果一致，可下载执行稿。
              </div>
            )}
            <SolutionPanel
              preview={preview}
              stale={previewStale}
              changes={changes}
              workspace={workspace}
              adopted={adopted}
            />
          </section>
        </main>
      )}

      <footer className="app-footer">
        纯前端离线工作台 · TypeScript + React + Vite · 计算全部在浏览器内完成
      </footer>
    </div>
  );
}
