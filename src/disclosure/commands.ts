// 命令工厂：构造审查事件，UI / 测试 / store 共用
import type {
  AnchorE,
  AppEvent,
  ClaimE,
  ClaimType,
  PageRange,
  PacketInput,
  RedE,
  ReviewState,
} from './types';
import { digest, nowISO, cmpVersion, normRange } from './utils';
import { anchorOccSig, buildManifest, prepareImport } from './engine';

export interface ActorCtx {
  by: string;
  at?: string;
}

let seq = 0;
function evId(): string {
  seq = (seq + 1) % 1_000_000;
  return 'ev_' + Date.now().toString(36) + '_' + seq;
}

export function importPacket(
  state: ReviewState,
  packet: PacketInput,
  ctx: ActorCtx & { packetId?: string },
): AppEvent[] {
  const at = ctx.at ?? nowISO();
  const packetId = ctx.packetId ?? 'pkt_' + digest(packet.name + at).slice(-10);
  const prepared = prepareImport(state, packet, { packetId, at, by: ctx.by });
  return [{ id: evId(), type: 'packet.imported', at, by: ctx.by, packet: prepared.payload }];
}

export function recordClaim(
  state: ReviewState,
  input: {
    docKey: string;
    version?: string;
    ranges: PageRange[];
    type: ClaimType;
    basis?: string;
    assertedBy?: string;
  },
  ctx: ActorCtx,
): AppEvent[] {
  const at = ctx.at ?? nowISO();
  // 保留登记的原始页序：输入 “12-9” 不能在这里悄悄翻正，必须由分析器标“反向区间”并阻断
  const raw = input.ranges.map((r) => ({ ...r }));
  const claim: ClaimE = {
    id: 'claim_' + digest(`manual|${JSON.stringify(input)}|${at}|${seq}`),
    docKey: input.docKey,
    version: input.version?.trim() || undefined,
    ranges: raw,
    type: input.type,
    basis: (input.basis ?? '').trim(),
    assertedBy: (input.assertedBy ?? '我方登记').trim(),
    createdAt: at,
    active: true,
    rev: 1,
    history: [
      { at, kind: 'record', type: input.type, ranges: raw.map((r) => ({ ...r })), basis: input.basis ?? '' },
    ],
  };
  void state;
  return [{ id: evId(), type: 'claim.recorded', at, by: ctx.by, claim }];
}

export function amendClaim(
  claim: ClaimE,
  patch: { type?: ClaimType; ranges?: PageRange[]; basis?: string },
  ctx: ActorCtx,
): AppEvent[] {
  const at = ctx.at ?? nowISO();
  return [
    {
      id: evId(),
      type: 'claim.amended',
      at,
      by: ctx.by,
      claimId: claim.id,
      before: { type: claim.type, ranges: claim.ranges, basis: claim.basis },
      after: {
        type: patch.type ?? claim.type,
        // 变更同样保留原始页序（含起止反向），交由分析器标出
        ranges: (patch.ranges ?? claim.ranges).map((r) => ({ ...r })),
        basis: patch.basis ?? claim.basis,
      },
    },
  ];
}

export function withdrawClaim(claim: ClaimE, reason: string, ctx: ActorCtx): AppEvent[] {
  return [{ id: evId(), type: 'claim.withdrawn', at: ctx.at ?? nowISO(), by: ctx.by, claimId: claim.id, reason }];
}

export function recordRedaction(
  input: { docKey: string; version?: string; ranges: PageRange[]; note?: string },
  ctx: ActorCtx,
): AppEvent[] {
  const at = ctx.at ?? nowISO();
  const red: RedE = {
    id: 'red_' + digest(`manual|${JSON.stringify(input)}|${at}|${seq}`),
    docKey: input.docKey,
    version: input.version?.trim() || undefined,
    ranges: input.ranges.map((r) => ({ ...r })), // 保留原始页序，反向区间须阻断
    note: (input.note ?? '').trim(),
    createdAt: at,
    active: true,
    rev: 1,
  };
  return [{ id: evId(), type: 'redaction.recorded', at, by: ctx.by, redaction: red }];
}

export function mergeRedactions(
  state: ReviewState,
  sourceIds: string[],
  ranges: PageRange[],
  ctx: ActorCtx,
): AppEvent[] {
  const at = ctx.at ?? nowISO();
  const sources = sourceIds.map((id) => state.redactions[id]).filter(Boolean);
  if (sources.length < 2) return [];
  const first = sources[0];
  const newId = 'red_' + digest(`merged|${sourceIds.slice().sort().join('+')}|${at}`);
  return [
    {
      id: evId(),
      type: 'redaction.merged',
      at,
      by: ctx.by,
      newId,
      sourceIds: sourceIds.slice().sort(),
      ranges: ranges.map(normRange),
      docKey: first.docKey,
      version: first.version,
    },
  ];
}

export function amendRedaction(red: RedE, ranges: PageRange[], ctx: ActorCtx): AppEvent[] {
  return [
    {
      id: evId(),
      type: 'redaction.amended',
      at: ctx.at ?? nowISO(),
      by: ctx.by,
      redactionId: red.id,
      ranges: ranges.map((r) => ({ ...r })), // 保留原始页序；显式“交换起止页”由调用方先归一
    },
  ];
}

export function withdrawRedaction(red: RedE, reason: string, ctx: ActorCtx): AppEvent[] {
  return [{ id: evId(), type: 'redaction.withdrawn', at: ctx.at ?? nowISO(), by: ctx.by, redactionId: red.id, reason }];
}

export function resolveAnchor(
  state: ReviewState,
  anchorId: string,
  choices: Record<string, string | null>,
  ctx: ActorCtx,
): AppEvent[] {
  const a = state.anchors[anchorId];
  if (!a) return [];
  return [{ id: evId(), type: 'anchor.resolved', at: ctx.at ?? nowISO(), by: ctx.by, anchorId, choices }];
}

export function splitAnchor(
  state: ReviewState,
  anchorId: string,
  ctx: ActorCtx,
): AppEvent[] {
  const at = ctx.at ?? nowISO();
  const parent = state.anchors[anchorId];
  if (!parent) return [];

  // 统计每个版本候选数，k = 任一版本中最多的命中数（即应形成的独立锚点数）
  const perVersion = new Map<string, number>();
  for (const o of parent.occurrences) {
    perVersion.set(o.version, (perVersion.get(o.version) ?? 0) + 1);
  }
  const k = Math.max(1, ...perVersion.values());

  // 版本按新旧排序；每个版本内候选按页码升序，依次归入第 1..k 个独立锚点
  const labels = [...perVersion.keys()].sort((x, y) => cmpVersion(y, x));
  const children: AnchorE[] = [];
  for (let idx = 0; idx < k; idx++) {
    const childId = 'anc_' + digest(`${parent.id}|child|${idx + 1}`);
    const occurrences = labels.flatMap((v) => {
      const occ = parent.occurrences
        .filter((o) => o.version === v)
        .sort((x, y) => x.page - y.page);
      const picked = occ[idx];
      return picked
        ? [{ id: 'occ_' + digest(`${childId}|${picked.version}|${picked.page}`), version: picked.version, page: picked.page }]
        : [];
    });
    children.push({
      id: childId,
      docKey: parent.docKey,
      label: `${parent.label} · ${['一', '二', '三', '四', '五', '六', '七', '八'][idx] ?? idx + 1}`,
      occurrences,
      parentId: parent.id,
      childIndex: idx + 1,
    });
  }
  return [{ id: evId(), type: 'anchor.split', at, by: ctx.by, anchorId, children }];
}

export function confirmPageOrder(fileId: string, ctx: ActorCtx): AppEvent[] {
  return [{ id: evId(), type: 'pages.orderConfirmed', at: ctx.at ?? nowISO(), by: ctx.by, fileId }];
}

export function relabelVersion(fileId: string, from: string, to: string, ctx: ActorCtx): AppEvent[] {
  return [{ id: evId(), type: 'version.relabeled', at: ctx.at ?? nowISO(), by: ctx.by, fileId, from, to }];
}

export function acceptIssue(issueKey: string, sig: string, note: string, ctx: ActorCtx): AppEvent[] {
  return [{ id: evId(), type: 'issue.accepted', at: ctx.at ?? nowISO(), by: ctx.by, issueKey, sig, note }];
}

export function generateManifest(
  state: ReviewState,
  meta: { id: string; at?: string; by: string },
): AppEvent[] {
  const at = meta.at ?? nowISO();
  const manifest = buildManifest(state, { id: meta.id, at, by: meta.by });
  return [{ id: evId(), type: 'disclosure.generated', at, by: meta.by, manifest }];
}

export { anchorOccSig };
