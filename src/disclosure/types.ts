// 案件披露材料审查 —— 领域类型定义

/** 保密主张类型 */
export type ClaimType =
  | 'confidential' // 商业秘密 / 保密信息
  | 'privileged' // 律师-当事人特权 / 工作成果
  | 'public' // 不主张保密（公开）
  | 'withheld'; // 不予披露（第三方隐私等，整段排除）

export interface PageRange {
  from: number;
  to: number;
}

export interface Rect {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/* ---------- 导入（文书包）输入 ---------- */

export interface ClaimInput {
  id?: string;
  doc: string; // 文书 key（优先）或标题
  version?: string; // 版本标签；缺省 = 该文书全部版本
  ranges: PageRange[];
  type: ClaimType;
  basis?: string;
  assertedBy?: string;
  assertedAt?: string;
}

export interface RedactionInput {
  id?: string;
  doc: string;
  version?: string;
  ranges: PageRange[];
  rects?: Rect[];
  note?: string;
}

export interface AnchorInput {
  id: string;
  doc: string;
  label: string; // 锚点文本，如 “第五条 验收”
  occurrences: { version: string; page: number }[];
}

export interface PacketVersionInput {
  label: string;
  fileName?: string;
  sha?: string;
  pageCount: number;
  /** 扫描件页码标签（物理页 -> 标签页码）；整体递减时判定为反向页码文件 */
  pageLabels?: number[];
}

export interface PacketDocInput {
  key?: string;
  title: string;
  summary?: string;
  versions: PacketVersionInput[];
  claims?: ClaimInput[];
  redactions?: RedactionInput[];
  anchors?: AnchorInput[];
}

export interface PacketInput {
  name: string;
  exportedAt?: string;
  docs: PacketDocInput[];
}

/* ---------- 归并后的实体 ---------- */

export interface DocE {
  key: string;
  title: string;
  summary: string;
}

export interface FileE {
  id: string;
  docKey: string;
  label: string;
  arriveSeq: number; // 到达批次序号（用于识别乱序到达）
  fileName: string;
  sha: string;
  pageCount: number;
  pageLabels?: number[];
  packetId: string;
  orderAcknowledged?: boolean; // 反向页码已确认翻转
  relabeledFrom?: string | null;
}

export interface ClaimSnapshot {
  at: string;
  kind: 'record' | 'amend';
  type: ClaimType;
  ranges: PageRange[];
  basis: string;
}

export interface ClaimE {
  id: string;
  docKey: string;
  version?: string;
  ranges: PageRange[];
  type: ClaimType;
  basis: string;
  assertedBy: string;
  createdAt: string;
  packetId?: string;
  active: boolean;
  withdrawnReason?: string;
  withdrawnAt?: string;
  mergedInto?: string | null;
  rev: number; // 变更次数，用于问题签名失效
  history: ClaimSnapshot[];
}

export interface RedE {
  id: string;
  docKey: string;
  version?: string;
  ranges: PageRange[];
  rects?: Rect[];
  note: string;
  createdAt: string;
  packetId?: string;
  active: boolean;
  withdrawnReason?: string;
  mergedInto?: string | null;
  sourceIds?: string[]; // 由哪些遮挡合并而来
  rev: number;
}

export interface AnchorOcc {
  id: string;
  version: string;
  page: number;
}

export interface AnchorE {
  id: string;
  docKey: string;
  label: string;
  occurrences: AnchorOcc[];
  /** 拆分后形成的独立锚点；原锚点随之退役，不再参与核对 */
  splitInto?: string[];
  /** 子锚点：来自哪个父锚点及第几个 */
  parentId?: string;
  childIndex?: number;
  resolution?:
    | { kind: 'pick'; choices: Record<string, string | null>; occSig: string } // version -> occId（null=确认该版本确无此锚点）
    | { kind: 'split' };
}

export interface ImportRec {
  packetId: string;
  name: string;
  at: string;
  by: string;
  digest: string;
  duplicateOf?: string;
  addedDocs: string[];
  mergedDocs: string[];
  addedFiles: { docKey: string; label: string }[];
  dedupedFiles: { docKey: string; label: string }[];
  addedClaims: number;
  dedupedClaims: number;
  addedRedactions: number;
  dedupedRedactions: number;
  addedAnchors: number;
}

export interface Resolution {
  at: string;
  by: string;
  sig: string;
  action: string;
  note?: string;
}

export interface ManifestEntry {
  fileId: string;
  docKey: string;
  title: string;
  version: string;
  fileName: string;
  pageCount: number;
  disclosedPages: PageRange[];
  redactedPages: PageRange[];
  protectedPages: PageRange[];
  withheldPages: PageRange[];
  claims: { type: ClaimType; ranges: PageRange[]; basis: string; assertedBy: string }[];
  status: 'disclose' | 'partial' | 'withheld';
}

export interface Manifest {
  id: string;
  at: string;
  by: string;
  entries: ManifestEntry[];
  sig: string;
  superseded?: boolean;
}

/* ---------- 审查问题 ---------- */

export type IssueKind =
  | 'duplicate_packet' // 重复包（信息，已自动归并）
  | 'out_of_order' // 乱序版本（信息，已自动归并）
  | 'version_conflict' // 同标签异内容（阻断）
  | 'reverse_pages' // 反向页码文件（阻断）
  | 'range_reversed' // 区间起止反向（阻断）
  | 'range_exceeds' // 区间超出页数（阻断）
  | 'conflicting_claims' // 同一文件冲突主张（阻断）
  | 'redaction_overlap' // 遮挡重叠（阻断）
  | 'redaction_adjacent' // 相邻遮挡（警告）
  | 'duplicate_claim' // 重复主张（信息）
  | 'claim_uncovered' // 保密页未遮挡（警告）
  | 'redaction_unfounded' // 遮挡无主张支撑（警告）
  | 'anchor_ambiguous' // 跨版本锚点歧义（阻断）
  | 'anchor_drift'; // 锚点漂移（信息）

export type IssueSeverity = 'blocking' | 'warning' | 'info';
export type IssueStatus = 'open' | 'accepted' | 'stale';

export interface IssueAction {
  id: string;
  label: string;
  kind:
    | 'relabel'
    | 'confirm_order'
    | 'fix_range'
    | 'withdraw_claim'
    | 'amend_claim'
    | 'withdraw_redaction'
    | 'merge_redactions'
    | 'resolve_anchor'
    | 'split_anchor'
    | 'accept';
  targetId?: string;
  targetType?: 'claim' | 'redaction';
  targetIds?: string[];
}

export interface Issue {
  key: string;
  kind: IssueKind;
  severity: IssueSeverity;
  status: IssueStatus;
  title: string;
  detail: string;
  docKey?: string;
  fileId?: string;
  anchorId?: string;
  relatedIds?: string[];
  actions?: IssueAction[];
}

/* ---------- 事件 ---------- */

interface EvBase {
  id: string;
  at: string;
  by: string;
}

export interface PacketImportedPayload {
  rec: ImportRec;
  docs: DocE[];
  files: FileE[];
  claims: ClaimE[];
  redactions: RedE[];
  anchors: AnchorE[];
}

export type AppEvent =
  | (EvBase & { type: 'log.cleared' })
  | (EvBase & { type: 'packet.imported'; packet: PacketImportedPayload })
  | (EvBase & {
      type: 'claim.recorded';
      claim: ClaimE;
    })
  | (EvBase & {
      type: 'claim.amended';
      claimId: string;
      before: { type: ClaimType; ranges: PageRange[]; basis: string };
      after: { type: ClaimType; ranges: PageRange[]; basis: string };
    })
  | (EvBase & { type: 'claim.withdrawn'; claimId: string; reason: string })
  | (EvBase & { type: 'redaction.recorded'; redaction: RedE })
  | (EvBase & {
      type: 'redaction.amended';
      redactionId: string;
      ranges: PageRange[];
    })
  | (EvBase & {
      type: 'redaction.merged';
      newId: string;
      sourceIds: string[];
      ranges: PageRange[];
      docKey: string;
      version?: string;
    })
  | (EvBase & { type: 'redaction.withdrawn'; redactionId: string; reason: string })
  | (EvBase & {
      type: 'anchor.resolved';
      anchorId: string;
      choices: Record<string, string | null>;
    })
  | (EvBase & { type: 'anchor.split'; anchorId: string; children: AnchorE[] })
  | (EvBase & { type: 'pages.orderConfirmed'; fileId: string })
  | (EvBase & {
      type: 'version.relabeled';
      fileId: string;
      from: string;
      to: string;
    })
  | (EvBase & { type: 'issue.accepted'; issueKey: string; sig: string; note: string })
  | (EvBase & { type: 'disclosure.generated'; manifest: Manifest });

export interface ReviewState {
  seq: number;
  docs: Record<string, DocE>;
  files: Record<string, FileE>;
  claims: Record<string, ClaimE>;
  redactions: Record<string, RedE>;
  anchors: Record<string, AnchorE>;
  imports: ImportRec[];
  resolutions: Record<string, Resolution>;
  manifests: Manifest[];
  events: AppEvent[];
}
