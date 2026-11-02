export function ArchitectureDiagram() {
  const box = {
    fill: "rgb(var(--surface))",
    stroke: "rgb(var(--line))",
  };
  return (
    <svg
      viewBox="0 0 760 320"
      role="img"
      aria-labelledby="arch-title arch-desc"
      className="w-full"
    >
      <title id="arch-title">Spec2Test 智能体结构</title>
      <desc id="arch-desc">
        对话与参数进入编排层，模型选择阶段工具生成产物；确定性校验器给出违规清单，
        清单回到编排层做定向修复，最多 N 轮。
      </desc>

      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" style={{ fill: "rgb(var(--muted))" }} />
        </marker>
        <marker id="arrow-accent" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" style={{ fill: "rgb(var(--accent-solid))" }} />
        </marker>
      </defs>

      <g style={{ fontFamily: "inherit" }}>
        <rect x="16" y="34" width="180" height="96" rx="10" {...box} />
        <text x="106" y="62" textAnchor="middle" style={{ fill: "rgb(var(--ink))", fontSize: 13, fontWeight: 600 }}>
          对话与参数
        </text>
        <text x="106" y="84" textAnchor="middle" style={{ fill: "rgb(var(--muted))", fontSize: 11 }}>
          用例 / 生成范围 / 修复轮数
        </text>
        <text x="106" y="102" textAnchor="middle" style={{ fill: "rgb(var(--muted))", fontSize: 11 }}>
          严格度 / 候选消息 / 审批
        </text>

        <rect x="256" y="34" width="220" height="96" rx="10" {...box} />
        <text x="366" y="62" textAnchor="middle" style={{ fill: "rgb(var(--ink))", fontSize: 13, fontWeight: 600 }}>
          编排层（模型）
        </text>
        <text x="366" y="84" textAnchor="middle" style={{ fill: "rgb(var(--muted))", fontSize: 11 }}>
          选工具、定顺序、决定重修或弃权
        </text>
        <text x="366" y="102" textAnchor="middle" style={{ fill: "rgb(var(--muted))", fontSize: 11 }}>
          不参与判定
        </text>

        <rect x="536" y="34" width="208" height="96" rx="10" {...box} />
        <text x="640" y="62" textAnchor="middle" style={{ fill: "rgb(var(--ink))", fontSize: 13, fontWeight: 600 }}>
          阶段工具
        </text>
        <text x="640" y="84" textAnchor="middle" style={{ fill: "rgb(var(--muted))", fontSize: 11 }}>
          读切片 · 抽候选 · 生成步骤
        </text>
        <text x="640" y="102" textAnchor="middle" style={{ fill: "rgb(var(--muted))", fontSize: 11 }}>
          生成字段 · 校验 · 修复 · 导出
        </text>

        <rect x="536" y="206" width="208" height="88" rx="10" {...box} />
        <text x="640" y="234" textAnchor="middle" style={{ fill: "rgb(var(--ink))", fontSize: 13, fontWeight: 600 }}>
          确定性校验器
        </text>
        <text x="640" y="256" textAnchor="middle" style={{ fill: "rgb(var(--muted))", fontSize: 11 }}>
          R1 消息存在 · R2 字段作用域
        </text>
        <text x="640" y="274" textAnchor="middle" style={{ fill: "rgb(var(--muted))", fontSize: 11 }}>
          R3 TP 覆盖 · 异常按 R0 拒收
        </text>

        <rect x="256" y="206" width="220" height="88" rx="10" {...box} />
        <text x="366" y="234" textAnchor="middle" style={{ fill: "rgb(var(--ink))", fontSize: 13, fontWeight: 600 }}>
          违规清单
        </text>
        <text x="366" y="256" textAnchor="middle" style={{ fill: "rgb(var(--muted))", fontSize: 11 }}>
          规则 / 路径 / 原因
        </text>
        <text x="366" y="274" textAnchor="middle" style={{ fill: "rgb(var(--muted))", fontSize: 11 }}>
          只改有依据的地方
        </text>

        <line x1="196" y1="82" x2="250" y2="82" style={{ stroke: "rgb(var(--muted))" }} strokeWidth="1.5" markerEnd="url(#arrow)" />
        <line x1="476" y1="82" x2="530" y2="82" style={{ stroke: "rgb(var(--muted))" }} strokeWidth="1.5" markerEnd="url(#arrow)" />
        <line x1="640" y1="130" x2="640" y2="200" style={{ stroke: "rgb(var(--muted))" }} strokeWidth="1.5" markerEnd="url(#arrow)" />
        <line x1="530" y1="250" x2="482" y2="250" style={{ stroke: "rgb(var(--muted))" }} strokeWidth="1.5" markerEnd="url(#arrow)" />
        <path
          d="M256 250 C 210 250, 190 190, 190 150 C 190 120, 220 112, 252 112"
          fill="none"
          style={{ stroke: "rgb(var(--accent-solid))" }}
          strokeWidth="1.6"
          strokeDasharray="5 4"
          markerEnd="url(#arrow-accent)"
        />
        <text x="120" y="196" style={{ fill: "rgb(var(--accent-ink))", fontSize: 11 }}>
          修复闭环 ≤ N 轮
        </text>
      </g>
    </svg>
  );
}
