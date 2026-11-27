import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { addDaysISO, todayIST } from '@/utils/time';
import { line } from '@/test/fixtures';
import { LineForm } from './LineForm';

function setup(props: Partial<Parameters<typeof LineForm>[0]> = {}) {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  render(<LineForm line={null} saving={false} onSave={onSave} onCancel={onCancel} {...props} />);
  return { onSave, onCancel, user: userEvent.setup({ applyAccept: false }) };
}

async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByTestId('line-amount'), '1200');
  await user.type(screen.getByTestId('line-vendor'), 'Hotel Sagar');
  await user.type(screen.getByTestId('line-city'), 'Pune');
}

describe('S2b line form (EF-002, EF-003)', () => {
  it('TC-FE-L01 required fields show inline errors linked by aria-describedby', async () => {
    const { user, onSave } = setup();
    await user.click(screen.getByTestId('line-save'));
    const amount = screen.getByTestId('line-amount');
    expect(screen.getByTestId('line-amount-error')).toHaveTextContent('Enter an amount.');
    expect(amount).toHaveAttribute('aria-invalid', 'true');
    expect(amount.getAttribute('aria-describedby')).toContain(screen.getByTestId('line-amount-error').id);
    expect(screen.getByTestId('line-vendor-error')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('TC-FE-L02 (TC-CLM-03) amount ≤ 0 and future dates are rejected', async () => {
    const { user, onSave } = setup();
    await fillValid(user);
    await user.clear(screen.getByTestId('line-amount'));
    await user.type(screen.getByTestId('line-amount'), '0');
    const date = screen.getByTestId('line-date');
    await user.clear(date);
    await user.type(date, addDaysISO(todayIST(), 1));
    await user.click(screen.getByTestId('line-save'));
    expect(screen.getByTestId('line-amount-error')).toHaveTextContent(/greater than 0/);
    expect(screen.getByTestId('line-date-error')).toHaveTextContent(/cannot be in the future/);
    expect(date).toHaveAttribute('max', todayIST());
    expect(onSave).not.toHaveBeenCalled();
  });

  it('TC-FE-L03 nights is shown only for HOTEL and required there', async () => {
    const { user, onSave } = setup();
    expect(screen.queryByTestId('line-nights')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByTestId('line-category'), 'HOTEL');
    const nights = screen.getByTestId('line-nights');
    expect(nights).toHaveValue(1);
    await fillValid(user);
    await user.clear(nights);
    await user.click(screen.getByTestId('line-save'));
    expect(screen.getByTestId('line-nights-error')).toHaveTextContent(/at least 1 night/);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('TC-FE-L04 picking a city sets the tier', async () => {
    const { user } = setup();
    await user.type(screen.getByTestId('line-city'), 'Mumbai');
    expect(screen.getByTestId('line-tier')).toHaveValue('TIER_1');
    await user.clear(screen.getByTestId('line-city'));
    await user.type(screen.getByTestId('line-city'), 'Jaipur');
    expect(screen.getByTestId('line-tier')).toHaveValue('OTHER');
  });

  it('TC-FE-L05 (TC-SEC-13) wrong type or > 5 MB receipt is rejected before upload', async () => {
    const { user } = setup();
    await user.upload(screen.getByTestId('line-receipt-input'), new File(['x'], 'setup.exe', { type: 'application/x-msdownload' }));
    expect(screen.getByTestId('line-receipt-error')).toHaveTextContent(/Only PDF, JPG or PNG/);
    await user.upload(screen.getByTestId('line-receipt-input'), new File([new Uint8Array(6 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' }));
    expect(screen.getByTestId('line-receipt-error')).toHaveTextContent(/limit is 5 MB/);
    expect(screen.queryByTestId('line-receipt-selected')).not.toBeInTheDocument();
  });

  it('TC-FE-L06 camera input uses the rear camera on phones', () => {
    setup();
    expect(screen.getByTestId('line-receipt-camera-input')).toHaveAttribute('capture', 'environment');
  });

  it('TC-FE-L07 valid line is saved with trimmed values and the chosen file', async () => {
    const { user, onSave } = setup();
    await fillValid(user);
    const file = new File(['%PDF-1.4'], 'bill.pdf', { type: 'application/pdf' });
    await user.upload(screen.getByTestId('line-receipt-input'), file);
    expect(screen.getByTestId('line-receipt-selected')).toHaveTextContent('bill.pdf');
    await user.click(screen.getByTestId('line-save'));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'MEAL', amount: '1200', vendor: 'Hotel Sagar', city: 'Pune', cityTier: 'TIER_1', nights: null }),
      file,
    );
  });

  it('TC-FE-L08 editing shows server field errors and existing receipt', () => {
    setup({ line: line(), existingReceiptName: 'dinner.jpg', serverErrors: { vendor: 'Vendor is too long' } });
    expect(screen.getByTestId('line-amount')).toHaveValue('1200.00');
    expect(screen.getByTestId('line-receipt-existing')).toHaveTextContent('dinner.jpg');
    expect(screen.getByTestId('line-vendor-error')).toHaveTextContent('Vendor is too long');
    expect(screen.getByTestId('line-save')).toHaveTextContent('Save line');
  });
});
