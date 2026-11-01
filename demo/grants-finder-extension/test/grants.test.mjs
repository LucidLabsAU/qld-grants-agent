import assert from 'node:assert/strict';
import { test } from 'node:test';
import { grantDetailsPath, parseRetrievedGrants } from '../extension/lib/grants.js';

test('only Queensland finder IDs have a Queensland-site details route', () => {
  assert.equal(grantDetailsPath({ id: '123', source: 'Queensland Grants Finder' }), '/service-details/123');
  for (const source of ['business.gov.au', 'SmartyGrants (Council)', 'Queensland Government (official program page)']) {
    assert.equal(grantDetailsPath({ id: 'cur-abc', source }), null);
  }
});

test('cards recompute current availability rather than trusting stale sync flags', () => {
  const output = { documents: [
    { content: JSON.stringify({ id: '1', title: 'Expired', status: 'Open', isOpen: true, closingDate: '2020-01-01T23:59:59.999+10:00' }) },
    { content: JSON.stringify({ id: '2', title: 'Ongoing', status: 'Open', isOpen: false }) },
  ] };
  const cards = parseRetrievedGrants(output);
  assert.equal(cards[0].isOpen, false);
  assert.equal(cards[0].status, 'Closed');
  assert.equal(cards[1].isOpen, true);
});

test('cards reject non-string titles and non-web URLs', () => {
  const cards = parseRetrievedGrants({ documents: [
    { content: JSON.stringify({ id: '1', title: {}, url: 'https://example.test' }) },
    { content: JSON.stringify({ id: '2', title: 'Valid', url: 'javascript:alert(1)' }) },
  ] });
  assert.equal(cards.length, 1);
  assert.equal(cards[0].url, '');
  assert.deepEqual(parseRetrievedGrants({ documents: {} }), []);
});
