/**
 * 纯逻辑自检（Node 运行）：重复包 / 乱序版本 / 相邻与重叠区间 /
 * 跨版本锚点歧义 / 撤回与变更失效 / 反向页码 / 冲突主张 / 清单阻断
 */
import { strict as assert } from 'node:assert';
import { replay, reduce, analyze, canGenerate, buildManifest, manifestStale, initialState, docVersions, claimLabel } from '../src/disclosure/engine';
import * as cmd from '../src/disclosure/commands';
import type { AppEvent, PacketInput, ReviewState } from '../src/disclosure/types';
import { unionRanges } from '../src/disclosure/utils';

const ME = { by: '书记员·林', at: '2026-09-10T02:00:00.000Z' };
let passed = 0;
function ok(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

function dispatch(state: ReviewState, evs: AppEvent[]): ReviewState {
  return evs.reduce(reduce, state);
}

/* ---------- 包 A：基础材料（v2 先到 = 乱序的第一跳） ---------- */
const packetA: PacketInput = {
  name: '原告材料包-20260901.zip',
  exportedAt: '2026-09-01',
  docs: [
    {
      key: 'contract',
      title: '《采购框架协议》',
      summary: '双方 2023 年签订，含验收与保密条款。',
      versions: [
        { label: 'v2', fileName: '合同_v2终稿.pdf', sha: 'hash-contract-v2', pageCount: 20, pageLabels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20] },
      ],
      claims: [
        { id: 'c-a1', doc: 'contract', version: 'v2', ranges: [{ from: 5, to: 8 }], type: 'confidential', basis: '第12条 价格保密', assertedBy: '原告律师', assertedAt: ME.at },
      ],
      redactions: [
        { id: 'r-a1', doc: 'contract', version: 'v2', ranges: [{ from: 5, to: 8 }], note: '价格明细' },
        // 相邻遮挡（警告，可合并不阻断）
        { id: 'r-a2', doc: 'contract', version: 'v2', ranges: [{ from: 9, to: 10 }], note: '供应商名单' },
      ],
      anchors: [
        { id: 'anc-art5', doc: 'contract', label: '第五条 验收', occurrences: [{ version: 'v2', page: 7 }] },
      ],
    },
    {
      key: 'email',
      title: '往来邮件汇总',
      summary: '项目组 2023–2024 年邮件。',
      versions: [
        // 扫描倒序：页码标签整体递减（文件共 14 页）
        { label: 'v1', fileName: '邮件扫描.pdf', sha: 'hash-email-v1', pageCount: 14, pageLabels: [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1] },
      ],
      claims: [
        { id: 'c-e1', doc: 'email', version: 'v1', ranges: [{ from: 12, to: 9 }], type: 'privileged', basis: '律师工作成果', assertedBy: '原告律师', assertedAt: ME.at },
        { id: 'c-e2', doc: 'email', version: 'v1', ranges: [{ from: 2, to: 3 }], type: 'public', basis: '对方主动公开', assertedBy: '原告律师', assertedAt: ME.at },
      ],
      redactions: [{ id: 'r-e1', doc: 'email', version: 'v1', ranges: [{ from: 1, to: 4 }], note: '法律意见批注' }],
    },
  ],
};

/* ---------- 包 B：与 A 内容完全相同（重复包），换个压缩包名字 ---------- */
const packetBDup: PacketInput = JSON.parse(JSON.stringify(packetA));
packetBDup.name = '原告材料包-再发一次.zip';

/* ---------- 包 C：更旧的 v1 后到（乱序第二跳）+ 锚点歧义 + 冲突主张 + 遮挡重叠 ---------- */
const packetC: PacketInput = {
  name: '原告材料包-补充.zip',
  exportedAt: '2026-09-05',
  docs: [
    {
      key: 'contract',
      title: '《采购框架协议》', // 同名文书 -> 归并
      summary: '双方 2023 年签订，含验收与保密条款。',
      versions: [{ label: 'v1', fileName: '合同_v1初稿.pdf', sha: 'hash-contract-v1', pageCount: 18 }],
      // v1 中“第五条 验收”命中两处 -> 跨版本锚点歧义；v2 只有一处
      anchors: [
        {
          id: 'anc-art5',
          doc: 'contract',
          label: '第五条 验收',
          occurrences: [
            { version: 'v1', page: 6 },
            { version: 'v1', page: 15 },
          ],
        },
      ],
    },
    {
      key: 'meeting',
      title: '会议纪要（6月）',
      summary: '评标会议纪要。',
      versions: [{ label: 'v3', fileName: '纪要_v3.pdf', sha: 'hash-meeting-v3', pageCount: 10 }],
      claims: [
        { id: 'c-m1', doc: 'meeting', version: 'v3', ranges: [{ from: 3, to: 5 }], type: 'confidential', basis: '评标信息', assertedBy: '原告律师', assertedAt: ME.at },
        // 与 c-m1 在 p4 冲突：保密 vs 公开
        { id: 'c-m2', doc: 'meeting', version: 'v3', ranges: [{ from: 4, to: 4 }], type: 'public', basis: '纪要已在另案公开', assertedBy: '被告代理', assertedAt: ME.at },
      ],
      redactions: [
        { id: 'r-m1', doc: 'meeting', version: 'v3', ranges: [{ from: 3, to: 5 }], note: '评标打分' },
        // 与 r-m1 重叠 p4-5（阻断）
        { id: 'r-m2', doc: 'meeting', version: 'v3', ranges: [{ from: 4, to: 6 }], note: '评委姓名' },
      ],
    },
  ],
};

function kinds(result: ReturnType<typeof analyze>) {
  return result.issues.map((i) => `${i.kind}:${i.status}`).sort();
}

/* ================= 场景 1：重复包自动归并 ================= */
console.log('场景 1 · 重复包自动归并');
let s = initialState();
s = dispatch(s, cmd.importPacket(s, packetA, { ...ME, at: '2026-09-02T01:00:00Z' }));
ok('首次导入：2 个文件、2 份文书、3 条主张、3 条遮挡', () => {
  assert.equal(Object.keys(s.files).length, 2);
  assert.equal(Object.keys(s.docs).length, 2);
  assert.equal(Object.values(s.claims).filter((c) => c.active).length, 3);
  assert.equal(Object.values(s.redactions).filter((r) => r.active).length, 3);
});
const beforeB = { files: Object.keys(s.files).length, claims: Object.keys(s.claims).length };
s = dispatch(s, cmd.importPacket(s, packetBDup, { ...ME, at: '2026-09-02T03:00:00Z' }));
ok('重复包：不新增任何文件/主张/遮挡，且记录 duplicateOf', () => {
  assert.equal(Object.keys(s.files).length, beforeB.files);
  assert.equal(Object.keys(s.claims).length, beforeB.claims);
  const imp = s.imports[1];
  assert.ok(imp.duplicateOf, '应标记为重复包');
  assert.equal(imp.dedupedFiles.length, 2);
  assert.equal(imp.addedFiles.length, 0);
});
ok('重复包产生一条 info 级 duplicate_packet 问题，不阻断', () => {
  const a = analyze(s);
  const dp = a.issues.filter((i) => i.kind === 'duplicate_packet');
  assert.equal(dp.length, 1);
  assert.equal(dp[0].severity, 'info');
});
ok('同名文件包若新增主张，不视为重复包：文件去重、仅并入新主张', () => {
  const packetBWithClaim: PacketInput = JSON.parse(JSON.stringify(packetA));
  packetBWithClaim.name = '原告材料包-补充主张.zip';
  packetBWithClaim.docs[0].claims!.push({
    id: 'c-a3',
    doc: 'contract',
    version: 'v2',
    ranges: [{ from: 11, to: 11 }],
    type: 'public',
    basis: '第 11 页为公开通知',
    assertedBy: '原告律师',
    assertedAt: ME.at,
  });
  s = dispatch(s, cmd.importPacket(s, packetBWithClaim, { ...ME, at: '2026-09-02T04:00:00Z' }));
  const imp = s.imports[2];
  assert.equal(imp.duplicateOf, undefined);
  assert.equal(imp.addedFiles.length, 0);
  assert.equal(imp.dedupedFiles.length, 2);
  assert.equal(imp.addedClaims, 1);
  assert.ok(s.claims['c-a3'] && s.claims['c-a3'].active);
});

/* ================= 场景 2：乱序版本自动归并 ================= */
console.log('场景 2 · 乱序版本归并');
s = dispatch(s, cmd.importPacket(s, packetC, { ...ME, at: '2026-09-06T01:00:00Z' }));
ok('更旧的 v1 后到：并入同一文书，不新建文书；合同现有 2 个版本', () => {
  assert.equal(Object.keys(s.docs).length, 3); // 新增 meeting
  const contract = Object.values(s.docs).find((d) => d.key === 'doc_key_contract' || d.title.includes('采购框架'))!;
  const vs = docVersions(s, contract.key).map((f) => f.label);
  assert.deepEqual(vs, ['v2', 'v1']); // 按版本新旧排序，与到达次序无关
});
ok('产生 out_of_order 信息问题（v1 比 v2 旧却后到）', () => {
  const a = analyze(s);
  const oo = a.issues.filter((i) => i.kind === 'out_of_order');
  assert.equal(oo.length, 1);
  assert.equal(oo[0].severity, 'info');
  assert.match(oo[0].title, /乱序/);
});

/* ================= 问题总览：阻断项齐全，清单不能生成 ================= */
console.log('场景 3 · 阻断校验：未解决时不能生成披露清单');
let analysis = analyze(s);
ok('四类阻断问题均被标出：反向页码 / 反向区间 / 冲突主张 / 遮挡重叠 / 锚点歧义', () => {
  const k = new Set(analysis.issues.map((i) => i.kind));
  assert.ok(k.has('reverse_pages'), '反向页码文件');
  assert.ok(k.has('range_reversed'), '反向区间 12→9');
  assert.ok(k.has('conflicting_claims'), '同一文件冲突主张');
  assert.ok(k.has('redaction_overlap'), '遮挡重叠');
  assert.ok(k.has('anchor_ambiguous'), '跨版本锚点歧义');
});
ok('相邻遮挡 p5-8 ｜ p9-10 标为 warning（非阻断）', () => {
  const adj = analysis.issues.filter((i) => i.kind === 'redaction_adjacent');
  assert.equal(adj.length, 1);
  assert.equal(adj[0].severity, 'warning');
  assert.match(adj[0].title, /相邻/);
});
ok('canGenerate = false，且阻断清单非空', () => {
  const g = canGenerate(s);
  assert.equal(g.ok, false);
  assert.ok(g.blocking.length >= 5);
});
let buildFailed = false;
try {
  // 即使直接调用 buildManifest 之前，UI 必须先看 canGenerate；这里验证阻断数量
  assert.ok(canGenerate(s).blocking.length > 0);
} catch {
  buildFailed = true;
}
assert.equal(buildFailed, false);

/* ================= 场景 4a：处置相邻与重叠区间 ================= */
console.log('场景 4 · 相邻与重叠遮挡处置');
// 先处理重叠：合并 r-m1/r-m2（并集 p3-6）
const overlapIssue = analyze(s).issues.find((i) => i.kind === 'redaction_overlap' && i.status === 'open')!;
const mergeAction = overlapIssue.actions!.find((a) => a.kind === 'merge_redactions')!;
s = dispatch(s, cmd.mergeRedactions(s, mergeAction.targetIds!, [{ from: 3, to: 6 }], { ...ME, at: '2026-09-10T05:00:00Z' }));
ok('重叠遮挡合并后：两条旧遮挡 inactive，新遮挡为并集 p3-6，重叠问题消失', () => {
  const ids = mergeAction.targetIds!;
  assert.ok(ids.every((id) => !s.redactions[id].active));
  assert.equal(s.redactions[ids[0]].mergedInto, s.redactions[ids[1]].mergedInto);
  assert.deepEqual(unionRanges(s.redactions[s.redactions[ids[0]].mergedInto!].ranges), [{ from: 3, to: 6 }]);
  assert.equal(analyze(s).issues.filter((i) => i.kind === 'redaction_overlap' && i.status === 'open').length, 0);
});
// 相邻：合并 r-a1/r-a2
const adjIssue = analyze(s).issues.find((i) => i.kind === 'redaction_adjacent' && i.status === 'open')!;
const adjAction = adjIssue.actions!.find((a) => a.kind === 'merge_redactions')!;
s = dispatch(s, cmd.mergeRedactions(s, adjAction.targetIds!, [{ from: 5, to: 10 }], { ...ME, at: '2026-09-10T05:10:00Z' }));
ok('相邻遮挡合并为 p5-10，相邻问题消失', () => {
  assert.equal(analyze(s).issues.filter((i) => i.kind === 'redaction_adjacent' && i.status === 'open').length, 0);
});

/* ================= 场景 4b：冲突主张——撤回其一 ================= */
console.log('场景 5 · 撤回主张：旧结论立即失效');
const conflict = analyze(s).issues.find((i) => i.kind === 'conflicting_claims' && i.status === 'open')!;
const withdrawPublic = conflict.actions!.find((a) => a.kind === 'withdraw_claim' && a.targetId === 'c-m2')!;
s = dispatch(s, cmd.withdrawClaim(s.claims[withdrawPublic.targetId!], '公开主张另案核实不成立，撤回', { ...ME, at: '2026-09-10T06:00:00Z' }));
ok('撤回公开主张后该主张 inactive 且带撤回原因，冲突问题消失', () => {
  assert.equal(s.claims['c-m2'].active, false);
  assert.match(s.claims['c-m2'].withdrawnReason!, /撤回/);
  assert.equal(analyze(s).issues.filter((i) => i.kind === 'conflicting_claims' && i.status === 'open').length, 0);
});

/* ---------- 反向区间：先“错误地接受”，再修主张，验证旧结论失效 ---------- */
const revRangeIssue = analyze(s).issues.find((i) => i.kind === 'range_reversed' && i.status === 'open')!;
s = dispatch(s, cmd.acceptIssue(revRangeIssue.key, revRangeIssue.sig, '误操作：先登记接受', { ...ME, at: '2026-09-10T06:20:00Z' }));
ok('登记处置后问题状态为 accepted', () => {
  const again = analyze(s).issues.find((i) => i.key === revRangeIssue.key)!;
  assert.equal(again.status, 'accepted');
});
// 变更主张：区间修正为 9-12（原来误登 12→9）
s = dispatch(
  s,
  cmd.amendClaim(s.claims['c-e1'], { ranges: [{ from: 9, to: 12 }], basis: '律师工作成果（修正页码）' }, { ...ME, at: '2026-09-10T06:30:00Z' }),
);
ok('变更主张后：rev 增加、轨迹保留；旧接受立即失效（stale），反向问题因区间已正而消失', () => {
  assert.equal(s.claims['c-e1'].rev, 2);
  assert.equal(s.claims['c-e1'].history.length, 2);
  assert.equal(s.claims['c-e1'].history[1].kind, 'amend');
  const gone = analyze(s).issues.find((i) => i.key === revRangeIssue.key);
  assert.ok(!gone || gone.status === 'stale' || !gone);
});

/* ================= 反向页码文件：确认翻转 ================= */
const revPages = analyze(s).issues.find((i) => i.kind === 'reverse_pages' && i.status === 'open')!;
ok('反向页码问题指向邮件扫描件，且给出翻转动作', () => {
  assert.match(revPages.detail, /递减/);
  assert.equal(revPages.actions![0].kind, 'confirm_order');
});
s = dispatch(s, cmd.confirmPageOrder(revPages.fileId!, { ...ME, at: '2026-09-10T06:40:00Z' }));
ok('确认翻转后反向页码问题消失', () => {
  assert.equal(analyze(s).issues.filter((i) => i.kind === 'reverse_pages' && i.status === 'open').length, 0);
});

/* ================= 场景 6：跨版本锚点歧义 ================= */
console.log('场景 6 · 跨版本锚点歧义处置');
const anchorIssue = analyze(s).issues.find((i) => i.kind === 'anchor_ambiguous' && i.status === 'open')!;
ok('锚点问题同时描述“同版本多处”与缺失情况', () => {
  assert.match(anchorIssue.detail, /v1/);
  assert.match(anchorIssue.detail, /多处|p6\/p15/);
});
const anc = s.anchors['anc-art5'];
const v1occ = anc.occurrences.filter((o) => o.version === 'v1');
const v2occ = anc.occurrences.filter((o) => o.version === 'v2');
// 误选一次：v1 选 p15
s = dispatch(
  s,
  cmd.resolveAnchor(s, 'anc-art5', { v1: v1occ.find((o) => o.page === 15)!.id, v2: v2occ[0].id }, { ...ME, at: '2026-09-10T07:00:00Z' }),
);
ok('逐版本指定后歧义阻断消失', () => {
  assert.equal(analyze(s).issues.filter((i) => i.kind === 'anchor_ambiguous' && i.status === 'open').length, 0);
});
// 新证据到达：v0 更旧版本（乱序）补入，且没有该锚点 -> 旧选择证据不足，须重新处置
const packetD: PacketInput = {
  name: '更旧底稿.zip',
  docs: [
    {
      key: 'contract',
      title: '《采购框架协议》',
      summary: '',
      versions: [{ label: 'v0', fileName: '合同底稿.pdf', sha: 'hash-contract-v0', pageCount: 12 }],
    },
  ],
};
s = dispatch(s, cmd.importPacket(s, packetD, { ...ME, at: '2026-09-11T01:00:00Z' }));
ok('新版本进入后未覆盖的版本使旧锚点处置失效，歧义重新变为 open', () => {
  const again = analyze(s).issues.find((i) => i.kind === 'anchor_ambiguous');
  assert.ok(again && again.status === 'open', '旧处置应因证据变化失效');
});
// 完成处置：v1=6（正确处），v2 保持，v0 显式确认无此锚点
s = dispatch(
  s,
  cmd.resolveAnchor(
    s,
    'anc-art5',
    {
      v0: null,
      v1: v1occ.find((o) => o.page === 6)!.id,
      v2: v2occ[0].id,
    },
    { ...ME, at: '2026-09-11T02:00:00Z' },
  ),
);
ok('补全（含显式标注 v0 无锚点）后歧义消除', () => {
  assert.equal(analyze(s).issues.filter((i) => i.kind === 'anchor_ambiguous' && i.status === 'open').length, 0);
});

/* ================= 清单生成 + 撤回导致旧清单失效 ================= */
console.log('场景 7 · 披露清单生成与失效');
// 剩余非阻断：claim_uncovered / redaction_unfounded 等警告；先查看
const remain = analyze(s).issues;
const blocking = remain.filter((i) => i.severity === 'blocking' && i.status === 'open');
ok('此时无阻断项，可以生成', () => {
  assert.equal(blocking.length, 0, '剩余阻断: ' + blocking.map((b) => b.title).join('；'));
  assert.equal(canGenerate(s).ok, true);
});
const m1 = buildManifest(s, { id: 'mn-1', at: '2026-09-11T03:00:00Z', by: ME.by });
s = dispatch(s, [{ id: 'ev-manifest-1', type: 'disclosure.generated', at: '2026-09-11T03:00:00Z', by: ME.by, manifest: m1 }]);
ok('清单按版本输出：合同 v2/v1/v0 各有条目；保密页从公开页剔除', () => {
  const contractEntry = m1.entries.find((e) => e.version === 'v2')!;
  assert.equal(contractEntry.status, 'partial');
  // v2: 遮挡合并为 p5-10 -> 公开页不含 5-10
  const disclosedFlat = contractEntry.disclosedPages.flatMap((r) => Array.from({ length: r.to - r.from + 1 }, (_, k) => k + r.from));
  assert.ok(!disclosedFlat.includes(5) && !disclosedFlat.includes(10));
  assert.ok(disclosedFlat.includes(1) && disclosedFlat.includes(20));
  assert.ok(m1.entries.some((e) => e.version === 'v0'));
});
ok('刚生成的清单视为有效（未失效）', () => {
  assert.equal(manifestStale(s, m1), false);
});
// 撤回合同上的保密主张 c-a1 -> 公开页集合改变 -> 清单失效
s = dispatch(s, cmd.withdrawClaim(s.claims['c-a1'], '价格信息庭审后不再主张保密', { ...ME, at: '2026-09-12T01:00:00Z' }));
ok('撤回主张后旧清单立即 stale；且相关遮挡转为“无主张支撑”警告', () => {
  assert.equal(manifestStale(s, m1), true);
  const a = analyze(s);
  assert.ok(a.issues.some((i) => i.kind === 'redaction_unfounded'));
});
// 重新生成
assert.equal(canGenerate(s).ok, true, '警告不阻断重新生成');
const m2 = buildManifest(s, { id: 'mn-2', at: '2026-09-12T02:00:00Z', by: ME.by });
ok('新清单签名不同，v2 合同此前的保密遮挡页情况已变化', () => {
  assert.notEqual(m2.sig, m1.sig);
});

/* ================= 刷新保留完整轨迹：事件日志可重放 ================= */
console.log('场景 8 · 刷新重放保留完整轨迹');
const events = s.events ?? [];
// 上面的手动 dispatch 没有收集事件；这里重新完整走一遍命令序列来验证可重放性
function buildByReplay(): ReviewState {
  let t = initialState();
  const log: AppEvent[] = [];
  const step = (evs: AppEvent[]) => {
    log.push(...evs);
    t = dispatch(t, evs);
  };
  step(cmd.importPacket(t, packetA, { ...ME, at: '2026-09-02T01:00:00Z' }));
  step(cmd.importPacket(t, packetBDup, { ...ME, at: '2026-09-02T03:00:00Z' }));
  step(cmd.importPacket(t, packetC, { ...ME, at: '2026-09-06T01:00:00Z' }));
  let an = analyze(t);
  const ov = an.issues.find((i) => i.kind === 'redaction_overlap')!;
  step(cmd.mergeRedactions(t, ov.actions!.find((x) => x.kind === 'merge_redactions')!.targetIds!, [{ from: 3, to: 6 }], { ...ME, at: '2026-09-10T05:00:00Z' }));
  const ad = analyze(t).issues.find((i) => i.kind === 'redaction_adjacent')!;
  step(cmd.mergeRedactions(t, ad.actions!.find((x) => x.kind === 'merge_redactions')!.targetIds!, [{ from: 5, to: 10 }], { ...ME, at: '2026-09-10T05:10:00Z' }));
  const cf = analyze(t).issues.find((i) => i.kind === 'conflicting_claims')!;
  step(cmd.withdrawClaim(t.claims['c-m2'], '公开主张撤回', { ...ME, at: '2026-09-10T06:00:00Z' }));
  void cf;
  step(cmd.amendClaim(t.claims['c-e1'], { ranges: [{ from: 9, to: 12 }] }, { ...ME, at: '2026-09-10T06:30:00Z' }));
  const rp = analyze(t).issues.find((i) => i.kind === 'reverse_pages')!;
  step(cmd.confirmPageOrder(rp.fileId!, { ...ME, at: '2026-09-10T06:40:00Z' }));
  const aa0 = analyze(t).issues.find((i) => i.kind === 'anchor_ambiguous')!;
  const anchor = t.anchors['anc-art5'];
  step(
    cmd.resolveAnchor(t, 'anc-art5', {
      v1: anchor.occurrences.find((o) => o.version === 'v1' && o.page === 6)!.id,
      v2: anchor.occurrences.find((o) => o.version === 'v2')!.id,
    }, { ...ME, at: '2026-09-11T02:00:00Z' }),
  );
  void aa0;
  step(cmd.importPacket(t, packetD, { ...ME, at: '2026-09-11T01:00:00Z' }));
  const anchor2 = t.anchors['anc-art5'];
  step(
    cmd.resolveAnchor(t, 'anc-art5', {
      v0: null,
      v1: anchor2.occurrences.find((o) => o.version === 'v1' && o.page === 6)!.id,
      v2: anchor2.occurrences.find((o) => o.version === 'v2')!.id,
    }, { ...ME, at: '2026-09-11T02:30:00Z' }),
  );
  step(cmd.withdrawClaim(t.claims['c-a1'], '不再主张', { ...ME, at: '2026-09-12T01:00:00Z' }));
  step(cmd.generateManifest(t, { id: 'mn-r', at: '2026-09-12T02:00:00Z', by: ME.by }));
  return { t, log };
}
// 重放依赖 store 收集事件；这里直接用逐步构建的状态验证终态一致
const built = buildByReplay();
const replayed = built.t;
ok('终态：撤回的主张均 inactive，归并文书数正确', () => {
  assert.equal(replayed.claims['c-m2'].active, false);
  assert.equal(replayed.claims['c-a1'].active, false);
  assert.equal(Object.keys(replayed.docs).length, 3);
});
ok('终态仍可生成清单（警告不阻断），且与直接构建的 open 阻断数同为 0', () => {
  assert.equal(analyze(replayed).issues.filter((i) => i.severity === 'blocking' && i.status === 'open').length, 0);
  assert.equal(canGenerate(replayed).ok, true);
});
ok('撤回主张保留原因与时间；变更主张保留两条历史快照', () => {
  assert.equal(replayed.claims['c-a1'].withdrawnReason, '不再主张');
  assert.equal(replayed.claims['c-e1'].history.filter((h) => h.kind === 'amend').length, 1);
  assert.equal(replayed.claims['c-e1'].history.length, 2);
});

/* ---------- 真正的“刷新重放”：只保留事件日志，重建出完整状态 ---------- */
console.log('场景 9 · 仅靠事件日志重建（模拟刷新后 localStorage 重放）');
ok('事件日志按时间顺序记录了全部命令（≥ 10 条）', () => {
  assert.ok(built.log.length >= 10, `实际 ${built.log.length} 条`);
});
const restored = replay(built.log);
const sig = (st: ReviewState) =>
  JSON.stringify({
    docs: Object.keys(st.docs).sort(),
    files: Object.values(st.files).map((f) => `${f.docKey}:${f.label}:${f.arriveSeq}`).sort(),
    claims: Object.values(st.claims).map((c) => `${c.id}:${c.active ? 'a' : 'x'}:${c.rev}:${c.withdrawnReason ?? ''}`).sort(),
    reds: Object.values(st.redactions).map((r) => `${r.id}:${r.active ? 'a' : 'x'}:${r.mergedInto ?? ''}`).sort(),
    anchors: Object.values(st.anchors).map((a) => `${a.id}:${a.occurrences.length}:${a.resolution?.kind ?? '-'}`).sort(),
    imports: st.imports.map((i) => `${i.packetId}:${i.duplicateOf ?? ''}`),
    manifests: st.manifests.map((m) => `${m.id}:${m.sig}`),
  });
ok('重放后的状态与逐步构建的终态完全一致（文件/主张/遮挡/锚点/清单）', () => {
  assert.equal(sig(restored), sig(replayed));
});
ok('重放状态无 open 阻断项，且撤回轨迹仍在', () => {
  assert.equal(canGenerate(restored).ok, true);
  assert.equal(restored.claims['c-m2'].active, false);
  assert.equal(restored.manifests.length, 1);
});
void events;
void claimLabel;

/* ================= 场景 10：UI 处置原语补充（同标签异内容 / 拆分锚点 / 遮挡更正 / 警告失效） ================= */
console.log('场景 10 · 其余处置原语');
{
  let u = initialState();
  const pk1: PacketInput = {
    name: '包X.zip',
    docs: [
      {
        key: 'x',
        title: '《技术规格书》',
        summary: '',
        versions: [{ label: 'v1', sha: 'sha-x-1', pageCount: 10, fileName: '规格A.pdf' }],
        anchors: [{ id: 'anc-x', doc: 'x', label: '附录B 接口', occurrences: [{ version: 'v1', page: 9 }] }],
      },
    ],
  };
  u = dispatch(u, cmd.importPacket(u, pk1, { ...ME, at: '2026-09-13T01:00:00Z' }));
  const pk2: PacketInput = {
    name: '包Y.zip',
    docs: [
      {
        key: 'x',
        title: '《技术规格书》',
        summary: '',
        // 同标签 v1、不同哈希 -> 版本冲突
        versions: [{ label: 'v1', sha: 'sha-x-2', pageCount: 10, fileName: '规格B.pdf' }],
        // 同锚点在 v1 又出现一处 -> 歧义
        anchors: [{ id: 'anc-x', doc: 'x', label: '附录B 接口', occurrences: [{ version: 'v1', page: 3 }] }],
        claims: [
          { id: 'cx1', doc: 'x', version: 'v1', ranges: [{ from: 2, to: 4 }], type: 'confidential', basis: '接口参数', assertedBy: '原告律师', assertedAt: ME.at },
        ],
        redactions: [{ id: 'rx1', doc: 'x', version: 'v1', ranges: [{ from: 9, to: 5 }], note: '反向登记' }],
      },
    ],
  };
  u = dispatch(u, cmd.importPacket(u, pk2, { ...ME, at: '2026-09-13T02:00:00Z' }));
  const an1 = analyze(u);
  assert.ok(an1.issues.some((i) => i.kind === 'version_conflict' && i.status === 'open'), '同标签异内容应阻断');
  assert.ok(an1.issues.some((i) => i.kind === 'anchor_ambiguous'), '新增同版本双锚点应歧义');
  assert.ok(an1.issues.some((i) => i.kind === 'range_reversed' && i.relatedIds?.includes('rx1')), '反向遮挡区间应标出');

  // 重新标记其中一个文件 -> 冲突解除
  const vc = an1.issues.find((i) => i.kind === 'version_conflict')!;
  const targetId = vc.relatedIds!.find((id) => u.files[id].sha === 'sha-x-2')!;
  u = dispatch(u, cmd.relabelVersion(targetId, 'v1', 'v1-修订', { ...ME, at: '2026-09-13T03:00:00Z' }));
  assert.equal(analyze(u).issues.filter((i) => i.kind === 'version_conflict' && i.status === 'open').length, 0, '重标后冲突解除');

  // 遮挡反向：一键交换起止
  const rr = analyze(u).issues.find((i) => i.kind === 'range_reversed' && i.relatedIds?.includes('rx1'))!;
  const fixAction = rr.actions!.find((a) => a.kind === 'fix_range')!;
  u = dispatch(u, cmd.amendRedaction(u.redactions[fixAction.targetId!], [{ from: 5, to: 9 }], { ...ME, at: '2026-09-13T03:10:00Z' }));
  assert.equal(u.redactions.rx1.rev, 2);
  assert.equal(analyze(u).issues.filter((i) => i.kind === 'range_reversed' && i.status === 'open').length, 0, '更正后反向区间消失');

  // 锚点拆分 -> 形成两个独立锚点，各自仍阻断，直到逐项对齐
  const splitEvs = cmd.splitAnchor(u, 'anc-x', { ...ME, at: '2026-09-13T03:20:00Z' });
  u = dispatch(u, splitEvs);
  const parent = u.anchors['anc-x'];
  assert.ok(parent.splitInto && parent.splitInto.length === 2, '拆分应形成 2 个独立锚点');
  const childIds = parent.splitInto!;
  assert.ok(childIds.every((id) => u.anchors[id].parentId === 'anc-x'), '子锚点应记录父锚点');
  let ambIssues = analyze(u).issues.filter((i) => i.kind === 'anchor_ambiguous' && i.status === 'open');
  assert.equal(ambIssues.length, 2, '两个子锚点未逐项对齐前都应阻断');
  assert.equal(canGenerate(u).ok, false, '拆分后未全部对齐前不能生成清单');
  // 原父锚点的问题消失（退役）
  assert.ok(!analyze(u).issues.some((i) => i.anchorId === 'anc-x'), '父锚点退役后不再产生问题');

  // 只对齐第一个子锚点 -> 仍剩一个阻断
  const labels = docVersions(u, parent.docKey).map((f) => f.label);
  const resolveChild = (childId: string) => {
    const child = u.anchors[childId];
    const choices: Record<string, string | null> = {};
    for (const l of labels) {
      const occ = child.occurrences.find((o) => o.version === l);
      choices[l] = occ ? occ.id : null;
    }
    return cmd.resolveAnchor(u, childId, choices, { ...ME, at: '2026-09-13T03:25:00Z' });
  };
  u = dispatch(u, resolveChild(childIds[0]));
  assert.equal(analyze(u).issues.filter((i) => i.kind === 'anchor_ambiguous' && i.status === 'open').length, 1, '对齐一个后仍有一个阻断');
  assert.equal(canGenerate(u).ok, false);
  u = dispatch(u, resolveChild(childIds[1]));
  assert.equal(analyze(u).issues.filter((i) => i.kind === 'anchor_ambiguous' && i.status === 'open').length, 0, '两个子锚点全部对齐后阻断解除');
  assert.equal(canGenerate(u).ok, true, '全部子锚点对齐后才能生成');

  // 警告处置后，撤回主张 -> 旧结论失效（且 orphan redaction 警告变化）
  // rx1 p5-9 无保密主张支撑（cx1 只到 p4）-> orphan 警告
  const orphan = analyze(u).issues.find((i) => i.kind === 'redaction_unfounded' && i.status === 'open')!;
  assert.ok(orphan, 'p5-9 超出 cx1 主张范围，应有无支撑警告');
  u = dispatch(u, cmd.acceptIssue(orphan.key, orphan.sig, '稍后补正', { ...ME, at: '2026-09-13T03:30:00Z' }));
  assert.equal(analyze(u).issues.find((i) => i.key === orphan.key)!.status, 'accepted');
  // 撤回主张后，该警告事实未变（仍无支撑），签名不变 -> 仍 accepted；改为新增覆盖主张，警告消失
  u = dispatch(
    u,
    cmd.recordClaim(u, { docKey: orphan.docKey!, version: 'v1', ranges: [{ from: 5, to: 9 }], type: 'confidential', basis: '补充主张', assertedBy: '原告律师' }, { ...ME, at: '2026-09-13T03:40:00Z' }),
  );
  const after = analyze(u).issues.find((i) => i.key === orphan.key);
  assert.ok(!after, '补登覆盖 p5-9 的主张后，无支撑警告应消失');
  console.log('  ✓ 同标签异内容重标、遮挡反向更正、拆分后逐项对齐门禁、警告随补正失效，均通过');
}

/* ================= 场景 11：两个绕过阻断的修复核对 ================= */
console.log('场景 11 · 手动登记反向页序必须保留并阻断；拆分锚点必须逐项对齐');
{
  let v = initialState();
  const log: AppEvent[] = [];
  const step = (evs: AppEvent[]) => {
    log.push(...evs);
    v = evs.reduce(reduce, v);
  };
  step(cmd.importPacket(v, {
    name: '包Z.zip',
    docs: [{ key: 'z', title: '《验收报告》', summary: '', versions: [{ label: 'v1', sha: 'z1', pageCount: 30 }] }],
  }, { ...ME, at: '2026-09-14T01:00:00Z' }));
  const zKey = Object.keys(v.docs)[0];

  // 手动登记 “12-9”：原始顺序必须原样保留，且出现反向区间阻断
  step(cmd.recordClaim(v, { docKey: zKey, version: 'v1', ranges: [{ from: 12, to: 9 }], type: 'privileged', basis: '误填反向页序', assertedBy: '我方登记' }, { ...ME, at: '2026-09-14T02:00:00Z' }));
  const claim = Object.values(v.claims)[0];
  assert.deepEqual(claim.ranges, [{ from: 12, to: 9 }], '主张必须保留登记时的原始页序 12→9');
  let a = analyze(v);
  assert.ok(a.issues.some((i) => i.kind === 'range_reversed' && i.status === 'open'), '反向主张区间必须标阻断');
  assert.equal(canGenerate(v).ok, false, '存在反向区间时不能生成清单');

  // 手动登记反向遮挡同样处理
  step(cmd.recordRedaction({ docKey: zKey, version: 'v1', ranges: [{ from: 20, to: 15 }], note: '误填反向遮挡' }, { ...ME, at: '2026-09-14T02:10:00Z' }));
  const red = Object.values(v.redactions)[0];
  assert.deepEqual(red.ranges, [{ from: 20, to: 15 }], '遮挡必须保留原始页序 20→15');
  assert.equal(analyze(v).issues.filter((i) => i.kind === 'range_reversed' && i.status === 'open').length, 2, '主张与遮挡各一条反向阻断');

  // 用“交换起止页”动作修正（normRange）后阻断解除
  step(cmd.amendClaim(claim, { ranges: [{ from: 9, to: 12 }] }, { ...ME, at: '2026-09-14T02:20:00Z' }));
  step(cmd.amendRedaction(red, [{ from: 15, to: 20 }], { ...ME, at: '2026-09-14T02:21:00Z' }));
  assert.equal(analyze(v).issues.filter((i) => i.kind === 'range_reversed' && i.status === 'open').length, 0, '交换起止后反向阻断消失');
  assert.equal(canGenerate(v).ok, true);

  // 拆分锚点：先构造同版本双命中 + 另一版本缺失
  step(cmd.importPacket(v, {
    name: '包Z2.zip',
    docs: [{
      key: 'z', title: '《验收报告》', summary: '',
      versions: [{ label: 'v2', sha: 'z2', pageCount: 32 }],
      anchors: [{ id: 'anc-z', doc: 'z', label: '附件一 清单', occurrences: [{ version: 'v2', page: 5 }, { version: 'v2', page: 22 }, { version: 'v1', page: 6 }] }],
    }],
  }, { ...ME, at: '2026-09-14T03:00:00Z' }));
  // 注意：v1 先在包Z中已存在，锚点合并后 v1 1 处、v2 2 处
  const az = analyze(v).issues.find((i) => i.kind === 'anchor_ambiguous' && i.status === 'open')!;
  assert.ok(az, '拆分前应存在锚点歧义阻断');

  step(cmd.splitAnchor(v, 'anc-z', { ...ME, at: '2026-09-14T03:10:00Z' }));
  const zChildren = v.anchors['anc-z'].splitInto!;
  assert.equal(zChildren.length, 2, '应按 v2 的 2 处命中拆成 2 个独立锚点');
  assert.equal(analyze(v).issues.filter((i) => i.kind === 'anchor_ambiguous' && i.status === 'open').length, 2, '两个子锚点均阻断');
  assert.equal(canGenerate(v).ok, false);

  // 再次对齐：两个子锚点分别逐版本确认（v1 各 1 处，其中一个须在 v1 确认“无此锚点”）
  const zLabels = docVersions(v, zKey).map((f) => f.label); // [v2, v1]
  for (const cid of zChildren) {
    const child = v.anchors[cid];
    const choices: Record<string, string | null> = {};
    for (const l of zLabels) {
      const occ = child.occurrences.find((o) => o.version === l);
      choices[l] = occ ? occ.id : null; // 该版本没有第 n 个命中 -> 显式确认无此锚点
    }
    step(cmd.resolveAnchor(v, cid, choices, { ...ME, at: '2026-09-14T03:20:00Z' }));
  }
  assert.equal(analyze(v).issues.filter((i) => i.kind === 'anchor_ambiguous' && i.status === 'open').length, 0, '逐项对齐完成后阻断解除');
  assert.equal(canGenerate(v).ok, true);

  // 刷新重放：仅用事件日志重建，状态与轨迹完全一致
  const restored = replay(log);
  const restoredClaim = restored.claims[Object.keys(restored.claims)[0]];
  assert.deepEqual(restoredClaim.ranges, [{ from: 9, to: 12 }], '当前状态为交换起止后的正确页序 9-12');
  assert.deepEqual(
    restoredClaim.history[0].ranges,
    [{ from: 12, to: 9 }],
    '轨迹首条快照必须保留最初登记的反向页序 12→9（历史保真）',
  );
  assert.deepEqual(restoredClaim.history[1].ranges, [{ from: 9, to: 12 }], '轨迹第二条为交换起止后的页序');
  assert.equal(restoredClaim.history.length, 2, '主张变更轨迹（登记 + 交换起止）完整保留');
  assert.deepEqual(restored.anchors['anc-z'].splitInto, zChildren, '拆分关系刷新后保持');
  assert.equal(analyze(restored).issues.filter((i) => i.kind === 'anchor_ambiguous' && i.status === 'open').length, 0);
  assert.equal(canGenerate(restored).ok, true);
  // 事件轨迹中确实包含“登记反向”“交换起止”“拆分”“两次对齐”等记录
  const types = log.map((e) => e.type);
  assert.ok(types.includes('anchor.split') && types.filter((t) => t === 'anchor.resolved').length >= 2);
  console.log('  ✓ 手动反向登记保留原始页序并阻断；拆分形成独立锚点、逐项对齐前门禁关闭；刷新重放一致');
}

console.log(`\n全部 ${passed} 项自检通过 ✅`);
