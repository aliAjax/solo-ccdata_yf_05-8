// 披露清单：阻断校验 -> 生成 -> 导出 Markdown；旧清单撤回/变更后立即标记失效
import { useState } from 'react';
import { AlertOctagon, CheckCircle2, Download, FileSignature, RefreshCw, ScrollText } from 'lucide-react';
import type { AnalysisResult } from '../engine';
import { buildManifest, canGenerate, claimLabel, manifestStale } from '../engine';
import type { Manifest, ReviewState } from '../types';
import { fmtRanges } from '../utils';
import { Empty, Ranges, fmtTime } from './shared';

export function ManifestView({
  state,
  analysis,
  actor,
  onGenerate,
  onJumpIssues,
}: {
  state: ReviewState;
  analysis: AnalysisResult;
  actor: string;
  onGenerate: (manifest: Manifest) => void;
  onJumpIssues: () => void;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const gate = canGenerate(state);

  const preview = previewOpen && gate.ok
    ? buildManifest(state, { id: 'preview', at: new Date().toISOString(), by: actor })
    : null;

  const download = (m: Manifest) => {
    const text = toMarkdown(state, m);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    a.download = `披露清单_${m.id}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="manifest-view">
      <section className={`gate-card ${gate.ok ? 'ok' : 'blocked'}`}>
        <div className="gate-icon">
          {gate.ok ? <CheckCircle2 size={26} /> : <AlertOctagon size={26} />}
        </div>
        <div className="gate-text">
          <h2>{gate.ok ? '阻断项已全部解决，可以生成披露清单' : `还有 ${gate.blocking.length} 个阻断问题未解决，不能生成披露清单`}</h2>
          <p>
            {gate.ok
              ? `将按 ${Object.keys(state.files).length} 个文件版本计算公开页 / 遮挡页 / 不予披露页。警告与信息类问题不阻断，但会保留在轨迹中。`
              : '遮挡重叠、反向页码、冲突主张、区间错误、同标签异内容与未处置的锚点歧义都会阻断生成。'}
          </p>
          {!gate.ok && (
            <ul className="gate-list">
              {gate.blocking.slice(0, 8).map((b) => (
                <li key={b.key}>
                  <b>{b.title}</b>
                  <span>{b.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="gate-actions">
          {!gate.ok ? (
            <button className="btn-primary" onClick={onJumpIssues}>
              前往解决（{gate.blocking.length}）
            </button>
          ) : (
            <>
              <button className="btn-outline" onClick={() => setPreviewOpen((v) => !v)}>
                <ScrollText size={14} /> {previewOpen ? '收起预览' : '预览清单'}
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  const m = buildManifest(state, {
                    id: `mn-${state.manifests.length + 1}`,
                    at: new Date().toISOString(),
                    by: actor,
                  });
                  onGenerate(m);
                  download(m);
                }}
              >
                <FileSignature size={15} /> 生成并导出清单
              </button>
            </>
          )}
        </div>
      </section>

      {preview && (
        <section className="pane-card manifest-preview">
          <div className="sub-head">
            <RefreshCw size={14} /> 实时预览（撤回或变更主张后，下方内容与已生成清单会立即改变/失效）
          </div>
          <ManifestTable manifest={preview} />
        </section>
      )}

      <section className="pane-card">
        <div className="sub-head">
          <FileSignature size={14} /> 已生成清单（{state.manifests.length}）
        </div>
        {state.manifests.length === 0 && <Empty title="尚未生成过披露清单" hint="解决全部阻断项后在此生成，系统保留每次结论及其有效状态" />}
        {state.manifests
          .slice()
          .reverse()
          .map((m) => {
            const stale = manifestStale(state, m);
            return (
              <div key={m.id} className={`manifest-rec ${stale ? 'stale' : 'live'}`}>
                <div className="manifest-rec-head">
                  <b>
                    {m.id} · {m.entries.length} 个文件版本
                  </b>
                  <span className={`manifest-state ${stale ? 'is-stale' : ''}`}>
                    {stale ? '结论已失效（主张/遮挡有撤回或变更）' : '当前有效'}
                  </span>
                </div>
                <small className="muted">
                  生成于 {fmtTime(m.at)} · {m.by} · 签名 {m.sig.slice(0, 18)}…
                </small>
                <div className="manifest-rec-actions">
                  <button className="btn-link" onClick={() => download(m)}>
                    <Download size={13} /> 导出当时版本 (Markdown)
                  </button>
                </div>
                <ManifestTable manifest={m} compact />
              </div>
            );
          })}
      </section>
    </div>
  );
}

function ManifestTable({ manifest, compact }: { manifest: Manifest; compact?: boolean }) {
  return (
    <div className="manifest-table">
      <div className="mt-row mt-head">
        <span>文书 / 版本</span>
        <span>文件</span>
        <span>公开页</span>
        <span>遮挡页</span>
        <span>不予披露</span>
        <span>状态</span>
      </div>
      {manifest.entries.map((e) => (
        <div key={e.fileId} className="mt-row">
          <span className="mt-doc">
            <b>{e.title}</b>
            <small>{e.version} · 共 {e.pageCount} 页</small>
            {!compact &&
              e.claims.map((c, i) => (
                <em key={i} className="mt-claim">
                  {claimLabel(c.type)} <Ranges ranges={c.ranges} />（{c.assertedBy}）
                </em>
              ))}
          </span>
          <span className="muted">{e.fileName}</span>
          <span className="pg-disclose">{fmtRanges(e.disclosedPages) || '—'}</span>
          <span className="pg-redact">
            {[
              e.redactedPages.length ? `遮挡 ${fmtRanges(e.redactedPages)}` : '',
              e.protectedPages.length ? `保密未遮挡 ${fmtRanges(e.protectedPages)}` : '',
            ]
              .filter(Boolean)
              .join('；') || '—'}
          </span>
          <span className="pg-withheld">{fmtRanges(e.withheldPages) || '—'}</span>
          <span className={`mt-status ${e.status}`}>
            {e.status === 'disclose' ? '全部公开' : e.status === 'partial' ? '部分披露' : '整份不披露'}
          </span>
        </div>
      ))}
    </div>
  );
}

function toMarkdown(state: ReviewState, m: Manifest): string {
  void state;
  const lines: string[] = [];
  lines.push(`# 披露材料清单（${m.id}）`);
  lines.push('');
  lines.push(`- 生成时间：${fmtTime(m.at)}`);
  lines.push(`- 经办人：${m.by}`);
  lines.push(`- 文件版本数：${m.entries.length}`);
  lines.push(`- 结论签名：\`${m.sig}\``);
  lines.push('');
  lines.push('| 文书 | 版本 | 文件 | 总页数 | 公开页 | 遮挡页 | 保密未遮挡 | 不予披露 | 结论 |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const e of m.entries) {
    lines.push(
      [
        e.title,
        e.version,
        e.fileName,
        String(e.pageCount),
        fmtRanges(e.disclosedPages) || '—',
        fmtRanges(e.redactedPages) || '—',
        fmtRanges(e.protectedPages) || '—',
        fmtRanges(e.withheldPages) || '—',
        e.status === 'disclose' ? '全部公开' : e.status === 'partial' ? '部分披露' : '整份不披露',
      ]
        .map((x) => x.replace(/\|/g, '\\|'))
        .join(' | '),
    );
  }
  lines.push('');
  lines.push('## 主张依据明细');
  for (const e of m.entries) {
    if (!e.claims.length) continue;
    lines.push(`- **${e.title} ${e.version}**`);
    for (const c of e.claims) {
      lines.push(`  - ${claimLabel(c.type)} ${fmtRanges(c.ranges)}｜${c.assertedBy}｜${c.basis || '未填写依据'}`);
    }
  }
  lines.push('');
  lines.push('> 撤回或变更任一主张/遮挡后，本清单结论立即失效，请重新生成并核对签名。');
  return lines.join('\n');
}
