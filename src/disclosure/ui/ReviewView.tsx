// 审查台：按问题逐条处置；所有动作都落到事件日志，撤回/变更后旧结论自动失效
import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  Check,
  Copy,
  FileWarning,
  GitBranch,
  History,
  Info,
  Link2Off,
  MapPinned,
  Merge,
  Pencil,
  ScanSearch,
  ShieldAlert,
} from 'lucide-react';
import type { AnalyzedIssue } from '../engine';
import type { IssueKind } from '../types';
import { Empty, SeverityBadge, StatusBadge } from './shared';

const KIND_ICON: Record<IssueKind, typeof Info> = {
  duplicate_packet: Copy,
  out_of_order: GitBranch,
  version_conflict: FileWarning,
  reverse_pages: ScanSearch,
  range_reversed: Pencil,
  range_exceeds: FileWarning,
  conflicting_claims: ShieldAlert,
  redaction_overlap: Ban,
  redaction_adjacent: Merge,
  duplicate_claim: Copy,
  claim_uncovered: AlertTriangle,
  redaction_unfounded: AlertTriangle,
  anchor_ambiguous: MapPinned,
  anchor_drift: History,
};

type Filter = 'open' | 'all' | 'blocking' | 'stale';

export function ReviewView({
  issues,
  blocking,
  onAction,
}: {
  issues: AnalyzedIssue[];
  blocking: number;
  onAction: (issue: AnalyzedIssue, actionId: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>('open');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const counts = useMemo(
    () => ({
      open: issues.filter((i) => i.status === 'open').length,
      blocking: issues.filter((i) => i.status === 'open' && i.severity === 'blocking').length,
      stale: issues.filter((i) => i.status === 'stale').length,
      all: issues.length,
    }),
    [issues],
  );

  const list = issues.filter((i) =>
    filter === 'all' ? true : filter === 'open' ? i.status === 'open' : filter === 'stale' ? i.status === 'stale' : i.status === 'open' && i.severity === 'blocking',
  );
  const selected = issues.find((i) => i.key === selectedKey) ?? list[0] ?? null;

  return (
    <div className="workspace dc-workspace">
      <div className="table-pane">
        <div className="pane-head">
          <div>
            <h2>审查问题</h2>
            <p>阻断项未全部解决前，不能生成披露清单</p>
          </div>
          <div className="seg">
            {(
              [
                ['open', `待处理 ${counts.open}`],
                ['blocking', `阻断 ${counts.blocking}`],
                ['stale', `已失效 ${counts.stale}`],
                ['all', `全部 ${counts.all}`],
              ] as [Filter, string][]
            ).map(([k, label]) => (
              <button key={k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {list.length === 0 ? (
          <Empty
            icon={<Check size={26} />}
            title={filter === 'open' ? '没有待处理的问题' : '该分类下暂无问题'}
            hint={blocking === 0 ? '可以前往「披露清单」生成清单' : undefined}
          />
        ) : (
          <div className="issue-list">
            {list.map((i) => {
              const Icon = KIND_ICON[i.kind];
              return (
                <button key={i.key} className={`issue-row sev-${i.severity} ${selected?.key === i.key ? 'sel' : ''}`} onClick={() => setSelectedKey(i.key)}>
                  <span className="issue-icon">
                    <Icon size={15} />
                  </span>
                  <span className="issue-body">
                    <b>{i.title}</b>
                    <small>{i.detail}</small>
                  </span>
                  <span className="issue-tags">
                    <SeverityBadge severity={i.severity} />
                    <StatusBadge status={i.status} />
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {selected && (
        <IssueDetail key={selected.key + selected.status + selected.sig} issue={selected} onAction={onAction} />
      )}
    </div>
  );
}

function IssueDetail({ issue, onAction }: { issue: AnalyzedIssue; onAction: (issue: AnalyzedIssue, actionId: string) => void }) {
  const Icon = KIND_ICON[issue.kind];
  return (
    <div className="detail issue-detail">
      <div className="detail-head">
        <div className="detail-icon">
          <Icon size={19} />
        </div>
        <div>
          <span>REVIEW ISSUE</span>
          <h2>{issue.title}</h2>
        </div>
      </div>

      <div className="issue-meta">
        <SeverityBadge severity={issue.severity} />
        <StatusBadge status={issue.status} />
      </div>

      <p className="issue-detail-text">{issue.detail}</p>

      {issue.status === 'stale' && (
        <div className="stale-note">
          <Link2Off size={15} />
          <div>
            <b>此前的处置结论已失效</b>
            <p>该问题所依据的主张、遮挡或锚点证据在处置后发生了撤回/变更/补证。请按当前事实重新处置；旧结论仍保留在操作轨迹中。</p>
          </div>
        </div>
      )}
      {issue.status === 'accepted' && (
        <div className="accepted-note">
          <Check size={15} />
          <div>
            <b>该问题已处置，且依据未再变化</b>
            <p>如事实发生变化，本结论会立刻转为“已失效”。处置记录可在「操作轨迹」中追溯。</p>
          </div>
        </div>
      )}

      {issue.actions && issue.actions.length > 0 && issue.status !== 'accepted' && (
        <div className="action-stack">
          {issue.actions.map((a) => (
            <button key={a.id} className="action-btn" onClick={() => onAction(issue, a.id)}>
              {a.kind.includes('withdraw') ? <Ban size={14} /> : a.kind.includes('merge') ? <Merge size={14} /> : <Check size={14} />}
              {a.label}
            </button>
          ))}
        </div>
      )}
      {(!issue.actions || issue.actions.length === 0) && issue.status === 'open' && (
        <div className="action-stack">
          <button className="action-btn ghost" onClick={() => onAction(issue, 'accept')}>
            <Info size={14} /> 已知悉并备注（信息类问题）
          </button>
        </div>
      )}
    </div>
  );
}
