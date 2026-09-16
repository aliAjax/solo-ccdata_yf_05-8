// 案件披露材料审查 · 应用外壳：导航、统计、动作分发（全部落到事件日志）
import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookLock,
  FileStack,
  FileUp,
  GitBranch,
  History,
  Layers3,
  ScrollText,
  ShieldQuestion,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { ReviewStore } from './store';
import type { AnalyzedIssue } from './engine';
import { analyze, claimLabel, docVersions } from './engine';
import * as cmd from './commands';
import { clampRanges, fmtRanges, normRange, unionRanges } from './utils';
import type { ClaimE, ClaimType, PageRange, PacketInput, RedE } from './types';
import { DocsView } from './ui/DocsView';
import { ReviewView } from './ui/ReviewView';
import { ManifestView } from './ui/ManifestView';
import { TrailView } from './ui/TrailView';
import { ImportModal } from './ui/ImportModal';
import { AnchorResolveModal, Modal, PromptModal } from './ui/Modals';
import { demoBatch } from './demo';
import { ClaimBadge } from './ui/shared';

type Tab = 'docs' | 'review' | 'manifest' | 'trail';

const ACTOR = '书记员·林';

interface PendingPrompt {
  title: string;
  label: string;
  initial?: string;
  placeholder?: string;
  confirmText?: string;
  danger?: boolean;
  body?: string;
  resolve: (value: string) => void;
}

export default function Disclosure({ store, initialTab }: { store: ReviewStore; initialTab?: Tab }) {
  const { state, log, append, importPackets, clearLog } = store;
  const analysis = useMemo(() => analyze(state), [state]);
  const [tab, setTab] = useState<Tab>(initialTab ?? 'review');
  const [showImport, setShowImport] = useState(false);
  const [pending, setPending] = useState<PendingPrompt | null>(null);
  const [anchorModal, setAnchorModal] = useState<AnalyzedIssue | null>(null);
  const [amendTarget, setAmendTarget] = useState<ClaimE | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 3200);
  };

  const ask = (p: Omit<PendingPrompt, 'resolve'>): Promise<string> =>
    new Promise((resolve) => setPending({ ...p, resolve }));

  const counts = {
    docs: Object.keys(state.docs).length,
    files: Object.keys(state.files).length,
    claims: Object.values(state.claims).filter((c) => c.active).length,
    redactions: Object.values(state.redactions).filter((r) => r.active).length,
  };

  /* ---------------- 问题动作分发 ---------------- */
  const onIssueAction = async (issue: AnalyzedIssue, actionId: string) => {
    const action = issue.actions?.find((a) => a.id === actionId);
    const kind = action?.kind ?? (actionId === 'accept' ? 'accept' : '');
    const file = issue.fileId ? state.files[issue.fileId] : undefined;
    if (kind !== 'accept' && !action) return;

    switch (kind) {
      case 'accept': {
        const note = await ask({
          title: '登记处置结论',
          label: '处置说明（可留空）',
          placeholder: '如：已与主办律师确认，该页为公开通知',
          confirmText: '登记结论',
        });
        setPending(null);
        append(cmd.acceptIssue(issue.key, issue.sig, note, { by: ACTOR }));
        flash('处置结论已登记；事实变化时会自动失效');
        return;
      }
      case 'confirm_order':
        append(cmd.confirmPageOrder(issue.fileId!, { by: ACTOR }));
        flash('已确认扫描倒序，页码顺序翻转');
        return;
      case 'relabel': {
        const related = issue.relatedIds ?? [];
        const targetId = related.find((id) => id !== issue.fileId) ?? related[0];
        const target = targetId ? state.files[targetId] : undefined;
        if (!target) return;
        const to = await ask({
          title: '重新标记版本标签',
          label: `为文件「${target.fileName}」输入正确的版本标签`,
          initial: target.label + '-b',
          confirmText: '重新标记',
          body: '同一标签下存在内容不同的文件。重新标记后，系统按新标签归位，版本冲突即解除。',
        });
        setPending(null);
        if (to && to !== target.label) {
          append(cmd.relabelVersion(target.id, target.label, to, { by: ACTOR }));
          flash(`版本标签已更正为 ${to}`);
        }
        return;
      }
      case 'fix_range': {
        const maxPage = file?.pageCount ?? 0;
        if (action!.targetType === 'claim' && action!.targetId) {
          const c = state.claims[action!.targetId];
          if (!c) return;
          const hasReverse = c.ranges.some((r) => r.from > r.to);
          const next: PageRange[] = hasReverse
            ? c.ranges.map(normRange)
            : clampRanges(c.ranges, maxPage);
          append(cmd.amendClaim(c, { ranges: next }, { by: ACTOR }));
          flash(hasReverse ? '已交换起止页，反向区间问题消除' : `已裁剪到文件页数（${maxPage} 页）`);
        } else if (action!.targetType === 'redaction' && action!.targetId) {
          const r = state.redactions[action!.targetId];
          if (!r) return;
          const hasReverse = r.ranges.some((x) => x.from > x.to);
          const next: PageRange[] = hasReverse
            ? r.ranges.map(normRange)
            : clampRanges(r.ranges, maxPage);
          append(cmd.amendRedaction(r, next, { by: ACTOR }));
          flash(hasReverse ? '已交换遮挡区间起止页' : `已裁剪遮挡到 ${maxPage} 页`);
        }
        return;
      }
      case 'withdraw_claim': {
        const c = action!.targetId ? state.claims[action!.targetId] : undefined;
        if (!c) return;
        const reason = await ask({
          title: '撤回保密主张',
          label: '撤回原因',
          placeholder: '如：经核实不再主张该页保密',
          confirmText: '确认撤回',
          danger: true,
          body: `将撤回「${fmtRanges(c.ranges)}」的 ${claimLabel(c.type)} 主张。撤回后相关问题结论与已生成清单立即失效，撤回记录保留在轨迹中。`,
        });
        setPending(null);
        if (reason) {
          append(cmd.withdrawClaim(c, reason, { by: ACTOR }));
          flash('主张已撤回，旧结论立即失效');
        }
        return;
      }
      case 'amend_claim': {
        const c = action!.targetId ? state.claims[action!.targetId] : undefined;
        if (c) setAmendTarget(c);
        return;
      }
      case 'withdraw_redaction': {
        const r = action!.targetId ? state.redactions[action!.targetId] : undefined;
        if (!r) return;
        const reason = await ask({
          title: '撤回遮挡',
          label: '撤回原因',
          placeholder: '如：遮挡系重复登记',
          confirmText: '确认撤回',
          danger: true,
        });
        setPending(null);
        if (reason) {
          append(cmd.withdrawRedaction(r, reason, { by: ACTOR }));
          flash('遮挡已撤回，旧结论立即失效');
        }
        return;
      }
      case 'merge_redactions': {
        const ids = action!.targetIds ?? [];
        const reds = ids.map((id) => state.redactions[id]).filter(Boolean) as RedE[];
        if (reds.length < 2) return;
        append(cmd.mergeRedactions(state, ids, unionRanges(reds.flatMap((r) => r.ranges)), { by: ACTOR }));
        flash(`已合并为一条遮挡：${fmtRanges(unionRanges(reds.flatMap((r) => r.ranges)))}`);
        return;
      }
      case 'resolve_anchor':
        setAnchorModal(issue);
        return;
      case 'split_anchor':
        if (issue.anchorId) {
          append(cmd.splitAnchor(state, issue.anchorId, { by: ACTOR }));
          flash('已拆分为独立锚点；请逐项完成逐版本对齐，全部对齐前仍不能生成清单');
        }
        return;
      default:
        return;
    }
  };

  /* ---------------- 文书库动作 ---------------- */
  const addClaim: Parameters<typeof DocsView>[0]['onAddClaim'] = (docKey, c) => {
    append(cmd.recordClaim(state, { docKey, ...c }, { by: ACTOR }));
    flash('主张已登记');
  };
  const addRedaction: Parameters<typeof DocsView>[0]['onAddRedaction'] = (docKey, r) => {
    append(cmd.recordRedaction({ docKey, ...r }, { by: ACTOR }));
    flash('遮挡已登记');
  };
  const withdrawClaimFromDoc = async (c: ClaimE) => {
    const reason = await ask({
      title: '撤回保密主张',
      label: '撤回原因',
      confirmText: '确认撤回',
      danger: true,
      placeholder: '撤回后相关结论立即失效',
    });
    setPending(null);
    if (reason) {
      append(cmd.withdrawClaim(c, reason, { by: ACTOR }));
      flash('主张已撤回');
    }
  };
  const amendClaimFromDoc = (c: ClaimE, patch: { type?: ClaimType; ranges?: PageRange[]; basis?: string }) => {
    append(cmd.amendClaim(c, patch, { by: ACTOR }));
    flash('主张已变更，旧结论立即失效');
  };
  const withdrawRedFromDoc = async (r: RedE) => {
    const reason = await ask({
      title: '撤回遮挡',
      label: '撤回原因',
      confirmText: '确认撤回',
      danger: true,
    });
    setPending(null);
    if (reason) {
      append(cmd.withdrawRedaction(r, reason, { by: ACTOR }));
      flash('遮挡已撤回');
    }
  };
  const amendRedFromDoc = (r: RedE, ranges: PageRange[]) => {
    append(cmd.amendRedaction(r, ranges, { by: ACTOR }));
    flash('遮挡页码已更正');
  };

  const onImport = (packets: PacketInput[]) => {
    importPackets(packets, { by: ACTOR });
    setShowImport(false);
    setTab('review');
    flash(`已顺序导入 ${packets.length} 个文书包，重复内容已自动归并`);
  };

  const loadDemo = () => {
    importPackets(demoBatch, { by: ACTOR });
    setTab('review');
    flash('演示案卷已载入：含重复包、乱序版本、重叠/相邻遮挡、反向页码与锚点歧义');
  };

  const openBlocking = analysis.blocking;

  return (
    <div className="shell dc-shell">
      <aside>
        <div className="brand">
          <div className="brand-icon dc-brand">
            <BookLock size={18} />
          </div>
          <div>
            <b>Disclosure Desk</b>
            <small>案件披露材料审查</small>
          </div>
        </div>
        <div className="nav-title">CASE REVIEW</div>
        <NavButton icon={ShieldQuestion} label="审查台" active={tab === 'review'} onClick={() => setTab('review')} badge={openBlocking} danger />
        <NavButton icon={FileStack} label="文书库" active={tab === 'docs'} onClick={() => setTab('docs')} badge={counts.docs} />
        <NavButton icon={ScrollText} label="披露清单" active={tab === 'manifest'} onClick={() => setTab('manifest')} />
        <NavButton icon={History} label="操作轨迹" active={tab === 'trail'} onClick={() => setTab('trail')} badge={log.length} />

        <div className="aside-bottom">
          <div className="mini-card dc-mini">
            <GitBranch size={16} />
            <div>
              <b>{openBlocking > 0 ? `${openBlocking} 个阻断问题` : '无阻断问题'}</b>
              <small>{openBlocking > 0 ? '解决前不能生成披露清单' : '可生成披露清单（警告不阻断）'}</small>
            </div>
          </div>
          <button className="nav" onClick={() => setShowImport(true)}>
            <FileUp size={16} /> 导入文书包
          </button>
          {log.length === 0 && (
            <button className="nav" onClick={loadDemo}>
              <Sparkles size={16} /> 一键载入演示案卷
            </button>
          )}
          {log.length > 0 && (
            <button
              className="nav danger-nav"
              onClick={async () => {
                const v = await ask({
                  title: '清空全部审查记录',
                  label: '输入“清空”确认',
                  confirmText: '清空',
                  danger: true,
                });
                setPending(null);
                if (v === '清空') {
                  clearLog();
                  flash('记录已清空');
                }
              }}
            >
              <Trash2 size={16} /> 清空记录
            </button>
          )}
          <div className="user">
            <div className="avatar dc-av">林</div>
            <span>{ACTOR}</span>
          </div>
        </div>
      </aside>

      <main>
        <header>
          <div>
            <div className="crumb">
              CASE DISCLOSURE / <b>REVIEW DESK</b>
            </div>
            <h1>案件披露材料审查</h1>
            <p>批量导入、自动归并，冲突不解决不出清单；撤回与变更全程留痕、旧结论立即失效。</p>
          </div>
          <div className="head-actions">
            <button className="outline" onClick={() => setShowImport(true)}>
              <FileUp size={15} /> 导入文书包
            </button>
          </div>
        </header>

        <section className="summary dc-summary">
          <Stat label="归并文书" value={counts.docs} hint={`${counts.files} 个文件版本`} />
          <Stat label="活动主张" value={counts.claims} teal hint="撤回后不计数" />
          <Stat label="活动遮挡" value={counts.redactions} hint={`共 ${Object.keys(state.redactions).length} 条登记`} />
          <Stat label="待解阻断" value={openBlocking} red={openBlocking > 0} teal={openBlocking === 0} hint={openBlocking ? '清单生成被阻断' : '可以生成清单'} />
        </section>

        {state.imports.length > 0 && (
          <section className="import-strip">
            <Layers3 size={14} />
            {state.imports.map((imp) => (
              <span key={imp.packetId} className={`import-chip ${imp.duplicateOf ? 'dup' : ''}`}>
                {imp.name}
                {imp.duplicateOf && <em>重复包·已跳过</em>}
              </span>
            ))}
          </section>
        )}

        {tab === 'review' && (
          <ReviewView issues={analysis.issues} blocking={analysis.blocking} onAction={onIssueAction} />
        )}
        {tab === 'docs' && (
          <DocsView
            state={state}
            onAddClaim={addClaim}
            onAddRedaction={addRedaction}
            onWithdrawClaim={withdrawClaimFromDoc}
            onAmendClaim={amendClaimFromDoc}
            onWithdrawRedaction={withdrawRedFromDoc}
            onAmendRedaction={amendRedFromDoc}
          />
        )}
        {tab === 'manifest' && (
          <ManifestView
            state={state}
            analysis={analysis}
            actor={ACTOR}
            onJumpIssues={() => setTab('review')}
            onGenerate={(m) => {
              append([{ id: 'ev_m_' + m.id, type: 'disclosure.generated', at: m.at, by: m.by, manifest: m }]);
              flash('披露清单已生成；撤回或变更主张后该结论将自动标记失效');
            }}
          />
        )}
        {tab === 'trail' && <TrailView state={state} log={log} />}
      </main>

      {showImport && (
        <ImportModal state={state} actor={ACTOR} onImport={onImport} onClose={() => setShowImport(false)} />
      )}
      {pending && (
        <PromptModal
          title={pending.title}
          label={pending.label}
          initial={pending.initial ?? ''}
          placeholder={pending.placeholder}
          confirmText={pending.confirmText}
          danger={pending.danger}
          onClose={() => {
            pending.resolve('');
            setPending(null);
          }}
          onConfirm={(v) => {
            const resolve = pending.resolve;
            setPending(null);
            resolve(v);
          }}
        >
          {pending.body && <p className="dc-hint">{pending.body}</p>}
        </PromptModal>
      )}
      {anchorModal?.anchorId && state.anchors[anchorModal.anchorId] && (
        <AnchorResolveModal
          anchor={state.anchors[anchorModal.anchorId]}
          files={docVersions(state, anchorModal.docKey!)}
          onClose={() => setAnchorModal(null)}
          onConfirm={(choices) => {
            append(cmd.resolveAnchor(state, anchorModal.anchorId!, choices, { by: ACTOR }));
            setAnchorModal(null);
            flash('锚点已逐版本对齐');
          }}
        />
      )}
      {amendTarget && (
        <AmendClaimModal
          claim={state.claims[amendTarget.id] ?? amendTarget}
          onClose={() => setAmendTarget(null)}
          onConfirm={(patch) => {
            append(cmd.amendClaim(state.claims[amendTarget.id] ?? amendTarget, patch, { by: ACTOR }));
            setAmendTarget(null);
            flash('主张已变更，相关旧结论立即失效');
          }}
        />
      )}
      {toast && (
        <div className="toast">
          <AlertTriangle size={14} /> {toast}
        </div>
      )}
    </div>
  );
}

function NavButton({
  icon: Icon,
  label,
  active,
  onClick,
  badge,
  danger,
}: {
  icon: typeof History;
  label: string;
  active?: boolean;
  onClick: () => void;
  badge?: number;
  danger?: boolean;
}) {
  return (
    <button className={`nav ${active ? 'active' : ''}`} onClick={onClick}>
      <Icon size={16} />
      {label}
      {badge !== undefined && badge > 0 && <span className={danger ? 'red' : undefined}>{badge}</span>}
    </button>
  );
}

function Stat({ label, value, hint, teal, red }: { label: string; value: number; hint?: string; teal?: boolean; red?: boolean }) {
  return (
    <div>
      <span>{label}</span>
      <b className={teal ? 'teal' : red ? 'red' : ''}>{value}</b>
      {hint && <small>{hint}</small>}
    </div>
  );
}

function AmendClaimModal({
  claim,
  onClose,
  onConfirm,
}: {
  claim: ClaimE;
  onClose: () => void;
  onConfirm: (patch: { type: ClaimType; ranges: PageRange[]; basis: string }) => void;
}) {
  const [type, setType] = useState<ClaimType>(claim.type);
  const [pages, setPages] = useState(claim.ranges.map((r) => (r.from === r.to ? `${r.from}` : `${r.from}-${r.to}`)).join('、'));
  const [basis, setBasis] = useState(claim.basis);
  const [err, setErr] = useState('');

  const parse = (): PageRange[] => {
    const out: PageRange[] = [];
    for (const part of pages.split(/[,，、\s]+/).filter(Boolean)) {
      const m = /^(\d+)\s*[-–—至~～]\s*(\d+)$/.exec(part) ?? /^(\d+)$/.exec(part);
      if (!m) continue;
      out.push({ from: +m[1], to: m[2] ? +m[2] : +m[1] });
    }
    return out;
  };

  return (
    <Modal
      title="变更保密主张"
      onClose={onClose}
      footer={
        <>
          <button className="btn-outline" onClick={onClose}>
            取消
          </button>
          <button
            className="btn-primary"
            onClick={() => {
              const ranges = parse();
              if (!ranges.length) {
                setErr('请填写有效页码，如 5-8、11');
                return;
              }
              onConfirm({ type, ranges, basis });
            }}
          >
            保存变更（旧结论立即失效）
          </button>
        </>
      }
    >
      <p className="dc-hint">
        当前主张：<ClaimBadge type={claim.type} /> {fmtRanges(claim.ranges)}，{claim.assertedBy}。变更将新增一条轨迹记录，不覆盖原登记。
      </p>
      <label className="dc-field">
        <span>主张类型</span>
        <select value={type} onChange={(e) => setType(e.target.value as ClaimType)}>
          <option value="confidential">商业秘密 / 保密信息</option>
          <option value="privileged">律师工作成果 / 特权</option>
          <option value="withheld">不予披露（整段排除）</option>
          <option value="public">不主张保密（公开）</option>
        </select>
      </label>
      <label className="dc-field">
        <span>页码区间</span>
        <input value={pages} onChange={(e) => setPages(e.target.value)} placeholder="如 5-8、11" />
      </label>
      <label className="dc-field">
        <span>依据 / 说明</span>
        <textarea rows={2} value={basis} onChange={(e) => setBasis(e.target.value)} />
      </label>
      {err && <div className="form-error">{err}</div>}
    </Modal>
  );
}
