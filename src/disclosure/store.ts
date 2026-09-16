// 事件溯源 store：只持久化事件日志，刷新后重放重建全部状态与完整轨迹
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppEvent, PacketInput, ReviewState } from './types';
import { initialState, reduce } from './engine';
import { importPacket } from './commands';

const STORAGE_KEY = 'disclosure-desk:events:v1';

function loadLog(): AppEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AppEvent[]) : [];
  } catch {
    return [];
  }
}

export function useReviewStore() {
  const [log, setLog] = useState<AppEvent[]>(() => loadLog());

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
    } catch {
      // 存储已满或被禁用：本次会话仍可用
    }
  }, [log]);

  const state: ReviewState = useMemo(() => log.reduce((s, ev) => reduce(s, ev), initialState()), [log]);

  const append = useCallback((events: AppEvent[]) => {
    if (!events.length) return;
    setLog((prev) => [...prev, ...events]);
  }, []);

  /** 批量导入：每个包都基于“前一个包归并后”的状态做指纹去重 */
  const importPackets = useCallback(
    (packets: PacketInput[], ctx: { by: string }) => {
      let current = log.reduce((s, ev) => reduce(s, ev), initialState());
      const all: AppEvent[] = [];
      for (const packet of packets) {
        const evs = importPacket(current, packet, { by: ctx.by });
        for (const ev of evs) current = reduce(current, ev);
        all.push(...evs);
      }
      setLog((prev) => [...prev, ...all]);
      return all.length;
    },
    [log],
  );

  const clearAll = useCallback(() => setLog([]), []);

  return { state, log, append, importPackets, clearLog: clearAll };
}

export type ReviewStore = ReturnType<typeof useReviewStore>;
