import { claimsApi } from '@/api/claims';
import type { ClaimDetail } from '@/api/types';
import { cityTierFor } from '@/utils/cities';

/**
 * BR-03: a POLICY_REJECTED claim cannot be edited, but the owner can copy it to a new draft.
 * Lines are copied; receipts are not (the employee attaches them again, which also re-runs hashing).
 */
export async function copyClaimToDraft(claim: ClaimDetail): Promise<ClaimDetail> {
  const draft = await claimsApi.create(`${claim.title} (copy)`);
  for (const l of claim.lines) {
    await claimsApi.addLine(draft.id, {
      category: l.category,
      amount: String(l.amount),
      expenseDate: l.expenseDate,
      vendor: l.vendor,
      city: l.city ?? '',
      cityTier: l.cityTier ?? cityTierFor(l.city ?? ''),
      nights: l.nights ?? null,
      description: l.description ?? '',
    });
  }
  return draft;
}
