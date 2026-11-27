import { useRef, useState, type FormEvent } from 'react';
import { Camera, Paperclip, Trash2, X } from 'lucide-react';
import { CATEGORIES, type Category, type CityTier, type ClaimLine, type LineInput } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { ALL_CITIES, cityTierFor, tierLabel } from '@/utils/cities';
import { CATEGORY_LABEL } from '@/utils/labels';
import { isValidAmount } from '@/utils/money';
import { validateReceiptFile } from '@/utils/misc';
import { todayIST } from '@/utils/time';
import { LocalFilePreview } from './ReceiptViewer';

export interface LineFormProps {
  line: ClaimLine | null;
  existingReceiptName?: string | null;
  serverErrors?: Record<string, string>;
  generalError?: string | null;
  saving: boolean;
  onSave: (input: LineInput, file: File | null) => void;
  onCancel: () => void;
  onDelete?: () => void;
  testId?: string;
}

type Errors = Partial<Record<keyof LineInput | 'file', string>>;

function initial(line: ClaimLine | null): LineInput {
  if (!line) {
    return {
      category: 'MEAL',
      amount: '',
      expenseDate: todayIST(),
      vendor: '',
      city: '',
      cityTier: 'OTHER',
      nights: null,
      description: '',
    };
  }
  return {
    category: line.category,
    amount: String(line.amount),
    expenseDate: line.expenseDate,
    vendor: line.vendor,
    city: line.city ?? '',
    cityTier: line.cityTier ?? cityTierFor(line.city ?? ''),
    nights: line.nights ?? null,
    description: line.description ?? '',
  };
}

function validateLine(v: LineInput, today = todayIST()): Errors {
  const e: Errors = {};
  if (!v.category) e.category = 'Choose a category.';
  if (!v.amount.trim()) e.amount = 'Enter an amount.';
  else if (!isValidAmount(v.amount)) e.amount = 'Amount must be greater than 0 with at most 2 decimals.';
  if (!v.expenseDate) e.expenseDate = 'Choose the expense date.';
  else if (v.expenseDate > today) e.expenseDate = 'The expense date cannot be in the future.';
  if (!v.vendor.trim()) e.vendor = 'Enter the vendor name.';
  if (!v.city.trim()) e.city = 'Enter the city.';
  if (v.category === 'HOTEL' && (!v.nights || v.nights < 1)) e.nights = 'Hotel lines need at least 1 night.';
  return e;
}

export function LineForm({
  line,
  existingReceiptName,
  serverErrors,
  generalError,
  saving,
  onSave,
  onCancel,
  onDelete,
  testId = 'line-form',
}: LineFormProps) {
  const [v, setV] = useState<LineInput>(() => initial(line));
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const today = todayIST();

  const err = (k: keyof Errors): string | undefined => errors[k] ?? serverErrors?.[k];

  function set<K extends keyof LineInput>(k: K, value: LineInput[K]) {
    setV((cur) => ({ ...cur, [k]: value }));
    setErrors((cur) => ({ ...cur, [k]: undefined }));
  }

  function onPickFile(f: File | undefined) {
    if (!f) return;
    const problem = validateReceiptFile(f);
    if (problem) {
      setErrors((cur) => ({ ...cur, file: problem }));
      setFile(null);
      return;
    }
    setErrors((cur) => ({ ...cur, file: undefined }));
    setFile(f);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const found = validateLine(v, today);
    setErrors((cur) => ({ ...found, file: cur.file }));
    if (Object.keys(found).length > 0) return;
    onSave({ ...v, amount: v.amount.trim(), nights: v.category === 'HOTEL' ? v.nights : null }, file);
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3" data-testid={testId}>
      {generalError && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800" data-testid={`${testId}-error`}>
          {generalError}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Category" required error={err('category')} testId="line-category">
          {(p) => (
            <Select
              {...p}
              value={v.category}
              onChange={(e) => {
                const c = e.target.value as Category;
                set('category', c);
                if (c === 'HOTEL' && !v.nights) set('nights', 1);
              }}
              data-testid="line-category"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Amount (₹)" required error={err('amount')} testId="line-amount">
          {(p) => (
            <Input
              {...p}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={v.amount}
              onChange={(e) => set('amount', e.target.value.replace(/[^\d.]/g, ''))}
              className="text-right tabular-nums"
              data-testid="line-amount"
            />
          )}
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Date" required error={err('expenseDate')} testId="line-date">
          {(p) => (
            <Input
              {...p}
              type="date"
              max={today}
              value={v.expenseDate}
              onChange={(e) => set('expenseDate', e.target.value)}
              data-testid="line-date"
            />
          )}
        </Field>
        {v.category === 'HOTEL' ? (
          <Field label="Nights" required error={err('nights')} testId="line-nights">
            {(p) => (
              <Input
                {...p}
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={v.nights ?? ''}
                onChange={(e) => set('nights', e.target.value === '' ? null : Math.max(0, Math.floor(Number(e.target.value))))}
                data-testid="line-nights"
              />
            )}
          </Field>
        ) : (
          <div aria-hidden />
        )}
      </div>

      <Field label="Vendor" required error={err('vendor')} testId="line-vendor">
        {(p) => (
          <Input
            {...p}
            autoComplete="off"
            maxLength={120}
            placeholder="e.g. Hotel Sagar"
            value={v.vendor}
            onChange={(e) => set('vendor', e.target.value)}
            data-testid="line-vendor"
          />
        )}
      </Field>

      <div className="grid grid-cols-[1fr_auto] items-start gap-3">
        <Field label="City" required error={err('city')} hint="Picking a city sets the tier" testId="line-city">
          {(p) => (
            <>
              <Input
                {...p}
                list="ef-cities"
                autoComplete="off"
                placeholder="Start typing…"
                value={v.city}
                onChange={(e) => {
                  set('city', e.target.value);
                  set('cityTier', cityTierFor(e.target.value));
                }}
                data-testid="line-city"
              />
              <datalist id="ef-cities">
                {ALL_CITIES.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </>
          )}
        </Field>
        <Field label="City tier" error={err('cityTier')} testId="line-tier">
          {(p) => (
            <Select
              {...p}
              value={v.cityTier}
              onChange={(e) => set('cityTier', e.target.value as CityTier)}
              className="w-32"
              data-testid="line-tier"
            >
              <option value="TIER_1">{tierLabel('TIER_1')}</option>
              <option value="OTHER">{tierLabel('OTHER')}</option>
            </Select>
          )}
        </Field>
      </div>

      <Field label="Description" error={err('description')} testId="line-description">
        {(p) => (
          <Textarea
            {...p}
            rows={2}
            maxLength={500}
            value={v.description}
            onChange={(e) => set('description', e.target.value)}
            data-testid="line-description"
          />
        )}
      </Field>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-slate-800">Receipt</legend>
        <p className="text-xs text-slate-600" id="receipt-hint">
          PDF, JPG or PNG, up to 5 MB. Required for amounts above ₹500.
        </p>
        {existingReceiptName && !file && (
          <p className="text-xs text-green-800" data-testid="line-receipt-existing">
            ✓ Attached: {existingReceiptName}
          </p>
        )}
        {file && (
          <div className="flex items-start gap-3" data-testid="line-receipt-selected">
            <LocalFilePreview file={file} />
            <div className="min-w-0 text-xs text-slate-700">
              <p className="truncate font-medium">{file.name}</p>
              <button
                type="button"
                onClick={() => setFile(null)}
                className="mt-1 inline-flex items-center gap-1 text-red-700 hover:underline"
                data-testid="line-receipt-clear"
              >
                <X className="h-3 w-3" aria-hidden /> Remove
              </button>
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            icon={<Camera className="h-4 w-4" aria-hidden />}
            onClick={() => cameraRef.current?.click()}
            testId="line-receipt-camera"
          >
            Take photo
          </Button>
          <Button
            size="sm"
            icon={<Paperclip className="h-4 w-4" aria-hidden />}
            onClick={() => fileRef.current?.click()}
            testId="line-receipt-file"
          >
            {existingReceiptName || file ? 'Replace file' : 'Choose file'}
          </Button>
          <input
            ref={cameraRef}
            type="file"
            accept="image/jpeg,image/png"
            capture="environment"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              onPickFile(e.target.files?.[0]);
              e.target.value = '';
            }}
            data-testid="line-receipt-camera-input"
          />
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            className="sr-only"
            tabIndex={-1}
            aria-describedby="receipt-hint"
            onChange={(e) => {
              onPickFile(e.target.files?.[0]);
              e.target.value = '';
            }}
            data-testid="line-receipt-input"
          />
        </div>
        {err('file') && (
          <p role="alert" className="text-xs font-medium text-red-700" data-testid="line-receipt-error">
            {err('file')}
          </p>
        )}
      </fieldset>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3">
        {onDelete ? (
          <Button variant="danger" size="sm" icon={<Trash2 className="h-4 w-4" aria-hidden />} onClick={onDelete} testId="line-delete">
            Remove line
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button onClick={onCancel} testId="line-cancel">
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving} testId="line-save">
            {line ? 'Save line' : 'Add line'}
          </Button>
        </div>
      </div>
    </form>
  );
}
