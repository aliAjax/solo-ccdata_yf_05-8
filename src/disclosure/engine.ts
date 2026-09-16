// 事件归并、问题分析、披露清单构建 —— 全部为纯函数，可在 Node 下直接测试
import type {
  AnchorE,
  AnchorInput,
  AppEvent,
  ClaimE,
  ClaimInput,
  ClaimType,
  DocE,
  FileE,
  ImportRec,
  Issue,
  Manifest,
  ManifestEntry,
  PacketImportedPayload,
  PacketInput,
  PageRange,
  RedE,
  RedactionInput,
  ReviewState,
} from './types';
import {
  claimKey,
  clampRanges,
  cmpVersion,
  complement,
  digest,
  docKeyOf,
  fileIdOf,
  fmtRanges,
  isReversed,
  isOutOrder,
  normRange,
  rangesAdjacent,
  rangesEqual,
  rangesOverlap,
  redKey,
  subtractRanges,
  unionRanges,
} from './utils';

export const initialState = (): ReviewState => ({
  seq: 0,
  docs: {},
  files: {},
  claims: {},
  redactions: {},
  anchors: {},
  imports: [],
  resolutions: {},
  manifests: [],
  events: [],
});

export function reduce(state: ReviewState, ev: AppEvent): ReviewState {
  switch (ev.type) {
    case 'log.cleared':
      return initialState();

    case 'packet.imported': {
      const p = ev.packet;
      const docs = { ...state.docs };
      const files = { ...state.files };
      const claims = { ...state.claims };
      const redactions = { ...state.redactions };
      const anchors = { ...state.anchors };
      for (const d of p.docs) if (!docs[d.key]) docs[d.key] = d;
      for (const f of p.files) if (!files[f.id]) files[f.id] = f;
      for (const c of p.claims) if (!claims[c.id]) claims[c.id] = c;
      for (const r of p.redactions) if (!redactions[r.id]) redactions[r.id] = r;
      for (const a of p.anchors) {
        // 同一锚点可能在后续包中补充新的出现位置，逐 occ 合并
        const old = anchors[a.id];
        if (!old) anchors[a.id] = a;
        else {
          const seen = new Set(old.occurrences.map((o) => `${o.version}|${o.page}`));
          anchors[a.id] = {
            ...old,
            occurrences: [
              ...old.occurrences,
              ...a.occurrences.filter((o) => !seen.has(`${o.version}|${o.page}`)),
            ],
          };
        }
      }
      return {
        ...state,
        docs,
        files,
        claims,
        redactions,
        anchors,
        imports: [...state.imports, p.rec],
      };
    }

    case 'claim.recorded':
      return { ...state, claims: { ...state.claims, [ev.claim.id]: ev.claim } };

    case 'claim.amended': {
      const c = state.claims[ev.claimId];
      if (!c) return state;
      const next: ClaimE = {
        ...c,
        ...ev.after,
        rev: c.rev + 1,
        active: true,
        withdrawnReason: undefined,
        withdrawnAt: undefined,
        history: [
          ...c.history,
          { at: ev.at, kind: 'amend', ...ev.after },
        ],
      };
      return { ...state, claims: { ...state.claims, [c.id]: next } };
    }

    case 'claim.withdrawn': {
      const c = state.claims[ev.claimId];
      if (!c) return state;
      return {
        ...state,
        claims: {
          ...state.claims,
          [c.id]: { ...c, active: false, withdrawnReason: ev.reason, withdrawnAt: ev.at },
        },
      };
    }

    case 'redaction.recorded':
      return { ...state, redactions: { ...state.redactions, [ev.redaction.id]: ev.redaction } };

    case 'redaction.amended': {
      const r = state.redactions[ev.redactionId];
      if (!r) return state;
      return {
        ...state,
        redactions: { ...state.redactions, [r.id]: { ...r, ranges: ev.ranges, rev: r.rev + 1 } },
      };
    }

    case 'redaction.merged': {
      const redactions = { ...state.redactions };
      for (const sid of ev.sourceIds) {
        const s = redactions[sid];
        if (s) redactions[sid] = { ...s, active: false, mergedInto: ev.newId };
      }
      const prototype = redactions[ev.sourceIds[0]];
      const merged: RedE = {
        id: ev.newId,
        docKey: ev.docKey,
        version: ev.version,
        ranges: ev.ranges,
        rects: ev.sourceIds.flatMap((id) => redactions[id]?.rects ?? []),
        note: '由相邻/重叠遮挡合并',
        createdAt: ev.at,
        active: true,
        sourceIds: ev.sourceIds,
        rev: 1,
        packetId: prototype?.packetId,
      };
      redactions[ev.newId] = merged;
      return { ...state, redactions };
    }

    case 'redaction.withdrawn': {
      const r = state.redactions[ev.redactionId];
      if (!r) return state;
      return {
        ...state,
        redactions: { ...state.redactions, [r.id]: { ...r, active: false, withdrawnReason: ev.reason } },
      };
    }

    case 'anchor.resolved': {
      const a = state.anchors[ev.anchorId];
      if (!a) return state;
      return {
        ...state,
        anchors: {
          ...state.anchors,
          [a.id]: {
            ...a,
            resolution: { kind: 'pick', choices: ev.choices, occSig: anchorOccSig(a) },
          },
        },
      };
    }

    case 'anchor.split': {
      const a = state.anchors[ev.anchorId];
      if (!a) return state;
      return {
        ...state,
        anchors: { ...state.anchors, [a.id]: { ...a, resolution: { kind: 'split' } } },
      };
    }

    case 'pages.orderConfirmed': {
      const f = state.files[ev.fileId];
      if (!f) return state;
      return { ...state, files: { ...state.files, [f.id]: { ...f, orderAcknowledged: true } } };
    }

    case 'version.relabeled': {
      const f = state.files[ev.fileId];
      if (!f) return state;
      // 文件槽身份保持稳定（id 不随标签变化）；仅更正标签，便于轨迹引用与后续核对
      return { ...state, files: { ...state.files, [f.id]: { ...f, label: ev.to, relabeledFrom: f.relabeledFrom ?? ev.from } } };
    }

    case 'issue.accepted':
      return {
        ...state,
        resolutions: {
          ...state.resolutions,
          [ev.issueKey]: { at: ev.at, by: ev.by, sig: ev.sig, action: 'accept', note: ev.note },
        },
      };

    case 'disclosure.generated':
      return { ...state, manifests: [...state.manifests, ev.manifest] };

    default:
      return state;
  }
}

export function replay(events: AppEvent[]): ReviewState {
  return events.reduce((s, ev) => reduce(s, ev), initialState());
}

/* ================= 文书包导入规划：去重 / 归并 ================= */

export interface PreparedImport {
  payload: PacketImportedPayload;
  duplicateOf?: string;
}

function resolveDocRef(
  state: ReviewState,
  pendingDocs: DocE[],
  ref: string,
  packet: PacketInput,
  currentKey: string,
): string {
  // 显式 key 与本包某文书 key 一致
  if (packet.docs.some((x) => x.key && x.key.trim() === ref.trim())) {
    const k = docKeyOf(ref, ref.trim());
    if (state.docs[k] || pendingDocs.some((d) => d.key === k)) return k;
  }
  // 按标题在已存在/本包文书中查找
  const byTitle = docKeyOf(ref);
  if (state.docs[byTitle] || pendingDocs.some((d) => d.key === byTitle)) return byTitle;
  return currentKey;
}

/** 稳定序列化：忽略字段顺序，重发的同一包得到同一指纹，新增主张/遮挡则不是重复包 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function packetDigest(p: PacketInput): string {
  // 指纹覆盖文书、版本、主张、遮挡、锚点；不把压缩包名/导出时间计入，便于识别换名重发包
  return digest(canonical(p.docs));
}

export function prepareImport(
  state: ReviewState,
  packet: PacketInput,
  meta: { packetId: string; at: string; by: string },
): PreparedImport {
  const dg = packetDigest(packet);
  const duplicate = state.imports.find((i) => i.digest === dg);

  const docsOut: DocE[] = [];
  const filesOut: FileE[] = [];
  const claimsOut: ClaimE[] = [];
  const redsOut: RedE[] = [];
  const anchorsOut: AnchorE[] = [];

  const addedDocs: string[] = [];
  const mergedDocs: string[] = [];
  const addedFiles: ImportRec['addedFiles'] = [];
  const dedupedFiles: ImportRec['dedupedFiles'] = [];
  const claimSeen = new Set<string>();
  let addedClaims = 0;
  let dedupedClaims = 0;
  let addedReds = 0;
  let dedupedReds = 0;
  let addedAnchors = 0;
  const anchorSeen = new Set<string>();
  const batchSeq = state.imports.length + 1;

  for (const d of packet.docs) {
    const key = docKeyOf(d.title, d.key);
    if (!state.docs[key] && !docsOut.some((x) => x.key === key)) {
      docsOut.push({ key, title: d.title.trim(), summary: (d.summary ?? '').trim() });
      addedDocs.push(key);
    } else if (state.docs[key]) {
      mergedDocs.push(key);
    }

    // 版本：乱序也归并；同标签同哈希去重；同标签异哈希保留（分析阶段标冲突）
    for (const v of d.versions) {
      const id = fileIdOf(key, v.label, v.sha);
      // 同一内容（同 doc 同哈希）即使以别的标签重新导入，也视为同一文件，不再生成第二个槽位
      const sameContent =
        Object.values(state.files).find((f) => f.docKey === key && v.sha && f.sha === v.sha) ??
        filesOut.find((f) => f.docKey === key && v.sha && f.sha === v.sha);
      const exists = !!state.files[id] || filesOut.some((f) => f.id === id) || Boolean(sameContent);
      const payload: FileE = {
        id,
        docKey: key,
        label: v.label.trim(),
        arriveSeq: batchSeq,
        fileName: (v.fileName ?? v.label).trim(),
        sha: (v.sha ?? '').trim(),
        pageCount: v.pageCount,
        pageLabels: v.pageLabels,
        packetId: meta.packetId,
      };
      if (exists) dedupedFiles.push({ docKey: key, label: v.label });
      else {
        filesOut.push(payload);
        addedFiles.push({ docKey: key, label: v.label });
      }
    }

    for (const c of d.claims ?? []) {
      const finalDoc = resolveDocRef(state, docsOut, c.doc, packet, key);
      // 保留原始区间顺序：起止反向（8→4）须作为问题标出，不在导入时悄悄翻转
      const ranges = c.ranges.map((r) => ({ ...r }));
      const assertedBy = (c.assertedBy ?? '对方当事人').trim();
      const ck = claimKey(finalDoc, c.version?.trim(), c.type, ranges, assertedBy);
      if ((c.id && state.claims[c.id]) || (c.id && claimsOut.some((x) => x.id === c.id))) {
        dedupedClaims++;
        continue;
      }
      if (claimSeen.has(ck)) {
        dedupedClaims++;
        continue;
      }
      const dup = Object.values(state.claims).find(
        (x) =>
          x.active &&
          x.docKey === finalDoc &&
          (x.version ?? '') === (c.version?.trim() ?? '') &&
          x.type === c.type &&
          x.assertedBy === assertedBy &&
          rangesEqual(x.ranges, ranges),
      );
      if (dup) {
        dedupedClaims++;
        claimSeen.add(ck);
        continue;
      }
      claimSeen.add(ck);
      const id = c.id ?? 'claim_' + digest(`${meta.packetId}|${ck}`);
      claimsOut.push({
        id,
        docKey: finalDoc,
        version: c.version?.trim() || undefined,
        ranges,
        type: c.type,
        basis: (c.basis ?? '').trim(),
        assertedBy,
        createdAt: c.assertedAt ?? meta.at,
        packetId: meta.packetId,
        active: true,
        rev: 1,
        history: [{ at: c.assertedAt ?? meta.at, kind: 'record', type: c.type, ranges, basis: (c.basis ?? '').trim() }],
      });
      addedClaims++;
    }

    for (const r of d.redactions ?? []) {
      const ranges = r.ranges.map((x) => ({ ...x }));
      const rk = redKey(key, r.version?.trim(), ranges);
      const existingById = r.id && state.redactions[r.id];
      if (existingById || redsOut.some((x) => x.id === r.id)) {
        dedupedReds++;
        continue;
      }
      const dup = Object.values(state.redactions).find(
        (x) =>
          x.docKey === key &&
          (x.version ?? '') === (r.version?.trim() ?? '') &&
          rangesEqual(x.ranges, ranges),
      );
      if (dup || redsOut.some((x) => redKey(x.docKey, x.version, x.ranges) === rk)) {
        dedupedReds++;
        continue;
      }
      const id = r.id ?? 'red_' + digest(`${meta.packetId}|${rk}`);
      redsOut.push({
        id,
        docKey: key,
        version: r.version?.trim() || undefined,
        ranges,
        rects: r.rects,
        note: (r.note ?? '').trim(),
        createdAt: meta.at,
        packetId: meta.packetId,
        active: true,
        rev: 1,
      });
      addedReds++;
    }

    for (const a of d.anchors ?? []) {
      anchorsOut.push(buildAnchor(state, key, a));
      if (!state.anchors[a.id] && !anchorSeen.has(a.id)) addedAnchors++;
      anchorSeen.add(a.id);
    }
  }

  const rec: ImportRec = {
    packetId: meta.packetId,
    name: packet.name,
    at: meta.at,
    by: meta.by,
    digest: dg,
    duplicateOf: duplicate?.packetId,
    addedDocs: addedDocs.map((k) => state.docs[k]?.title ?? docsOut.find((d) => d.key === k)?.title ?? k),
    mergedDocs: mergedDocs.map((k) => state.docs[k]?.title ?? k),
    addedFiles,
    dedupedFiles,
    addedClaims,
    dedupedClaims,
    addedRedactions: addedReds,
    dedupedRedactions: dedupedReds,
    addedAnchors,
  };

  return { payload: { rec, docs: docsOut, files: filesOut, claims: claimsOut, redactions: redsOut, anchors: anchorsOut }, duplicateOf: duplicate?.packetId };
}

function buildAnchor(state: ReviewState, docKey: string, a: AnchorInput): AnchorE {
  const old = state.anchors[a.id];
  const merged = old
    ? [...old.occurrences, ...a.occurrences.map((o) => ({ id: '', version: o.version, page: o.page }))]
    : a.occurrences.map((o) => ({ id: '', version: o.version, page: o.page }));
  // 稳定 occId：锚点+版本+页
  const seen = new Set<string>();
  const occurrences = merged
    .filter((o) => {
      const k = `${o.version}|${o.page}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((o) => ({ ...o, id: 'occ_' + digest(`${a.id}|${o.version}|${o.page}`) }));
  return { id: a.id, docKey, label: a.label, occurrences, resolution: old?.resolution };
}

/* ================= 问题分析 ================= */

const CLAIM_LABEL: Record<ClaimType, string> = {
  confidential: '商业秘密/保密',
  privileged: '律师工作成果/特权',
  public: '不主张保密',
  withheld: '不予披露',
};
export const claimLabel = (t: ClaimType) => CLAIM_LABEL[t];

/** 取文书所有版本标签（最新在前） */
export function docVersions(state: ReviewState, docKey: string): FileE[] {
  return Object.values(state.files)
    .filter((f) => f.docKey === docKey)
    .sort((a, b) => cmpVersion(b.label, a.label));
}

function activeClaimsOf(state: ReviewState, docKey: string): ClaimE[] {
  return Object.values(state.claims).filter((c) => c.active && c.docKey === docKey);
}
function activeRedsOf(state: ReviewState, docKey: string): RedE[] {
  return Object.values(state.redactions).filter((r) => r.active && r.docKey === docKey);
}

/** 主张/遮挡是否适用于某个文件版本 */
function appliesToVersion(scope: string | undefined, label: string): boolean {
  return !scope || scope === label;
}

function claimBasisSig(c: ClaimE): string {
  return `${c.id}:${c.active ? 'a' : 'x'}:${c.type}:${c.rev}:${unionRanges(c.ranges).map((r) => `${r.from}-${r.to}`).join(',')}`;
}
function redBasisSig(r: RedE): string {
  return `${r.id}:${r.active ? 'a' : 'x'}:${r.rev}:${unionRanges(r.ranges).map((x) => `${x.from}-${x.to}`).join(',')}`;
}
function anchorBasisSig(a: AnchorE): string {
  return `${a.id}:${a.occurrences.map((o) => `${o.version}@${o.page}`).join(';')}::${
    a.resolution?.kind === 'pick'
      ? `pick:${a.resolution.occSig}:${Object.entries(a.resolution.choices)
          .map(([v, id]) => `${v}=${id ?? 'none'}`)
          .sort()
          .join(',')}`
      : a.resolution?.kind ?? '-'
  }`;
}

/** 锚点证据签名：出现位置集合发生变化（新包补充页码）时，旧处置失效 */
export function anchorOccSig(a: AnchorE): string {
  return a.occurrences.map((o) => `${o.version}@${o.page}`).sort().join(';');
}

export interface AnalyzedIssue extends Issue {
  /** 该问题当前事实的签名；与登记处置时的 sig 不一致即旧结论失效 */
  sig: string;
}

export interface AnalysisResult {
  issues: AnalyzedIssue[];
  blocking: number;
  acceptedLive: number;
}

export function analyze(state: ReviewState): AnalysisResult {
  const issues: AnalyzedIssue[] = [];
  const push = (i: Omit<AnalyzedIssue, 'status'>) => {
    const res = state.resolutions[i.key];
    const live = res && res.sig === i.sig;
    issues.push({ ...i, status: live ? 'accepted' : res ? 'stale' : 'open' });
  };

  for (const doc of Object.values(state.docs)) {
    const files = docVersions(state, doc.key);
    const claims = activeClaimsOf(state, doc.key);
    const reds = activeRedsOf(state, doc.key);

    /* ---- 1. 同标签异内容：版本冲突（阻断） ---- */
    const byLabel = new Map<string, FileE[]>();
    for (const f of files) {
      const arr = byLabel.get(f.label) ?? [];
      arr.push(f);
      byLabel.set(f.label, arr);
    }
    for (const [label, arr] of byLabel) {
      const shas = new Set(arr.map((f) => f.sha || digest(f.id + f.pageCount)));
      if (shas.size > 1) {
        const key = `vconf:${doc.key}:${label}`;
        push({
          key,
          kind: 'version_conflict',
          severity: 'blocking',
          title: `版本标签“${label}”对应不同文件内容`,
          docKey: doc.key,
          fileId: arr[0].id,
          detail: `${doc.title} 的 ${arr.length} 个文件都使用版本标签 ${label}，但哈希不一致：${arr
            .map((f) => `${f.fileName}(${f.sha || '无哈希'})`)
            .join('、')}。无法确定哪个才是 ${label}，需重新标记版本。`,
          relatedIds: arr.map((f) => f.id),
          sig: key + '|' + arr.map((f) => f.sha + f.fileName).sort().join(','),
          actions: [{ id: 'relabel', label: '重新标记版本标签', kind: 'relabel' }],
        });
      }
    }

    /* ---- 2. 乱序版本到达（信息，已自动归并） ---- */
    const arrivals = files.slice().sort((a, b) => a.arriveSeq - b.arriveSeq || cmpVersion(a.label, b.label));
    arrivals.forEach((f, i) => {
      if (i === 0) return;
      const prev = arrivals[i - 1];
      if (cmpVersion(f.label, prev.label) < 0) {
        const key = `outorder:${f.id}`;
        push({
          key,
          kind: 'out_of_order',
          severity: 'info',
          title: `乱序到达版本已归并：${f.label} 早于 ${prev.label}`,
          docKey: doc.key,
          fileId: f.id,
          detail: `${doc.title}：第 ${f.arriveSeq} 批到达的 ${f.label} 比第 ${prev.arriveSeq} 批的 ${prev.label} 更旧，已按版本顺序自动归入同一文书，不影响清单生成。`,
          sig: key + '|' + f.arriveSeq,
        });
      }
    });

    /* ---- 3. 反向页码（阻断） ---- */
    for (const f of files) {
      if (!f.pageLabels || f.pageLabels.length < 2 || f.orderAcknowledged) continue;
      let desc = 0;
      let asc = 0;
      for (let i = 1; i < f.pageLabels.length; i++) {
        if (f.pageLabels[i] < f.pageLabels[i - 1]) desc++;
        if (f.pageLabels[i] > f.pageLabels[i - 1]) asc++;
      }
      if (desc > asc && desc > 0) {
        const key = `revpages:${f.id}`;
        push({
          key,
          kind: 'reverse_pages',
          severity: 'blocking',
          title: `疑似反向页码文件：${f.label}`,
          docKey: doc.key,
          fileId: f.id,
          detail: `${doc.title} ${f.label}（${f.fileName}）的页码标签整体递减（${f.pageLabels.slice(0, 6).join('→')}…），遮挡页与主张页可能整体错位。请确认后翻转页码顺序。`,
          sig: key + '|' + f.pageLabels.join(','),
          actions: [{ id: 'flip', label: '确认扫描倒序，翻转页码', kind: 'confirm_order' }],
        });
      }
    }

    /* ---- 4. 主张 / 遮挡逐版本检查 ---- */
    for (const file of files) {
      const fc = claims.filter((c) => appliesToVersion(c.version, file.label));
      const fr = reds.filter((r) => appliesToVersion(r.version, file.label));

      // 4a. 反向区间（from > to）
      for (const c of fc) {
        const bad = c.ranges.filter(isReversed);
        if (bad.length) {
          const key = `revclaim:${c.id}:${file.id}`;
          push({
            key,
            kind: 'range_reversed',
            severity: 'blocking',
            title: `主张区间页序反向：${CLAIM_LABEL[c.type]} ${bad.map((r) => `${r.from}→${r.to}`).join('、')}`,
            docKey: doc.key,
            fileId: file.id,
            relatedIds: [c.id],
            detail: `${doc.title} ${file.label}：${c.assertedBy} 登记的区间起止颠倒，需更正区间后再生成清单。`,
            sig: key + '|' + claimBasisSig(c),
            actions: [{ id: 'fix', label: '交换起止页', kind: 'fix_range', targetType: 'claim', targetId: c.id }],
          });
        }
        const total = file.pageCount;
        const overflow = c.ranges.filter((r) => r.to > total || r.from < 1);
        if (overflow.length) {
          const key = `overflow-claim:${c.id}:${file.id}`;
          push({
            key,
            kind: 'range_exceeds',
            severity: 'blocking',
            title: `主张区间超出文件页数：${fmtRanges(overflow)}`,
            docKey: doc.key,
            fileId: file.id,
            relatedIds: [c.id],
            detail: `${doc.title} ${file.label} 共 ${total} 页，${c.assertedBy} 的主张 ${fmtRanges(overflow)} 超出范围。`,
            sig: key + '|' + claimBasisSig(c) + '|' + total,
            actions: [{ id: 'fix', label: '裁剪到文件范围', kind: 'fix_range', targetType: 'claim', targetId: c.id }],
          });
        }
      }
      for (const r of fr) {
        const bad = r.ranges.filter(isReversed);
        if (bad.length) {
          const key = `revred:${r.id}:${file.id}`;
          push({
            key,
            kind: 'range_reversed',
            severity: 'blocking',
            title: `遮挡区间页序反向：${bad.map((x) => `${x.from}→${x.to}`).join('、')}`,
            docKey: doc.key,
            fileId: file.id,
            relatedIds: [r.id],
            detail: `${doc.title} ${file.label}：遮挡登记的起止页颠倒（${r.note || '无备注'}），需更正后再生成清单。`,
            sig: key + '|' + redBasisSig(r),
            actions: [{ id: 'fix', label: '交换起止页', kind: 'fix_range', targetType: 'redaction', targetId: r.id }],
          });
        }
        const overflow = r.ranges.filter((x) => x.to > file.pageCount || x.from < 1);
        if (overflow.length) {
          const key = `overflow-red:${r.id}:${file.id}`;
          push({
            key,
            kind: 'range_exceeds',
            severity: 'blocking',
            title: `遮挡区间超出文件页数：${fmtRanges(overflow)}`,
            docKey: doc.key,
            fileId: file.id,
            relatedIds: [r.id],
            detail: `${doc.title} ${file.label} 共 ${file.pageCount} 页，遮挡 ${fmtRanges(overflow)} 超出范围。`,
            sig: key + '|' + redBasisSig(r) + '|' + file.pageCount,
            actions: [{ id: 'fix', label: '裁剪到文件范围', kind: 'fix_range', targetType: 'redaction', targetId: r.id }],
          });
        }
      }

      // 4b. 同一文件冲突主张（阻断）：保密类 / 不予披露 与 “不主张保密(公开)” 页重叠
      for (let i = 0; i < fc.length; i++) {
        for (let j = i + 1; j < fc.length; j++) {
          const a = fc[i];
          const b = fc[j];
          const protective: ClaimType[] = ['confidential', 'privileged', 'withheld'];
          const aProtects = protective.includes(a.type);
          const bProtects = protective.includes(b.type);
          if (aProtects === bProtects) continue; // 同属保护类（按并集处理）或都非保护类，不算冲突
          if (rangesOverlap(a.ranges, b.ranges)) {
            const pair = [a.id, b.id].sort().join(':');
            const key = `conflict:${pair}:${file.id}`;
            push({
              key,
              kind: 'conflicting_claims',
              severity: 'blocking',
              title: `同一文件存在冲突主张：${CLAIM_LABEL[a.type]} ⚔ ${CLAIM_LABEL[b.type]}`,
              docKey: doc.key,
              fileId: file.id,
              relatedIds: [a.id, b.id],
              detail: `${doc.title} ${file.label}：${a.assertedBy} 主张“${CLAIM_LABEL[a.type]}”与 ${b.assertedBy} 主张“${CLAIM_LABEL[b.type]}”在 ${fmtRanges(
                intersectOf(a.ranges, b.ranges),
              )} 页重叠。同一页不能同时保密与公开，须撤回或变更其中一项主张。`,
              sig: `${key}|${claimBasisSig(a)}|${claimBasisSig(b)}`,
              actions: [
                { id: 'wa', label: `撤回「${CLAIM_LABEL[a.type]}」`, kind: 'withdraw_claim', targetId: a.id },
                { id: 'wb', label: `撤回「${CLAIM_LABEL[b.type]}」`, kind: 'withdraw_claim', targetId: b.id },
                { id: 'amend', label: '变更主张范围/类型', kind: 'amend_claim', targetId: a.id },
              ],
            });
          }
        }
      }

      // 4c. 同类型重复主张（信息，自动识别不阻断）
      for (let i = 0; i < fc.length; i++) {
        for (let j = i + 1; j < fc.length; j++) {
          const a = fc[i];
          const b = fc[j];
          if (a.type !== b.type || a.assertedBy !== b.assertedBy) continue;
          if (rangesOverlap(a.ranges, b.ranges) || rangesAdjacent(a.ranges, b.ranges)) {
            const pair = [a.id, b.id].sort().join(':');
            const key = `dupclaim:${pair}:${file.id}`;
            push({
              key,
              kind: 'duplicate_claim',
              severity: 'info',
              title: `重复保密主张已识别：${CLAIM_LABEL[a.type]}`,
              docKey: doc.key,
              fileId: file.id,
              relatedIds: [a.id, b.id],
              detail: `${doc.title} ${file.label}：两条同为 ${a.assertedBy} 的“${CLAIM_LABEL[a.type]}”主张覆盖重叠/相邻页（${fmtRanges(
                a.ranges,
              )} 与 ${fmtRanges(b.ranges)}），清单按并集处理，不阻断生成。可撤回多余的一条以保持整洁。`,
              sig: `${key}|${claimBasisSig(a)}|${claimBasisSig(b)}`,
              actions: [{ id: 'wb', label: '撤回后登记的重复主张', kind: 'withdraw_claim', targetId: b.id }],
            });
          }
        }
      }

      // 4d. 遮挡两两关系：重叠（阻断）/ 相邻（提示可合并）
      for (let i = 0; i < fr.length; i++) {
        for (let j = i + 1; j < fr.length; j++) {
          const a = fr[i];
          const b = fr[j];
          const pair = [a.id, b.id].sort().join(':');
          if (rangesOverlap(a.ranges, b.ranges)) {
            const key = `redoverlap:${pair}:${file.id}`;
            push({
              key,
              kind: 'redaction_overlap',
              severity: 'blocking',
              title: `遮挡区间重叠：${fmtRanges(a.ranges)} ⚔ ${fmtRanges(b.ranges)}`,
              docKey: doc.key,
              fileId: file.id,
              relatedIds: [a.id, b.id],
              detail: `${doc.title} ${file.label}：两条遮挡在 ${fmtRanges(intersectOf(a.ranges, b.ranges))} 页重叠。重叠遮挡会导致复核口径不清，须合并为一条或撤回其一。`,
              sig: `${key}|${redBasisSig(a)}|${redBasisSig(b)}`,
              actions: [
                { id: 'merge', label: '合并两条遮挡（取并集）', kind: 'merge_redactions', targetIds: [a.id, b.id] },
                { id: 'wa', label: '撤回第一条', kind: 'withdraw_redaction', targetId: a.id },
                { id: 'wb', label: '撤回第二条', kind: 'withdraw_redaction', targetId: b.id },
              ],
            });
          } else if (rangesAdjacent(a.ranges, b.ranges)) {
            const key = `redadj:${pair}:${file.id}`;
            push({
              key,
              kind: 'redaction_adjacent',
              severity: 'warning',
              title: `相邻遮挡可合并：${fmtRanges(a.ranges)} ｜ ${fmtRanges(b.ranges)}`,
              docKey: doc.key,
              fileId: file.id,
              relatedIds: [a.id, b.id],
              detail: `${doc.title} ${file.label}：两条遮挡端点相接但不重叠。分开登记不阻断清单生成；若属于同一段落连续遮挡，建议合并。`,
              sig: `${key}|${redBasisSig(a)}|${redBasisSig(b)}`,
              actions: [{ id: 'merge', label: '合并相邻遮挡', kind: 'merge_redactions', targetIds: [a.id, b.id] }],
            });
          }
        }
      }

      // 4e. 保密/特权主张没有对应遮挡（警告）
      for (const c of fc) {
        if (c.type !== 'confidential' && c.type !== 'privileged') continue;
        const covered = unionRanges(fr.flatMap((r) => r.ranges));
        const gap = subtractRanges(c.ranges, covered);
        if (gap.length) {
          const key = `uncovered:${c.id}:${file.id}`;
          push({
            key,
            kind: 'claim_uncovered',
            severity: 'warning',
            title: `主张保密页缺少遮挡：${fmtRanges(gap)}`,
            docKey: doc.key,
            fileId: file.id,
            relatedIds: [c.id],
            detail: `${doc.title} ${file.label}：${c.assertedBy} 主张 ${fmtRanges(gap)} 页为“${CLAIM_LABEL[c.type]}”，但未见遮挡登记。请补登遮挡或在复核中说明法律依据（部分请求下保密页可明文披露）。`,
            sig: `${key}|${claimBasisSig(c)}|${covered.map((r) => `${r.from}-${r.to}`).join(',')}`,
            actions: [{ id: 'accept', label: '已知悉，备注法律依据', kind: 'accept' }],
          });
        }
      }

      // 4f. 遮挡没有任何保密主张支撑（警告）
      for (const r of fr) {
        const basisClaims = fc.filter((c) => c.type === 'confidential' || c.type === 'privileged');
        const supported = unionRanges(basisClaims.flatMap((c) => c.ranges));
        const orphan = subtractRanges(r.ranges, supported);
        if (orphan.length) {
          const key = `orphanred:${r.id}:${file.id}`;
          push({
            key,
            kind: 'redaction_unfounded',
            severity: 'warning',
            title: `部分遮挡缺少保密主张支撑：${fmtRanges(orphan)}`,
            docKey: doc.key,
            fileId: file.id,
            relatedIds: [r.id],
            detail: `${doc.title} ${file.label}：${fmtRanges(orphan)} 页有遮挡但没有对应的保密/特权主张。过度遮挡可能被认定为规避披露，请补登记主张或撤回遮挡。`,
            sig: `${key}|${redBasisSig(r)}|${supported.map((x) => `${x.from}-${x.to}`).join(',')}`,
            actions: [{ id: 'accept', label: '已知悉，稍后补正', kind: 'accept' }],
          });
        }
      }
    }

    /* ---- 5. 跨版本锚点歧义（阻断） ---- */
    for (const a of Object.values(state.anchors).filter((x) => x.docKey === doc.key)) {
      const labels = docVersions(state, doc.key).map((f) => f.label);
      const byVersion = new Map<string, AnchorE['occurrences']>();
      for (const o of a.occurrences) {
        const arr = byVersion.get(o.version) ?? [];
        arr.push(o);
        byVersion.set(o.version, arr);
      }
      const dupVersions = [...byVersion.entries()].filter(([, occ]) => occ.length > 1).map(([v]) => v);
      const missingVersions = labels.filter((l) => !byVersion.has(l));
      const ambiguous = dupVersions.length > 0 || missingVersions.length > 0;

      const resolved =
        (a.resolution?.kind === 'split') ||
        (a.resolution?.kind === 'pick' && a.resolution.occSig === anchorOccSig(a) && resolutionComplete(a, labels, byVersion));
      if (ambiguous && !resolved) {
        const key = `anchor:${a.id}`;
        push({
          key,
          kind: 'anchor_ambiguous',
          severity: 'blocking',
          title: `跨版本锚点歧义：「${a.label}」`,
          docKey: doc.key,
          anchorId: a.id,
          detail:
            (dupVersions.length
              ? `同一版本内命中多处：${dupVersions.map((v) => `${v} 版 p${byVersion.get(v)!.map((o) => o.page).join('/p')}`).join('；')}。`
              : '') +
            (missingVersions.length ? `以下版本未找到该锚点：${missingVersions.join('、')}（版本漂移或扫描缺页）。` : '') +
            '引用页在版本间无法对齐，须逐版本指定对应位置（确认缺失可显式标注“该版本无此锚点”），或拆分为多个锚点。',
          sig: `${key}|${anchorOccSig(a)}|${labels.join(',')}`,
          actions: [
            { id: 'pick', label: '逐版本指定锚点位置', kind: 'resolve_anchor' },
            { id: 'split', label: '拆分为独立锚点', kind: 'split_anchor' },
          ],
        });
      }

      // 锚点漂移（信息）：各版本位置相差较大
      const pages = [...byVersion.values()].map((occ) => occ[0]?.page).filter((p): p is number => typeof p === 'number');
      if (pages.length > 1 && Math.max(...pages) - Math.min(...pages) >= 3 && !ambiguous) {
        const key = `anchordrift:${a.id}`;
        push({
          key,
          kind: 'anchor_drift',
          severity: 'info',
          title: `锚点跨版本漂移 ${Math.min(...pages)}→${Math.max(...pages)} 页：「${a.label}」`,
          docKey: doc.key,
          anchorId: a.id,
          detail: `${doc.title}：锚点「${a.label}」在不同版本相差 ${Math.max(...pages) - Math.min(...pages)} 页，引用核对时请注意版本。`,
          sig: `${key}|${pages.join(',')}`,
        });
      }
    }
  }

  /* ---- 6. 跨文书的重复包（信息，导入时归并） ---- */
  for (const imp of state.imports) {
    if (imp.duplicateOf) {
      push({
        key: `duppack:${imp.packetId}`,
        kind: 'duplicate_packet',
        severity: 'info',
        title: `重复文书包已自动归并：${imp.name}`,
        detail: `该包内容指纹与已导入的「${state.imports.find((x) => x.packetId === imp.duplicateOf)?.name}」完全一致，未产生重复文件、主张或遮挡（跳过 ${imp.dedupedFiles.length} 个版本、${imp.dedupedClaims} 条主张、${imp.dedupedRedactions} 条遮挡）。`,
        sig: `duppack:${imp.packetId}:${imp.digest}`,
      });
    }
  }

  const blocking = issues.filter((i) => i.severity === 'blocking' && i.status === 'open').length;
  const acceptedLive = issues.filter((i) => i.status === 'accepted').length;
  return { issues: issues.sort(issueOrder), blocking, acceptedLive };
}

function issueOrder(a: AnalyzedIssue, b: AnalyzedIssue): number {
  const rank = { blocking: 0, warning: 1, info: 2 } as const;
  if (rank[a.severity] !== rank[b.severity]) return rank[a.severity] - rank[b.severity];
  if ((a.status === 'open') !== (b.status === 'open')) return a.status === 'open' ? -1 : 1;
  return a.key.localeCompare(b.key);
}

function resolutionComplete(
  a: AnchorE,
  labels: string[],
  byVersion: Map<string, AnchorE['occurrences']>,
): boolean {
  if (a.resolution?.kind !== 'pick') return false;
  for (const l of labels) {
    if (!(l in a.resolution.choices)) return false;
    const choice = a.resolution.choices[l];
    if (choice === null) continue; // 显式确认无锚点
    const valid = byVersion.get(l)?.some((o) => o.id === choice);
    if (!valid) return false;
  }
  return true;
}

function intersectOf(a: PageRange[], b: PageRange[]): PageRange[] {
  const out: PageRange[] = [];
  for (const x of a.map(normRange)) {
    for (const y of b.map(normRange)) {
      const from = Math.max(x.from, y.from);
      const to = Math.min(x.to, y.to);
      if (from <= to) out.push({ from, to });
    }
  }
  return unionRanges(out);
}

/* ================= 披露清单 ================= */

export function canGenerate(state: ReviewState): { ok: boolean; blocking: AnalyzedIssue[] } {
  const { issues } = analyze(state);
  const blocking = issues.filter((i) => i.severity === 'blocking' && i.status === 'open');
  return { ok: blocking.length === 0 && Object.keys(state.files).length > 0, blocking };
}

export function buildManifest(state: ReviewState, meta: { id: string; at: string; by: string }): Manifest {
  const entries: ManifestEntry[] = [];
  for (const doc of Object.values(state.docs)) {
    for (const file of docVersions(state, doc.key)) {
      const claims = activeClaimsOf(state, doc.key).filter((c) => appliesToVersion(c.version, file.label));
      const reds = activeRedsOf(state, doc.key).filter((r) => appliesToVersion(r.version, file.label));

      const withheld = clampRanges(
        claims.filter((c) => c.type === 'withheld').flatMap((c) => c.ranges),
        file.pageCount,
      );
      const claimProtected = clampRanges(
        claims.filter((c) => c.type === 'confidential' || c.type === 'privileged').flatMap((c) => c.ranges),
        file.pageCount,
      );
      const redacted = clampRanges(reds.flatMap((r) => r.ranges), file.pageCount);
      // 被“不予披露”覆盖的页从遮挡/公开中剔除
      const redactedFinal = subtractRanges(redacted, withheld);
      const protectedNoRed = subtractRanges(subtractRanges(claimProtected, redactedFinal), withheld);
      const allHidden = unionRanges([...withheld, ...redactedFinal, ...protectedNoRed]);
      const disclosed = complement(allHidden, file.pageCount);

      const status: ManifestEntry['status'] =
        disclosed.length === 0 ? 'withheld' : allHidden.length ? 'partial' : 'disclose';

      entries.push({
        fileId: file.id,
        docKey: doc.key,
        title: doc.title,
        version: file.label,
        fileName: file.fileName,
        pageCount: file.pageCount,
        disclosedPages: disclosed,
        redactedPages: redactedFinal,
        protectedPages: protectedNoRed,
        withheldPages: withheld,
        claims: claims.map((c) => ({
          type: c.type,
          ranges: clampRanges(c.ranges, file.pageCount),
          basis: c.basis,
          assertedBy: c.assertedBy,
        })),
        status,
      });
    }
  }
  entries.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN') || cmpVersion(b.version, a.version));
  return { id: meta.id, at: meta.at, by: meta.by, entries, sig: manifestSig(state, entries) };
}

/**
 * 清单结论签名：既包含计算后的页集，也包含推导所依据的主张/遮挡身份与版本号。
 * 只要主张或遮挡被撤回、变更（即使页集恰好不变），旧清单签名即改变 -> 立即失效。
 */
export function manifestSig(state: ReviewState, entries: ManifestEntry[]): string {
  return digest(
    entries
      .map((e) => {
        const claimBasis = Object.values(state.claims)
          .filter((c) => c.active && c.docKey === e.docKey && (!c.version || c.version === e.version))
          .map((c) => `${c.id}@${c.rev}:${c.type}:${c.ranges.map((r) => `${r.from}-${r.to}`).join(',')}`)
          .sort()
          .join(';');
        const redBasis = Object.values(state.redactions)
          .filter((r) => r.active && r.docKey === e.docKey && (!r.version || r.version === e.version))
          .map((r) => `${r.id}@${r.rev}:${r.ranges.map((x) => `${x.from}-${x.to}`).join(',')}`)
          .sort()
          .join(';');
        return [
          e.fileId,
          e.status,
          e.disclosedPages.map((r) => `${r.from}-${r.to}`).join(','),
          e.redactedPages.map((r) => `${r.from}-${r.to}`).join(','),
          e.protectedPages.map((r) => `${r.from}-${r.to}`).join(','),
          e.withheldPages.map((r) => `${r.from}-${r.to}`).join(','),
          `claims[${claimBasis}]`,
          `reds[${redBasis}]`,
        ].join('|');
      })
      .join('‖'),
  );
}

/** 旧清单是否已失效：重新构建后的签名不同即失效 */
export function manifestStale(state: ReviewState, m: Manifest): boolean {
  const fresh = buildManifest(state, { id: '', at: '', by: '' });
  return fresh.sig !== m.sig;
}

/* 供 UI 调用的小工具 */
export { clampRanges, intersectOf };
