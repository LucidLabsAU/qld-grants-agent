import type { GrantRecord } from '../../rayfin/data/GrantRecord';
import { catalogueFields, evidenceFields, evidenceText } from '../../rayfin/functions/src/grantFields';

export type QualityField = typeof catalogueFields[number][0];

export function fieldValue(grant: GrantRecord, field: QualityField): string | boolean | undefined {
  if (evidenceFields.some((key) => key === field)) return evidenceText(grant, field as typeof evidenceFields[number]);
  return grant[field];
}

export function hasField(grant: GrantRecord, field: QualityField): boolean {
  const value = fieldValue(grant, field);
  if (typeof value === 'boolean') return true;
  return typeof value === 'string' && !!value.trim() && !/^(unknown|not specified|n\/a|[-–—\s]+)$/i.test(value.trim());
}

export function qualityBySource(grants: GrantRecord[]) {
  const groups = new Map<string, GrantRecord[]>();
  for (const grant of grants) {
    const group = groups.get(grant.source) ?? [];
    group.push(grant);
    groups.set(grant.source, group);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([source, records]) => ({
    source, total: records.length,
    fields: Object.fromEntries(catalogueFields.map(([key]) => [key, records.filter((record) => hasField(record, key)).length])) as Record<QualityField, number>,
  }));
}
