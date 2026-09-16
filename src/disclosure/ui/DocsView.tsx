// 文书库：文书/版本归并视图，登记与撤回主张、遮挡，查看版本与锚点
import { useMemo, useState } from 'react';
import {
  Ban,
  FileText,
  FolderInput,
  GitBranch,
  History,
  Layers,
  MapPinned,
  Pencil,
  Plus,
  RotateCcw,
  Shrink,
} from 'lucide-react';
import type { ReviewState, ClaimE, RedE, ClaimType, PageRange } from '../types';
import { docVersions } from '../engine';
import { cmpVersion, isOutOrder } from '../utils';
import { ClaimBadge, Empty, Ranges, fmtTime } from './shared';

const TYPE_OPTIONS: { value: ClaimType; label: string }[] = [
  { value: 'confidential', label: '商业秘密 / 保密信息' },
  { value: 'privileged', label: '律师工作成果 / 特权' },
  { value: 'withheld', label: '不予披露（整段排除）' },
  { value: 'public', label: '不主张保密（公开）' },
];

export function DocsView({
  state,
  onAddClaim,
  onAddRedaction,
  onWithdrawClaim,
  onAmendClaim,
  onWithdrawRedaction,
  onAmendRedaction,
}: {
  state: ReviewState;
  onAddClaim: (docKey: string, c: { version?: string; ranges: PageRange[]; type: ClaimType; basis: string; assertedBy: string }) => void;
  onAddRedaction: (docKey: string, r: { version?: string; ranges: PageRange[]; note: string }) => void;
  onWithdrawClaim: (c: ClaimE) => void;
  onAmendClaim: (c: ClaimE, patch: { type?: ClaimType; ranges?: PageRange[]; basis?: string }) => void;
  onWithdrawRedaction: (r: RedE) => void;
  onAmendRedaction: (r: RedE, ranges: PageRange[]) => void;
}) {
  const docs = Object.values(state.docs);
  const [activeKey, setActiveKey] = useState<string | null>(docs[0]?.key ?? null);
  const doc = docs.find((d) => d.key === activeKey) ?? docs[0];
  const [mode, setMode] = useState<'claim' | 'red' | null>(null);

  if (!doc) {
    return (
      <div className="pane-card">
        <Empty icon={<FolderInput size={26} />} title="还没有导入任何文书包" hint="点击右上角「导入文书包」，或选择演示案卷一键载入" />
      </div>
    );
  }

  const files = docVersions(state, doc.key);
  const latest = files[0]?.label;
  const claims = Object.values(state.claims)
    .filter((c) => c.docKey === doc.key)
    .sort((a, b) => Number(b.active) - Number(a.active) || a.createdAt.localeCompare(b.createdAt));
  const reds = Object.values(state.redactions)
    .filter((r) => r.docKey === doc.key)
    .sort((a, b) => Number(b.active) - Number(a.active) || a.createdAt.localeCompare(b.createdAt));
  const anchors = Object.values(state.anchors).filter((a) => a.docKey === doc.key);

  // 到达次序（用于标注乱序到达）
  const arrivals = files.slice().sort((a, b) => a.arriveSeq - b.arriveSeq || cmpVersion(a.label, b.label));
  const outOrderIds = new Set<string>();
  arrivals.forEach((f, i) => {
    if (i > 0 && isOutOrder(f.label, arrivals[i - 1].label)) outOrderIds.add(f.id);
  });

  return (
    <div className="docs-layout">
      <div className="doc-list pane-card">
        <div className="pane-head slim">
          <div>
            <h2>
              <FileText size={15} /> 文书（{docs.length}）
            </h2>
            <p>同名文书跨包自动归并，版本按版本号而非到达顺序排列</p>
          </div>
        </div>
        {docs.map((d) => {
          const n = docVersions(state, d.key).length;
          return (
            <button key={d.key} className={`doc-nav ${d.key === doc.key ? 'sel' : ''}`} onClick={() => setActiveKey(d.key)}>
              <FileText size={15} />
              <span>
                <b>{d.title}</b>
                <small>{n} 个版本</small>
              </span>
            </button>
          );
        })}
      </div>

      <div className="doc-main">
        <section className="pane-card">
          <div className="doc-title-row">
            <div>
              <h2>{doc.title}</h2>
              <p>{doc.summary || '未登记摘要'}</p>
            </div>
            <div className="doc-add-btns">
              <button className="btn-outline" onClick={() => setMode(mode === 'claim' ? null : 'claim')}>
                <Plus size={14} /> 登记主张
              </button>
              <button className="btn-outline" onClick={() => setMode(mode === 'red' ? null : 'red')}>
                <Plus size={14} /> 登记遮挡
              </button>
            </div>
          </div>

          {mode === 'claim' && (
            <ClaimForm
              versions={files.map((f) => f.label)}
              latest={latest}
              onCancel={() => setMode(null)}
              onSubmit={(c) => {
                onAddClaim(doc.key, c);
                setMode(null);
              }}
            />
          )}
          {mode === 'red' && (
            <RedactionForm
              versions={files.map((f) => f.label)}
              latest={latest}
              onCancel={() => setMode(null)}
              onSubmit={(r) => {
                onAddRedaction(doc.key, r);
                setMode(null);
              }}
            />
          )}

          <div className="version-strip">
            <div className="sub-head">
              <GitBranch size={14} /> 版本（{files.length}）
            </div>
            {files.map((f, idx) => (
              <div key={f.id} className="version-chip">
                <b>{f.label}</b>
              <span className="muted">{f.fileName} · {f.pageCount} 页</span>
                <span className="muted">第 {f.arriveSeq} 批到达</span>
                {idx === 0 && <span className="mini-flag latest">最新</span>}
                {outOrderIds.has(f.id) && <span className="mini-flag outorder">乱序到达·已归并</span>}
                {f.orderAcknowledged && <span className="mini-flag flipped">页码已翻转确认</span>}
                {f.relabeledFrom && <span className="mini-flag relabel">由 {f.relabeledFrom} 重新标记</span>}
              </div>
            ))}
          </div>
        </section>

        <section className="pane-card">
          <div className="sub-head">
            <Layers size={14} /> 保密主张（{claims.length}）
          </div>
          {claims.length === 0 && <Empty title="尚未登记主张" />}
          {claims.map((c) => (
            <ClaimRow
              key={c.id}
              claim={c}
              fileLabels={files.map((f) => f.label)}
              onWithdraw={() => onWithdrawClaim(c)}
              onAmend={(patch) => onAmendClaim(c, patch)}
            />
          ))}
        </section>

        <section className="pane-card">
          <div className="sub-head">
            <Shrink size={14} /> 遮挡登记（{reds.length}）
          </div>
          {reds.length === 0 && <Empty title="尚未登记遮挡" />}
          {reds.map((r) => (
            <RedRow key={r.id} red={r} onWithdraw={() => onWithdrawRedaction(r)} onAmend={(ranges) => onAmendRedaction(r, ranges)} />
          ))}
        </section>

        {anchors.length > 0 && (
          <section className="pane-card">
            <div className="sub-head">
              <MapPinned size={14} /> 跨版本锚点（{anchors.length}）
            </div>
            {anchors.map((a) => (
              <div key={a.id} className="anchor-line">
                <b>
                  <MapPinned size={13} /> {a.label}
                </b>
                <span className="muted">
                  {a.occurrences.map((o) => `${o.version}: p${o.page}`).join('　')}
                </span>
                {a.resolution && <span className="mini-flag latest">{a.resolution.kind === 'split' ? '已拆分' : '已逐版本对齐'}</span>}
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

function parseRangesText(text: string): PageRange[] {
  const ranges: PageRange[] = [];
  for (const part of text.split(/[,，、\s]+/).filter(Boolean)) {
    const m = /^(\d+)\s*[-–—至~～]\s*(\d+)$/.exec(part) ?? /^(\d+)$/.exec(part);
    if (!m) continue;
    const from = +m[1];
    const to = m[2] ? +m[2] : from;
    // 保留原序：起止反向交给分析器标出
    ranges.push({ from, to });
  }
  return ranges;
}

function ClaimForm({
  versions,
  latest,
  onSubmit,
  onCancel,
}: {
  versions: string[];
  latest?: string;
  onSubmit: (c: { version?: string; ranges: PageRange[]; type: ClaimType; basis: string; assertedBy: string }) => void;
  onCancel: () => void;
}) {
  const [version, setVersion] = useState(latest ?? versions[0] ?? '');
  const [type, setType] = useState<ClaimType>('confidential');
  const [pages, setPages] = useState('');
  const [basis, setBasis] = useState('');
  const [assertedBy, setAssertedBy] = useState('对方律师');
  const [err, setErr] = useState('');
  return (
    <div className="entry-form">
      <div className="form-grid">
        <label>
          <span>适用版本</span>
          <select value={version} onChange={(e) => setVersion(e.target.value)}>
            {versions.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>主张类型</span>
          <select value={type} onChange={(e) => setType(e.target.value as ClaimType)}>
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>页码区间</span>
          <input placeholder="如 5-8、12 或 5-8,11" value={pages} onChange={(e) => setPages(e.target.value)} />
        </label>
        <label>
          <span>主张方</span>
          <input value={assertedBy} onChange={(e) => setAssertedBy(e.target.value)} />
        </label>
        <label className="wide">
          <span>依据 / 说明</span>
          <input placeholder="如：协议第十二条 价格保密" value={basis} onChange={(e) => setBasis(e.target.value)} />
        </label>
      </div>
      {err && <div className="form-error">{err}</div>}
      <div className="form-actions">
        <button className="btn-outline" onClick={onCancel}>
          取消
        </button>
        <button
          className="btn-primary"
          onClick={() => {
            const ranges = parseRangesText(pages);
            if (!ranges.length) {
              setErr('请填写至少一个有效页码，如 5-8');
              return;
            }
            onSubmit({ version: version || undefined, ranges, type, basis, assertedBy: assertedBy || '对方律师' });
          }}
        >
          登记主张
        </button>
      </div>
    </div>
  );
}

function RedactionForm({
  versions,
  latest,
  onSubmit,
  onCancel,
}: {
  versions: string[];
  latest?: string;
  onSubmit: (r: { version?: string; ranges: PageRange[]; note: string }) => void;
  onCancel: () => void;
}) {
  const [version, setVersion] = useState(latest ?? versions[0] ?? '');
  const [pages, setPages] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  return (
    <div className="entry-form">
      <div className="form-grid">
        <label>
          <span>适用版本</span>
          <select value={version} onChange={(e) => setVersion(e.target.value)}>
            {versions.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>遮挡页码</span>
          <input placeholder="如 5-8、10 或 5-8,10" value={pages} onChange={(e) => setPages(e.target.value)} />
        </label>
        <label className="wide">
          <span>遮挡说明</span>
          <input placeholder="如：价格明细、第三方个人信息" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      {err && <div className="form-error">{err}</div>}
      <div className="form-actions">
        <button className="btn-outline" onClick={onCancel}>
          取消
        </button>
        <button
          className="btn-primary"
          onClick={() => {
            const ranges = parseRangesText(pages);
            if (!ranges.length) {
              setErr('请填写至少一个有效页码，如 5-8');
              return;
            }
            onSubmit({ version: version || undefined, ranges, note });
          }}
        >
          登记遮挡
        </button>
      </div>
    </div>
  );
}

function ClaimRow({
  claim,
  fileLabels,
  onWithdraw,
  onAmend,
}: {
  claim: ClaimE;
  fileLabels: string[];
  onWithdraw: () => void;
  onAmend: (patch: { type?: ClaimType; ranges?: PageRange[]; basis?: string }) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [type, setType] = useState<ClaimType>(claim.type);
  const [pages, setPages] = useState(claim.ranges.map((r) => (r.from === r.to ? `${r.from}` : `${r.from}-${r.to}`)).join('、'));
  const [basis, setBasis] = useState(claim.basis);
  const scope = useMemo(() => (claim.version ? claim.version : fileLabels.join('/') + ' 全版本'), [claim.version, fileLabels]);

  return (
    <div className={`reg-row ${claim.active ? '' : 'inactive'}`}>
      <div className="reg-main">
        <ClaimBadge type={claim.type} />
        <Ranges ranges={claim.ranges} />
        <span className="muted">{scope}</span>
        <span className="muted">{claim.assertedBy}</span>
        {claim.basis && <span className="reg-note">{claim.basis}</span>}
        {!claim.active && (
          <span className="withdrawn-tag">
            <Ban size={12} /> 已于 {fmtTime(claim.withdrawnAt ?? claim.createdAt)} 撤回
          </span>
        )}
      </div>
      {claim.active && (
        <div className="reg-ops">
          <button className="btn-link" onClick={() => setEditing((e) => !e)}>
            <Pencil size={13} /> 变更
          </button>
          <button className="btn-link danger" onClick={onWithdraw}>
            <RotateCcw size={13} /> 撤回主张
          </button>
        </div>
      )}
      {claim.active && claim.history.length > 1 && (
        <div className="rev-tag">
          <History size={12} /> v{claim.rev} · 已变更 {claim.history.length - 1} 次
        </div>
      )}
      {editing && (
        <div className="amend-box">
          <div className="form-grid">
            <label>
              <span>类型</span>
              <select value={type} onChange={(e) => setType(e.target.value as ClaimType)}>
                {TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>页码区间</span>
              <input value={pages} onChange={(e) => setPages(e.target.value)} />
            </label>
            <label className="wide">
              <span>依据</span>
              <input value={basis} onChange={(e) => setBasis(e.target.value)} />
            </label>
          </div>
          <div className="form-actions">
            <button className="btn-outline" onClick={() => setEditing(false)}>
              取消
            </button>
            <button
              className="btn-primary"
              onClick={() => {
                const ranges = parseRangesText(pages);
                if (!ranges.length) return;
                onAmend({ type, ranges, basis });
                setEditing(false);
              }}
            >
              保存变更（旧结论将失效）
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function RedRow({ red, onWithdraw, onAmend }: { red: RedE; onWithdraw: () => void; onAmend: (ranges: PageRange[]) => void }) {
  const [editing, setEditing] = useState(false);
  const [pages, setPages] = useState(red.ranges.map((r) => (r.from === r.to ? `${r.from}` : `${r.from}-${r.to}`)).join('、'));
  return (
    <div className={`reg-row ${red.active ? '' : 'inactive'}`}>
      <div className="reg-main">
        <span className="redact-tag">
          <Shrink size={12} /> 遮挡
        </span>
        <Ranges ranges={red.ranges} />
        <span className="muted">{red.version ?? '全版本'}</span>
        {red.note && <span className="reg-note">{red.note}</span>}
        {red.mergedInto && <span className="mini-flag relabel">已合并</span>}
        {!red.active && red.withdrawnReason && <span className="withdrawn-tag"><Ban size={12} /> 已撤回</span>}
        {red.sourceIds && <span className="mini-flag latest">由 {red.sourceIds.length} 条合并</span>}
      </div>
      {red.active && !red.mergedInto && (
        <div className="reg-ops">
          <button className="btn-link" onClick={() => setEditing((e) => !e)}>
            <Pencil size={13} /> 更正页码
          </button>
          <button className="btn-link danger" onClick={onWithdraw}>
            <RotateCcw size={13} /> 撤回遮挡
          </button>
        </div>
      )}
      {editing && (
        <div className="amend-box">
          <div className="form-grid">
            <label className="wide">
              <span>遮挡页码（并集自动归一）</span>
              <input value={pages} onChange={(e) => setPages(e.target.value)} />
            </label>
          </div>
          <div className="form-actions">
            <button className="btn-outline" onClick={() => setEditing(false)}>
              取消
            </button>
            <button
              className="btn-primary"
              onClick={() => {
                const ranges = parseRangesText(pages);
                if (!ranges.length) return;
                onAmend(ranges);
                setEditing(false);
              }}
            >
              保存更正
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
