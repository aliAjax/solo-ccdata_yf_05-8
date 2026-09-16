// 操作轨迹：完整事件日志（刷新后由事件重放恢复），撤回/变更不覆盖旧记录
import { useMemo, useState } from 'react';
import {
  ArrowDownWideNarrow,
  Ban,
  CheckCircle2,
  FileSignature,
  FileUp,
  GitBranch,
  History,
  MapPinned,
  Merge,
  Pencil,
  Plus,
  RotateCcw,
  ScanSearch,
  Tags,
} from 'lucide-react';
import type { AppEvent, ReviewState } from '../types';
import { claimLabel } from '../engine';
import { fmtRanges, fmtRangesRaw } from '../utils';
import { Empty, fmtTime } from './shared';

const EVENT_TEXT: Partial<Record<AppEvent['type'], string>> = {
  'packet.imported': '导入文书包',
  'claim.recorded': '登记保密主张',
  'claim.amended': '变更保密主张',
  'claim.withdrawn': '撤回主张',
  'redaction.recorded': '登记遮挡',
  'redaction.amended': '更正遮挡页码',
  'redaction.merged': '合并遮挡',
  'redaction.withdrawn': '撤回遮挡',
  'anchor.resolved': '锚点逐版本对齐',
  'anchor.split': '锚点拆分处理',
  'pages.orderConfirmed': '确认反向页码并翻转',
  'version.relabeled': '重新标记版本',
  'issue.accepted': '登记问题处置结论',
  'disclosure.generated': '生成披露清单',
  'log.cleared': '清空记录',
};

export function TrailView({ state, log }: { state: ReviewState; log: AppEvent[] }) {
  const [onlyActive, setOnlyActive] = useState(false);

  const rows = useMemo(() => {
    const reversed = log.slice().reverse();
    return reversed.map((ev) => describe(ev, state));
  }, [log, state]);

  const filtered = onlyActive ? rows.filter((r) => r.affects) : rows;

  return (
    <div className="pane-card trail-card">
      <div className="pane-head slim">
        <div>
          <h2>
            <History size={15} /> 操作轨迹（{log.length}）
          </h2>
          <p>全部操作以事件形式留存；撤回与变更新增记录、不覆盖旧记录。刷新页面后据此重放恢复。</p>
        </div>
        <label className="toggle-inline">
          <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} /> 只看影响当前事实的操作
        </label>
      </div>
      {rows.length === 0 ? (
        <Empty icon={<History size={26} />} title="暂无操作记录" hint="导入文书包后，每一步归并、撤回、变更都会留痕" />
      ) : (
        <ol className="trail">
          {filtered.map((r) => {
            const Icon = r.icon;
            return (
              <li key={r.key} className={`trail-item ${r.tone}`}>
                <span className="trail-icon">
                  <Icon size={14} />
                </span>
                <div className="trail-body">
                  <div className="trail-title">
                    <b>{r.title}</b>
                    {r.badge && <span className={`trail-badge ${r.badge.cls}`}>{r.badge.text}</span>}
                  </div>
                  {r.lines.map((line, i) => (
                    <p key={i}>{line}</p>
                  ))}
                </div>
                <span className="trail-time">
                  {fmtTime(r.at)}
                  <small>{r.by}</small>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

interface Row {
  key: string;
  at: string;
  by: string;
  title: string;
  icon: typeof History;
  lines: string[];
  tone: 'normal' | 'danger' | 'good';
  badge?: { text: string; cls: string };
  affects: boolean;
}

function describe(ev: AppEvent, state: ReviewState): Row {
  const base = { key: ev.id, at: ev.at, by: ev.by };
  const docTitle = (k?: string) => (k ? state.docs[k]?.title ?? k : '');
  switch (ev.type) {
    case 'packet.imported': {
      const r = ev.packet.rec;
      const dup = Boolean(r.duplicateOf);
      return {
        ...base,
        title: `${EVENT_TEXT[ev.type]}：${r.name}`,
        icon: FileUp,
        tone: dup ? 'good' : 'normal',
        badge: dup ? { text: '重复包·整体跳过', cls: 'b-good' } : undefined,
        affects: !dup,
        lines: [
          dup
            ? `内容指纹与「${state.imports.find((i) => i.packetId === r.duplicateOf)?.name}」一致，未新增任何文件、主张或遮挡（跳过版本 ${r.dedupedFiles.length}、主张 ${r.dedupedClaims}、遮挡 ${r.dedupedRedactions}）`
            : `新增文书 ${r.addedDocs.length ? r.addedDocs.join('、') : '无'}${r.mergedDocs.length ? `；并入既有文书 ${r.mergedDocs.map(docTitle).join('、')}` : ''}；新增版本 ${r.addedFiles
                .map((f) => `${docTitle(f.docKey)} ${f.label}`)
                .join('、') || '无'}${r.dedupedFiles.length ? `；同哈希去重 ${r.dedupedFiles.length} 个版本` : ''}`,
          `主张 +${r.addedClaims}${r.dedupedClaims ? `（去重 ${r.dedupedClaims}）` : ''}，遮挡 +${r.addedRedactions}${r.dedupedRedactions ? `（去重 ${r.dedupedRedactions}）` : ''}，锚点 +${r.addedAnchors}`,
        ],
      };
    }
    case 'claim.recorded': {
      const c = ev.claim;
      return {
        ...base,
        title: `登记主张：${claimLabel(c.type)} ${fmtRangesRaw(c.ranges)}`,
        icon: Plus,
        tone: 'normal',
        affects: true,
        lines: [`${docTitle(c.docKey)} ${c.version ?? '全版本'}｜主张方：${c.assertedBy}｜依据：${c.basis || '未填写'}`],
      };
    }
    case 'claim.amended': {
      const c = state.claims[ev.claimId];
      return {
        ...base,
        title: `变更主张：${claimLabel(ev.before.type)} ${fmtRangesRaw(ev.before.ranges)} → ${claimLabel(ev.after.type)} ${fmtRangesRaw(ev.after.ranges)}`,
        icon: Pencil,
        tone: 'normal',
        badge: { text: '相关旧结论已失效', cls: 'b-warn' },
        affects: true,
        lines: [
          `${docTitle(c?.docKey)} ${c?.version ?? '全版本'}`,
          ev.before.basis !== ev.after.basis ? `依据：「${ev.before.basis || '无'}」→「${ev.after.basis || '无'}」` : '依据未变',
        ],
      };
    }
    case 'claim.withdrawn': {
      const c = state.claims[ev.claimId];
      return {
        ...base,
        title: `撤回主张：${c ? claimLabel(c.type) : ''} ${c ? fmtRanges(c.ranges) : ''}`,
        icon: Ban,
        tone: 'danger',
        badge: { text: '旧结论立即失效', cls: 'b-danger' },
        affects: true,
        lines: [`${docTitle(c?.docKey)} ${c?.version ?? '全版本'}｜撤回原因：${ev.reason}`],
      };
    }
    case 'redaction.recorded':
      return {
        ...base,
        title: `登记遮挡：${fmtRangesRaw(ev.redaction.ranges)}`,
        icon: ArrowDownWideNarrow,
        tone: 'normal',
        affects: true,
        lines: [`${docTitle(ev.redaction.docKey)} ${ev.redaction.version ?? '全版本'}｜${ev.redaction.note || '无说明'}`],
      };
    case 'redaction.amended': {
      const r = state.redactions[ev.redactionId];
      return {
        ...base,
        title: `更正遮挡页码：${fmtRanges(ev.ranges)}`,
        icon: Pencil,
        tone: 'normal',
        badge: { text: '相关旧结论已失效', cls: 'b-warn' },
        affects: true,
        lines: [`${docTitle(r?.docKey)} ${r?.version ?? '全版本'}`],
      };
    }
    case 'redaction.merged': {
      return {
        ...base,
        title: `合并遮挡：${fmtRanges(ev.ranges)}`,
        icon: Merge,
        tone: 'normal',
        affects: true,
        lines: [`${docTitle(ev.docKey)} ${ev.version ?? '全版本'}｜原 ${ev.sourceIds.length} 条遮挡标记为已合并，新遮挡取并集`],
      };
    }
    case 'redaction.withdrawn': {
      const r = state.redactions[ev.redactionId];
      return {
        ...base,
        title: `撤回遮挡：${r ? fmtRanges(r.ranges) : ''}`,
        icon: Ban,
        tone: 'danger',
        badge: { text: '旧结论立即失效', cls: 'b-danger' },
        affects: true,
        lines: [`${docTitle(r?.docKey)}｜原因：${ev.reason}`],
      };
    }
    case 'anchor.resolved': {
      const a = state.anchors[ev.anchorId];
      return {
        ...base,
        title: `锚点逐版本对齐：「${a?.label ?? ev.anchorId}」`,
        icon: MapPinned,
        tone: 'good',
        affects: true,
        lines: Object.entries(ev.choices).map(([v, occ]) => {
          const page = a?.occurrences.find((o) => o.id === occ)?.page;
          return `${v} → ${page ? `第 ${page} 页` : '确认该版本无此锚点'}`;
        }),
      };
    }
    case 'anchor.split': {
      const a = state.anchors[ev.anchorId];
      return {
        ...base,
        title: `拆分锚点：「${a?.label ?? ev.anchorId}」→ ${ev.children.length} 个独立锚点`,
        icon: MapPinned,
        tone: 'normal',
        badge: { text: `逐项对齐前仍阻断（${ev.children.length} 项待处理）`, cls: 'b-warn' },
        affects: true,
        lines: ev.children.map((c) => `${c.label}：${c.occurrences.length ? c.occurrences.map((o) => `${o.version} p${o.page}`).join('、') : '暂无候选'}`),
      };
    }
    case 'pages.orderConfirmed': {
      const f = state.files[ev.fileId];
      return {
        ...base,
        title: `确认扫描倒序并翻转页码：${docTitle(f?.docKey)} ${f?.label ?? ''}`,
        icon: ScanSearch,
        tone: 'good',
        affects: true,
        lines: [`${f?.fileName ?? ''}：页码已按正确顺序重新对齐`],
      };
    }
    case 'version.relabeled': {
      const f = state.files[ev.fileId];
      return {
        ...base,
        title: `版本标签更正：${ev.from} → ${ev.to}`,
        icon: Tags,
        tone: 'normal',
        affects: true,
        lines: [docTitle(f?.docKey)],
      };
    }
    case 'issue.accepted':
      return {
        ...base,
        title: `登记问题处置结论${ev.note ? `：${ev.note}` : ''}`,
        icon: CheckCircle2,
        tone: 'normal',
        affects: false,
        lines: [`问题 ${ev.issueKey}；若所依据事实变化，该结论自动转为“已失效”`],
      };
    case 'disclosure.generated':
      return {
        ...base,
        title: `生成披露清单 ${ev.manifest.id}（${ev.manifest.entries.length} 个文件版本）`,
        icon: FileSignature,
        tone: ev.manifest.superseded ? 'danger' : 'good',
        badge: { text: '后随撤回/变更会失效', cls: 'b-warn' },
        affects: true,
        lines: [`结论签名 ${ev.manifest.sig}`],
      };
    case 'log.cleared':
      return { ...base, title: '清空全部记录', icon: RotateCcw, tone: 'danger', affects: false, lines: [] };
    default:
      return { ...base, title: EVENT_TEXT[(ev as { type: AppEvent['type'] }).type] ?? '操作', icon: GitBranch, tone: 'normal', affects: true, lines: [] };
  }
}
