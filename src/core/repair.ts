import type { RepairSuggestion, ShutterState, Workspace } from './types';
import { isSatisfiable, solveWorkspace } from './sat';
import { sortByUtf8 } from './utf8';

/**
 * 锁定数不超过该值时才计算修复建议：精确枚举全部撤销子集，
 * 规模上限 2^8 = 256，每个子集一次 O(V+E) 的可满足性判定。
 */
export const MAX_REPAIR_LOCKS = 8;

/**
 * 按字典序枚举 [0, n) 的 size 元下标组合。
 * 调用方将下标映射到按 UTF-8 字节序排好的锁定 ID 数组时，
 * 产出的撤销清单即按「排序后 ID 清单的 UTF-8 逐元素字典序」递增，
 * 因此每个规模下首个可行清单就是并列裁决的胜者。
 */
function* combinations(n: number, size: number): Generator<number[]> {
  if (size < 0 || size > n) return;
  const idx = Array.from({ length: size }, (_, i) => i);
  for (;;) {
    yield [...idx];
    let i = size - 1;
    while (i >= 0 && idx[i] === n - size + i) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < size; j++) idx[j] = idx[j - 1] + 1;
  }
}

/**
 * 对完整规则与锁定集合求精确最少撤销数，给出锁定修复建议。
 *
 * 唯一的修复手段是整把撤销临时锁定：不修改规则、不翻转锁定值、
 * 不沿用旧快门表。流程：
 * 1. 锁定数 > MAX_REPAIR_LOCKS → too-many-locks，不做任何搜索；
 * 2. 全部解锁后仍无解 → rules-conflict，明确报告规则自身冲突，不给假建议；
 * 3. 否则按撤销规模递增枚举子集（同规模按 UTF-8 字典序），
 *    首个使「规则 + 剩余锁定」可满足的子集即精确最少撤销清单，
 *    再由原 2-SAT 求解器给出撤销后的字典序最小完整方案。
 *
 * 规则自身可满足时，撤销全部锁定必然可行，故搜索必然终止于某个清单。
 */
export function computeRepairSuggestion(
  workspace: Workspace,
  locks: Record<string, ShutterState>,
): RepairSuggestion {
  const lockIds = sortByUtf8(Object.keys(locks), (id) => id);
  if (lockIds.length > MAX_REPAIR_LOCKS) {
    return { kind: 'too-many-locks', count: lockIds.length };
  }

  if (!isSatisfiable(workspace, {})) {
    return { kind: 'rules-conflict' };
  }

  for (let size = 0; size <= lockIds.length; size++) {
    for (const picked of combinations(lockIds.length, size)) {
      // 展开复制保持 __proto__ 等特殊 ID 为独立自有属性；delete 只移除自有条目
      const remaining = { ...locks };
      const unlock: Array<{ id: string; state: ShutterState }> = [];
      for (const i of picked) {
        const id = lockIds[i];
        unlock.push({ id, state: locks[id] });
        delete remaining[id];
      }
      if (isSatisfiable(workspace, remaining)) {
        const outcome = solveWorkspace(workspace, remaining);
        if (outcome.kind !== 'sat') {
          // 不应发生：isSatisfiable 与 solveWorkspace 基于同一构图与 Tarjan
          throw new Error('修复复核异常：判定可行但求解器未给出方案');
        }
        return { kind: 'repairable', unlock, outcome };
      }
    }
  }

  // 不可达：上面已验证空锁定可满足，枚举到 size = 全部锁定时必然命中
  throw new Error('修复搜索异常：规则可解却未找到任何可撤销集合');
}
