// 命令工厂：构造审查事件，UI / 测试 / store 共用
import type {
  AppEvent,
  ClaimE,
  ClaimType,
  PageRange,
  PacketInput,
  RedE,
  ReviewState,
} from './types';
import { digest, normRange, nowISO } from './utils';
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
  const claim: ClaimE = {
    id: 'claim_' + digest(`manual|${JSON.stringify(input)}|${at}|${seq}`),
    docKey: input.docKey,
    version: input.version?.trim() || undefined,
    ranges: input.ranges.map(normRange),
    type: input.type,
    basis: (input.basis ?? '').trim(),
    assertedBy: (input.assertedBy ?? '我方登记').trim(),
    createdAt: at,
    active: true,
    rev: 1,
    history: [
      { at, kind: 'record', type: input.type, ranges: input.ranges.map(normRange), basis: input.basis ?? '' },
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
        ranges: (patch.ranges ?? claim.ranges).map(normRange),
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
    ranges: input.ranges.map(normRange),
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
      ranges: ranges.map(normRange),
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

export function splitAnchor(anchorId: string, ctx: ActorCtx): AppEvent[] {
  return [{ id: evId(), type: 'anchor.split', at: ctx.at ?? nowISO(), by: ctx.by, anchorId }];
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
