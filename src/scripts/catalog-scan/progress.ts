import type { ScanStats } from "./types.js";

export function createStats(total: number): ScanStats {
  return {
    total,
    scanned: 0,
    found: 0,
    notFound: 0,
    errors: 0,
    startTime: Date.now(),
  };
}

export function printProgress(stats: ScanStats, currentTitle: string): void {
  const elapsed = (Date.now() - stats.startTime) / 1000;
  const rate = stats.scanned / elapsed;
  const remaining = stats.total - stats.scanned;
  const eta = rate > 0 ? remaining / rate : 0;

  const pct = ((stats.scanned / stats.total) * 100).toFixed(1);
  const etaStr = formatDuration(eta);

  process.stdout.write(
    `\r[${stats.scanned}/${stats.total}] ${pct}% | ` +
      `found: ${stats.found} | empty: ${stats.notFound} | err: ${stats.errors} | ` +
      `ETA: ${etaStr} | ${currentTitle.slice(0, 40)}${"".padEnd(20)}`,
  );
}

export function printSummary(stats: ScanStats): void {
  const elapsed = (Date.now() - stats.startTime) / 1000;

  console.log("\n\n=== Scan Complete ===");
  console.log(`  Total books:    ${stats.total}`);
  console.log(`  Scanned:        ${stats.scanned}`);
  console.log(`  Found holdings: ${stats.found}`);
  console.log(`  No holdings:    ${stats.notFound}`);
  console.log(`  Errors:         ${stats.errors}`);
  console.log(`  Duration:       ${formatDuration(elapsed)}`);
  console.log(
    `  Rate:           ${(stats.scanned / elapsed).toFixed(1)} books/sec`,
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}
