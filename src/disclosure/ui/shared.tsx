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

export function Ranges({ ranges }: { ranges: PageRange[] }) {
  if (!ranges.length) return <span className="muted">—</span>;
  return <span className="range-chip">{fmtRanges(ranges)}</span>;
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
