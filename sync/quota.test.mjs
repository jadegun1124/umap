import assert from 'node:assert/strict';
import test from 'node:test';
import { STORAGE_QUOTA_MESSAGE, storageQuotaResponse } from './protocol.mjs';

test('a Durable Object free-tier write limit becomes a Korean quota response', async () => {
  const response = storageQuotaResponse(new Error('Exceeded allowed rows written in Durable Objects free tier.'));
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error, 'quota');
  assert.equal(body.message, STORAGE_QUOTA_MESSAGE);
  assert.match(body.message, /오전 9시/);
  assert.equal(storageQuotaResponse(new Error('invalid token')), null);
  const nested = storageQuotaResponse({ message: '', cause: { message: 'Exceeded allowed rows read in Durable Objects free tier.' } });
  assert.equal(nested.status, 503);
});
