// 演示案卷：4 个文书包，覆盖重复包 / 乱序版本 / 相邻与重叠遮挡 /
// 反向页码 / 冲突主张 / 跨版本锚点歧义 / 撤回失效等全部核对场景
import type { PacketInput } from './types';

export interface DemoPacket extends PacketInput {
  hint: string;
}

/**
 * 包 1：基础材料。合同 v2 先到（为乱序埋伏笔）；
 * 邮件扫描件页码反向，且有一条 12→9 的反向主张区间。
 */
export const packetA: DemoPacket = {
  name: '原告材料包-20260901.zip',
  exportedAt: '2026-09-01',
  hint: '基础材料：合同 v2、倒序扫描的邮件汇总；含相邻遮挡与反向页码',
  docs: [
    {
      key: 'contract',
      title: '《采购框架协议》',
      summary: '双方 2023 年签订，共十二条，含验收（第五条）与保密（第十二条）条款。',
      versions: [
        {
          label: 'v2',
          fileName: '采购框架协议_v2终稿.pdf',
          sha: 'hash-contract-v2',
          pageCount: 20,
          pageLabels: Array.from({ length: 20 }, (_, i) => i + 1),
        },
      ],
      claims: [
        {
          id: 'c-a1',
          doc: 'contract',
          version: 'v2',
          ranges: [{ from: 5, to: 8 }],
          type: 'confidential',
          basis: '协议第十二条：单价与折扣率属于商业秘密',
          assertedBy: '原告律师',
          assertedAt: '2026-09-01T03:00:00.000Z',
        },
      ],
      redactions: [
        { id: 'r-a1', doc: 'contract', version: 'v2', ranges: [{ from: 5, to: 8 }], note: '价格明细（单价/折扣）' },
        { id: 'r-a2', doc: 'contract', version: 'v2', ranges: [{ from: 9, to: 10 }], note: '供应商短名单' },
      ],
      anchors: [{ id: 'anc-art5', doc: 'contract', label: '第五条 验收', occurrences: [{ version: 'v2', page: 7 }] }],
    },
    {
      key: 'email',
      title: '往来邮件汇总',
      summary: '项目组 2023–2024 年往来邮件，扫描合订本。',
      versions: [
        {
          label: 'v1',
          fileName: '往来邮件_扫描合订.pdf',
          sha: 'hash-email-v1',
          pageCount: 14,
          // 扫描时把最后一页放在了最前：标签整体递减
          pageLabels: [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
        },
      ],
      claims: [
        {
          id: 'c-e1',
          doc: 'email',
          version: 'v1',
          ranges: [{ from: 12, to: 9 }], // 起止反向，须标出
          type: 'privileged',
          basis: '律师法律意见及工作成果',
          assertedBy: '原告律师',
          assertedAt: '2026-09-01T03:00:00.000Z',
        },
        {
          id: 'c-e2',
          doc: 'email',
          version: 'v1',
          ranges: [{ from: 13, to: 14 }],
          type: 'public',
          basis: '该两页为公开通知，不主张保密',
          assertedBy: '原告律师',
          assertedAt: '2026-09-01T03:00:00.000Z',
        },
      ],
      redactions: [{ id: 'r-e1', doc: 'email', version: 'v1', ranges: [{ from: 9, to: 12 }], note: '法律意见批注段落' }],
    },
  ],
};

/** 包 2：与包 1 字节级重复（仅压缩包名不同），用于重复包归并。 */
export const packetB: DemoPacket = {
  ...JSON.parse(JSON.stringify(packetA)),
  name: '原告材料包-再发一次.zip',
  exportedAt: '2026-09-02',
  hint: '与包 1 内容指纹完全一致：应整体跳过并标记为重复包',
};

/**
 * 包 3：更旧的合同 v1 后到（乱序归并）；“第五条 验收”在 v1 中命中两处；
 * 新增会议纪要：保密主张与公开主张在 p4 冲突，两条遮挡在 p4-5 重叠。
 */
export const packetC: DemoPacket = {
  name: '原告材料包-补充.zip',
  exportedAt: '2026-09-05',
  hint: '更旧的 v1 后到 + 锚点双命中 + 冲突主张 + 重叠遮挡',
  docs: [
    {
      key: 'contract',
      title: '《采购框架协议》',
      summary: '双方 2023 年签订，共十二条，含验收（第五条）与保密（第十二条）条款。',
      versions: [
        { label: 'v1', fileName: '采购框架协议_v1初稿.pdf', sha: 'hash-contract-v1', pageCount: 18 },
      ],
      // v1 排版不同，目录里也有一处“第五条 验收”，正文一处 -> 锚点歧义
      anchors: [
        {
          id: 'anc-art5',
          doc: 'contract',
          label: '第五条 验收',
          occurrences: [
            { version: 'v1', page: 6 },
            { version: 'v1', page: 15 },
          ],
        },
      ],
    },
    {
      key: 'meeting',
      title: '评标会议纪要（6月）',
      summary: '2023 年 6 月评标会议纪要与打分表合订。',
      versions: [{ label: 'v3', fileName: '评标会议纪要_v3.pdf', sha: 'hash-meeting-v3', pageCount: 10 }],
      claims: [
        {
          id: 'c-m1',
          doc: 'meeting',
          version: 'v3',
          ranges: [{ from: 3, to: 5 }],
          type: 'confidential',
          basis: '评标打分与评委意见在保密期内',
          assertedBy: '原告律师',
          assertedAt: '2026-09-05T02:00:00.000Z',
        },
        {
          id: 'c-m2',
          doc: 'meeting',
          version: 'v3',
          ranges: [{ from: 4, to: 4 }],
          type: 'public',
          basis: '该页已在(2024)前案中作为公开证据提交',
          assertedBy: '被告代理律师',
          assertedAt: '2026-09-05T02:30:00.000Z',
        },
      ],
      redactions: [
        { id: 'r-m1', doc: 'meeting', version: 'v3', ranges: [{ from: 3, to: 5 }], note: '评标打分区' },
        { id: 'r-m2', doc: 'meeting', version: 'v3', ranges: [{ from: 4, to: 6 }], note: '评委姓名行' },
      ],
    },
  ],
};

/** 包 4：更旧的合同 v0 底稿后到；v0 中没有“第五条 验收”——用于使旧锚点结论失效。 */
export const packetD: DemoPacket = {
  name: '合同历史底稿.zip',
  exportedAt: '2026-09-08',
  hint: '更旧的 v0：该版本尚无第五条，锚点旧处置应立即失效',
  docs: [
    {
      key: 'contract',
      title: '《采购框架协议》',
      summary: '双方 2023 年签订，共十二条，含验收（第五条）与保密（第十二条）条款。',
      versions: [{ label: 'v0', fileName: '采购框架协议_谈判底稿.pdf', sha: 'hash-contract-v0', pageCount: 12 }],
    },
  ],
};

/** 一键载入演示案卷时，按时间批量导入的前三个包（包 4 由用户在锚点处置后手动导入，观察失效） */
export const demoBatch: DemoPacket[] = [packetA, packetB, packetC];

export const allDemoPackets: DemoPacket[] = [packetA, packetB, packetC, packetD];
