/** 面向非射频背景读者的一句话用例说明。键与 8 个用例一一对应。 */
export const CASE_PLAIN: Record<string, string> = {
  "6.7.1.1": "终端靠 GNSS 定位判断自己是否在卫星覆盖内，从而决定选哪个小区。",
  "6.7.1.2": "一个运营商网络有多个跟踪区时，终端如何在系统消息里认出并选择合适的小区。",
  "6.7.1.3":
    "网络把当前卫星小区标记为“禁止接入”后，终端应当识别它已不可用，并重新搜索可驻留的小区。",
  "6.7.1.4":
    "终端按周期做 PLMN 搜索/重选；本切片输入缺少消息名，系统会明确弃权而不是编造。",
  "6.7.1.5": "终端根据自身位置与距离测量触发小区重选（Sintrasearch / Snonintrasearch）。",
  "6.7.1.6": "终端根据时间测量触发小区重选，而不是位置。",
  "6.7.1.10": "为了省电，终端在满足条件时跳过地面网络测量，直接做 NR 小区重选。",
  "6.7.1.12": "终端从 LTE 地面网重选到 NR 卫星网（跨 RAT），并按信号门限判断。",
};

export function plainOf(caseId?: string | null): string | undefined {
  if (!caseId) return undefined;
  return CASE_PLAIN[caseId];
}
