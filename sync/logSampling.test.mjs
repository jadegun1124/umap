import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Workers Logs keep about 10% of requests, including errors', () => {
  const toml = readFileSync(new URL('./wrangler.toml', import.meta.url), 'utf8');
  assert.match(toml, /\[observability\]\nenabled = true/);
  assert.match(toml, /\[observability\.logs\]\nenabled = true\ninvocation_logs = true\nhead_sampling_rate = 0\.1/);
  assert.match(toml, /\[observability\.traces\]\nenabled = true\nhead_sampling_rate = 0\.1/);
  assert.match(toml, /\[observability\.issues\]\nenabled = true/);
  assert.match(toml, /90%/);
  assert.match(toml, /head_sampling_rate/);
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(readme, /head_sampling_rate = 0\.1/);
  assert.match(readme, /90%/);
  assert.match(readme, /observability\.logs\.head_sampling_rate/);
});
