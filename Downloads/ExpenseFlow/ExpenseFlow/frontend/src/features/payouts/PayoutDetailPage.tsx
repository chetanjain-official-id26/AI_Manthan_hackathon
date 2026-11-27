import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BadgeCheck, Ban, Download } from 'lucide-react';
import { ApiError, errorMessage } from '@/api/client';
import { qk } from '@/api/keys';
import { payoutsApi } from '@/api/payouts';
import type { PayoutBatch, PayoutItem } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { PayoutStatusChip } from '@/components/ui/Chips';
import { Banner, ConflictBanner, ErrorBanner, Money, Stat, SkeletonDetail } from '@/components/ui/Display';
import { Field, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { NotFoundPage } from '@/components/layout/NotFound';
import { formatINR, sumMoney } from '@/utils/money';
import { saveBlob } from '@/utils/misc';
import { formatIST } from '@/utils/time';

interface EmployeeGroup {
  key: string;
  name: string;
  empCode?: string;
  items: PayoutItem[];
  total: string;
}

function groupByEmployee(items: PayoutItem[]): EmployeeGroup[] {
  const map = new Map<string, EmployeeGroup>();
  for (const it of items) {
    const key = String(it.employeeId);
    const g = map.get(key) ?? { key, name: it.employeeName ?? `Employee #${it.employeeId}`, empCode: it.empCode, items: [], total: '0.00' };
    g.items.push(it);
    map.set(key, g);
  }
  for (const g of map.values()) g.total = sumMoney(g.items.map((i) => i.amount));
  return [...map.values()].sort((a, b) => (a.empCode ?? a.name).localeCompare(b.empCode ?? b.name));
}

export default function PayoutDetailPage() {
  const { id: idParam } = useParams();
  const id = Number(idParam);
  const q = useQuery({ queryKey: qk.payout(id), queryFn: () => payoutsApi.get(id), enabled: Number.isFinite(id) && id > 0 });

  if (!Number.isFinite(id) || id <= 0) return <NotFoundPage title="Batch not found" />;
  if (q.isPending) return <SkeletonDetail />;
  if (q.isError) {
    if (q.error instanceof ApiError && q.error.isNotFound) return <NotFoundPage title="Batch not found" />;
    return <ErrorBanner error={q.error} onRetry={() => void q.refetch()} />;
  }
  return <BatchDetail batch={q.data} onRefresh={() => void q.refetch()} />;
}

function BatchDetail({ batch, onRefresh }: { batch: PayoutBatch; onRefresh: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [dialog, setDialog] = useState<'paid' | 'void' | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidError, setVoidError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const groups = useMemo(() => groupByEmployee(batch.items ?? []), [batch.items]);
  const employeeCount = batch.employeeCount ?? groups.length;

  const refreshAll = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: qk.payout(batch.id) }),
      qc.invalidateQueries({ queryKey: qk.payouts }),
      qc.invalidateQueries({ queryKey: qk.claims }),
    ]);
  };

  const onErr = (e: unknown) => {
    setDialog(null);
    if (e instanceof ApiError && e.isConflict) setConflict(true);
    else setActionError(errorMessage(e));
  };

  const exportCsv = useMutation({
    mutationFn: () => payoutsApi.csv(batch.id),
    onSuccess: async ({ blob, fileName }) => {
      saveBlob(blob, fileName ?? batch.fileName ?? `EXPF_${batch.id}.csv`);
      toast.success(`Downloaded ${fileName ?? batch.fileName ?? 'CSV'}`);
      await refreshAll();
    },
    onError: onErr,
  });

  const markPaid = useMutation({
    mutationFn: () => payoutsApi.markPaid(batch.id, batch.version),
    onSuccess: async () => {
      setDialog(null);
      toast.success(`Batch ${batch.batchNo} marked paid · ${batch.claimCount} claims are now PAID`);
      await refreshAll();
    },
    onError: onErr,
  });

  const voidBatch = useMutation({
    mutationFn: (reason: string) => payoutsApi.void(batch.id, reason),
    onSuccess: async () => {
      setDialog(null);
      setVoidReason('');
      toast.success(`Batch ${batch.batchNo} voided · claims returned to Approved`);
      await refreshAll();
      void qc.invalidateQueries({ queryKey: qk.eligible });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.isValidation) setVoidError(e.fieldErrors.reason ?? errorMessage(e));
      else onErr(e);
    },
  });

  const canExport = batch.status === 'DRAFT' || batch.status === 'EXPORTED';
  const canPay = batch.status === 'EXPORTED';
  const canVoid = batch.status === 'DRAFT' || batch.status === 'EXPORTED';

  return (
    <div className="space-y-4">
      <Link to="/payouts" className="inline-flex items-center gap-1 text-sm text-slate-700 hover:text-slate-900" data-testid="back-to-payouts">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Payouts
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold text-slate-900" data-testid="batch-no">
            Batch {batch.batchNo}
          </h1>
          <PayoutStatusChip status={batch.status} />
        </div>
        <div className="flex flex-wrap gap-2">
          {canExport && (
            <Button icon={<Download className="h-4 w-4" aria-hidden />} loading={exportCsv.isPending} onClick={() => exportCsv.mutate()} testId="export-csv">
              {batch.status === 'EXPORTED' ? 'Download CSV again' : 'Export CSV'}
            </Button>
          )}
          {batch.status !== 'PAID' && batch.status !== 'VOID' && (
            <Button
              variant="success"
              icon={<BadgeCheck className="h-4 w-4" aria-hidden />}
              disabled={!canPay}
              title={canPay ? undefined : 'Export the CSV first'}
              onClick={() => setDialog('paid')}
              testId="mark-paid"
            >
              Mark paid
            </Button>
          )}
          {canVoid && (
            <Button
              variant="danger"
              icon={<Ban className="h-4 w-4" aria-hidden />}
              onClick={() => {
                setVoidError(null);
                setDialog('void');
              }}
              testId="void-batch"
            >
              Void
            </Button>
          )}
        </div>
      </div>

      {conflict && (
        <ConflictBanner
          onRefresh={() => {
            setConflict(false);
            onRefresh();
          }}
        />
      )}
      {actionError && (
        <Banner tone="error" testId="batch-action-error">
          {actionError}
        </Banner>
      )}
      {batch.status === 'DRAFT' && <Banner tone="info">Export the CSV and upload it to the bank, then mark the batch paid.</Banner>}
      {batch.status === 'VOID' && (
        <Banner tone="warning" title="Voided">
          {batch.voidReason ?? 'This batch was voided. Its claims returned to Approved.'}
        </Banner>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="batch-totals">
        <Stat label="Claims" value={batch.claimCount} testId="batch-claims" />
        <Stat label="Employees" value={employeeCount} testId="batch-employees" />
        <Stat label="Total" value={<span className="text-xl">{formatINR(batch.totalAmount)}</span>} testId="batch-total" />
        <Stat
          label="File"
          value={<span className="block truncate text-sm font-medium">{batch.fileName ?? 'Not exported'}</span>}
          hint={batch.paidAt ? `Paid ${formatIST(batch.paidAt)}` : batch.exportedAt ? `Exported ${formatIST(batch.exportedAt)}` : `Created ${formatIST(batch.createdAt)}`}
          testId="batch-file"
        />
      </div>

      <section className="ef-table-wrap ef-scroll" aria-label="Batch items by employee">
        <table className="w-full text-sm" data-testid="batch-items">
          <thead className="ef-thead text-left font-semibold uppercase">
            <tr>
              <th scope="col" className="px-4 py-3">Employee / claim</th>
              <th scope="col" className="px-4 py-3 text-right">Amount</th>
            </tr>
          </thead>
          {groups.length === 0 ? (
            <tbody>
              <tr>
                <td colSpan={2} className="px-4 py-6 text-center text-slate-600">
                  No items.
                </td>
              </tr>
            </tbody>
          ) : (
            groups.map((g) => (
              <tbody key={g.key} className="border-t border-slate-200" data-testid={`batch-group-${g.key}`}>
                <tr className="bg-slate-50/60">
                  <th scope="rowgroup" className="px-4 py-2 text-left font-semibold text-slate-900">
                    {g.name}
                    {g.empCode && <span className="ml-1 font-normal text-slate-600">· {g.empCode}</span>}
                    <span className="ml-1 font-normal text-slate-600">
                      · {g.items.length} claim{g.items.length > 1 ? 's' : ''}
                    </span>
                  </th>
                  <td className="px-4 py-2 text-right">
                    <Money value={g.total} strong />
                  </td>
                </tr>
                {g.items.map((it) => (
                  <tr key={it.claimId}>
                    <td className="px-4 py-1.5 pl-8">
                      <Link to={`/claims/${it.claimId}`} state={{ from: `/payouts/${batch.id}` }} className="text-indigo-800 hover:underline">
                        {it.claimNo ?? `Claim #${it.claimId}`}
                      </Link>
                    </td>
                    <td className="px-4 py-1.5 text-right">
                      <Money value={it.amount} />
                    </td>
                  </tr>
                ))}
              </tbody>
            ))
          )}
          <tfoot className="border-t-2 border-slate-300">
            <tr>
              <th scope="row" className="px-4 py-3 text-left">
                Control total
              </th>
              <td className="px-4 py-3 text-right">
                <Money value={batch.totalAmount} strong />
              </td>
            </tr>
          </tfoot>
        </table>
      </section>

      <Modal
        open={dialog === 'paid'}
        onClose={() => setDialog(null)}
        title={`Mark batch ${batch.batchNo} paid?`}
        size="sm"
        testId="mark-paid-dialog"
        footer={
          <>
            <Button onClick={() => setDialog(null)} testId="mark-paid-cancel">
              Cancel
            </Button>
            <Button variant="success" loading={markPaid.isPending} onClick={() => markPaid.mutate()} testId="mark-paid-confirm">
              Mark paid
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-700">
          Confirm the bank has processed <strong>{batch.fileName ?? 'the file'}</strong>. All {batch.claimCount} claims ({formatINR(batch.totalAmount)}) will move
          to <strong>Paid</strong>. A paid batch cannot be voided.
        </p>
      </Modal>

      <Modal
        open={dialog === 'void'}
        onClose={() => setDialog(null)}
        title={`Void batch ${batch.batchNo}?`}
        size="sm"
        testId="void-dialog"
        footer={
          <>
            <Button onClick={() => setDialog(null)} testId="void-cancel">
              Keep batch
            </Button>
            <Button
              variant="danger"
              loading={voidBatch.isPending}
              onClick={() => {
                if (!voidReason.trim()) {
                  setVoidError('A reason is required to void a batch.');
                  return;
                }
                voidBatch.mutate(voidReason.trim());
              }}
              testId="void-confirm"
            >
              Void batch
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          <p className="text-sm text-slate-700">Claims in this batch return to Approved and can be added to a new batch.</p>
          <Field label="Reason" required error={voidError} testId="void-reason">
            {(p) => (
              <Textarea
                {...p}
                autoFocus
                rows={2}
                value={voidReason}
                onChange={(e) => {
                  setVoidReason(e.target.value);
                  setVoidError(null);
                }}
                data-testid="void-reason"
              />
            )}
          </Field>
        </div>
      </Modal>
    </div>
  );
}
