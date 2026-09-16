/**
 * 组件冒烟测试：用 react-dom/server 把整棵审查应用在多种状态下渲染一遍，
 * 捕获渲染期运行时错误（无需浏览器）。
 */
import React from 'react';
import { renderToString } from 'react-dom/server';
import { initialState, reduce, analyze, canGenerate } from '../src/disclosure/engine';
import * as cmd from '../src/disclosure/commands';
import { demoBatch, packetD } from '../src/disclosure/demo';
import type { AppEvent, ReviewState } from '../src/disclosure/types';
import { unionRanges } from '../src/disclosure/utils';
import Disclosure from '../src/disclosure/Disclosure';

function renderWith(state: ReviewState, log: AppEvent[], initialTab?: 'docs' | 'review' | 'manifest' | 'trail') {
  // 直接构造一个最小 store 对象供组件消费
  const store = {
    state,
    log,
    append: () => undefined,
    importPackets: () => 0,
    clearLog: () => undefined,
  };
  return renderToString(React.createElement(Disclosure, { store: store as never, initialTab }));
}

let n = 0;
function check(name: string, fn: () => string) {
  const html = fn();
  if (!html || html.length < 500) throw new Error(`${name}: 渲染结果过短（${html?.length} 字符）`);
  n++;
  console.log(`  ✓ ${name}（${html.length} 字符）`);
}

function buildState(): { state: ReviewState; log: AppEvent[] } {
  let state = initialState();
  const log: AppEvent[] = [];
  const step = (evs: AppEvent[]) => {
    log.push(...evs);
    state = evs.reduce(reduce, state);
  };
  for (const p of demoBatch) step(cmd.importPacket(state, p, { by: '书记员·林', at: '2026-09-02T01:00:00Z' }));
  return { state, log };
}

console.log('组件 SSR 冒烟测试');

// 1. 空状态
{
  let html = '';
  check('空库状态（无导入）可渲染', () => {
    html = renderWith(initialState(), []);
    return html;
  });
  if (!html.includes('案件披露材料审查') || !html.includes('一键载入演示案卷')) {
    throw new Error('空状态关键文案缺失');
  }
}

// 2. 刚导入 demo（全部阻断问题存在）
{
  const { state, log } = buildState();
  const a = analyze(state);
  const blocking = a.issues.filter((i) => i.severity === 'blocking' && i.status === 'open');
  console.log(`    demo 初始阻断 ${blocking.length} 个：${blocking.map((b) => b.kind).join('、')}`);
  if (canGenerate(state).ok) throw new Error('初始状态不应可生成清单');
  check('导入演示案卷后（阻断态）可渲染', () => renderWith(state, log));
}

// 3. 走完所有处置：合并重叠/相邻、撤回冲突、修正反向、翻转页码、锚点对齐
{
  let { state, log } = buildState();
  const step = (evs: AppEvent[]) => {
    log.push(...evs);
    state = evs.reduce(reduce, state);
  };
  const byKind = (kind: string) => analyze(state).issues.find((i) => i.kind === kind && i.status === 'open');

  const ov = byKind('redaction_overlap')!;
  step(cmd.mergeRedactions(state, ov.actions!.find((x) => x.kind === 'merge_redactions')!.targetIds!, unionRanges(ov.relatedIds!.flatMap((id) => state.redactions[id].ranges)), { by: 't' }));
  const adj = byKind('redaction_adjacent')!;
  step(cmd.mergeRedactions(state, adj.actions!.find((x) => x.kind === 'merge_redactions')!.targetIds!, unionRanges(adj.relatedIds!.flatMap((id) => state.redactions[id].ranges)), { by: 't' }));
  step(cmd.withdrawClaim(state.claims['c-m2'], '撤回', { by: 't' }));
  step(cmd.amendClaim(state.claims['c-e1'], { ranges: [{ from: 9, to: 12 }] }, { by: 't' }));
  step(cmd.confirmPageOrder(byKind('reverse_pages')!.fileId!, { by: 't' }));
  const anchor = state.anchors['anc-art5'];
  step(cmd.resolveAnchor(state, 'anc-art5', {
    v1: anchor.occurrences.find((o) => o.version === 'v1' && o.page === 6)!.id,
    v2: anchor.occurrences.find((o) => o.version === 'v2')!.id,
  }, { by: 't' }));

  const remaining = analyze(state).issues.filter((i) => i.severity === 'blocking' && i.status === 'open');
  if (remaining.length) throw new Error('处置后仍有阻断：' + remaining.map((r) => r.title).join('；'));
  if (!canGenerate(state).ok) throw new Error('处置后应可生成');

  // 生成清单
  step(cmd.generateManifest(state, { id: 'mn-1', at: '2026-09-12T03:00:00Z', by: '书记员·林' }));

  check('全部阻断解决 + 已生成清单后可渲染', () => renderWith(state, log));

  // 撤回主张使清单失效
  step(cmd.withdrawClaim(state.claims['c-a1'], '不再主张', { by: 't' }));
  const html = renderWith(state, log, 'manifest');
  check('撤回导致清单失效后可渲染', () => html);
  if (!html.includes('结论已失效')) throw new Error('界面应显示“结论已失效”');

  // 四个标签页在终态下都可渲染
  for (const t of ['docs', 'review', 'manifest', 'trail'] as const) {
    check(`终态下「${t}」标签可渲染`, () => renderWith(state, log, t));
  }

  // 导入 v0 让锚点旧处置失效
  step(cmd.importPacket(state, packetD, { by: 't', at: '2026-09-13T01:00:00Z' }));
  const reOpen = analyze(state).issues.find((i) => i.kind === 'anchor_ambiguous' && i.status === 'open');
  if (!reOpen) throw new Error('新证据后锚点歧义应重新打开');
  check('补证使旧锚点结论失效后可渲染', () => renderWith(state, log));
}

console.log(`\n组件冒烟测试全部通过（${n} 个渲染检查）✅`);
