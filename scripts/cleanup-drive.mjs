const endpoint = process.env.SHARED_MEDIA_CLEANUP_URL;
const secret = process.env.SHARED_MEDIA_CLEANUP_SECRET;
const dryRun = process.env.DRY_RUN !== "false";
if (!endpoint || !secret || new URL(endpoint).protocol !== "https:") throw new Error("Missing secure cleanup configuration.");
let cursor = null;
let passDeleted = 0;
let totalDeleted = 0;
let totalEligible = 0;
for (let batch = 0; batch < 20_000; batch++) {
  let result;
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(endpoint, {method: "POST", headers: {"Content-Type": "application/json", "x-hush-cleanup-key": secret}, body: JSON.stringify({dryRun, ...(cursor ? {cursor} : {})}), signal: AbortSignal.timeout(140_000)});
    if (response.ok) {result = await response.json(); break;}
    if (![429, 502, 503, 504].includes(response.status) || attempt === 4) throw new Error(`Cleanup failed: HTTP ${response.status}`);
    await new Promise(resolve => setTimeout(resolve, 2000 * 2 ** attempt));
  }
  passDeleted += result.deleted; totalDeleted += result.deleted; totalEligible += result.eligible;
  cursor = result.nextCursor;
  console.log(JSON.stringify({batch: batch + 1, dryRun, cutoff: result.cutoff, eligible: result.eligible, deleted: result.deleted, skipped: result.skipped}));
  if (!cursor) {
    // Deletion can shift Drive pagination; rescan until a full pass deletes nothing.
    if (!dryRun && passDeleted > 0) {passDeleted = 0; continue;}
    console.log(JSON.stringify({complete: true, dryRun, totalDeleted, ...(dryRun ? {totalEligible} : {})}));
    process.exit(0);
  }
}
throw new Error("Cleanup batch safety limit reached. Run again to continue.");
