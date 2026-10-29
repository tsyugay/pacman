/**
 * Post-Sale Follow-Up Agent
 *
 * A Google Sheets + Apps Script tool that follows up with car buyers from the
 * salesperson's own Gmail on a customizable cadence, checks in on their
 * experience, and invites honest feedback (optionally with a thank-you gift).
 *
 * Everything is configured in the spreadsheet:
 *   Settings   - who you are, mode (Draft/Send), gift wording, schedule, AI
 *   Cadence    - one row per email: when it goes out, subject, body
 *   Customers  - one row per buyer: dealership, vehicle, purchase date, notes
 *   Log        - every action the agent takes
 */

var SHEET = { SETTINGS: 'Settings', CADENCE: 'Cadence', CUSTOMERS: 'Customers', LOG: 'Log' };
var GMAIL_LABEL = 'Post-Sale Follow-Up';
var API_KEY_PROPERTY = 'ANTHROPIC_API_KEY';

var STATUS = {
  ACTIVE: 'Active',
  PAUSED: 'Paused',
  REPLIED: 'Replied - check inbox',
  REVIEWED: 'Reviewed',
  OPTED_OUT: 'Opted out',
  COMPLETED: 'Completed',
  ERROR: 'Error'
};
// Statuses the agent will never email.
var STOPPED_STATUSES = [STATUS.PAUSED, STATUS.REPLIED, STATUS.REVIEWED, STATUS.OPTED_OUT, STATUS.COMPLETED];

var CUSTOMER_HEADERS = [
  'First Name', 'Last Name', 'Email', 'Dealership', 'Vehicle', 'Purchase Date', 'Deal Notes',
  'Review Link', 'Status', 'Last Step Sent', 'Last Sent', 'Next Email', 'First Sent',
  'Last Reply Seen', 'Agent Notes'
];
// Columns the agent maintains; shaded grey so salespeople know not to type in them.
var SYSTEM_HEADERS = ['Last Step Sent', 'Last Sent', 'Next Email', 'First Sent', 'Last Reply Seen', 'Agent Notes'];
var CADENCE_HEADERS = ['Step', 'Days After Purchase', 'Subject', 'Body', 'Active'];
var LOG_HEADERS = ['Timestamp', 'Customer', 'Email', 'Step', 'Action', 'Subject', 'Details'];

var SETTINGS_SPEC = [
  { key: 'salespersonName', label: 'Salesperson Name', def: '', help: 'Used in the From name and the {{Signature}}.' },
  { key: 'salespersonTitle', label: 'Salesperson Title', def: 'Sales Consultant', help: 'Shown under your name in the signature.' },
  { key: 'salespersonPhone', label: 'Salesperson Phone', def: '', help: 'Shown in the signature. Leave blank to omit.' },
  { key: 'dealership', label: 'Default Dealership', def: '', help: 'Used when a customer row has no Dealership.' },
  { key: 'reviewLink', label: 'Default Review / Survey Link', def: '', help: 'Inserted where {{ReviewLink}} appears. A customer row can override it. Lines with {{ReviewLink}} are dropped when no link is set.' },
  { key: 'giftEnabled', label: 'Offer Thank-You Gift', def: true, type: 'bool', help: 'When checked, {{GiftOffer}} is replaced with the wording below. When unchecked, lines with {{GiftOffer}} are dropped.' },
  { key: 'giftText', label: 'Thank-You Gift Wording', def: "As a small thank-you for taking the time to share your honest feedback, I'd love to treat you to a free tank of gas, whatever you decide to say. Just reply here once you're done and I'll get it set up.", help: 'Keep this unconditional: never tie the gift to a score or a positive review (see README).' },
  { key: 'mode', label: 'Mode (Draft or Send)', def: 'Draft', help: 'Draft = emails wait in your Gmail Drafts for you to review and send. Send = emails go out automatically.' },
  { key: 'sendHour', label: 'Daily Run Hour (0-23)', def: 10, type: 'number', help: 'Hour of day the agent runs, in this spreadsheet\'s time zone (File > Settings). Re-run "Turn on daily schedule" after changing.' },
  { key: 'skipWeekends', label: 'Skip Weekends', def: true, type: 'bool', help: 'No emails on Saturday or Sunday. Replies are still checked.' },
  { key: 'minGapDays', label: 'Minimum Days Between Emails', def: 2, type: 'number', help: 'Never email the same customer more often than this.' },
  { key: 'stopOnReply', label: 'Pause When Customer Replies', def: true, type: 'bool', help: 'When a customer emails you, pause their sequence so you can respond personally. Set Status back to Active to resume.' },
  { key: 'optOutLine', label: 'Opt-Out Line', def: "P.S. If you'd rather not get these check-ins, just reply STOP and I'll take you off my list.", help: 'Added to the end of every email. Replies containing STOP or UNSUBSCRIBE mark the customer Opted out.' },
  { key: 'dailyLimit', label: 'Max Emails Per Run', def: 40, type: 'number', help: 'Safety cap. Free Gmail accounts can send to about 100 recipients a day from scripts.' },
  { key: 'aiEnabled', label: 'Use AI Personalization', def: false, type: 'bool', help: 'Uses Claude to weave each customer\'s Deal Notes into the email. Requires an API key (menu > Set Claude API key).' },
  { key: 'aiModel', label: 'AI Model', def: 'claude-opus-5-5', help: 'Claude model ID used for personalization.' },
  { key: 'aiTone', label: 'AI Tone Instructions', def: 'Warm, genuine and brief. Sound like a real person who enjoyed helping them, not a marketing email.', help: 'Extra style guidance for the AI.' }
];

var DEFAULT_CADENCE = [
  [1, 1, 'Thank you, {{FirstName}}!',
    'Hi {{FirstName}},\n\n' +
    'Thank you again for choosing {{Dealership}} for your {{Vehicle}}. It was a real pleasure working with you, and I hope your first day behind the wheel has been everything you hoped for.\n\n' +
    'If anything comes up (a feature you want help setting up, a question about paperwork, anything at all), just reply here. I\'m happy to help.\n\n' +
    '{{Signature}}', true],
  [2, 4, 'How\'s the {{Vehicle}} treating you?',
    'Hi {{FirstName}},\n\n' +
    'Just checking in now that you\'ve had a few days with your {{Vehicle}}. How\'s everything going? Have you had a chance to get your phone paired and the settings the way you like them?\n\n' +
    'If anything isn\'t quite right, I genuinely want to know so I can help make it right.\n\n' +
    '{{Signature}}', true],
  [3, 7, 'A quick favor, {{FirstName}}',
    'Hi {{FirstName}},\n\n' +
    'You may receive a short survey about your purchase from {{Dealership}} or the manufacturer. If you have a couple of minutes, I\'d really appreciate your honest feedback. It\'s how we learn what we\'re doing well and where we can do better.\n\n' +
    'You can also share your experience here: {{ReviewLink}}\n\n' +
    '{{GiftOffer}}\n\n' +
    'And if anything about your experience fell short, I want to hear about that too. Just reply and I\'ll do what I can to make it right.\n\n' +
    '{{Signature}}', true],
  [4, 14, 'Still enjoying the {{Vehicle}}?',
    'Hi {{FirstName}},\n\n' +
    'I hope you\'re loving your {{Vehicle}}! I wanted to follow up in case you haven\'t had a chance to share your feedback yet. No pressure at all, but it really does help.\n\n' +
    'Here\'s the link: {{ReviewLink}}\n\n' +
    '{{GiftOffer}}\n\n' +
    '{{Signature}}', true],
  [5, 30, 'One month in!',
    'Hi {{FirstName}},\n\n' +
    'Can you believe it\'s already been a month with your {{Vehicle}}? I wanted to say thank you once more and remind you that I\'m here for anything you need: service questions, accessories, or help for a friend or family member who\'s shopping.\n\n' +
    'Thanks again for trusting me with your purchase.\n\n' +
    '{{Signature}}', true]
];

// Placeholders that may legitimately be empty; a line containing one that resolves to
// nothing is dropped entirely so the email never shows "Here's the link: " with no link.
var OPTIONAL_PLACEHOLDERS = ['ReviewLink', 'GiftOffer'];
var SIGNATURE_MARKER = '%%SIGNATURE%%';

// Phrases that ask for a specific score. Tying any reward to these is what the FTC
// consumer-review rule prohibits, and most manufacturer survey programs ban "coaching".
var SCORE_REQUEST_PATTERN = /\b100\s?%|\b(5|five)[-\s]?stars?\b|\b10\s?(\/|out of)\s?10\b|perfect (score|scores|rating|ratings|marks)|\btop[-\s]box\b|\ball (5s|fives|10s|tens)\b|\bcompletely satisfied\b|highest (score|scores|rating|ratings|marks)/i;

// ---------------------------------------------------------------------------
// Menu and UI
// ---------------------------------------------------------------------------

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Follow-Up Agent')
    .addItem('Add customer…', 'showAddCustomer')
    .addItem('Preview next email for selected customer', 'previewSelected')
    .addItem('Send me a test of selected customer\'s next email', 'sendTestForSelected')
    .addSeparator()
    .addItem('Run follow-ups now', 'runNow')
    .addItem('Turn on daily schedule', 'installDailyTrigger')
    .addItem('Turn off daily schedule', 'removeDailyTrigger')
    .addSeparator()
    .addItem('Set Claude API key (optional)', 'setApiKey')
    .addItem('Set up / repair sheets', 'setupSheets')
    .addToUi();
}

function setupSheets() {
  ensureSheets_(SpreadsheetApp.getActive());
  SpreadsheetApp.getUi().alert('Sheets are ready. Fill in the Settings tab, review the Cadence tab, then add customers.');
}

function showAddCustomer() {
  ensureSheets_(SpreadsheetApp.getActive());
  var html = HtmlService.createTemplateFromFile('AddCustomer');
  html.defaultDealership = readSettings_(SpreadsheetApp.getActive()).dealership || '';
  SpreadsheetApp.getUi().showSidebar(html.evaluate().setTitle('Add customer'));
}

/** Called from the Add Customer sidebar. */
function addCustomer(form) {
  var ss = SpreadsheetApp.getActive();
  ensureSheets_(ss);
  var firstName = String(form.firstName || '').trim();
  var email = String(form.email || '').trim();
  var purchaseDate = String(form.purchaseDate || '').trim();
  if (!firstName || !email || !purchaseDate) throw new Error('First name, email and purchase date are required.');
  if (!isValidEmail_(email)) throw new Error('That email address doesn\'t look right: ' + email);

  var table = readTable_(ss.getSheetByName(SHEET.CUSTOMERS));
  var values = {
    'First Name': firstName,
    'Last Name': String(form.lastName || '').trim(),
    'Email': email,
    'Dealership': String(form.dealership || '').trim(),
    'Vehicle': String(form.vehicle || '').trim(),
    'Purchase Date': purchaseDate,
    'Deal Notes': String(form.dealNotes || '').trim(),
    'Review Link': String(form.reviewLink || '').trim(),
    'Status': STATUS.ACTIVE
  };
  var row = table.headers.map(function (h) { return values.hasOwnProperty(h) ? values[h] : ''; });
  table.sheet.appendRow(row);
  return 'Added ' + firstName + '. Their first email follows the Cadence tab.';
}

function previewSelected() {
  var ctx = selectedCustomer_();
  if (!ctx) return;
  var result = planAndCompose_(ctx);
  var ui = SpreadsheetApp.getUi();
  if (!result.email) {
    ui.alert('Nothing to send for ' + (ctx.customer.firstName || 'this customer') + ' right now.\n\n' + result.reason);
    return;
  }
  var e = result.email;
  var html = '<div style="font-family:Arial,sans-serif;font-size:13px">' +
    '<p><b>Step ' + escapeHtml_(result.step.step) + '</b> (day ' + escapeHtml_(result.step.days) + ')' +
    (result.due ? ', due now' : '. Not due yet: ' + escapeHtml_(result.schedule)) + '</p>' +
    '<p><b>To:</b> ' + escapeHtml_(ctx.customer.email) + '<br><b>Subject:</b> ' + escapeHtml_(e.subject) + '</p>' +
    '<pre style="white-space:pre-wrap;font-family:inherit;border:1px solid #ddd;padding:10px;border-radius:6px">' + escapeHtml_(e.body) + '</pre>' +
    (e.aiUsed ? '<p style="color:#555">Personalized with AI from the deal notes.</p>' : '') +
    (e.warnings.length ? '<p style="color:#b45309"><b>Heads up:</b><br>' + e.warnings.map(escapeHtml_).join('<br>') + '</p>' : '') +
    '</div>';
  ui.showModalDialog(HtmlService.createHtmlOutput(html).setWidth(560).setHeight(520), 'Email preview');
}

function sendTestForSelected() {
  var ctx = selectedCustomer_();
  if (!ctx) return;
  var result = planAndCompose_(ctx);
  var ui = SpreadsheetApp.getUi();
  if (!result.email) {
    ui.alert('Nothing to send for this customer right now.\n\n' + result.reason);
    return;
  }
  var me = Session.getEffectiveUser().getEmail();
  GmailApp.sendEmail(me, '[TEST] ' + result.email.subject, result.email.body, mailOptions_(ctx.settings));
  ui.alert('Sent a test of step ' + result.step.step + ' to ' + me + '. The customer was not emailed.');
}

function runNow() {
  var summary = runFollowUps_();
  SpreadsheetApp.getUi().alert('Follow-up run finished.\n\n' + summary.text);
}

function installDailyTrigger() {
  removeDailyTrigger_();
  var settings = readSettings_(SpreadsheetApp.getActive());
  var hour = clampInt_(settings.sendHour, 0, 23, 10);
  ScriptApp.newTrigger('runDailyFollowUps').timeBased().everyDays(1).atHour(hour).create();
  SpreadsheetApp.getUi().alert('Daily schedule is on. The agent will run every day around ' + hour + ':00 (' +
    SpreadsheetApp.getActive().getSpreadsheetTimeZone() + ').\n\nMode: ' + settings.mode);
}

function removeDailyTrigger() {
  var removed = removeDailyTrigger_();
  SpreadsheetApp.getUi().alert(removed ? 'Daily schedule is off.' : 'There was no daily schedule to turn off.');
}

function removeDailyTrigger_() {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runDailyFollowUps') { ScriptApp.deleteTrigger(t); removed++; }
  });
  return removed > 0;
}

function setApiKey() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('Claude API key',
    'Paste an Anthropic API key (from console.anthropic.com). It is stored privately in this script, not in the spreadsheet. Leave blank to remove it.',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var key = res.getResponseText().trim();
  var props = PropertiesService.getUserProperties();
  if (key) { props.setProperty(API_KEY_PROPERTY, key); ui.alert('API key saved. Turn on "Use AI Personalization" in Settings to use it.'); }
  else { props.deleteProperty(API_KEY_PROPERTY); ui.alert('API key removed.'); }
}

// ---------------------------------------------------------------------------
// Scheduled run
// ---------------------------------------------------------------------------

/** Entry point for the daily time-based trigger. */
function runDailyFollowUps() {
  runFollowUps_();
}

function runFollowUps_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { text: 'Another run is already in progress.' };
  try {
    return processCustomers_(SpreadsheetApp.getActive(), new Date());
  } finally {
    lock.releaseLock();
  }
}

function processCustomers_(ss, now) {
  ensureSheets_(ss);
  var settings = readSettings_(ss);
  var steps = readCadence_(ss);
  var tz = ss.getSpreadsheetTimeZone();
  var today = ymd_(now, tz);
  var weekend = isWeekend_(now, tz);
  var table = readTable_(ss.getSheetByName(SHEET.CUSTOMERS));
  var apiKey = PropertiesService.getUserProperties().getProperty(API_KEY_PROPERTY);
  var counts = { sent: 0, drafted: 0, replies: 0, optOuts: 0, completed: 0, errors: 0 };
  var limit = clampInt_(settings.dailyLimit, 0, 1500, 40);
  var label = null;

  for (var i = 0; i < table.rows.length; i++) {
    var c = rowToCustomer_(table, i);
    if (!c.email && !c.firstName) continue; // blank row

    var status = normalizeStatus_(c.status);
    if (STOPPED_STATUSES.indexOf(status) !== -1) {
      if (c.nextEmail) updateRow_(table, i, { 'Next Email': '' });
      continue;
    }

    try {
      if (!isValidEmail_(c.email)) throw new Error('Email address is missing or invalid.');
      var purchase = toYmd_(c.purchaseDate, tz);
      if (!purchase) throw new Error('Purchase Date is missing or not a date.');

      // 1. Check for a reply before sending anything else.
      if (settings.stopOnReply && c.firstSent) {
        var reply = findNewReply_(c);
        if (reply) {
          var optedOut = isOptOut_(reply.text);
          updateRow_(table, i, {
            'Status': optedOut ? STATUS.OPTED_OUT : STATUS.REPLIED,
            'Last Reply Seen': reply.date,
            'Next Email': '',
            'Agent Notes': (optedOut ? 'Asked to stop on ' : 'Customer replied on ') + ymd_(reply.date, tz) + '. Sequence paused.'
          });
          log_(ss, c, '', optedOut ? 'Opted out' : 'Reply detected', '', truncate_(reply.text, 200));
          optedOut ? counts.optOuts++ : counts.replies++;
          continue;
        }
      }

      // 2. Work out which step (if any) is due.
      var plan = planNextStep_(steps, c.lastStepSent, daysBetween_(purchase, today),
        c.lastSent ? daysBetween_(ymd_(toDate_(c.lastSent), tz), today) : null, settings.minGapDays);

      if (plan.done) {
        updateRow_(table, i, { 'Status': STATUS.COMPLETED, 'Next Email': '', 'Agent Notes': 'All steps sent.' });
        counts.completed++;
        continue;
      }
      if (c.status !== STATUS.ACTIVE) updateRow_(table, i, { 'Status': STATUS.ACTIVE });
      if (!plan.step) {
        updateRow_(table, i, { 'Next Email': nextEmailText_(plan, purchase, c, settings, tz) });
        continue;
      }
      if (weekend && settings.skipWeekends) {
        updateRow_(table, i, { 'Next Email': 'Step ' + plan.step.step + ' on next weekday' });
        continue;
      }
      if (counts.sent + counts.drafted >= limit) {
        updateRow_(table, i, { 'Agent Notes': 'Waiting: hit the Max Emails Per Run limit.' });
        continue;
      }

      // 3. Compose and send (or draft).
      var email = composeEmail_(plan.step, c, settings, apiKey);
      var draft = GmailApp.createDraft(c.email, email.subject, email.body, mailOptions_(settings));
      var action;
      if (settings.mode === 'send') {
        var msg = draft.send();
        try {
          label = label || GmailApp.getUserLabelByName(GMAIL_LABEL) || GmailApp.createLabel(GMAIL_LABEL);
          msg.getThread().addLabel(label);
        } catch (labelErr) { /* labeling is a convenience; never fail a send over it */ }
        action = 'Sent';
        counts.sent++;
      } else {
        action = 'Drafted';
        counts.drafted++;
      }

      var notes = action + ' step ' + plan.step.step + ' on ' + today + '.';
      if (plan.skipped.length) notes += ' Skipped step ' + plan.skipped.map(function (s) { return s.step; }).join(', ') + ' (customer added late).';
      if (email.aiUsed) notes += ' AI-personalized.';
      if (email.warnings.length) notes += ' ' + email.warnings.join(' ');
      var after = planNextStep_(steps, plan.step.step, daysBetween_(purchase, today), 0, settings.minGapDays);
      var update = {
        'Last Step Sent': plan.step.step,
        'Last Sent': now,
        'Agent Notes': notes,
        'Next Email': after.done ? 'None (last step)' : nextEmailText_(after, purchase, { lastSent: now }, settings, tz)
      };
      if (!c.firstSent) update['First Sent'] = now;
      updateRow_(table, i, update);
      log_(ss, c, plan.step.step, action, email.subject, notes);
    } catch (err) {
      counts.errors++;
      updateRow_(table, i, { 'Status': STATUS.ERROR, 'Agent Notes': 'Error on ' + today + ': ' + err.message + ' Fix it and the next run will retry.' });
      log_(ss, c, '', 'Error', '', err.message);
    }
  }

  var text = [
    settings.mode === 'send' ? 'Emails sent: ' + counts.sent : 'Drafts created: ' + counts.drafted + ' (check your Gmail Drafts)',
    'Replies detected (paused): ' + counts.replies,
    'Opt-outs: ' + counts.optOuts,
    'Sequences completed: ' + counts.completed,
    'Errors: ' + counts.errors + (counts.errors ? ' (see Agent Notes / Log tab)' : '')
  ].join('\n');
  if (weekend && settings.skipWeekends) text += '\n\nToday is a weekend, so no emails were sent (replies were still checked).';
  return { counts: counts, text: text };
}

/** Plans and composes the next email for the selected row without sending it. */
function planAndCompose_(ctx) {
  var tz = ctx.ss.getSpreadsheetTimeZone();
  var today = ymd_(new Date(), tz);
  var c = ctx.customer;
  var purchase = toYmd_(c.purchaseDate, tz);
  if (!purchase) return { reason: 'Purchase Date is missing or not a date.' };
  if (STOPPED_STATUSES.indexOf(normalizeStatus_(c.status)) !== -1) return { reason: 'Status is "' + c.status + '". Set it to Active to resume.' };
  var steps = readCadence_(ctx.ss);
  var daysSincePurchase = daysBetween_(purchase, today);
  var plan = planNextStep_(steps, c.lastStepSent, daysSincePurchase,
    c.lastSent ? daysBetween_(ymd_(toDate_(c.lastSent), tz), today) : null, ctx.settings.minGapDays);
  if (plan.done) return { reason: 'Every step in the Cadence tab has already been sent.' };
  var step = plan.step || plan.upcoming;
  var apiKey = PropertiesService.getUserProperties().getProperty(API_KEY_PROPERTY);
  return {
    step: step,
    due: !!plan.step,
    schedule: plan.step ? '' : nextEmailText_(plan, purchase, c, ctx.settings, tz),
    email: composeEmail_(step, c, ctx.settings, apiKey)
  };
}

function selectedCustomer_() {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getActiveSheet();
  var ui = SpreadsheetApp.getUi();
  if (sheet.getName() !== SHEET.CUSTOMERS || ss.getActiveRange().getRow() < 2) {
    ui.alert('Click on a customer\'s row in the Customers tab first.');
    return null;
  }
  var table = readTable_(sheet);
  var i = ss.getActiveRange().getRow() - 2;
  if (i >= table.rows.length) { ui.alert('That row is empty.'); return null; }
  return { ss: ss, settings: readSettings_(ss), customer: rowToCustomer_(table, i) };
}

// ---------------------------------------------------------------------------
// Email composition
// ---------------------------------------------------------------------------

function buildVars_(c, settings, signature) {
  return {
    FirstName: c.firstName || 'there',
    LastName: c.lastName || '',
    Vehicle: c.vehicle || 'car',
    Dealership: c.dealership || settings.dealership || 'our dealership',
    Salesperson: settings.salespersonName || '',
    SalespersonPhone: settings.salespersonPhone || '',
    ReviewLink: c.reviewLink || settings.reviewLink || '',
    GiftOffer: settings.giftEnabled ? (settings.giftText || '') : '',
    Signature: signature
  };
}

function buildSignature_(settings, dealership) {
  var lines = ['Thanks,', settings.salespersonName];
  var titleLine = [settings.salespersonTitle, dealership].filter(Boolean).join(', ');
  lines.push(titleLine, settings.salespersonPhone);
  return lines.filter(function (l) { return l && String(l).trim(); }).join('\n');
}

/**
 * Replaces {{Placeholders}}. Unknown placeholders are left visible so mistakes get
 * noticed in preview. Lines containing an empty optional placeholder are dropped.
 */
function mergeTemplate_(template, vars) {
  var lines = String(template || '').replace(/\r\n/g, '\n').split('\n');
  var out = [];
  lines.forEach(function (line) {
    var drop = false;
    var merged = line.replace(/\{\{\s*(\w+)\s*\}\}/g, function (match, name) {
      var key = findKey_(vars, name);
      if (key === null) return match;
      var value = vars[key] == null ? '' : String(vars[key]);
      if (!value && OPTIONAL_PLACEHOLDERS.indexOf(key) !== -1) drop = true;
      return value;
    });
    if (!drop) out.push(merged);
  });
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function findKey_(obj, name) {
  var lower = name.toLowerCase();
  for (var k in obj) if (obj.hasOwnProperty(k) && k.toLowerCase() === lower) return k;
  return null;
}

function composeEmail_(step, c, settings, apiKey) {
  var dealership = c.dealership || settings.dealership || '';
  var signature = buildSignature_(settings, dealership);
  var subject = mergeTemplate_(step.subject, buildVars_(c, settings, signature));
  // The body is merged with a marker in place of the signature so AI rewriting can't alter it.
  var vars = buildVars_(c, settings, SIGNATURE_MARKER);
  var body = mergeTemplate_(step.body, vars);
  var warnings = [];
  var aiUsed = false;

  if (settings.giftEnabled && vars.GiftOffer && SCORE_REQUEST_PATTERN.test(body + ' ' + subject)) {
    warnings.push('This email offers the gift AND asks for a specific score. That combination can violate FTC rules and manufacturer survey policies. Edit the Cadence template.');
  }
  if (/\{\{\s*\w+\s*\}\}/.test(body + subject)) {
    warnings.push('The template has a {{placeholder}} the agent doesn\'t recognize.');
  }

  if (settings.aiEnabled) {
    if (!apiKey) {
      warnings.push('AI personalization is on but no API key is set, so the template was used as-is.');
    } else if (c.dealNotes) {
      try {
        var rewritten = personalizeWithClaude_(body, c, settings, vars, apiKey);
        var problem = validateAiBody_(rewritten, body, vars);
        if (problem) warnings.push('AI draft was discarded (' + problem + '); used the template instead.');
        else { body = rewritten; aiUsed = true; }
      } catch (err) {
        warnings.push('AI personalization failed (' + err.message + '); used the template instead.');
      }
    }
  }

  body = body.indexOf(SIGNATURE_MARKER) !== -1 ? body.split(SIGNATURE_MARKER).join(signature) : body + '\n\n' + signature;
  if (settings.optOutLine) body += '\n\n' + settings.optOutLine;
  return { subject: subject, body: body, aiUsed: aiUsed, warnings: warnings };
}

/** Returns a reason string if the AI rewrite must not be used, otherwise null. */
function validateAiBody_(rewritten, original, vars) {
  if (!rewritten || rewritten.length < 20) return 'empty response';
  if (vars.ReviewLink && original.indexOf(vars.ReviewLink) !== -1 && rewritten.indexOf(vars.ReviewLink) === -1) return 'review link was changed';
  if (vars.GiftOffer && original.indexOf(vars.GiftOffer) !== -1 && squash_(rewritten).indexOf(squash_(vars.GiftOffer)) === -1) return 'gift wording was changed';
  if (SCORE_REQUEST_PATTERN.test(rewritten) && !SCORE_REQUEST_PATTERN.test(original)) return 'it asked for a specific score';
  if (/\$\s?\d/.test(rewritten) && !/\$\s?\d/.test(original)) return 'it mentioned a dollar amount from the deal notes';
  return null;
}

function squash_(s) { return String(s).replace(/\s+/g, ' ').trim(); }

// ---------------------------------------------------------------------------
// Claude personalization (optional)
// ---------------------------------------------------------------------------

// Models that accept server-side refusal fallbacks (fallbacks: "default").
var FALLBACK_MODELS = ['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5'];

function buildClaudeRequest_(body, c, settings, vars) {
  var keep = [SIGNATURE_MARKER + ' (on its own line, exactly as written)'];
  if (vars.ReviewLink && body.indexOf(vars.ReviewLink) !== -1) keep.push('the review link: ' + vars.ReviewLink);
  if (vars.GiftOffer && body.indexOf(vars.GiftOffer) !== -1) keep.push('this sentence, word for word: "' + vars.GiftOffer + '"');

  var system = [
    'You personalize follow-up emails that a car salesperson sends to a customer after a sale.',
    'Rewrite the template so it feels personal, using the salesperson\'s private deal notes for warm, specific touches (for example the reason they bought, family, a trip they mentioned, a feature they loved).',
    'Rules:',
    '- Keep the purpose, structure and approximate length of the template. Plain text only, no subject line, no markdown.',
    '- Never mention prices, payments, financing, credit, trade-in values, negotiation, or anything the customer could find awkward or private. If a note is negative or sensitive, leave it out.',
    '- Never ask for a particular rating or score, and never imply that a gift or anything else depends on what they say.',
    '- Do not invent facts that are not in the notes or template.',
    '- Keep these exactly: ' + keep.join('; ') + '.',
    '- Tone: ' + (settings.aiTone || 'warm and genuine') + '.',
    'Reply with only the email body.'
  ].join('\n');

  var user = [
    '<customer>', 'First name: ' + (c.firstName || ''), 'Vehicle: ' + (c.vehicle || ''), 'Dealership: ' + vars.Dealership, '</customer>',
    '<deal_notes>', c.dealNotes, '</deal_notes>',
    '<template>', body, '</template>'
  ].join('\n');

  var model = settings.aiModel || 'claude-opus-5-5';
  var payload = {
    model: model,
    max_tokens: 4000,
    output_config: { effort: 'low' },
    system: system,
    messages: [{ role: 'user', content: user }]
  };
  var headers = { 'x-api-key': '', 'anthropic-version': '2026-10-21' };
  if (FALLBACK_MODELS.indexOf(model) !== -1) {
    payload.fallbacks = 'default';
    headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
  }
  return { payload: payload, headers: headers };
}

function personalizeWithClaude_(body, c, settings, vars, apiKey) {
  var req = buildClaudeRequest_(body, c, settings, vars);
  req.headers['x-api-key'] = apiKey;
  var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: req.headers,
    payload: JSON.stringify(req.payload),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  var data;
  try { data = JSON.parse(res.getContentText()); } catch (e) { throw new Error('unreadable API response (HTTP ' + code + ')'); }
  if (code !== 200) throw new Error('API error ' + code + ': ' + (data.error && data.error.message || 'unknown'));
  return extractClaudeText_(data);
}

function extractClaudeText_(data) {
  if (data.stop_reason === 'refusal') throw new Error('the model declined');
  if (data.stop_reason === 'max_tokens') throw new Error('response was cut off');
  return (data.content || [])
    .filter(function (b) { return b.type === 'text'; })
    .map(function (b) { return b.text; })
    .join('').trim();
}

// ---------------------------------------------------------------------------
// Scheduling logic (pure functions; covered by test/run-tests.js)
// ---------------------------------------------------------------------------

/**
 * Decides what to send next.
 * steps: active cadence steps sorted by day.
 * Returns {done} when nothing is left, {step, skipped} when a step is due, or
 * {step: null, upcoming, waitingForGap} when the next step isn't due yet.
 * If several steps are overdue (customer added late), only the latest one is sent so
 * the customer never gets a stale "thanks for picking it up yesterday" weeks later.
 */
function planNextStep_(steps, lastStepSent, daysSincePurchase, daysSinceLastSent, minGapDays) {
  var last = Number(lastStepSent) || 0;
  var remaining = steps.filter(function (s) { return s.step > last; });
  if (!remaining.length) return { done: true };
  var due = remaining.filter(function (s) { return s.days <= daysSincePurchase; });
  if (!due.length) return { step: null, upcoming: remaining[0], skipped: [] };
  var gap = Number(minGapDays) || 0;
  if (daysSinceLastSent !== null && daysSinceLastSent !== undefined && daysSinceLastSent < gap) {
    return { step: null, upcoming: due[due.length - 1], waitingForGap: true, skipped: [] };
  }
  return { step: due[due.length - 1], skipped: due.slice(0, -1) };
}

function nextEmailText_(plan, purchaseYmd, c, settings, tz) {
  var next = plan.upcoming || plan.step;
  if (!next) return '';
  var due = addDays_(purchaseYmd, next.days);
  if (c.lastSent) {
    var gapDate = addDays_(ymd_(toDate_(c.lastSent), tz), Number(settings.minGapDays) || 0);
    if (gapDate > due) due = gapDate;
  }
  return 'Step ' + next.step + ' on ' + due;
}

/** Whole calendar days from ymd a to ymd b ('yyyy-MM-dd'). */
function daysBetween_(a, b) {
  return Math.round((ymdToUtc_(b) - ymdToUtc_(a)) / 86400000);
}

function addDays_(ymd, n) {
  var d = new Date(ymdToUtc_(ymd) + n * 86400000);
  return d.getUTCFullYear() + '-' + pad2_(d.getUTCMonth() + 1) + '-' + pad2_(d.getUTCDate());
}

function ymdToUtc_(ymd) {
  var p = ymd.split('-');
  return Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}

function pad2_(n) { return (n < 10 ? '0' : '') + n; }

function isOptOut_(text) {
  var fresh = stripQuoted_(text).slice(0, 400);
  return /^\s*(stop|unsubscribe)\b/i.test(fresh) ||
    /\b(unsubscribe|remove me|opt(-|\s)?out|stop (emailing|sending|contacting|messaging))\b/i.test(fresh);
}

/** Drops the quoted original message from a reply so only the customer's new words remain. */
function stripQuoted_(text) {
  var lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    if (/^On .+wrote:\s*$/.test(lines[i]) || /^-+\s*Original Message\s*-+/i.test(lines[i]) || /^From: /.test(lines[i])) break;
    if (/^\s*>/.test(lines[i])) continue;
    out.push(lines[i]);
  }
  return out.join('\n').trim();
}

function normalizeStatus_(status) {
  var s = String(status || '').trim().toLowerCase();
  if (!s) return STATUS.ACTIVE;
  for (var k in STATUS) if (STATUS[k].toLowerCase() === s) return STATUS[k];
  if (s.indexOf('repl') === 0) return STATUS.REPLIED;
  if (s.indexOf('opt') === 0 || s === 'unsubscribed' || s === 'stop') return STATUS.OPTED_OUT;
  if (s.indexOf('review') === 0) return STATUS.REVIEWED;
  if (s === 'pause' || s === 'on hold' || s === 'hold') return STATUS.PAUSED;
  return STATUS.ACTIVE;
}

function isValidEmail_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

// ---------------------------------------------------------------------------
// Gmail helpers
// ---------------------------------------------------------------------------

/** Finds the newest email from the customer that arrived after we started (or last handled a reply). */
function findNewReply_(c) {
  var since = toDate_(c.firstSent);
  var seen = toDate_(c.lastReplySeen);
  if (seen && seen > since) since = seen;
  var query = 'from:' + c.email + ' after:' + Math.floor(since.getTime() / 1000);
  var threads = GmailApp.search(query, 0, 20);
  var newest = null;
  var email = c.email.toLowerCase();
  threads.forEach(function (t) {
    t.getMessages().forEach(function (m) {
      if (m.getDate() > since && m.getFrom().toLowerCase().indexOf(email) !== -1) {
        if (!newest || m.getDate() > newest.getDate()) newest = m;
      }
    });
  });
  return newest ? { date: newest.getDate(), text: newest.getPlainBody() } : null;
}

// ---------------------------------------------------------------------------
// Spreadsheet helpers
// ---------------------------------------------------------------------------

function ensureSheets_(ss) {
  var settings = ss.getSheetByName(SHEET.SETTINGS);
  var newSettings = !settings;
  if (newSettings) {
    settings = ss.insertSheet(SHEET.SETTINGS);
    settings.getRange(1, 1, 1, 3).setValues([['Setting', 'Value', 'What it does']]);
  }
  // Add any settings that are missing (keeps existing values untouched).
  var existing = settings.getDataRange().getValues().map(function (r) { return String(r[0]).trim(); });
  SETTINGS_SPEC.forEach(function (spec) {
    if (existing.indexOf(spec.label) !== -1) return;
    settings.appendRow([spec.label, spec.def, spec.help]);
    if (spec.type === 'bool') settings.getRange(settings.getLastRow(), 2).insertCheckboxes().setValue(spec.def);
  });
  if (newSettings) {
    formatHeader_(settings, 3);
    settings.setColumnWidth(1, 230); settings.setColumnWidth(2, 380); settings.setColumnWidth(3, 480);
    settings.getRange(1, 1, settings.getLastRow(), 3).setWrap(true).setVerticalAlignment('top');
  }

  var cadence = ss.getSheetByName(SHEET.CADENCE);
  if (!cadence) {
    cadence = ss.insertSheet(SHEET.CADENCE);
    cadence.getRange(1, 1, 1, CADENCE_HEADERS.length).setValues([CADENCE_HEADERS]);
    cadence.getRange(2, 1, DEFAULT_CADENCE.length, CADENCE_HEADERS.length).setValues(DEFAULT_CADENCE);
    cadence.getRange(2, 5, DEFAULT_CADENCE.length, 1).insertCheckboxes();
    cadence.getRange(2, 5, DEFAULT_CADENCE.length, 1).setValues(DEFAULT_CADENCE.map(function () { return [true]; }));
    formatHeader_(cadence, CADENCE_HEADERS.length);
    cadence.setColumnWidth(1, 50); cadence.setColumnWidth(2, 140); cadence.setColumnWidth(3, 260); cadence.setColumnWidth(4, 620);
    cadence.getRange(2, 1, DEFAULT_CADENCE.length, CADENCE_HEADERS.length).setWrap(true).setVerticalAlignment('top');
  }

  var customers = ss.getSheetByName(SHEET.CUSTOMERS);
  if (!customers) {
    customers = ss.insertSheet(SHEET.CUSTOMERS);
    customers.getRange(1, 1, 1, CUSTOMER_HEADERS.length).setValues([CUSTOMER_HEADERS]);
    formatHeader_(customers, CUSTOMER_HEADERS.length);
    SYSTEM_HEADERS.forEach(function (h) {
      customers.getRange(1, CUSTOMER_HEADERS.indexOf(h) + 1).setBackground('#d9d9d9');
    });
    var rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(Object.keys(STATUS).map(function (k) { return STATUS[k]; }), true)
      .setAllowInvalid(true).build();
    customers.getRange(2, CUSTOMER_HEADERS.indexOf('Status') + 1, 999, 1).setDataValidation(rule);
    customers.getRange(2, CUSTOMER_HEADERS.indexOf('Purchase Date') + 1, 999, 1).setNumberFormat('yyyy-mm-dd');
    customers.setColumnWidth(CUSTOMER_HEADERS.indexOf('Deal Notes') + 1, 320);
    customers.setColumnWidth(CUSTOMER_HEADERS.indexOf('Agent Notes') + 1, 320);
  }

  var log = ss.getSheetByName(SHEET.LOG);
  if (!log) {
    log = ss.insertSheet(SHEET.LOG);
    log.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]);
    formatHeader_(log, LOG_HEADERS.length);
  }

  // A brand-new spreadsheet starts with an empty "Sheet1"; remove it to avoid confusion.
  var blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);
}

function formatHeader_(sheet, width) {
  sheet.getRange(1, 1, 1, width).setFontWeight('bold');
  sheet.setFrozenRows(1);
}

function readSettings_(ss) {
  var rows = ss.getSheetByName(SHEET.SETTINGS).getDataRange().getValues();
  var byLabel = {};
  rows.forEach(function (r) { byLabel[String(r[0]).trim()] = r[1]; });
  var out = {};
  SETTINGS_SPEC.forEach(function (spec) {
    var v = byLabel.hasOwnProperty(spec.label) ? byLabel[spec.label] : spec.def;
    if (spec.type === 'bool') v = toBool_(v);
    else if (spec.type === 'number') v = (v === '' || v === null || isNaN(Number(v))) ? spec.def : Number(v);
    else v = String(v == null ? '' : v).trim();
    out[spec.key] = v;
  });
  out.mode = String(out.mode).toLowerCase().indexOf('send') === 0 ? 'send' : 'draft';
  return out;
}

function readCadence_(ss) {
  var rows = ss.getSheetByName(SHEET.CADENCE).getDataRange().getValues();
  var headers = rows.shift().map(function (h) { return String(h).trim(); });
  var col = function (name) { return headers.indexOf(name); };
  return parseCadenceRows_(rows, col('Step'), col('Days After Purchase'), col('Subject'), col('Body'), col('Active'));
}

function parseCadenceRows_(rows, iStep, iDays, iSubject, iBody, iActive) {
  return rows
    .filter(function (r) { return String(r[iBody] || '').trim() && r[iDays] !== '' && !isNaN(Number(r[iDays])); })
    .filter(function (r) { return iActive === -1 || r[iActive] === '' || toBool_(r[iActive]); })
    .map(function (r, idx) {
      return {
        step: r[iStep] === '' || isNaN(Number(r[iStep])) ? idx + 1 : Number(r[iStep]),
        days: Number(r[iDays]),
        subject: String(r[iSubject] || ''),
        body: String(r[iBody] || '')
      };
    })
    .sort(function (a, b) { return a.days - b.days || a.step - b.step; });
}

function readTable_(sheet) {
  var values = sheet.getDataRange().getValues();
  var headers = values.shift().map(function (h) { return String(h).trim(); });
  return { sheet: sheet, headers: headers, rows: values };
}

function rowToCustomer_(table, i) {
  var r = table.rows[i];
  var get = function (h) { var j = table.headers.indexOf(h); return j === -1 ? '' : r[j]; };
  var str = function (h) { return String(get(h) == null ? '' : get(h)).trim(); };
  return {
    firstName: str('First Name'),
    lastName: str('Last Name'),
    email: str('Email'),
    dealership: str('Dealership'),
    vehicle: str('Vehicle'),
    purchaseDate: get('Purchase Date'),
    dealNotes: str('Deal Notes'),
    reviewLink: str('Review Link'),
    status: str('Status'),
    lastStepSent: get('Last Step Sent'),
    lastSent: get('Last Sent') || null,
    nextEmail: str('Next Email'),
    firstSent: get('First Sent') || null,
    lastReplySeen: get('Last Reply Seen') || null
  };
}

function updateRow_(table, i, fields) {
  Object.keys(fields).forEach(function (h) {
    var j = table.headers.indexOf(h);
    if (j === -1) return;
    table.rows[i][j] = fields[h];
    table.sheet.getRange(i + 2, j + 1).setValue(fields[h]);
  });
}

function log_(ss, c, step, action, subject, details) {
  ss.getSheetByName(SHEET.LOG).appendRow([new Date(), [c.firstName, c.lastName].join(' ').trim(), c.email, step, action, subject, details]);
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function ymd_(date, tz) { return Utilities.formatDate(date, tz, 'yyyy-MM-dd'); }

/** Sheet dates come back as Date objects; typed text like 2026-10-28 is kept as-is. */
function toYmd_(v, tz) {
  if (!v) return null;
  var iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(v).trim());
  if (typeof v === 'string' && iso) return iso[1] + '-' + pad2_(Number(iso[2])) + '-' + pad2_(Number(iso[3]));
  var d = toDate_(v);
  return d ? ymd_(d, tz) : null;
}

function mailOptions_(settings) {
  return settings.salespersonName ? { name: settings.salespersonName } : {};
}

function isWeekend_(date, tz) {
  var dow = Number(Utilities.formatDate(date, tz, 'u')); // 1 = Monday ... 7 = Sunday
  return dow >= 6;
}

function toDate_(v) {
  if (!v) return null;
  if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v.getTime()) ? null : v;
  var s = String(v).trim();
  var iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  var d = iso ? new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])) : new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function toBool_(v) {
  if (typeof v === 'boolean') return v;
  return /^(true|yes|y|1|on)$/i.test(String(v).trim());
}

function clampInt_(v, min, max, def) {
  var n = parseInt(v, 10);
  if (isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
}

function truncate_(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }

function escapeHtml_(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
  });
}
