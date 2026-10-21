/* Fixed Standard API price scenarios, USD per million tokens, 2026-10-21.
 * Pure computation: no network, storage, or changes to source records.
 * Amounts on partial results cover only the rows whose required counts exist.
 * observed_min/max vary unknown cache writes and unresolved long-context rates;
 * optimistic_min prices all input as cache reads, omitting cold-start writes.
 * Neither metric estimates Codex subscription charges or a measured API bill.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ApiCost = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const DATE = '2026-10-21';
  const LONG_THRESHOLD = 272000;
  const PRICES = Object.freeze({
    'gpt-6-astra': Object.freeze({ input: 10, cached: 1, write: 12.5, output: 50 }),
    'gpt-5.6-luna': Object.freeze({ input: 0.20, cached: 0.02, write: 0.25, output: 1.20 })
  });
  const token = n => Number.isSafeInteger(n) && n >= 0;
  const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  function stable(value) {
    if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
    if (object(value)) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
    return JSON.stringify(value);
  }
  function declaredPartial(costs) {
    return costs.usage_known === false || costs.token_totals_complete === false ||
      costs.partial === true || /unknown|partial|incomplete|lower.bound/i.test(String(costs.accounting || ''));
  }
  function writeCount(row) {
    const a = row.cache_write_input_tokens, b = row.cache_write_tokens;
    if (a != null && b != null && a !== b) return { invalid: true };
    const value = a != null ? a : b;
    return value == null ? { known: false } : { known: true, value, invalid: !token(value) };
  }
  function longRate(input, responses, aggregate) {
    if (input <= LONG_THRESHOLD) return { minInput: 1, maxInput: 1, minOutput: 1, maxOutput: 1, ambiguous: false };
    const definite = !aggregate && responses === 1;
    return { minInput: definite ? 2 : 1, maxInput: 2, minOutput: definite ? 1.5 : 1,
      maxOutput: 1.5, ambiguous: !definite };
  }

  /**
   * entries: [{run_id, model, costs, receiptflag?, receipt_flags?}]
   * model is an exact model-name string or an object with a name property.
   * costs.attempts takes precedence over aggregate costs; never sum both.
   * denominator is the externally chosen episode count (extra attempts do not
   * increase it). Identical run_id entries are counted once; conflicts fail closed.
   * Null amounts mean no eligible rows, not zero cost. Check *_complete / partial
   * before describing any amount as covering the full group.
   */
  function estimate(entries, denominator) {
    const result = {
      pricing_date: DATE, currency: 'USD', denominator,
      observed_min: null, observed_max: null, optimistic_min: null,
      avg_observed_min: null, avg_observed_max: null, avg_optimistic_min: null,
      observed_complete: true, optimistic_complete: true, partial: false,
      unknown_attempts: 0, missing_cached_attempts: 0, unknown_model_entries: 0,
      duplicate_entries: 0, conflicting_entries: 0, duplicate_attempts: 0,
      inconsistent_entries: 0, long_context_ambiguous_attempts: 0,
      cache_write_unknown_attempts: 0, entries_counted: 0,
      observed_attempts: 0, optimistic_attempts: 0,
      known_input_tokens: 0, known_cached_input_tokens: 0, known_output_tokens: 0,
      receipt_flags: [], issues: []
    };
    let observedMin = 0, observedMax = 0, optimisticMin = 0;
    function issue(code, run_id, attempt_id) {
      const item = { code };
      if (run_id != null) item.run_id = run_id;
      if (attempt_id != null) item.attempt_id = attempt_id;
      result.issues.push(item);
    }
    function incomplete(observed = true, optimistic = true) {
      if (observed) result.observed_complete = false;
      if (optimistic) result.optimistic_complete = false;
    }
    const validDenominator = token(denominator) && denominator > 0;
    if (!validDenominator) { issue('invalid_denominator'); incomplete(); }
    if (!Array.isArray(entries)) { entries = []; issue('invalid_entries'); incomplete(); }
    const unique = new Map();
    for (const entry of entries) {
      if (!object(entry) || typeof entry.run_id !== 'string' || !entry.run_id) {
        issue('missing_run_id'); incomplete(); continue;
      }
      const flags = {};
      for (const source of [entry, object(entry.costs) ? entry.costs : {}]) {
        for (const key of Object.keys(source)) {
          const unverifiedReceipt = key === 'receipt_identity_verified' && source[key] === false;
          const declaredProjection = key === 'basis' && source[key] === 'package_declared_usage_projection';
          if (/receipt.*flag|receiptflag|supplement.*declar/i.test(key) || unverifiedReceipt || declaredProjection) {
            flags[key] = source[key];
          }
        }
      }
      if (Object.keys(flags).length) {
        const flag = { run_id: entry.run_id, flags };
        if (!result.receipt_flags.some(x => stable(x) === stable(flag))) result.receipt_flags.push(flag);
      }
      const signature = stable({ model: entry.model, costs: entry.costs });
      const prior = unique.get(entry.run_id);
      if (!prior) unique.set(entry.run_id, { entry, signature, conflict: false });
      else if (prior.signature === signature) result.duplicate_entries++;
      else if (!prior.conflict) {
        prior.conflict = true; result.conflicting_entries++;
        issue('conflicting_run_id', entry.run_id); incomplete();
      }
    }
    for (const item of unique.values()) {
      if (item.conflict) continue;
      const entry = item.entry, id = entry.run_id, costs = entry.costs;
      const model = object(entry.model) ? entry.model.name : entry.model;
      const price = typeof model === 'string' && own(PRICES, model) ? PRICES[model] : null;
      if (!price) {
        result.unknown_model_entries++; issue('unknown_model', id); incomplete(); continue;
      }
      if (!object(costs)) { issue('missing_costs', id); result.unknown_attempts++; incomplete(); continue; }
      const aggregate = !Array.isArray(costs.attempts) || costs.attempts.length === 0;
      let rows = aggregate ? [costs] : costs.attempts;
      let duplicateConflict = false;
      if (!aggregate) {
        const seen = new Map(), clean = [];
        for (const row of rows) {
          const key = object(row) && row.attempt_id;
          if (key == null) { clean.push(row); continue; }
          if (!seen.has(key)) { seen.set(key, stable(row)); clean.push(row); }
          else if (seen.get(key) === stable(row)) result.duplicate_attempts++;
          else { duplicateConflict = true; issue('conflicting_attempt_id', id, key); }
        }
        rows = clean;
      }
      if (duplicateConflict) { result.inconsistent_entries++; incomplete(); continue; }
      let blockObserved = false, blockOptimistic = false;
      if (!aggregate) {
        for (const field of ['input_tokens', 'cached_input_tokens', 'output_tokens', 'cache_write_input_tokens']) {
          if (!token(costs[field])) continue;
          const known = rows.filter(row => object(row) && token(row[field]));
          const sum = known.reduce((n, row) => n + row[field], 0);
          if (sum > costs[field] || (known.length === rows.length && sum !== costs[field])) {
            issue('aggregate_attempt_mismatch:' + field, id);
            blockObserved = true;
            if (field === 'input_tokens' || field === 'output_tokens') blockOptimistic = true;
          }
        }
      }
      if (blockObserved || blockOptimistic) {
        result.inconsistent_entries++; incomplete(blockObserved, blockOptimistic);
      }
      result.entries_counted++;
      let unknown = 0;
      for (let index = 0; index < rows.length; index++) {
        const row = rows[index];
        const aid = object(row) && row.attempt_id != null ? row.attempt_id : (aggregate ? 'aggregate' : index);
        if (!object(row)) { unknown++; issue('invalid_attempt', id, aid); incomplete(); continue; }
        const input = row.input_tokens, cached = row.cached_input_tokens, output = row.output_tokens;
        const inputKnown = token(input), outputKnown = token(output), cachedKnown = token(cached);
        const usagePartial = row.usage_known === false || row.token_totals_complete === false || row.partial === true;
        if (inputKnown) result.known_input_tokens += input;
        if (outputKnown) result.known_output_tokens += output;
        if (cachedKnown && inputKnown && cached <= input) result.known_cached_input_tokens += cached;
        if (usagePartial || !inputKnown || !outputKnown) {
          unknown++; issue('partial_usage', id, aid); incomplete();
        }
        if (!inputKnown || !outputKnown) continue;
        const rate = longRate(input, row.model_responses, aggregate);
        if (rate.ambiguous) result.long_context_ambiguous_attempts++;
        if (!blockOptimistic) {
          optimisticMin += (input * price.cached * rate.minInput + output * price.output * rate.minOutput) / 1e6;
          result.optimistic_attempts++;
        }
        if (!cachedKnown) {
          result.missing_cached_attempts++; issue('missing_cached_input', id, aid); incomplete(true, false); continue;
        }
        if (cached > input) {
          issue('cached_input_exceeds_input', id, aid); incomplete(true, false); continue;
        }
        const miss = input - cached, write = writeCount(row);
        if (write.invalid || (write.known && write.value > miss)) {
          issue('invalid_cache_write_input', id, aid); incomplete(true, false); continue;
        }
        if (blockObserved) continue;
        const lowWrite = write.known ? write.value : 0;
        const highWrite = write.known ? write.value : miss;
        if (!write.known && miss > 0) result.cache_write_unknown_attempts++;
        const inputCharge = count => cached * price.cached + (miss - count) * price.input + count * price.write;
        observedMin += (inputCharge(lowWrite) * rate.minInput + output * price.output * rate.minOutput) / 1e6;
        observedMax += (inputCharge(highWrite) * rate.maxInput + output * price.output * rate.maxOutput) / 1e6;
        result.observed_attempts++;
      }
      const declarations = [costs.unknown_attempts, costs.unknown_usage_attempts,
        costs.failed_or_inflight_requests_without_usage].filter(token);
      const declaredUnknown = declarations.length ? Math.max(...declarations) : 0;
      unknown = Math.max(unknown, declaredUnknown, declaredPartial(costs) ? 1 : 0);
      if (unknown) incomplete();
      result.unknown_attempts += unknown;
    }
    if (result.observed_attempts) { result.observed_min = observedMin; result.observed_max = observedMax; }
    else result.observed_complete = false;
    if (result.optimistic_attempts) result.optimistic_min = optimisticMin;
    else result.optimistic_complete = false;
    if (validDenominator) {
      if (result.observed_min !== null) result.avg_observed_min = result.observed_min / denominator;
      if (result.observed_max !== null) result.avg_observed_max = result.observed_max / denominator;
      if (result.optimistic_min !== null) result.avg_optimistic_min = result.optimistic_min / denominator;
    }
    result.partial = !result.observed_complete || !result.optimistic_complete;
    return result;
  }
  return Object.freeze({ estimate, prices: PRICES, pricing_date: DATE, long_context_threshold: LONG_THRESHOLD });
});
