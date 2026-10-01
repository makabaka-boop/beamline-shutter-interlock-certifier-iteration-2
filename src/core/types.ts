/// <reference types="vite/client" />

export type ShutterState = 'OPEN' | 'CLOSED';

/** 一条文字：某快门处于某状态 */
export interface Literal {
  id: string;
  state: ShutterState;
}

/**
 * 二元规则：两个文字，含义为“至少一个成立”（析取子句）。
 * index 为规则在导入中的序号（从 0 起），text 保留原文便于逐步复核。
 */
export interface Rule {
  index: number;
  a: Literal;
  b: Literal;
  text: string;
}

export interface Workspace {
  ids: string[];
  rules: Rule[];
}

export interface ImportResult {
  ok: boolean;
  errors: string[];
  workspace: Workspace | null;
}

export type ChangeAction = ShutterState;

export interface Change {
  id: string;
  from: ShutterState;
  to: ShutterState;
}

/** 蕴含图上的一条边，并指回其来源规则（或锁定 / 贪心试设） */
export type EdgeReason =
  | { kind: 'rule'; ruleIndex: number }
  | { kind: 'lock'; id: string; state: ShutterState }
  | { kind: 'assume'; i: number; state: ShutterState };

export interface Edge {
  from: number;
  to: number;
  reason: EdgeReason;
}

/** 蕴含路径上的一步：from --(依据)--> to */
export interface ImplicationStep {
  from: Literal;
  to: Literal;
  reason: EdgeReason;
}

export interface ConflictWitness {
  id: string;
  openToClosed: ImplicationStep[];
  closedToOpen: ImplicationStep[];
}

export type SolveOutcome =
  | {
      kind: 'sat';
      assignment: Record<string, ShutterState>;
      orderedIds: string[];
    }
  | {
      kind: 'unsat';
      witness: ConflictWitness;
    };
