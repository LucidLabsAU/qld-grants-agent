import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DataQuality } from '@/components/DataQuality';
import { hasField, qualityBySource } from '@/services/dataQuality';
import { parseGrantImport, type GrantRecord } from '@/services/grants';
import { catalogueFields, enableLosslessText } from '../../rayfin/functions/src/grantFields';
import { deserializeDabResponse } from '@microsoft/rayfin-data';

const grant: GrantRecord = {
  ...parseGrantImport([{
    id: 'qld-1', source: 'State', title: 'Community grant', amount: 0, jurisdictions: ['Queensland'],
    categories: [], contentHash: 'hash', isOpen: false, eligibility: null,
  }])[0], id: 'record-1', user_id: 'owner', active: true,
};
const missing: GrantRecord = { ...grant, id: 'record-2', sourceId: 'qld-2', title: 'Second grant', amount: '', eligibilityOverflow: 'Additional source evidence' };

describe('catalogue data quality', () => {
  it('keeps date-shaped funding guidance and boolean-shaped text lossless through the real SDK serializer', () => {
    const previous = process.env.RAYFIN_FEATURE_FLAGS;
    try {
      enableLosslessText(process.env);
      const result = deserializeDabResponse({
        openingDateText: '2016-11-01T00:00:00', amountText: 'false', closingDate: '2026-12-01', isOpen: false,
      });
      expect(result).toEqual({
        openingDateText: '2016-11-01T00:00:00', amountText: 'false', closingDate: '2026-12-01', isOpen: false,
      });
    } finally {
      if (previous === undefined) delete process.env.RAYFIN_FEATURE_FLAGS;
      else process.env.RAYFIN_FEATURE_FLAGS = previous;
    }
  });
  it('counts zero, false and full evidence as present and separates missing fields by source', () => {
    expect(hasField(grant, 'amount')).toBe(true);
    expect(hasField(grant, 'isOpen')).toBe(true);
    expect(hasField(grant, 'categories')).toBe(false);
    expect(hasField(missing, 'eligibility')).toBe(true);
    expect(hasField({ ...grant, status: 'Unknown' }, 'status')).toBe(false);
    expect(hasField({ ...grant, roundName: '-' }, 'roundName')).toBe(false);
    const groups = qualityBySource([grant, missing, { ...grant, id: 'other', source: 'Council', amount: '' }]);
    expect(groups.find((group) => group.source === 'State')).toMatchObject({ total: 2, fields: { amount: 1, eligibility: 1, isOpen: 2 } });
    expect(groups.find((group) => group.source === 'Council')).toMatchObject({ total: 1, fields: { amount: 0 } });
  });

  it('drills from source to programs, filters missing fields and retains Queensland scope unless explicitly expanded', () => {
    const onSelect = vi.fn();
    render(<DataQuality grants={[grant, missing, { ...grant, id: 'interstate', title: 'Interstate grant', source: 'Federal', jurisdictions: 'Victoria' }]} onSelect={onSelect} />);
    expect(screen.getByText('2 programs · 1 sources')).toBeInTheDocument();
    const row = screen.getAllByRole('row')[1];
    const headers = screen.getAllByRole('columnheader').map((header) => header.textContent);
    expect(headers).toHaveLength(catalogueFields.length + 2);
    const openingGuidance = screen.getByRole('columnheader', { name: 'Opening date guidance' });
    expect(openingGuidance.querySelector('br')).toBeInTheDocument();
    expect(openingGuidance).toHaveTextContent('Opening date guidance');
    expect(screen.getByRole('columnheader', { name: 'Amount (AUD)' }).querySelector('br')).toBeNull();
    const amount = within(row).getAllByRole('cell')[headers.indexOf('Amount (AUD)') - 1];
    const count = within(amount).getByRole('button', { name: 'Amount (AUD) completeness for State: 1 of 2 records (50%).' });
    expect(count).toHaveTextContent('1 / 2');
    expect(count).not.toHaveTextContent('50%');
    expect(count).toHaveAttribute('aria-pressed', 'false');
    expect(amount).toHaveStyle({ backgroundSize: '50% 100%' });
    expect(within(amount).getAllByRole('button')).toHaveLength(1);
    expect(amount.querySelector('.quality-cell-size')).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'State' }));
    expect(screen.getByRole('button', { name: 'Community grant' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Find missing field'), { target: { value: 'amount' } });
    expect(screen.queryByRole('button', { name: 'Community grant' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Second grant' }));
    expect(onSelect).toHaveBeenCalledWith('record-2');
    fireEvent.change(screen.getByLabelText('Find missing field'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Jurisdiction'), { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Interstate grant' })).toBeInTheDocument();
  });

  it('toggles individual cells between count and percentage by click and keyboard without changing their fills', async () => {
    const user = userEvent.setup();
    render(<DataQuality grants={[grant, missing, { ...missing, id: 'record-3', sourceId: 'qld-3' }]} onSelect={vi.fn()} />);
    for (const [field, percent, count] of [['Amount (AUD)', 33.3, 1], ['Categories', 0, 0], ['Cached open flag', 100, 3]] as const) {
      const button = screen.getByRole('button', { name: `${field} completeness for State: ${count} of 3 records (${percent}%).` });
      expect(button).toHaveTextContent(`${count} / 3`);
      expect(button.parentElement).toHaveStyle({ backgroundSize: `${percent}% 100%` });
      await user.click(button);
      expect(button).toHaveTextContent(`${percent}%`);
      expect(button).toHaveAttribute('aria-pressed', 'true');
      expect(button.parentElement).toHaveStyle({ backgroundSize: `${percent}% 100%` });
      expect(screen.getByRole('button', { name: 'Grant title completeness for State: 3 of 3 records (100%).' })).toHaveTextContent('3 / 3');
      await user.keyboard('[Space]');
      expect(button).toHaveTextContent(`${count} / 3`);
      expect(button).toHaveAttribute('aria-pressed', 'false');
    }
  });
});
