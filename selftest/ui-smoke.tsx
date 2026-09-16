/**
 * 组件冒烟测试：用 react-dom/server 把整棵审查应用在多种状态下渲染一遍，
 * 捕获渲染期运行时错误（无需浏览器）。
 */
import React from 'react';
import { renderToString } from 'react-dom/server';
import { initialState, reduce, replay, analyze, canGenerate, docVersions } from '../src/disclosure/engine';
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

// 4. 绕过修复一：手动登记反向页序在各界面原样可见
{
  let state = initialState();
  const log: AppEvent[] = [];
  const step = (evs: AppEvent[]) => {
    log.push(...evs);
    state = evs.reduce(reduce, state);
  };
  step(cmd.importPacket(state, {
    name: 'p.zip',
    docs: [{ key: 'd', title: '《测试文书》', summary: '', versions: [{ label: 'v1', sha: 'h1', pageCount: 30 }] }],
  }, { by: 't' }));
  const docKey = Object.keys(state.docs)[0];
  step(cmd.recordClaim(state, { docKey, version: 'v1', ranges: [{ from: 12, to: 9 }], type: 'privileged', basis: '反向', assertedBy: '我' }, { by: 't' }));
  step(cmd.recordRedaction({ docKey, version: 'v1', ranges: [{ from: 20, to: 15 }], note: '反向遮挡' }, { by: 't' }));

  const docsHtml = renderWith(state, log, 'docs');
  check('文书库显示原始反向页序（p12→p9）', () => docsHtml);
  if (!docsHtml.includes('p12→p9') || !docsHtml.includes('反向')) throw new Error('文书库未保留/标注反向页序');

  const trailHtml = renderWith(state, log, 'trail');
  if (!trailHtml.includes('p12→p9')) throw new Error('操作轨迹未保留原始反向页序');

  const manifestHtml = renderWith(state, log, 'manifest');
  if (!manifestHtml.includes('不能生成披露清单')) throw new Error('反向区间应阻断清单生成');
  if (canGenerate(state).ok) throw new Error('canGenerate 应为 false');
}

// 5. 绕过修复二：拆分形成独立锚点，逐项对齐前门禁关闭
{
  let state = initialState();
  const log: AppEvent[] = [];
  const step = (evs: AppEvent[]) => {
    log.push(...evs);
    state = evs.reduce(reduce, state);
  };
  step(cmd.importPacket(state, {
    name: 'p.zip',
    docs: [{
      key: 'd', title: '《锚点文书》', summary: '',
      versions: [
        { label: 'v2', sha: 'h2', pageCount: 30 },
        { label: 'v1', sha: 'h1', pageCount: 28 },
      ],
      anchors: [{ id: 'anc', doc: 'd', label: '第3条 付款', occurrences: [{ version: 'v2', page: 4 }, { version: 'v2', page: 18 }, { version: 'v1', page: 5 }] }],
    }],
  }, { by: 't' }));
  const docKey = Object.keys(state.docs)[0];
  const before = analyze(state).issues.filter((i) => i.kind === 'anchor_ambiguous');
  if (before.length !== 1) throw new Error('拆分前应有一个锚点歧义问题');

  step(cmd.splitAnchor(state, 'anc', { by: 't' }));
  const children = state.anchors['anc'].splitInto ?? [];
  if (children.length !== 2) throw new Error('应拆分为 2 个独立锚点');
  if (canGenerate(state).ok) throw new Error('拆分后未逐项对齐前不能生成清单');

  const reviewHtml = renderWith(state, log, 'review');
  check('拆分后审查台列出两个独立锚点阻断', () => reviewHtml);
  if (reviewHtml.includes('已拆分') && !reviewHtml.includes('拆分锚点待')) {
    // 不应再出现“点拆分即解除”的旧文案
  }
  if (!reviewHtml.includes('拆分锚点待逐版本对齐确认')) throw new Error('子锚点须显示为待对齐阻断');

  const docsHtml = renderWith(state, log, 'docs');
  if (!docsHtml.includes('第3条 付款 · 一') || !docsHtml.includes('第3条 付款 · 二')) throw new Error('文书库应列出两个独立锚点');

  // 只对齐第一个：仍阻断
  const labels = docVersions(state, docKey).map((f) => f.label);
  const choicesOf = (cid: string) => {
    const c = state.anchors[cid];
    const ch: Record<string, string | null> = {};
    for (const l of labels) ch[l] = c.occurrences.find((o) => o.version === l)?.id ?? null;
    return ch;
  };
  step(cmd.resolveAnchor(state, children[0], choicesOf(children[0]), { by: 't' }));
  if (canGenerate(state).ok) throw new Error('仅对齐一个子锚点时仍应阻断');

  step(cmd.resolveAnchor(state, children[1], choicesOf(children[1]), { by: 't' }));
  if (!canGenerate(state).ok) throw new Error('两个子锚点全部对齐后应可生成');

  // 刷新重放：拆分关系与对齐结论保持
  const restored = replay(log);
  if (restored.anchors['anc'].splitInto?.length !== 2) throw new Error('重放后拆分关系丢失');
  if (!canGenerate(restored).ok) throw new Error('重放后应仍可生成');
  check('拆分→逐项对齐→刷新重放一致', () => renderWith(restored, log, 'review'));
}

console.log(`\n组件冒烟测试全部通过（${n} 个渲染检查）✅`);
