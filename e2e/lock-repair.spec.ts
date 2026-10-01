import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * 锁定修复建议的端到端：
 * 双锁触发无解 → 原冲突闭环与修复建议（最少撤销清单 + 候选方案）同屏
 * → 期间改动锁定使建议过期（确认入口消失、工作区不被改写、不可采纳/导出）
 * → 重新认证 → 确认修复只一次性撤销所列锁定并重新认证
 * → 采纳 → 下载稿与屏幕逐行一致。
 *
 * 期望值均由 2-SAT 求解与修复搜索的确定性逻辑决定，无固定假结论。
 */
test('锁定修复建议：过期建议不改写工作区，确认仅撤销所列锁定并重新认证', async ({ page }) => {
  await page.goto('/');

  // 1. 导入示例工作区
  await page.getByTestId('sample-btn').click();
  await page.getByTestId('import-btn').click();
  await expect(page.getByTestId('import-ok')).toBeVisible();

  // 2. 双锁 S3=CLOSED、S4=CLOSED → 直接违反规则 #2（S3 OPEN OR S4 OPEN），无解
  await page.getByTestId('lock-S3').click();
  await page.getByTestId('lock-S4').click();
  await page.getByTestId('run-certify').click();
  await expect(page.getByTestId('result-unsat')).toBeVisible();

  // 3. 原冲突闭环与修复建议同屏保留
  await expect(page.getByTestId('path-open-to-closed')).toBeVisible();
  await expect(page.getByTestId('path-closed-to-open')).toBeVisible();
  const suggestion = page.getByTestId('repair-suggestion');
  await expect(suggestion).toBeVisible();
  // 最少撤销 1 把；并列 [S3]/[S4] 按 UTF-8 字节序取最小 → 撤销 S3
  await expect(suggestion).toContainText('最少撤销 1 把');
  await expect(page.getByTestId('repair-unlock-S3')).toHaveText('撤销 S3=CLOSED');
  await expect(page.getByTestId('repair-unlock-S4')).toHaveCount(0);
  // 候选方案：撤销 S3 的锁定后仅 S3 必须 OPEN，其余 CLOSED
  await expect(page.getByTestId('repair-plan-row-S1')).toContainText('CLOSED');
  await expect(page.getByTestId('repair-plan-row-S2')).toContainText('CLOSED');
  await expect(page.getByTestId('repair-plan-row-S3')).toContainText('OPEN');
  await expect(page.getByTestId('repair-plan-row-S4')).toContainText('CLOSED');

  // 4. 期间改动锁定（加锁 S1）→ 建议立即过期：
  //    确认入口消失，过期建议不得改写工作区，也不可采纳/导出旧方案
  await page.getByTestId('lock-S1').click();
  await expect(page.getByTestId('stale-warning')).toBeVisible();
  await expect(page.getByTestId('confirm-repair')).toHaveCount(0);
  await expect(page.getByTestId('repair-suggestion')).toHaveCount(0);
  // 三把锁原样保留：过期建议没有撤销任何锁定
  await expect(page.getByTestId('lock-state-S1')).toBeVisible();
  await expect(page.getByTestId('lock-state-S3')).toBeVisible();
  await expect(page.getByTestId('lock-state-S4')).toBeVisible();
  await expect(page.getByTestId('adopt-plan')).toBeDisabled();
  await expect(page.getByTestId('download-plan')).toBeDisabled();

  // 5. 重新认证 → 新建议仍旧撤销 S3（S1 的锁定不影响冲突核心）→ 确认修复
  await page.getByTestId('run-certify').click();
  await expect(page.getByTestId('stale-warning')).toHaveCount(0);
  await expect(page.getByTestId('repair-suggestion')).toBeVisible();
  await expect(page.getByTestId('repair-unlock-S3')).toHaveText('撤销 S3=CLOSED');
  await page.getByTestId('confirm-repair').click();

  // 6. 只一次性撤销 S3：S1、S4 的锁定保留；已重新认证为可行
  await expect(page.getByTestId('lock-state-S3')).toHaveCount(0);
  await expect(page.getByTestId('lock-state-S1')).toBeVisible();
  await expect(page.getByTestId('lock-state-S4')).toBeVisible();
  await expect(page.getByTestId('result-sat')).toBeVisible();
  await expect(page.getByTestId('plan-row-S3')).toContainText('OPEN');
  await expect(page.getByTestId('change-S3')).toHaveText('S3：CLOSED→OPEN');

  // 7. 采纳并下载：与屏幕表逐行一致
  await page.getByTestId('adopt-plan').click();
  await expect(page.getByTestId('adopted-banner')).toBeVisible();
  await expect(page.getByTestId('state-S1-CLOSED')).toBeChecked();
  await expect(page.getByTestId('state-S2-CLOSED')).toBeChecked();
  await expect(page.getByTestId('state-S3-OPEN')).toBeChecked();
  await expect(page.getByTestId('state-S4-CLOSED')).toBeChecked();
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('download-plan').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('shutter-table.txt');
  const filePath = await download.path();
  expect(filePath).toBeTruthy();
  const content = readFileSync(filePath!, 'utf-8');
  expect(content).toBe('S1 CLOSED\nS2 CLOSED\nS3 OPEN\nS4 CLOSED\n');
});
