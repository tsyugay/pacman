// Runs Code.gs against in-memory fakes of the Google Apps Script services.
// Usage: node test/run-tests.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const TZ = 'America/Chicago';

// --- Fakes ------------------------------------------------------------------

function chainable(extra) {
  const r = new Proxy(extra || {}, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => r; // formatting calls (setFontWeight, setWrap, ...) are no-ops
    }
  });
  return r;
}

class FakeSheet {
  constructor(name) { this.name = name; this.data = []; }
  getName() { return this.name; }
  width() { return Math.max(0, ...this.data.map(r => r.length)); }
  getLastRow() { return this.data.length; }
  getDataRange() {
    const w = this.width();
    return chainable({ getValues: () => this.data.map(r => { const c = r.slice(); while (c.length < w) c.push(''); return c; }) });
  }
  cell(r, c) { while (this.data.length < r) this.data.push([]); const row = this.data[r - 1]; while (row.length < c) row.push(''); return row; }
  getRange(r, c, nr, nc) {
    nr = nr || 1; nc = nc || 1;
    const self = this;
    return chainable({
      setValue(v) { self.cell(r, c)[c - 1] = v; return this; },
      setValues(vals) { vals.forEach((row, i) => row.forEach((v, j) => { self.cell(r + i, c + j)[c + j - 1] = v; })); return this; },
      getRow: () => r
    });
  }
  appendRow(row) { this.data.push(row.slice()); }
  setFrozenRows() {} setColumnWidth() {}
}

function makeEnv() {
  const sheets = {};
  const ss = {
    getSheetByName: n => sheets[n] || null,
    insertSheet: n => (sheets[n] = new FakeSheet(n)),
    getSheets: () => Object.values(sheets),
    deleteSheet: s => { delete sheets[s.name]; },
    getSpreadsheetTimeZone: () => TZ
  };
  const gmail = { drafts: [], sent: [], inbox: [], labels: {} };
  let claudeReply = null;
  const props = {};

  const ctx = {
    console,
    SpreadsheetApp: {
      getActive: () => ss,
      newDataValidation: () => chainable({ build: () => ({}) })
    },
    Utilities: {
      formatDate(date, tz, fmt) {
        const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
          .formatToParts(date).reduce((a, p) => (a[p.type] = p.value, a), {});
        if (fmt === 'yyyy-MM-dd') return `${parts.year}-${parts.month}-${parts.day}`;
        if (fmt === 'u') return String(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday) + 1);
        throw new Error('unsupported format ' + fmt);
      }
    },
    GmailApp: {
      createDraft(to, subject, body, opts) {
        const d = { to, subject, body, opts, send() { const m = fakeMessage('me@example.com', to, subject, body, ctx.__now); gmail.sent.push(m); gmail.drafts.splice(gmail.drafts.indexOf(d), 1); return m; } };
        gmail.drafts.push(d);
        return d;
      },
      sendEmail(to, subject, body) { gmail.sent.push(fakeMessage('me@example.com', to, subject, body, ctx.__now)); },
      search(q) {
        const from = /from:(\S+)/.exec(q)[1].toLowerCase();
        const after = Number(/after:(\d+)/.exec(q)[1]) * 1000;
        return gmail.inbox.filter(m => m.from.toLowerCase().includes(from) && m.date.getTime() > after)
          .map(m => ({ getMessages: () => [m.api] }));
      },
      getUserLabelByName: n => gmail.labels[n] || null,
      createLabel: n => (gmail.labels[n] = { name: n })
    },
    PropertiesService: { getUserProperties: () => ({ getProperty: k => props[k] || null }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    UrlFetchApp: {
      fetch(url, opts) {
        ctx.__lastRequest = { url, opts, payload: JSON.parse(opts.payload) };
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify(claudeReply) };
      }
    }
  };
  function fakeMessage(from, to, subject, body, date) {
    const m = { from, to, subject, body, date };
    m.api = { getDate: () => date, getFrom: () => from, getPlainBody: () => body, getThread: () => ({ addLabel() {} }) };
    return m;
  }
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8'), ctx);
  ctx.ensureSheets_(ss);
  return {
    ctx, ss, gmail, props,
    setClaudeReply: r => { claudeReply = r; },
    receive: (from, body, date) => gmail.inbox.push(fakeMessage(from, 'me@example.com', 'Re', body, date)),
    setSetting(label, value) {
      const s = ss.getSheetByName('Settings');
      const row = s.data.findIndex(r => r[0] === label);
      assert(row > 0, 'no setting ' + label);
      s.data[row][1] = value;
    },
    addCustomer(fields) {
      const s = ss.getSheetByName('Customers');
      s.appendRow(s.data[0].map(h => (h in fields ? fields[h] : '')));
    },
    customer(i) {
      const s = ss.getSheetByName('Customers');
      return Object.fromEntries(s.data[0].map((h, j) => [h, s.data[i + 1][j]]));
    },
    run(date) { ctx.__now = date; return ctx.processCustomers_(ss, date); }
  };
}

// Noon in Chicago on the given day offset from 2026-11-02 (a Monday).
function day(n) { return new Date(Date.UTC(2026, 10, 2 + n, 18, 0, 0)); }

// --- Tests ------------------------------------------------------------------

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('pure helpers', () => {
  const { ctx } = makeEnv();
  assert.strictEqual(ctx.daysBetween_('2026-11-01', '2026-11-08'), 7);
  assert.strictEqual(ctx.daysBetween_('2026-03-07', '2026-03-09'), 2); // across DST
  assert.strictEqual(ctx.addDays_('2026-12-30', 3), '2027-01-02');
  assert.strictEqual(ctx.mergeTemplate_('Hi {{firstname}}\nLink: {{ReviewLink}}\nBye', { FirstName: 'Ana', ReviewLink: '' }), 'Hi Ana\nBye');
  assert.strictEqual(ctx.mergeTemplate_('Hi {{Nope}}', { FirstName: 'Ana' }), 'Hi {{Nope}}');
  assert(ctx.isOptOut_('STOP'));
  assert(ctx.isOptOut_('Please unsubscribe me'));
  assert(!ctx.isOptOut_('Thanks! Loving the car.\n\nOn Mon, Nov 2, 2026 Sam wrote:\n> reply STOP to opt out'));
  assert(ctx.SCORE_REQUEST_PATTERN.test('please give us 100% on the survey'));
  assert(ctx.SCORE_REQUEST_PATTERN.test('a 5-star review'));
  assert(!ctx.SCORE_REQUEST_PATTERN.test('share your honest feedback'));
  assert.strictEqual(ctx.normalizeStatus_(''), 'Active');
  assert.strictEqual(ctx.normalizeStatus_('reviewed'), 'Reviewed');
});

test('planNextStep_ skips stale steps and respects the gap', () => {
  const { ctx } = makeEnv();
  const steps = [1, 4, 7, 14, 30].map((d, i) => ({ step: i + 1, days: d }));
  assert.strictEqual(ctx.planNextStep_(steps, 0, 0, null, 2).step, null);
  assert.strictEqual(ctx.planNextStep_(steps, 0, 1, null, 2).step.step, 1);
  const late = ctx.planNextStep_(steps, 0, 9, null, 2);
  assert.strictEqual(late.step.step, 3);
  assert.deepStrictEqual(late.skipped.map(s => s.step), [1, 2]);
  assert(ctx.planNextStep_(steps, 2, 7, 1, 2).waitingForGap);
  assert(ctx.planNextStep_(steps, 5, 40, 10, 2).done);
});

test('full 35-day cadence in Send mode', () => {
  const env = makeEnv();
  env.setSetting('Salesperson Name', 'Sam Rivera');
  env.setSetting('Default Dealership', 'Lakeside Toyota');
  env.setSetting('Default Review / Survey Link', 'https://example.com/review');
  env.setSetting('Mode (Draft or Send)', 'Send');
  env.setSetting('Skip Weekends', false);
  env.addCustomer({ 'First Name': 'Ana', 'Email': 'ana@example.com', 'Vehicle': '2026 RAV4 Hybrid', 'Purchase Date': '2026-11-02', 'Status': 'Active' });
  const sendDays = [];
  for (let n = 0; n <= 35; n++) {
    const before = env.gmail.sent.length;
    env.run(day(n));
    if (env.gmail.sent.length > before) sendDays.push(n);
  }
  assert.deepStrictEqual(sendDays, [1, 4, 7, 14, 30]);
  const c = env.customer(0);
  assert.strictEqual(c['Status'], 'Completed');
  assert.strictEqual(c['Last Step Sent'], 5);
  const step3 = env.gmail.sent[2];
  assert(step3.body.includes('https://example.com/review'));
  assert(step3.body.includes('free tank of gas'));
  assert(step3.body.includes('Sam Rivera'));
  assert(step3.body.includes('reply STOP'));
  assert(!/\{\{/.test(env.gmail.sent.map(m => m.subject + m.body).join('')));
  assert.strictEqual(step3.subject, 'A quick favor, Ana');
});

test('Draft mode creates drafts and still advances the cadence', () => {
  const env = makeEnv();
  env.setSetting('Skip Weekends', false);
  env.addCustomer({ 'First Name': 'Ben', 'Email': 'ben@example.com', 'Purchase Date': '2026-11-02' });
  env.run(day(1));
  env.run(day(4));
  assert.strictEqual(env.gmail.sent.length, 0);
  assert.strictEqual(env.gmail.drafts.length, 2);
  assert.strictEqual(env.customer(0)['Last Step Sent'], 2);
});

test('reply pauses, STOP opts out, reactivation resumes', () => {
  const env = makeEnv();
  env.setSetting('Mode (Draft or Send)', 'Send');
  env.setSetting('Skip Weekends', false);
  env.addCustomer({ 'First Name': 'Cy', 'Email': 'cy@example.com', 'Purchase Date': '2026-11-02' });
  env.addCustomer({ 'First Name': 'Di', 'Email': 'di@example.com', 'Purchase Date': '2026-11-02' });
  env.run(day(1));
  env.receive('Cy <cy@example.com>', 'Thanks Sam! One question about the warranty.', day(2));
  env.receive('Di <di@example.com>', 'stop', day(2));
  env.run(day(4));
  assert.strictEqual(env.customer(0)['Status'], 'Replied - check inbox');
  assert.strictEqual(env.customer(1)['Status'], 'Opted out');
  assert.strictEqual(env.gmail.sent.length, 2); // only the two day-1 emails
  // Salesperson answers Cy and sets them back to Active.
  env.ss.getSheetByName('Customers').data[1][8] = 'Active';
  env.run(day(5));
  assert.strictEqual(env.customer(0)['Status'], 'Active');
  assert.strictEqual(env.customer(0)['Last Step Sent'], 2);
  assert.strictEqual(env.gmail.sent.length, 3);
});

test('weekends skipped, late-added customer jumps ahead, bad rows flagged', () => {
  const env = makeEnv();
  env.setSetting('Mode (Draft or Send)', 'Send');
  env.addCustomer({ 'First Name': 'Ed', 'Email': 'ed@example.com', 'Purchase Date': '2026-10-24' }); // 9 days before day 0
  env.addCustomer({ 'First Name': 'Fay', 'Email': 'not-an-email', 'Purchase Date': '2026-11-01' });
  env.run(day(5)); // Saturday
  assert.strictEqual(env.gmail.sent.length, 0);
  env.run(day(7)); // Monday, 16 days after purchase
  assert.strictEqual(env.gmail.sent.length, 1);
  assert.strictEqual(env.customer(0)['Last Step Sent'], 4);
  assert(/Skipped step 1, 2, 3/.test(env.customer(0)['Agent Notes']));
  assert.strictEqual(env.customer(1)['Status'], 'Error');
});

test('AI personalization: request shape, accepted rewrite, rejected rewrite', () => {
  const env = makeEnv();
  env.props.ANTHROPIC_API_KEY = 'sk-test';
  env.setSetting('Use AI Personalization', true);
  env.setSetting('Default Review / Survey Link', 'https://example.com/review');
  const settings = env.ctx.readSettings_(env.ss);
  const steps = env.ctx.readCadence_(env.ss);
  const c = { firstName: 'Gia', email: 'gia@example.com', vehicle: 'Camry', dealNotes: 'Road trip to the Smokies next month. Paid $31,000.' };

  env.setClaudeReply({ stop_reason: 'end_turn', content: [{ type: 'text', text: "Hi Gia,\n\nHope the Camry is ready for the Smokies trip! You may get a short survey; honest feedback helps.\n\nYou can also share your experience here: https://example.com/review\n\n" + settings.giftText + "\n\n%%SIGNATURE%%" }] });
  let e = env.ctx.composeEmail_(steps[2], c, settings, 'sk-test');
  assert(e.aiUsed, e.warnings.join(' '));
  assert(e.body.includes('Smokies') && !e.body.includes('%%SIGNATURE%%'));
  const req = env.ctx.__lastRequest;
  assert.strictEqual(req.payload.model, 'claude-opus-5-5');
  assert.strictEqual(req.payload.fallbacks, 'default');
  assert.strictEqual(req.opts.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  assert.strictEqual(req.opts.headers['x-api-key'], 'sk-test');

  env.setClaudeReply({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hi Gia! Please give us 100% and enjoy your $31,000 Camry. https://example.com/review ' + settings.giftText }] });
  e = env.ctx.composeEmail_(steps[2], c, settings, 'sk-test');
  assert(!e.aiUsed);
  assert(/discarded/.test(e.warnings.join(' ')));

  env.setClaudeReply({ stop_reason: 'refusal', content: [] });
  e = env.ctx.composeEmail_(steps[0], c, settings, 'sk-test');
  assert(!e.aiUsed && /failed/.test(e.warnings.join(' ')));
});

test('template that ties the gift to a score is flagged', () => {
  const env = makeEnv();
  const settings = env.ctx.readSettings_(env.ss);
  const e = env.ctx.composeEmail_({ step: 9, days: 7, subject: 'Survey', body: 'Please give us 100%!\n{{GiftOffer}}' }, { firstName: 'H' }, settings, null);
  assert(/FTC/.test(e.warnings.join(' ')));
});

let failed = 0;
for (const t of tests) {
  try { t.fn(); console.log('ok   ' + t.name); }
  catch (err) { failed++; console.log('FAIL ' + t.name + '\n     ' + (err.stack || err).toString().split('\n').slice(0, 4).join('\n     ')); }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
