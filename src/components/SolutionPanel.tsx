import type {
  Change,
  EdgeReason,
  ImplicationStep,
  RepairSuggestion,
  ShutterState,
  SolveOutcome,
  Workspace,
} from '../core/types';

interface Props {
  preview: {
    outcome: SolveOutcome;
    repair: RepairSuggestion | null;
    specRev: number;
  } | null;
  stale: boolean;
  changes: Change[];
  workspace: Workspace;
  adopted: boolean;
  /** 修复建议中候选方案相对当前快门表的改动（建议有效时才有内容） */
  repairChanges: Change[];
  onConfirmRepair: () => void;
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

/** 完整方案表：认证结果与修复候选共用，仅靠 testid 前缀区分。 */
function PlanTable({
  orderedIds,
  assignment,
  changes,
  tableTestid,
  rowTestid,
}: {
  orderedIds: string[];
  assignment: Record<string, ShutterState>;
  changes: Change[];
  tableTestid: string;
  rowTestid: (id: string) => string;
}) {
  return (
    <table className="plan-table" data-testid={tableTestid}>
      <thead>
        <tr>
          <th>快门 ID</th>
          <th>方案状态</th>
          <th>当前状态</th>
          <th>改动</th>
        </tr>
      </thead>
      <tbody>
        {orderedIds.map((id) => {
          const to = assignment[id];
          const from = (changes.find((c) => c.id === id)?.from ?? null);
          const isChange = changes.some((c) => c.id === id);
          return (
            <tr key={id} data-testid={rowTestid(id)} className={isChange ? 'row-change' : ''}>
              <td className="mono">{id}</td>
              <td className={`plan-state ${to.toLowerCase()}`}>{to}</td>
              <td className="mono">{from ?? to}</td>
              <td>{isChange ? `${from} → ${to}` : '不变'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ChangesSummary({
  changes,
  summaryTestid,
  chipTestid,
}: {
  changes: Change[];
  summaryTestid: string;
  chipTestid: (id: string) => string;
}) {
  return (
    <div className="changes-summary" data-testid={summaryTestid}>
      {changes.length === 0 ? (
        <span>当前快门表与最小方案完全一致，无需改动。</span>
      ) : (
        <span>
          共 {changes.length} 处改动：
          {changes.map((c) => (
            <span key={c.id} className="change-chip" data-testid={chipTestid(c.id)}>
              {c.id}：{c.from}→{c.to}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

/**
 * 无解结果附带的锁定修复建议。确认按钮仅在建议未过期时渲染
 * （面板整体在过期时已被替换为失效提示，此处再经 App 守卫双保险）。
 */
function RepairSection({
  repair,
  repairChanges,
  onConfirmRepair,
}: {
  repair: RepairSuggestion;
  repairChanges: Change[];
  onConfirmRepair: () => void;
}) {
  if (repair.kind === 'too-many-locks') {
    return (
      <div className="repair-box" data-testid="repair-too-many">
        <h3>锁定修复建议</h3>
        <p className="muted">
          当前锁定 {repair.count} 个，超过精确求解上限（8 个），不提供锁定修复建议。
          请手动减少锁定后重新认证。
        </p>
      </div>
    );
  }
  if (repair.kind === 'rules-conflict') {
    return (
      <div className="repair-box" data-testid="repair-rules-conflict">
        <h3>锁定修复建议</h3>
        <p className="muted">
          即使撤销全部临时锁定，规则集合自身仍然无解：冲突来自规则本身而非值班员锁定。
          不提供锁定修复建议，请修正规则后重新导入。
        </p>
      </div>
    );
  }
  return (
    <div className="repair-box" data-testid="repair-suggestion">
      <h3>锁定修复建议（精确最少撤销）</h3>
      <p className="muted">
        规则本身可满足：最少撤销 {repair.unlock.length} 把临时锁定即可恢复可行
        （并列清单按快门 ID 的 UTF-8 字节序取最小）。修复只整把撤销锁定——
        不修改规则、不翻转锁定值、不沿用旧快门表。
      </p>
      <div className="changes-summary" data-testid="repair-unlock-list">
        {repair.unlock.map((u) => (
          <span key={u.id} className="change-chip unlock-chip" data-testid={`repair-unlock-${u.id}`}>
            撤销 {u.id}={u.state}
          </span>
        ))}
      </div>
      <h4 className="repair-plan-title">
        撤销后的字典序最小完整方案（候选，确认并重新认证后方可采纳）
      </h4>
      <PlanTable
        orderedIds={repair.outcome.orderedIds}
        assignment={repair.outcome.assignment}
        changes={repairChanges}
        tableTestid="repair-plan-table"
        rowTestid={(id) => `repair-plan-row-${id}`}
      />
      <ChangesSummary
        changes={repairChanges}
        summaryTestid="repair-changes-summary"
        chipTestid={(id) => `repair-change-${id}`}
      />
      <div className="repair-actions">
        <button
          type="button"
          className="primary"
          data-testid="confirm-repair"
          onClick={onConfirmRepair}
        >
          确认修复：一次性撤销上述 {repair.unlock.length} 把锁定并重新认证
        </button>
      </div>
    </div>
  );
}

export function SolutionPanel({
  preview,
  stale,
  changes,
  workspace,
  adopted,
  repairChanges,
  onConfirmRepair,
}: Props) {
  if (!preview) {
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

  const { outcome, repair } = preview;

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
        {repair ? (
          <RepairSection
            repair={repair}
            repairChanges={repairChanges}
            onConfirmRepair={onConfirmRepair}
          />
        ) : (
          <p className="muted">
            请修改规则或解除锁定后重新认证；不提供执行稿。
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="result-sat" data-testid="result-sat">
      <h3>✓ 存在可行方案（按 ID 的 UTF-8 字节序、CLOSED 优先的字典序最小完整方案）</h3>
      <PlanTable
        orderedIds={outcome.orderedIds}
        assignment={outcome.assignment}
        changes={changes}
        tableTestid="plan-table"
        rowTestid={(id) => `plan-row-${id}`}
      />
      <ChangesSummary
        changes={changes}
        summaryTestid="changes-summary"
        chipTestid={(id) => `change-${id}`}
      />
      {adopted && (
        <div className="muted">方案已采纳到快门表。</div>
      )}
    </div>
  );
}
