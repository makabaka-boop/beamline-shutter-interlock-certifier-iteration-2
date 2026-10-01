import type {
  Change,
  EdgeReason,
  ImplicationStep,
  SolveOutcome,
  Workspace,
} from '../core/types';

interface Props {
  preview: { outcome: SolveOutcome; specRev: number } | null;
  stale: boolean;
  changes: Change[];
  workspace: Workspace;
  adopted: boolean;
}

function reasonLabel(reason: EdgeReason, workspace: Workspace): { tag: string; detail: string } {
  if (reason.kind === 'rule') {
    const r = workspace.rules[reason.ruleIndex];
    return {
      tag: `规则 #${reason.ruleIndex}`,
      detail: r.text,
    };
  }
  if (reason.kind === 'lock') {
    return { tag: '锁定', detail: `操作员锁定 ${reason.id} = ${reason.state}` };
  }
  return { tag: '试设', detail: `贪心试设 ${reason.state}` };
}

function PathView({
  title,
  steps,
  workspace,
  testid,
}: {
  title: string;
  steps: ImplicationStep[];
  workspace: Workspace;
  testid: string;
}) {
  return (
    <div className="witness-path" data-testid={testid}>
      <div className="path-title">{title}</div>
      {steps.length === 0 ? (
        <div className="path-step">（空路径：两端为同一文字）</div>
      ) : (
        <ol>
          {steps.map((s, i) => {
            const why = reasonLabel(s.reason, workspace);
            return (
              <li key={i} className="path-step" data-testid={`${testid}-step-${i}`}>
                <span className="mono">
                  {s.from.id}={s.from.state}
                </span>
                <span className="arrow"> ⇒ </span>
                <span className="mono">
                  {s.to.id}={s.to.state}
                </span>
                <span className="reason">
                  依据 [{why.tag}] {why.detail}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export function SolutionPanel({ preview, stale, changes, workspace, adopted }: Props) {  if (!preview) {
    return (
      <p className="muted" data-testid="no-result">
        尚未运行认证。锁定任意快门（可选）后点击「运行认证」。
      </p>
    );
  }
  if (stale) {
    return (
      <div className="result-faded" data-testid="stale-result">
        <p className="muted">（旧结果仅供参考，已被标记为失效。）</p>
      </div>
    );
  }

  const { outcome } = preview;

  if (outcome.kind === 'unsat') {
    const w = outcome.witness;
    return (
      <div className="result-unsat" data-testid="result-unsat">
        <h3>✗ 无可行方案：快门「{w.id}」的 OPEN 与 CLOSED 落在同一强连通分量</h3>
        <p className="muted">
          该快门 ID（{w.id}）是所有“正反文字同 SCC”快门中按 UTF-8 字节序最小者。
          两条蕴含路径构成闭环，每一步均可指回原规则，逐条复核如下：
        </p>
        <PathView
          title={`路径一：假设 ${w.id} 为 OPEN，蕴含它必须 CLOSED（${w.id}=OPEN → ${w.id}=CLOSED）`}
          steps={w.openToClosed}
          workspace={workspace}
          testid="path-open-to-closed"
        />
        <PathView
          title={`路径二：假设 ${w.id} 为 CLOSED，蕴含它必须 OPEN（${w.id}=CLOSED → ${w.id}=OPEN）`}
          steps={w.closedToOpen}
          workspace={workspace}
          testid="path-closed-to-open"
        />
        <p className="muted">
          请修改规则或解除锁定后重新认证；不提供执行稿。
        </p>
      </div>
    );
  }

  return (
    <div className="result-sat" data-testid="result-sat">
      <h3>✓ 存在可行方案（按 ID 的 UTF-8 字节序、CLOSED 优先的字典序最小完整方案）</h3>
      <table className="plan-table" data-testid="plan-table">
        <thead>
          <tr>
            <th>快门 ID</th>
            <th>方案状态</th>
            <th>当前状态</th>
            <th>改动</th>
          </tr>
        </thead>
        <tbody>
          {outcome.orderedIds.map((id) => {
            const to = outcome.assignment[id];
            const from = (changes.find((c) => c.id === id)?.from ?? null);
            const isChange = changes.some((c) => c.id === id);
            return (
              <tr key={id} data-testid={`plan-row-${id}`} className={isChange ? 'row-change' : ''}>
                <td className="mono">{id}</td>
                <td className={`plan-state ${to.toLowerCase()}`}>{to}</td>
                <td className="mono">{from ?? to}</td>
                <td>{isChange ? `${from} → ${to}` : '不变'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="changes-summary" data-testid="changes-summary">
        {changes.length === 0 ? (
          <span>当前快门表与最小方案完全一致，无需改动。</span>
        ) : (
          <span>
            共 {changes.length} 处改动：
            {changes.map((c) => (
              <span key={c.id} className="change-chip" data-testid={`change-${c.id}`}>
                {c.id}：{c.from}→{c.to}
              </span>
            ))}
          </span>
        )}
      </div>
      {adopted && (
        <div className="muted">方案已采纳到快门表。</div>
      )}
    </div>
  );
}
