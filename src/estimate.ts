/** Rough token estimate: ceil(chars / 4). */
export function estimateTokens(content: string | undefined | null): number {
  if (!content) return 0;
  return Math.ceil(content.length / 4);
}

/** Share of the model context window a skill's content would take, in percent (0-100+). undefined if limit unknown. */
export function estimateSkillPercent(
  content: string | undefined | null,
  limit: number | undefined | null,
): number | undefined {
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0)
    return undefined;
  return (estimateTokens(content) / limit) * 100;
}

/** "~1.2%" / "<0.1%". */
export function formatPercent(pct: number | undefined): string | undefined {
  if (pct === undefined || !Number.isFinite(pct)) return undefined;
  if (pct < 0.1) return "<0.1%";
  return `~${pct.toFixed(1)}%`;
}

export function formatTokenSummary(
  tokens: number,
  percent: number | undefined,
): string {
  const count =
    tokens >= 1000 ? `${Number((tokens / 1000).toFixed(1))}K` : String(tokens);
  const share = formatPercent(percent);
  return `${count} tokens${share ? ` ${share}` : ""}`;
}
