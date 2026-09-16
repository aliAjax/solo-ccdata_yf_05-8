// 模态框：通用提示 / 锚点逐版本处置
import { useState, type ReactNode } from 'react';
import { X, MapPinned } from 'lucide-react';
import type { AnchorE, FileE } from '../types';

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 460,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  return (
    <div className="backdrop" onMouseDown={onClose}>
      <div className="modal dc-modal" style={{ width: `min(${width}px, 100%)` }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button aria-label="关闭" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function PromptModal({
  title,
  label,
  initial = '',
  placeholder,
  confirmText = '确认',
  danger,
  onConfirm,
  onClose,
  children,
}: {
  title: string;
  label: string;
  initial?: string;
  placeholder?: string;
  confirmText?: string;
  danger?: boolean;
  onConfirm: (value: string) => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const [value, setValue] = useState(initial);
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn-outline" onClick={onClose}>
            取消
          </button>
          <button
            className={danger ? 'btn-danger' : 'btn-primary'}
            onClick={() => {
              onConfirm(value.trim());
            }}
          >
            {confirmText}
          </button>
        </>
      }
    >
      {children}
      <label className="dc-field">
        <span>{label}</span>
        <textarea autoFocus rows={2} value={value} placeholder={placeholder} onChange={(e) => setValue(e.target.value)} />
      </label>
    </Modal>
  );
}

/** 逐版本指定锚点：每个版本选择一个出现位置，或显式确认该版本无此锚点 */
export function AnchorResolveModal({
  anchor,
  files,
  onConfirm,
  onClose,
}: {
  anchor: AnchorE;
  files: FileE[];
  onConfirm: (choices: Record<string, string | null>) => void;
  onClose: () => void;
}) {
  const labels = files.slice().sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })).map((f) => f.label);
  const occByVersion = new Map<string, { id: string; page: number }[]>();
  for (const o of anchor.occurrences) {
    const arr = occByVersion.get(o.version) ?? [];
    arr.push({ id: o.id, page: o.page });
    occByVersion.set(o.version, arr);
  }

  const initial: Record<string, string> = {};
  for (const [v, occ] of occByVersion) {
    if (occ.length === 1) initial[v] = occ[0].id;
  }
  const [picks, setPicks] = useState<Record<string, string>>(initial);
  const [noneSet, setNoneSet] = useState<Set<string>>(new Set());

  const complete = labels.every((l) => noneSet.has(l) || Boolean(picks[l]));

  return (
    <Modal
      title={
        <span className="modal-title-with-icon">
          <MapPinned size={17} /> 逐版本指定锚点：{anchor.label}
        </span>
      }
      onClose={onClose}
      width={560}
      footer={
        <>
          <button className="btn-outline" onClick={onClose}>
            取消
          </button>
          <button
            className="btn-primary"
            disabled={!complete}
            onClick={() => {
              const choices: Record<string, string | null> = {};
              for (const l of labels) choices[l] = noneSet.has(l) ? null : picks[l];
              onConfirm(choices);
            }}
          >
            确认对齐（{labels.length} 个版本）
          </button>
        </>
      }
    >
      <p className="dc-hint">
        同一锚点在不同版本排版位置不同。请为每个版本选择实际对应的出现页；该版本确无此条款时，请显式标注“无此锚点”。
        未逐版本确认前不能生成披露清单。
      </p>
      <div className="anchor-rows">
        {labels.map((l) => {
          const occ = occByVersion.get(l) ?? [];
          const ambiguousHere = occ.length > 1;
          const none = noneSet.has(l);
          return (
            <div key={l} className={`anchor-row ${ambiguousHere ? 'is-amb' : ''} ${none ? 'is-none' : ''}`}>
              <div className="anchor-ver">
                <b>{l}</b>
                <small>{occ.length ? `候选 ${occ.length} 处` : '未扫描到该文本'}</small>
              </div>
              <div className="anchor-pick">
                {none ? (
                  <em className="none-tag">已确认：该版本无此锚点</em>
                ) : occ.length ? (
                  <select value={picks[l] ?? ''} onChange={(e) => setPicks((p) => ({ ...p, [l]: e.target.value }))}>
                    <option value="" disabled>
                      选择页码…
                    </option>
                    {occ.map((o) => (
                      <option key={o.id} value={o.id}>
                        第 {o.page} 页{ambiguousHere ? `（候选 ${o.page}）` : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <em className="muted">该版本扫描件中无候选</em>
                )}
              </div>
              <button
                className="btn-link"
                onClick={() => {
                  setNoneSet((prev) => {
                    const next = new Set(prev);
                    if (next.has(l)) next.delete(l);
                    else {
                      next.add(l);
                      setPicks((p) => {
                        const c = { ...p };
                        delete c[l];
                        return c;
                      });
                    }
                    return next;
                  });
                }}
              >
                {none ? '撤销“无锚点”' : '该版本无此锚点'}
              </button>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
