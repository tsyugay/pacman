# Post-Sale Follow-Up Agent

A Google Sheet that emails car buyers from a salesperson's own Gmail after the sale. It checks in on how they're doing, invites honest feedback, and can offer a thank-you gift. Every salesperson gets their own copy, so it runs under their own Gmail and their customer data stays in their own Google Drive. No server or monthly fee is needed. AI personalization is optional and needs an Anthropic API key.

## What it does

- **Cadence you control.** One row per email in the **Cadence** tab, with the day it goes out, the subject, the body, and an on/off checkbox. Add rows for a longer sequence, delete rows for a shorter one, and edit the wording freely. The defaults send on days 1, 4, 7, 14 and 30.
- **Per-customer inputs.** First/last name, email, dealership, vehicle, purchase date, **deal notes** (what happened during the deal) and an optional review link. Enter them through the **Add customer** form or type them straight into the **Customers** tab.
- **Draft or Send mode.** Draft (the default) puts each email in Gmail Drafts so you can review it and press send. Send mode sends automatically.
- **Customer-first safety rails.**
  - When a customer replies, their sequence pauses so you can answer personally.
  - A reply of "STOP" or "unsubscribe" opts them out.
  - There's a minimum gap between emails, weekends can be skipped, and there's a cap on emails per run.
  - A customer added late jumps straight to the step that fits their timeline, so they don't get a stale "thanks for picking it up yesterday".
- **Optional AI personalization.** Claude rewrites each email using that customer's deal notes. For example, it can mention their road trip, or that it's their daughter's first car. It's told never to bring up price, financing, trade-in values or negotiation, and never to ask for a score. It also has to keep the review link, the gift wording and your signature exactly as you wrote them. If a rewrite breaks any of those rules, the agent throws it away and sends your template instead.
- **Log tab.** Records every send, draft, reply, opt-out and error.

### Placeholders for subjects and bodies

`{{FirstName}}` `{{LastName}}` `{{Vehicle}}` `{{Dealership}}` `{{Salesperson}}` `{{SalespersonPhone}}` `{{ReviewLink}}` `{{GiftOffer}}` `{{Signature}}`

If `{{ReviewLink}}` or `{{GiftOffer}}` has no value (for example, the gift is turned off), the agent drops the whole line it's on.

## Set up the master copy (one time, about 10 minutes)

1. Create a new Google Sheet and name it something like "Post-Sale Follow-Up".
2. Open **Extensions > Apps Script**. Delete the starter code and paste in `Code.gs`.
3. Click **+ > HTML**, name the file `AddCustomer` (exactly), and paste in `AddCustomer.html`.
4. Optional: in **Project Settings**, check "Show appsscript.json" and paste in `appsscript.json`. Then set your time zone in the sheet under **File > Settings**.
5. Save, then reload the spreadsheet. A **Follow-Up Agent** menu appears. Click **Follow-Up Agent > Set up / repair sheets** and approve the permissions prompt.
6. Fill in the **Settings** tab and adjust the **Cadence** tab to your liking.

## Share it with anyone

Share the master sheet with **"Anyone with the link can view"**. Then give people the link with `/edit…` replaced by `/copy`:

```
https://docs.google.com/spreadsheets/d/<SHEET_ID>/copy
```

Opening that link makes a private copy, with the script included, in the recipient's own Google Drive. Each salesperson then does the following:

1. Opens their copy and clicks **Follow-Up Agent > Set up / repair sheets**.
2. Approves access. Google will say **"Google hasn't verified this app"**. That's normal for a personal script like this. They click **Advanced > Go to … (unsafe)**. The script only runs in their own account.
3. Fills in **Settings** (name, dealership, review link) and adds customers.
4. Uses **Preview** and **Send me a test** on a customer row, then **Turn on daily schedule**.

Nobody else, including you, can see a copy's customers or Gmail.

## Optional: AI personalization

1. Get an API key at console.anthropic.com. Usage is billed by Anthropic. Each email is a single short request.
2. Click **Follow-Up Agent > Set Claude API key**. The key is stored privately for that user, not in the sheet.
3. In Settings, check **Use AI Personalization**.

Without AI, the deal notes are only kept for your records. They are never pasted into an email.

## The gas-card offer: what's allowed (please read)

The default wording offers a free tank of gas as thanks for **honest feedback, whatever they say**. That's on purpose. Offering it **in exchange for a 100% / 5-star review** would create real risk:

- **FTC rule on consumer reviews (16 CFR Part 465, in effect since October 2024).** It bans offering compensation conditioned, expressly or by implication, on a review expressing a particular sentiment. "Gas for a 100%" is exactly that. The FTC can seek civil penalties of up to $53,088 **per violation**, and in late 2025 it began sending warning letters under this rule.
- **Google reviews.** Google prohibits offering any incentive for a review, even when the incentive isn't tied to the rating. If your review link points to Google, **turn off "Offer Thank-You Gift"** or remove `{{GiftOffer}}` from any email that contains a Google link. Otherwise Google can remove reviews or restrict your profile.
- **Manufacturer (OEM) surveys.** If "100%" refers to a manufacturer satisfaction survey, most brands' dealer agreements prohibit survey coaching and incentives. Penalties can include chargebacks or lost bonus money. Check your brand's program rules before offering anything tied to the survey.

The agent helps you stay inside these lines. It warns you when a template both offers the gift and asks for a specific score, and it rejects AI drafts that ask for a score. Your templates are still yours to edit, so the responsibility for them is yours too. This is not legal advice. Have your dealership's compliance contact review the final wording.

## Limits worth knowing

- Gmail allows scripts to email about **100 recipients/day on free accounts** and about **1,500/day on Google Workspace** accounts. "Max Emails Per Run" defaults to 40.
- The daily run happens within the hour you choose, not at an exact minute. That's how Google schedules these.
- Reply detection treats any email from the customer, after the first follow-up, as a reply. That pauses their sequence until you set **Status** back to **Active**.
- Status values: `Active`, `Paused`, `Replied - check inbox`, `Reviewed`, `Opted out`, `Completed` and `Error`. Set a customer to **Reviewed** once they've left feedback, and their sequence stops, including any later check-ins.

## Development

`node test/run-tests.js` runs the script against in-memory fakes of the Sheets and Gmail services. It covers 35-day cadence simulations, Draft and Send modes, reply/STOP handling, weekend skipping, late-added customers and the AI guardrails.
