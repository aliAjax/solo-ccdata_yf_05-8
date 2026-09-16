// 导入文书包：选择演示包 / 粘贴 JSON，导入前展示将归并/去重的预览
import { useMemo, useState } from 'react';
import { FileStack, FileUp, Layers, Sparkles } from 'lucide-react';
import { Modal } from './Modals';
import { allDemoPackets, type DemoPacket } from '../demo';
import { packetDigest, prepareImport, reduce } from '../engine';
import type { AppEvent, PacketInput, ReviewState } from '../types';

export function ImportModal({
  state,
  actor,
  onImport,
  onClose,
}: {
  state: ReviewState;
  actor: string;
  onImport: (packets: PacketInput[]) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<'demo' | 'json'>('demo');
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState('');

  const demoSelections = allDemoPackets
    .map((p, i) => ({ p, i }))
    .filter(({ i }) => chosen.has(i));

  const parsedJson: PacketInput[] | null = useMemo(() => {
    if (mode !== 'json' || !jsonText.trim()) return null;
    try {
      const data = JSON.parse(jsonText);
      const arr = Array.isArray(data) ? data : [data];
      if (!arr.every((p) => p && typeof p.name === 'string' && Array.isArray(p.docs))) {
        setJsonError('结构不符：需要 { name, docs:[{ title, versions:[{label,pageCount}] }] }');
        return null;
      }
      setJsonError('');
      return arr as PacketInput[];
    } catch (e) {
      setJsonError('JSON 解析失败：' + (e as Error).message);
      return null;
    }
  }, [jsonText, mode]);

  const planned = useMemo(() => {
    const packets = mode === 'demo' ? demoSelections.map((x) => x.p) : parsedJson ?? [];
    // 依次归并预览：每个包基于前一个包归并后的状态做去重
    let cur = state;
    return packets.map((p) => {
      const prepared = prepareImport(cur, p, { packetId: 'preview', at: new Date().toISOString(), by: actor });
      const ev: AppEvent = { id: 'preview', type: 'packet.imported', at: '', by: actor, packet: prepared.payload };
      cur = reduce(cur, ev);
      return { packet: p, payload: prepared.payload, duplicateOf: prepared.duplicateOf };
    });
  }, [mode, chosen, parsedJson, state, actor, demoSelections]);

  const ready = planned.length > 0;

  return (
    <Modal
      width={680}
      title={
        <span className="modal-title-with-icon">
          <FileUp size={17} /> 批量导入文书包
        </span>
      }
      onClose={onClose}
      footer={
        <>
          <button className="btn-outline" onClick={onClose}>
            取消
          </button>
          <button
            className="btn-primary"
            disabled={!ready}
            onClick={() => {
              const packets = mode === 'demo' ? demoSelections.map((x) => x.p) : parsedJson!;
              onImport(packets);
            }}
          >
            导入 {planned.length} 个包
          </button>
        </>
      }
    >
      <div className="import-tabs">
        <button className={mode === 'demo' ? 'active' : ''} onClick={() => setMode('demo')}>
          <Sparkles size={14} /> 演示案卷
        </button>
        <button className={mode === 'json' ? 'active' : ''} onClick={() => setMode('json')}>
          <FileStack size={14} /> 粘贴 JSON
        </button>
      </div>

      {mode === 'demo' && (
        <div className="demo-list">
          {allDemoPackets.map((p: DemoPacket, i) => {
            const checked = chosen.has(i);
            const dg = packetDigest(p);
            const already = state.imports.some((imp) => imp.digest === dg);
            return (
              <label key={i} className={`demo-item ${checked ? 'sel' : ''}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    setChosen((prev) => {
                      const next = new Set(prev);
                      if (next.has(i)) next.delete(i);
                      else next.add(i);
                      return next;
                    })
                  }
                />
                <div className="demo-main">
                  <b>{p.name}</b>
                  <small>{p.hint}</small>
                  <span className="demo-meta">
                    {p.docs.length} 份文书 · {p.docs.reduce((n, d) => n + d.versions.length, 0)} 个版本 ·{' '}
                    {p.docs.reduce((n, d) => n + (d.claims?.length ?? 0), 0)} 条主张 ·{' '}
                    {p.docs.reduce((n, d) => n + (d.redactions?.length ?? 0), 0)} 条遮挡
                  </span>
                </div>
                {already && <span className="dup-flag">指纹已存在</span>}
              </label>
            );
          })}
        </div>
      )}

      {mode === 'json' && (
        <>
          <textarea
            className="json-input"
            rows={9}
            placeholder='[{"name":"对方材料包.zip","docs":[{"key":"d1","title":"《合作协议》","versions":[{"label":"v1","pageCount":12,"sha":"abc"}],"claims":[{"doc":"d1","version":"v1","ranges":[{"from":3,"to":5}],"type":"confidential","basis":"价格条款"}]}]}]'
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
          />
          {jsonError && <div className="form-error">{jsonError}</div>}
        </>
      )}

      {planned.length > 0 && (
        <div className="import-preview">
          <div className="preview-head">
            <Layers size={14} /> 归并预览（将顺序处理 {planned.length} 个包）
          </div>
          {planned.map(({ packet, payload, duplicateOf }, i) => (
            <div key={i} className={`preview-row ${duplicateOf ? 'is-dup' : ''}`}>
              <b>{packet.name}</b>
              {duplicateOf ? (
                <span className="dup-flag">重复包：整体跳过，不新增文件/主张/遮挡</span>
              ) : (
                <span className="preview-stats">
                  新增文书 {payload.rec.addedDocs.length}
                  {payload.rec.mergedDocs.length > 0 && ` · 并入既有文书 ${payload.rec.mergedDocs.length}`}
                  {' · '}版本 {payload.files.length}
                  {payload.rec.dedupedFiles.length > 0 && `（去重 ${payload.rec.dedupedFiles.length}）`}
                  {' · '}主张 {payload.rec.addedClaims}
                  {payload.rec.dedupedClaims > 0 && `（去重 ${payload.rec.dedupedClaims}）`}
                  {' · '}遮挡 {payload.rec.addedRedactions}
                  {payload.rec.dedupedRedactions > 0 && `（去重 ${payload.rec.dedupedRedactions}）`}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
