'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const api = require('../web/api-cost.js');
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10,
  `expected ${expected}, got ${actual}`);
const row = (input = 10000, cached = 6000, output = 1000, extra = {}) => ({
  attempt_id: 'a', input_tokens: input, cached_input_tokens: cached,
  output_tokens: output, model_responses: 1, paid_requests: 1, usage_known: true, ...extra
});
const entry = (id, attempt, extra = {}) => ({ run_id: id, model: 'gpt-6-astra', costs: { attempts: [attempt] }, ...extra });
let passed = 0;
function test(name, fn) {
  fn(); passed++; process.stdout.write(`ok ${passed} - ${name}\n`);
}

test('observed hit rate, unknown cache-write interval and optimistic lower bound', () => {
  const x = api.estimate([entry('one', row())], 2);
  close(x.observed_min, 0.096); close(x.observed_max, 0.106); close(x.optimistic_min, 0.06);
  close(x.avg_observed_min, 0.048); close(x.avg_observed_max, 0.053); close(x.avg_optimistic_min, 0.03);
  assert.equal(x.partial, false); assert.equal(x.cache_write_unknown_attempts, 1);
});
test('mixed models use their own prices, not a selected group default', () => {
  const x = api.estimate([entry('astra', row(), { model: { name: 'gpt-6-astra', thinking_effort: 'medium' } }),
    entry('luna', row(), { model: 'gpt-5.6-luna' })], 2);
  close(x.observed_min, 0.09812); close(x.observed_max, 0.10832); close(x.optimistic_min, 0.0614);
});
test('known write count replaces ordinary input charges without double billing', () => {
  const x = api.estimate([entry('write', row(10000, 6000, 1000, { cache_write_input_tokens: 2000 }))], 1);
  close(x.observed_min, 0.101); close(x.observed_max, 0.101);
  assert.equal(x.cache_write_unknown_attempts, 0);
});
test('cache remains a subset; invalid cache does not corrupt independent lower bound', () => {
  const x = api.estimate([entry('bad-cache', row(10, 11, 1))], 1);
  assert.equal(x.observed_min, null); close(x.optimistic_min, 0.00006);
  assert.equal(x.observed_complete, false); assert.equal(x.optimistic_complete, true);
});
test('single long request prices the entire input and output at long-context rates', () => {
  const x = api.estimate([entry('long', row(300000, 200000, 1000))], 1);
  close(x.observed_min, 2.475); close(x.observed_max, 2.975); close(x.optimistic_min, 0.675);
  assert.equal(x.long_context_ambiguous_attempts, 0);
});
test('two-response aggregate above threshold has short/long bounds, not assumed long', () => {
  const x = api.estimate([entry('two', row(300000, 200000, 1000, { model_responses: 2 }))], 1);
  close(x.observed_min, 1.25); close(x.observed_max, 2.975); close(x.optimistic_min, 0.35);
  assert.equal(x.long_context_ambiguous_attempts, 1);
});
test('threshold itself and multi-response input below it are short', () => {
  const x = api.estimate([entry('edge', row(272000, 0, 0, { model_responses: 2 }))], 1);
  close(x.observed_min, 2.72); close(x.observed_max, 3.4);
  assert.equal(x.long_context_ambiguous_attempts, 0);
});
test('aggregate-only counts cannot claim per-request long-context knowledge', () => {
  const aggregate = row(300000, 200000, 1000);
  const x = api.estimate([{ run_id: 'aggregate', model: 'gpt-6-astra', costs: aggregate }], 1);
  close(x.observed_min, 1.25); close(x.observed_max, 2.975);
  assert.equal(x.long_context_ambiguous_attempts, 1);
});
test('unknown usage stays partial while known counts remain calculable', () => {
  const x = api.estimate([entry('partial', row(10000, 6000, 1000, { usage_known: false }))], 1);
  close(x.observed_min, 0.096); assert.equal(x.unknown_attempts, 1); assert.equal(x.partial, true);
  const y = api.estimate([entry('missing', row(null, null, null))], 1);
  assert.equal(y.observed_min, null); assert.equal(y.optimistic_min, null); assert.equal(y.unknown_attempts, 1);
});
test('missing cached count cannot become zero; optimistic amount still exists', () => {
  const x = api.estimate([entry('missing-cache', row(10000, null, 1000))], 1);
  assert.equal(x.observed_min, null); close(x.optimistic_min, 0.06);
  assert.equal(x.missing_cached_attempts, 1); assert.equal(x.optimistic_complete, true);
});
test('unknown model is excluded with no fallback rate', () => {
  const x = api.estimate([entry('unsupported', row(), { model: 'gpt-6-sol' })], 1);
  assert.equal(x.observed_min, null); assert.equal(x.optimistic_min, null);
  assert.equal(x.unknown_model_entries, 1); assert.equal(x.partial, true);
});
test('identical duplicate entries are counted once and conflicting identities fail closed', () => {
  const a = entry('same', row());
  const x = api.estimate([a, JSON.parse(JSON.stringify(a))], 1);
  close(x.observed_min, 0.096); assert.equal(x.duplicate_entries, 1);
  const y = api.estimate([a, entry('same', row(11000))], 1);
  assert.equal(y.observed_min, null); assert.equal(y.conflicting_entries, 1);
});
test('extra invalid attempts add costs without changing the episode denominator', () => {
  const x = api.estimate([entry('episode', row()), entry('failed-extra', row(10000, 0, 1000))], 1);
  close(x.avg_observed_min, 0.246); close(x.avg_optimistic_min, 0.12);
  assert.equal(x.denominator, 1);
});
test('attempts override totals without summing twice; mismatches cannot invent a reference', () => {
  const a = entry('consistent', row());
  Object.assign(a.costs, { input_tokens: 10000, cached_input_tokens: 6000, output_tokens: 1000 });
  close(api.estimate([a], 1).observed_min, 0.096);
  a.costs.input_tokens = 20000;
  const x = api.estimate([a], 1);
  assert.equal(x.observed_min, null); assert.equal(x.optimistic_min, null); assert.equal(x.inconsistent_entries, 1);
});
test('cached-only aggregate mismatch blocks reference but preserves independent optimistic estimate', () => {
  const a = entry('mismatch', row()); a.costs.cached_input_tokens = 5000;
  const x = api.estimate([a], 1);
  assert.equal(x.observed_min, null); close(x.optimistic_min, 0.06);
});
test('receipt declarations survive and declared unknown attempts are not counted twice', () => {
  const a = entry('receipt', row(10000, 6000, 1000, { usage_known: false }), { receiptflag: 'contributor-declared' });
  a.costs.unknown_attempts = 3; a.costs.accounting = 'partial';
  const before = JSON.stringify(a), x = api.estimate([a], 1);
  assert.equal(x.unknown_attempts, 3); assert.equal(x.receipt_flags[0].flags.receiptflag, 'contributor-declared');
  assert.equal(JSON.stringify(a), before);
});
test('package-declared usage and unverified receipt identity remain visible', () => {
  const a = entry('supplement', row());
  a.costs.receipt_identity_verified = false;
  a.costs.basis = 'package_declared_usage_projection';
  const x = api.estimate([a], 1);
  assert.equal(x.receipt_flags.length, 1);
  assert.equal(x.receipt_flags[0].flags.receipt_identity_verified, false);
  assert.equal(x.receipt_flags[0].flags.basis, 'package_declared_usage_projection');
  close(x.observed_min, 0.096);
  const verified = entry('verified', row()); verified.costs.receipt_identity_verified = true;
  assert.equal(api.estimate([verified], 1).receipt_flags.length, 0);
});
test('zero usage is known zero; invalid denominator never yields Infinity', () => {
  const a = entry('zero', row(0, 0, 0));
  assert.equal(api.estimate([a], 1).observed_min, 0);
  const x = api.estimate([a], 0); assert.equal(x.avg_observed_min, null); assert.equal(x.partial, true);
});
test('browser global exposes the same pure API without CommonJS', () => {
  const sandbox = {}; vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../web/api-cost.js'), 'utf8'), sandbox);
  close(sandbox.ApiCost.estimate([entry('browser', row())], 1).observed_min, 0.096);
});
process.stdout.write(`${passed} API cost tests passed\n`);
