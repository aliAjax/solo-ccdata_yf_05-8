// 纯函数工具：区间运算、版本排序、指纹、页码归并
import type { PageRange } from './types';

export function normRange(r: PageRange): PageRange {
  return r.from <= r.to ? { from: r.from, to: r.to } : { from: r.to, to: r.from };
}

export function isReversed(r: PageRange): boolean {
  return r.from > r.to;
}

export function rangesEqual(a: PageRange[], b: PageRange[]): boolean {
  const sa = a.map(normRange).sort((x, y) => x.from - y.from || x.to - y.to);
  const sb = b.map(normRange).sort((x, y) => x.from - y.from || x.to - y.to);
  if (sa.length !== sb.length) return false;
  return sa.every((r, i) => r.from === sb[i].from && r.to === sb[i].to);
}

/** 合并为不相交的并集区间（自动处理重叠/包含） */
export function unionRanges(ranges: PageRange[]): PageRange[] {
  const norm = ranges.map(normRange).sort((a, b) => a.from - b.from || a.to - b.to);
  const out: PageRange[] = [];
  for (const r of norm) {
    const last = out[out.length - 1];
    // 相邻（端点相接）也合并，用于“一键合并相邻遮挡”
    if (last && r.from <= last.to + 1) last.to = Math.max(last.to, r.to);
    else out.push({ ...r });
  }
  return out;
}

/** 严格重叠（共享至少一个页码）；端点相接不算重叠 */
export function rangesOverlap(a: PageRange[], b: PageRange[]): boolean {
  for (const x of a.map(normRange)) {
    for (const y of b.map(normRange)) {
      if (x.from <= y.to && y.from <= x.to) return true;
    }
  }
  return false;
}

export function rangesAdjacent(a: PageRange[], b: PageRange[]): boolean {
  if (rangesOverlap(a, b)) return false;
  for (const x of a.map(normRange)) {
    for (const y of b.map(normRange)) {
      if (x.to + 1 === y.from || y.to + 1 === x.from) return true;
    }
  }
  return false;
}

export function clampRanges(ranges: PageRange[], maxPage: number): PageRange[] {
  return unionRanges(ranges)
    .map((r) => ({ from: Math.max(1, r.from), to: Math.min(maxPage, r.to) }))
    .filter((r) => r.from <= r.to);
}

/** 在 [1, total] 中取补集 */
export function complement(ranges: PageRange[], total: number): PageRange[] {
  const covered = unionRanges(ranges).filter((r) => r.to >= 1 && r.from <= total);
  const out: PageRange[] = [];
  let cursor = 1;
  for (const r of covered) {
    if (r.from > cursor) out.push({ from: cursor, to: r.from - 1 });
    cursor = Math.max(cursor, r.to + 1);
  }
  if (cursor <= total) out.push({ from: cursor, to: total });
  return out;
}

export function subtractRanges(a: PageRange[], b: PageRange[]): PageRange[] {
  const cut = unionRanges(b);
  return unionRanges(a).flatMap((r) => {
    const parts: PageRange[] = [];
    let cursor = r.from;
    for (const c of cut) {
      if (c.to < cursor) continue;
      if (c.from > r.to) break;
      if (c.from > cursor) parts.push({ from: cursor, to: Math.min(c.from - 1, r.to) });
      cursor = Math.max(cursor, c.to + 1);
    }
    if (cursor <= r.to) parts.push({ from: cursor, to: r.to });
    return parts;
  });
}

export function fmtRanges(ranges: PageRange[]): string {
  return unionRanges(ranges)
    .map((r) => (r.from === r.to ? `p${r.from}` : `p${r.from}-${r.to}`))
    .join('、');
}

/** 保留登记原始页序，起止反向时明确标出，不做翻转 */
export function fmtRangesRaw(ranges: PageRange[]): string {
  return ranges
    .map((r) => {
      if (r.from === r.to) return `p${r.from}`;
      if (r.from > r.to) return `p${r.from}→p${r.to}（反向）`;
      return `p${r.from}-p${r.to}`;
    })
    .join('、');
}

/* ---------- 版本标签 ---------- */

export interface ParsedVersion {
  label: string;
  numeric: number[] | null; // 点分数字（支持 v 前缀）
  date: [number, number, number] | null; // YYYY-MM-DD
}

export function parseVersion(label: string): ParsedVersion {
  const t = label.trim();
  const date = /^(\d{4})[-_.年](\d{1,2})[-_.月](\d{1,2})日?$/.exec(t);
  if (date) return { label: t, numeric: null, date: [+date[1], +date[2], +date[3]] };
  const num = /^[vV]?(\d+(?:\.\d+)*)$/.exec(t);
  if (num) return { label: t, numeric: num[1].split('.').map(Number), date: null };
  return { label: t, numeric: null, date: null };
}

function cmpNumArr(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** 版本新旧：>0 表示 a 比 b 新。无法解析的标签按文字序兜底。 */
export function cmpVersion(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const rank = (p: ParsedVersion): number => (p.date ? 2 : p.numeric ? 1 : 0);
  if (rank(pa) !== rank(pb)) return rank(pa) - rank(pb);
  if (pa.date && pb.date) {
    for (let i = 0; i < 3; i++) {
      const d = (pa.date![i] - pb.date![i]);
      if (d) return d;
    }
    return 0;
  }
  if (pa.numeric && pb.numeric) return cmpNumArr(pa.numeric, pb.numeric);
  return a.localeCompare(b, 'zh-Hans-CN');
}

export function isOutOrder(label: string, priorLatest: string | null): boolean {
  if (!priorLatest) return false;
  return cmpVersion(label, priorLatest) < 0;
}

/* ---------- 指纹 -------- */

export function digest(s: string): string {
  let h1 = 0xdeadbeef ^ 0;
  let h2 = 0x41c6ce57 ^ 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const h = (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(13, '0');
  return 'sha-' + h;
}

/** 文书归一键：同案同名文书视为同一份（空格/全半角/大小写差异归一） */
export function docKeyOf(title: string, explicit?: string): string {
  if (explicit && explicit.trim()) return 'doc_' + digest(explicit.trim().toLowerCase());
  const norm = title
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[（）]/g, (m) => (m === '（' ? '(' : ')'));
  return 'doc_' + digest(norm);
}

export function claimKey(
  docKey: string,
  version: string | undefined,
  type: string,
  ranges: PageRange[],
  assertedBy: string,
): string {
  return digest(
    [
      docKey,
      version ?? '*',
      type,
      ranges
        .map(normRange)
        .sort((a, b) => a.from - b.from || a.to - b.to)
        .map((r) => `${r.from}-${r.to}`)
        .join(','),
      assertedBy,
    ].join('|'),
  );
}

export function redKey(
  docKey: string,
  version: string | undefined,
  ranges: PageRange[],
): string {
  return digest(
    [
      docKey,
      version ?? '*',
      ranges
        .map(normRange)
        .sort((a, b) => a.from - b.from || a.to - b.to)
        .map((r) => `${r.from}-${r.to}`)
        .join(','),
    ].join('|'),
  );
}

export function fileIdOf(docKey: string, label: string, sha?: string): string {
  return 'file_' + digest(`${docKey}|${label.trim().toLowerCase()}|${sha ?? ''}`);
}

export function todayISO(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}

export function nowISO(): string {
  return new Date().toISOString();
}
