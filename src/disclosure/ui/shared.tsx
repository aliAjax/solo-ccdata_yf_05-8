// 共享小组件与格式化
import type { ReactNode } from 'react';
import type { ClaimType, IssueSeverity, IssueStatus, PageRange } from '../types';
import { claimLabel } from '../engine';
import { fmtRanges } from '../utils';

export const SEV_META: Record<IssueSeverity, { text: string; cls: string }> = {
  blocking: { text: '阻断', cls: 'sev-block' },
  warning: { text: '警告', cls: 'sev-warn' },
  info: { text: '信息', cls: 'sev-info' },
};

export const STATUS_META: Record<IssueStatus, { text: string; cls: string }> = {
  open: { text: '待解决', cls: 'st-open' },
  accepted: { text: '已处置', cls: 'st-accepted' },
  stale: { text: '结论已失效', cls: 'st-stale' },
};

export function SeverityBadge({ severity }: { severity: IssueSeverity }) {
  const m = SEV_META[severity];
  return <span className={`badge ${m.cls}`}>{m.text}</span>;
}

export function StatusBadge({ status }: { status: IssueStatus }) {
  const m = STATUS_META[status];
  return <span className={`badge ${m.cls}`}>{m.text}</span>;
}

const CLAIM_CLS: Record<ClaimType, string> = {
  confidential: 'claim-conf',
  privileged: 'claim-priv',
  public: 'claim-public',
  withheld: 'claim-withheld',
};

export function ClaimBadge({ type }: { type: ClaimType }) {
  return <span className={`claim-tag ${CLAIM_CLS[type]}`}>{claimLabel(type)}</span>;
}

export function Ranges({ ranges, raw }: { ranges: PageRange[]; raw?: boolean }) {
  if (!ranges.length) return <span className="muted">—</span>;
  // raw：保留登记的原始页序（含起止反向），并明确标出
  const text = raw
    ? ranges
        .map((r) => {
          if (r.from === r.to) return `p${r.from}`;
          if (r.from > r.to) return `p${r.from}→p${r.to}（反向）`;
          return `p${r.from}-p${r.to}`;
        })
        .join('、')
    : fmtRanges(ranges);
  const hasReverse = raw && ranges.some((r) => r.from > r.to);
  return <span className={`range-chip ${hasReverse ? 'is-reverse' : ''}`}>{text}</span>;
}

export function Empty({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div className="empty">
      {icon ?? null}
      <b>{title}</b>
      {hint && <small>{hint}</small>}
    </div>
  );
}

export function fmtTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
