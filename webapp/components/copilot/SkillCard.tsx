"use client";

export type Skill = { name: string; description?: string; when?: string; body: string };

export function SkillCard({ skill }: { skill: Skill }) {
  return (
    <div className="rounded-md border border-line bg-surface p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium">技能 · {skill.name}</span>
        <span className="text-[11px] text-muted">已加载</span>
      </div>
      {skill.description && <p className="mt-1 text-xs text-muted">{skill.description}</p>}
      <pre className="scroll-thin mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded border border-line bg-canvas p-2 text-[11px] leading-relaxed">
        {skill.body}
      </pre>
    </div>
  );
}
