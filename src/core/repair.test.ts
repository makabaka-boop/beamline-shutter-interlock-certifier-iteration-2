import { describe, expect, it } from 'vitest';
import type { Rule, ShutterState, Workspace } from './types';
import { computeRepairSuggestion, MAX_REPAIR_LOCKS } from './repair';
import { solveWorkspace } from './sat';
import { compareUtf8 } from './utf8';

/* ---------------- 独立暴力 oracle（不与 repair.ts 共享任何代码） ---------------- */

type Clause = [
  { id: string; state: ShutterState },
  { id: string; state: ShutterState },
];

/** 枚举全部 2ⁿ 个赋值判定可满足性（用 Map 承载，__proto__ 等 ID 也安全）。 */
function satBrute(
  ids: string[],
  clauses: Clause[],
  locks: Record<string, ShutterState>,
): boolean {
  return lexMinBrute(ids, clauses, locks) !== null;
}

/** CLOSED 优先字典序下首个可行赋值；无解为 null。 */
function lexMinBrute(
  ids: string[],
  clauses: Clause[],
  locks: Record<string, ShutterState>,
): Record<string, ShutterState> | null {
  const sorted = [...ids].sort(compareUtf8);
  const n = sorted.length;
  for (let mask = 0; mask < 1 << n; mask++) {
    const a = new Map<string, ShutterState>();
    for (let i = 0; i < n; i++) {
      a.set(sorted[i], ((mask >> (n - 1 - i)) & 1) === 0 ? 'CLOSED' : 'OPEN');
    }
    let ok = true;
    for (const [id, s] of Object.entries(locks)) {
      if (a.get(id) !== s) {
        ok = false;
        break;
      }
    }
    if (ok) {
      for (const [p, q] of clauses) {
        if (a.get(p.id) !== p.state && a.get(q.id) !== q.state) {
          ok = false;
          break;
        }
      }
    }
    if (ok) return Object.fromEntries(a);
  }
  return null;
}

/** 递归枚举全部 size 元子集（与 repair.ts 的组合生成器互不共享实现）。 */
function allSubsets<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  const cur: T[] = [];
  const rec = (start: number) => {
    if (cur.length === size) {
      out.push([...cur]);
      return;
    }
    for (let i = start; i <= items.length - (size - cur.length); i++) {
      cur.push(items[i]);
      rec(i + 1);
      cur.pop();
    }
  };
  rec(0);
  return out;
}

/** 排序后 ID 清单的 UTF-8 逐元素字典序比较。 */
function compareIdLists(a: string[], b: string[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const c = compareUtf8(a[i], b[i]);
    if (c !== 0) return c;
  }
  return a.length - b.length;
}

/**
 * 独立修复 oracle：规则自身无解返回 'rules-conflict'；否则枚举全部撤销子集，
 * 取最小规模，并列时取排序后 ID 清单的 UTF-8 字典序最小者。
 */
function bruteRepair(
  ids: string[],
  clauses: Clause[],
  locks: Record<string, ShutterState>,
): string[] | 'rules-conflict' {
  if (!satBrute(ids, clauses, {})) return 'rules-conflict';
  const lockIds = Object.keys(locks).sort(compareUtf8);
  for (let size = 0; size <= lockIds.length; size++) {
    const winners: string[][] = [];
    for (const subset of allSubsets(lockIds, size)) {
      const remaining = { ...locks };
      for (const id of subset) delete remaining[id];
      if (satBrute(ids, clauses, remaining)) winners.push(subset);
    }
    if (winners.length > 0) {
      winners.sort(compareIdLists);
      return winners[0];
    }
  }
  throw new Error('oracle 异常：规则可解却未找到可撤销集合');
}

/* ---------------- 测试夹具 ---------------- */

const STATES: ShutterState[] = ['OPEN', 'CLOSED'];

function makeRules(
  tuples: Array<[string, ShutterState, string, ShutterState]>,
): Rule[] {
  return tuples.map(([aid, as, bid, bs], index) => ({
    index,
    a: { id: aid, state: as },
    b: { id: bid, state: bs },
    text: `${aid} ${as} OR ${bid} ${bs}`,
  }));
}

function toClauses(
  tuples: Array<[string, ShutterState, string, ShutterState]>,
): Clause[] {
  return tuples.map(([a, as, b, bs]) => [
    { id: a, state: as },
    { id: b, state: bs },
  ]);
}

/* ---------------- 穷举：最小性与并列裁决 ---------------- */

describe('锁定修复建议：n=3 规则子集 × 全部 27 种锁定组合穷举', () => {
  const ids = ['A', 'B', 'C'];
  // 所有合法二元文字组合，共 12 条候选规则
  const candidateDefs: Array<[string, ShutterState, string, ShutterState]> = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      for (const si of STATES) {
        for (const sj of STATES) {
          candidateDefs.push([ids[i], si, ids[j], sj]);
        }
      }
    }
  }
  expect(candidateDefs).toHaveLength(12);

  // 全部锁定组合：每个快门 未锁 / 锁 OPEN / 锁 CLOSED，共 3³ = 27 种
  const lockCombos: Array<Record<string, ShutterState>> = [];
  for (const a of [null, ...STATES]) {
    for (const b of [null, ...STATES]) {
      for (const c of [null, ...STATES]) {
        const locks: Record<string, ShutterState> = {};
        if (a) locks.A = a;
        if (b) locks.B = b;
        if (c) locks.C = c;
        lockCombos.push(locks);
      }
    }
  }
  expect(lockCombos).toHaveLength(27);

  // 与 sat.test.ts 相同的步长抽样 + 全量掩码
  const masks: number[] = [];
  for (let m = 0; m < 1 << candidateDefs.length; m += 7) masks.push(m);
  masks.push((1 << candidateDefs.length) - 1);

  it.each(masks)('规则子集掩码 %#', (mask) => {
    const defs = candidateDefs.filter((_, k) => (mask >> k) & 1);
    const clauses = toClauses(defs);
    const ws: Workspace = { ids: [...ids], rules: makeRules(defs) };
    for (const locks of lockCombos) {
      const suggestion = computeRepairSuggestion(ws, locks);
      const expected = bruteRepair(ids, clauses, locks);

      if (expected === 'rules-conflict') {
        // 规则自身冲突：明确报告，绝不提供撤销清单
        expect(suggestion.kind).toBe('rules-conflict');
        expect(suggestion).toEqual({ kind: 'rules-conflict' });
        continue;
      }

      expect(suggestion.kind).toBe('repairable');
      if (suggestion.kind !== 'repairable') continue;

      const gotIds = suggestion.unlock.map((u) => u.id);
      // 最小性 + 并列裁决：与独立 oracle 选出的清单完全一致
      // （oracle 枚举全部子集取最小规模，再按 UTF-8 字典序取最小清单）
      expect(gotIds).toEqual(expected);
      // 清单按 UTF-8 字节序排列
      expect(gotIds).toEqual([...gotIds].sort(compareUtf8));
      // 只整把撤销：被撤销项的锁定值与原锁定一致，且都属于原锁定集合
      for (const u of suggestion.unlock) {
        expect(Object.prototype.hasOwnProperty.call(locks, u.id)).toBe(true);
        expect(u.state).toBe(locks[u.id]);
      }

      const remaining = { ...locks };
      for (const u of suggestion.unlock) delete remaining[u.id];

      // 撤销后的方案 = 独立暴力枚举的字典序最小完整方案
      const want = lexMinBrute(ids, clauses, remaining);
      expect(want).not.toBeNull();
      expect({ ...suggestion.outcome.assignment }).toEqual(want);
      // 方案完整
      expect(Object.keys(suggestion.outcome.assignment).sort()).toEqual(
        [...ids].sort(),
      );
      // 剩余锁定原样生效：不翻转锁定值
      for (const [id, s] of Object.entries(remaining)) {
        expect(suggestion.outcome.assignment[id]).toBe(s);
      }
      // 与原 2-SAT 求解器在剩余锁定下的结果一致
      const direct = solveWorkspace(ws, remaining);
      expect(direct.kind).toBe('sat');
      if (direct.kind === 'sat') {
        expect(suggestion.outcome.assignment).toEqual(direct.assignment);
        expect(suggestion.outcome.orderedIds).toEqual(direct.orderedIds);
      }
    }
  });
});

/* ---------------- 并列裁决与边界的定向用例 ---------------- */

describe('锁定修复建议：并列裁决与边界', () => {
  it('两组独立冲突最少撤销 2 把，并列取 UTF-8 字典序最小清单', () => {
    // (A OPEN ∨ B OPEN) 与 (C OPEN ∨ D OPEN)，四者全锁 CLOSED。
    // 最少撤销 2 把：{A|B} × {C|D} → 候选 [A,C] [A,D] [B,C] [B,D]，取 [A,C]。
    const ws: Workspace = {
      ids: ['A', 'B', 'C', 'D'],
      rules: makeRules([
        ['A', 'OPEN', 'B', 'OPEN'],
        ['C', 'OPEN', 'D', 'OPEN'],
      ]),
    };
    const s = computeRepairSuggestion(ws, {
      A: 'CLOSED',
      B: 'CLOSED',
      C: 'CLOSED',
      D: 'CLOSED',
    });
    expect(s.kind).toBe('repairable');
    if (s.kind !== 'repairable') return;
    expect(s.unlock).toEqual([
      { id: 'A', state: 'CLOSED' },
      { id: 'C', state: 'CLOSED' },
    ]);
    // 保留的锁定 B、D 原样生效；被撤销的 A、C 由求解器定值
    expect(s.outcome.assignment).toEqual({
      A: 'OPEN',
      B: 'CLOSED',
      C: 'OPEN',
      D: 'CLOSED',
    });
  });

  it('多字节 ID 的并列裁决按 UTF-8 字节序（z < 中）', () => {
    // 中 OPEN ∨ z OPEN，二者均锁 CLOSED：撤销任一即可，取字节序最小者 z。
    // 撤销 z 后 中 仍锁 CLOSED，规则迫使 z=OPEN。
    const ws: Workspace = {
      ids: ['中', 'z'],
      rules: makeRules([['中', 'OPEN', 'z', 'OPEN']]),
    };
    const s = computeRepairSuggestion(ws, { 中: 'CLOSED', z: 'CLOSED' });
    expect(s.kind).toBe('repairable');
    if (s.kind !== 'repairable') return;
    expect(s.unlock).toEqual([{ id: 'z', state: 'CLOSED' }]);
    expect(s.outcome.assignment['中']).toBe('CLOSED');
    expect(s.outcome.assignment['z']).toBe('OPEN');
  });

  it('特殊 ID（__proto__ / OR）参与撤销：清单与方案保持独立自有条目', () => {
    const ws: Workspace = {
      ids: ['__proto__', 'OR'],
      rules: makeRules([['__proto__', 'OPEN', 'OR', 'OPEN']]),
    };
    // __proto__ 必须以自有属性形式锁定（fromEntries）
    const locks: Record<string, ShutterState> = Object.fromEntries(
      [
        ['__proto__', 'CLOSED'],
        ['OR', 'CLOSED'],
      ] as Array<[string, ShutterState]>,
    );
    const s = computeRepairSuggestion(ws, locks);
    // 撤销任一可解；OR(0x4F) < __proto__(0x5F) → 撤销 OR。
    // 撤销后 __proto__ 仍锁 CLOSED，规则迫使 OR=OPEN。
    expect(s.kind).toBe('repairable');
    if (s.kind !== 'repairable') return;
    expect(s.unlock).toEqual([{ id: 'OR', state: 'CLOSED' }]);
    expect(Object.keys(s.outcome.assignment)).toHaveLength(2);
    expect(s.outcome.assignment['__proto__']).toBe('CLOSED');
    expect(s.outcome.assignment['OR']).toBe('OPEN');
  });

  it('修复只整把撤销：可翻转锁值解决时仍给出撤销清单且保留其余锁值', () => {
    // A OPEN ∨ B OPEN；锁 A=CLOSED、B=CLOSED。
    // 若允许翻转锁值，0 把撤销即可“解决”——但这不是合法修复：
    // 最少整把撤销数为 1，且保留的 B=CLOSED 不被翻转。
    const ws: Workspace = {
      ids: ['A', 'B'],
      rules: makeRules([['A', 'OPEN', 'B', 'OPEN']]),
    };
    const s = computeRepairSuggestion(ws, { A: 'CLOSED', B: 'CLOSED' });
    expect(s.kind).toBe('repairable');
    if (s.kind !== 'repairable') return;
    expect(s.unlock).toEqual([{ id: 'A', state: 'CLOSED' }]);
    expect(s.outcome.assignment.A).toBe('OPEN');
    expect(s.outcome.assignment.B).toBe('CLOSED');
  });

  it(`锁定数超过 ${MAX_REPAIR_LOCKS} 不提供建议（即使撤销一把即可解）`, () => {
    const ids = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
    expect(ids.length).toBe(MAX_REPAIR_LOCKS + 1);
    const ws: Workspace = {
      ids,
      rules: makeRules([['A', 'OPEN', 'B', 'OPEN']]),
    };
    const locks: Record<string, ShutterState> = Object.fromEntries(
      ids.map((id): [string, ShutterState] => [id, 'CLOSED']),
    );
    const s = computeRepairSuggestion(ws, locks);
    expect(s).toEqual({ kind: 'too-many-locks', count: MAX_REPAIR_LOCKS + 1 });
  });

  it('全部解锁仍无解 → 明确报告规则自身冲突，不给假建议', () => {
    // 四个子句覆盖 A、B 的全部组合：规则自身无解，与锁定无关
    const ws: Workspace = {
      ids: ['A', 'B'],
      rules: makeRules([
        ['A', 'OPEN', 'B', 'OPEN'],
        ['A', 'OPEN', 'B', 'CLOSED'],
        ['A', 'CLOSED', 'B', 'OPEN'],
        ['A', 'CLOSED', 'B', 'CLOSED'],
      ]),
    };
    const s = computeRepairSuggestion(ws, { A: 'CLOSED' });
    expect(s).toEqual({ kind: 'rules-conflict' });
  });

  it('无锁定时规则自身无解同样报告 rules-conflict', () => {
    const ws: Workspace = {
      ids: ['A', 'B'],
      rules: makeRules([
        ['A', 'OPEN', 'B', 'OPEN'],
        ['A', 'CLOSED', 'B', 'CLOSED'],
        ['A', 'CLOSED', 'B', 'OPEN'],
        ['A', 'OPEN', 'B', 'CLOSED'],
      ]),
    };
    expect(computeRepairSuggestion(ws, {})).toEqual({ kind: 'rules-conflict' });
  });

  it('当前已可满足时最少撤销为 0（空清单），方案即原求解结果', () => {
    const ws: Workspace = { ids: ['A', 'B'], rules: [] };
    const s = computeRepairSuggestion(ws, { A: 'OPEN' });
    expect(s.kind).toBe('repairable');
    if (s.kind !== 'repairable') return;
    expect(s.unlock).toEqual([]);
    expect(s.outcome.assignment).toEqual({ A: 'OPEN', B: 'CLOSED' });
  });
});
