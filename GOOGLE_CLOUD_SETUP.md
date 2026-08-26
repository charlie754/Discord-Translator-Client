# Google Cloud Translation: getting your own key

This guide is for the **Google Cloud Translation (your own key)** provider. It walks through
creating a Google Cloud account, making a key, restricting it, capping it, and pasting it into
Discord Translator.

It assumes you have never opened Google Cloud Console and do not know what a *project* or a
*billing account* is. Every term is explained where it first appears.

It takes about fifteen minutes. **Read the whole of the next section before you start.** It is the
part people wish they had read, and one paragraph of it is the difference between a small bill and
a very large one.

Discord Translator also ships two controls of its own that this guide covers, because you will meet
them on the same settings screen as the key: a **spend meter** that estimates what you have sent
this month, and an optional **monthly character cap** that is switched **off** by default. Neither
is a Google control and neither replaces step 6c — see
[The spend meter and the monthly character cap](#the-spend-meter-and-the-monthly-character-cap-inside-discord-translator).

---

## Read this first: this provider can cost you money, and two of the obvious safeguards do not work

Three things, in order of how badly they surprise people.

### 1. The Cloud Billing budget you will be offered does not cap spending

This is the single most dangerous misconception in the topic, so here is Google's own wording:

> Setting an alerts-only budget doesn't automatically cap Google Cloud or Google Maps Platform
> usage or spending.

An **alerts-only budget** — which is the ordinary kind, the one the Create budget flow gives you,
and the one this guide sends you to in step 6c — sends you an email. **It does not stop anything.**
By the time it arrives the money is already spent. Set one — it is a useful second signal — but
never treat it as protection.

**One qualification, so this is not overstated.** Google also ships a second kind called a **spend
cap budget**, which genuinely does stop usage: Google describes a triggered one as blocking "all
*new* usage for the specific service in the specified project", while "any *in-flight* requests of
the specified service are processed to completion, accruing charges as applicable". Two things
about it matter here:

- **It is in Preview** — Google's own page carries the pre-GA notice, meaning the feature is offered
  as is and can change.
- **It only works where the service supports it.** Google's wording is "*if supported for your
  service*", and its eligible-services list currently names four: Gemini API, Gemini Enterprise
  Agent Platform (formerly Vertex AI), Cloud Run, and Cloud Run functions. **Cloud Translation is
  not among them.** Checked against
  <https://cloud.google.com/billing/docs/how-to/budgets-spend-caps>; because the feature is in
  Preview that list can grow, so check it yourself rather than trusting this paragraph.

So a spend cap budget is a real cap that exists — it just does not appear to cover the API this
guide is about. **Nothing here changes the practical advice: for Cloud Translation, the quota cap in
step 6c is your real stop**, and a budget of the kind you will actually be offered is an alert, not
a brake.

### 2. There is no free tier — there is a monthly credit, and it is not a stop

This is worth getting right because the wrong phrase leads to the wrong expectation. Cloud
Translation does not have a free tier of 500,000 characters. It has a **monthly credit of up to
USD 10**, which at USD 20 per million characters happens to cover about 500,000 of them. In Google's
words the allowance is "applied as $10 credit every month", and:

> Credit usage applies collectively to both Cloud Translation - Basic and Cloud Translation -
> Advanced. The credit is up to $10, based on your usage and does not roll over.

So the 500,000 characters are **not a wall you bounce off.** Cross them and nothing refuses you —
the next character simply costs money, at **USD 20.00 per 1,000,000 characters**, charged to the
card on your billing account without asking again. And because the credit is shared with Cloud
Translation - Advanced and does not roll over, 500,000 is the *most* it will cover in a month, not
a figure you can count on.

### 3. Out of the box there is no daily limit at all

This is the number that matters, and the reason step 6c of this guide is not optional.

**The default characters-per-day quota on a new project is unlimited.** The only limit Google
applies by default is a rate limit: **6,000,000 characters per minute.** Multiply that out:

| Window | Characters | Cost at USD 20 per million |
|---|---|---|
| One minute | 6,000,000 | **USD 120** |
| One hour | 360,000,000 | **USD 7,200** |
| One day | 8,640,000,000 | **USD 172,800** |

That is the worst case for a key that leaks and is not capped. It is not a rhetorical flourish; it
is the default rate limit multiplied by the published price.

**The only thing that stops a request rather than billing it is a quota.** Exceeding a quota you
set returns HTTP 403 and the request is rejected. That is step 6c, and it is the whole point of
this document.

---

## What you are actually billed for

- **Characters, counted as code points — not bytes.** Google: *"Cloud Translation counts usage on a
  per character basis, even if a character is multiple bytes. Each character corresponds to a code
  point."* So a Japanese or Chinese message is **not** charged three times over for being
  multi-byte. One character is one character.
- **Everything you send, including whitespace.** Google: *"You are charged for all characters that
  you include in a Cloud Translation request, even untranslated characters. This includes, for
  example, whitespace characters."*
- **Empty queries too.** Google charges for those as well. Discord Translator does not send them —
  `shouldTranslate()` in `src/plugins/channelTranslator/core/detect.ts` drops empty content, and
  blank lines inside a message are skipped rather than sent — but the rule is Google's, so if you
  test the API by hand, do not send empty strings.
- **The placeholders this app substitutes.** Before sending, Discord Translator replaces URLs,
  mentions, custom emoji, timestamps and code spans with a short placeholder
  (`src/plugins/channelTranslator/core/protect.ts`) so the translator cannot mangle them. The
  placeholder is an opening marker, the token's number, and a closing marker — so it is three
  characters for the first ten tokens in a line and four from the eleventh onward. Those characters
  are billed. They are almost always *fewer* characters than the URL or mention they replaced, so
  this reduces your bill rather than inflating it — but it is not free.

A worked example. Call an average Discord message 60 characters — a short sentence — and read the
rows in order: **each one continues from the one above it**, and the running total is what the
month's credit is measured against.

The fourth row is the one people do not expect. The local cache holds **5,000 entries** and then
starts discarding the oldest, so a re-read of something you translated early in the month is sent
to Google again and billed again. The next section sets that out in detail; the table would be a
lie without it.

| Step, continuing from the row above | Messages sent to Google | Characters sent | Running total this month | Billed so far, at USD 20 per 1,000,000 |
|---|---|---|---|---|
| 1. Translate one message | 1 | 60 | 60 | USD 0 — inside the credit |
| 2. Open a channel and scroll back over 1,000 messages you have never translated | 1,000 | 60,000 | 60,060 | USD 0 — inside the credit |
| 3. Keep doing that elsewhere until 8,000 **distinct** messages have been translated | 6,999 | 419,940 | 480,000 | USD 0 — 96% of the credit used |
| 4. Scroll back over the **oldest 3,000** of those messages again. They were evicted from the 5,000-entry cache, so they are re-sent | 3,000 | 180,000 | 660,000 | **USD 3.20** |
| 5. Another 1,000 messages you have never translated | 1,000 | 60,000 | 720,000 | **USD 4.40** |

Reading that back in plain words:

- **About 8,000 distinct messages of average length use up the month's credit** — roughly eight
  scroll-backs through a busy channel, *provided every message is one you have not translated
  before*. Eight scroll-backs through the **same** 1,000 messages cost 60,000 characters, not
  480,000, because the cache answers the repeats.
- **Past 5,000 distinct messages, re-reading is no longer free.** Row 4 is not an extra thing the
  user did; it is the same channel read a second time. It costs USD 3.20 here purely because the
  cache had already thrown those entries away.
- **Once the credit is gone the marginal rate is about USD 1.20 per thousand messages**, whether
  those messages are new or merely re-read after eviction. Google cannot tell the difference and
  neither can your invoice.

A single person catching up on a fast server is well within reach of all of this.

## What the local cache does, and where it stops helping

Translations are cached locally, which genuinely reduces what you send. It is worth knowing its
exact shape, because the worked example above is already large enough to overflow it.

Measured in this repository, not assumed:

- The cache is an **LRU holding 5,000 entries** — `new TranslationCache(5000)` in
  `src/plugins/channelTranslator/state.ts`, implemented in
  `src/plugins/channelTranslator/core/cache.ts`.
- It is keyed by **a hash of the message text plus the target language**, never by message id. Ten
  people posting identical text cost one translation.
- One entry is **one message**, whatever its length.
- When it passes 5,000 entries, the **least recently used entry is discarded** to make room.
- It is **persisted** into your plugin settings and reloaded at startup, so it survives restarting
  Discord.

What follows from that, plainly:

- **Re-reading something still in the cache does not re-send it.** That part of the saving is real,
  and it is the only part that is unconditional.
- **The cache is full after 5,000 distinct messages — which is 300,000 characters, or 60% of the
  monthly credit.** Eviction therefore starts *before* the credit runs out, not after. From that
  point on, "I have read this before" and "this is free" are two different statements.
- **Past 5,000, re-reading re-bills.** The 8,000-message example above overflows the cache by 3,000
  messages, and scrolling back over those 3,000 sends them again — 180,000 characters, USD 3.20 at
  the point in the table where the credit has already gone. Nothing warns you; it looks exactly
  like ordinary scrolling.
- **Changing your target language re-translates everything.** The language is part of the key, so
  switching from English to 繁體中文 and back is two full sets of translations, competing for the
  same 5,000 slots — which also means each language reaches the eviction point twice as fast.
- **Double- and triple-click selection translation is not cached at all.** That path
  (`src/plugins/channelTranslator/selection.ts`) sends the selected text, shows the result in a
  popover and stores nothing, so translating the same selection twice is sent twice and billed
  twice. It *is* counted by the spend meter and *is* stopped by the character cap described in the
  next section — but the cache never helps it.

So the accurate claim is narrower than "the cache makes re-reading cheap": **the cache makes
re-reading cheap for your most recent 5,000 message-and-language pairs, and for nothing else.** It
is not a ceiling on your bill. The only ceiling is the quota in step 6c.

## The spend meter and the monthly character cap inside Discord Translator

Everything above this line is Google's side of the arrangement. These two are Discord Translator's
own, they live on the same settings screen as the key, and you will see them in step 7 whether or
not you were looking for them. **Neither of them is a Google control, and neither replaces step
6c** — the section after this one explains why that distinction is the whole point.

Both are in **Settings → Plugins → ChannelTranslator → the cog**, positioned immediately below
**googleCloudApiKey** on purpose: a meter on a different screen from the credential is a meter
nobody reads.

### The spend meter

It is a read-only panel headed **Spend meter — YYYY-MM**, showing the month in **your own local
calendar**, and it is implemented in `src/plugins/channelTranslator/core/usage.ts` with the display
in `src/plugins/channelTranslator/usageSettings.tsx`.

What it counts:

- **Only the providers that bill you** — Google Cloud Translation and DeepL. The default
  **Google (free)** provider is never counted, because nobody will ever invoice you for it, and a
  number in front of you that no one will charge you for is worse than no number.
- **Characters as code points**, the same unit Google bills in. Multi-byte text is not
  double-counted.
- **The exact text handed to the provider**, which is the text *after* the placeholder substitution
  described above — because that is what Google actually receives and charges for.
- **Text that was actually sent — including sent text that then failed.** The meter counts line by
  line, as each line goes out. A line that comes back is counted; so is a line whose failure proves
  it left the machine, because Google and DeepL bill for the request rather than for a usable
  answer. A request this app refused locally before it left — a blocked host, for instance — is not
  counted, and lines after a failure are never sent, so they are never counted either.
- The one thing it knowingly gets wrong in the other direction is a **network timeout**, which this
  app cannot distinguish from a local refusal. Those characters were sent, were billed, and are not
  in the meter. The code says so at the place it happens rather than hiding it.

A money figure is shown **only for Google Cloud Translation**, calculated as
`(characters − 500,000, floored at zero) ÷ 1,000,000 × USD 20`. The DeepL row deliberately shows
characters and no price, because this project has not verified DeepL's price table and will not
invent one.

**It is an estimate, and it cannot match Google's invoice.** The panel says so itself, and these
are the specific reasons:

- It counts only what **this plugin** sent. Anything else on the same billing account — another
  project, another tool, Cloud Translation - Advanced — spends the same USD 10 credit and is
  invisible here. This is the big one: the credit is shared, and the meter can only see its own
  share of the spending.
- **Google charges for empty queries**, which have no characters to count. This app does not send
  them, but it is Google's rule and it applies to anything else using the same account.
- The timeout case above, which under-counts.
- The month is your **local calendar** month; Google cuts its invoice on the billing account's own
  timezone, so the two can disagree for a few hours at a month boundary.

What it *does* see is both ways text leaves this app: whole-channel translation and the
double- or triple-click selection popover. Both obtain their provider from the same place
(`translationProvider()` in `src/plugins/channelTranslator/state.ts`), and what that returns is
already metered, so there is no unmetered path left for a caller to reach by accident.

**Rolling over and resetting.** The month rolls over by itself: the stored month is compared with
today's, and a mismatch starts the new month at zero — which works identically whether Discord was
running across midnight or closed. To clear it by hand, use the button at the bottom of the panel.
It takes **two clicks**: the first arms it and changes the label to *"Click again to erase this
month's count"*, the second erases the current month's counts for every paid provider. Resetting
changes nothing at Google — it clears your local record, not your bill. It exists for the case
where the number no longer describes anything, such as after you move to a different project or
replace a key.

**Where the number is kept.** In your plugin settings, under a hidden `usageBlob` entry: a month
string, provider ids, and integers. No message text of any kind — see [PRIVACY.md](./PRIVACY.md).

### The monthly character cap

**It is off by default.** The setting is **monthlyCharacterCap** and it ships as **0**, which means
no cap. Until you type a number into it, nothing on this settings screen stops a single request.
That default is deliberate — a cap that arrived switched on would silently break translation for
people the first time they crossed a number they never chose — but it does mean the meter above is
observation only until you act on it.

Set it to a number and, from the next message onward:

- The cap applies to **paid providers combined** — Google Cloud and DeepL summed, not one budget
  each.
- Before anything is sent, the plugin adds up what has already gone to paid providers this month
  and what this request would add. If the total would cross your cap, **nothing is sent.** This
  covers **both** ways text leaves the app — whole-channel translation and the double- or
  triple-click selection popover — because both obtain their provider from the same metered place.
- It refuses the **whole message**, never half of it, so you are never left with a half-translated
  message and no way to tell which half.
- You get a notice saying so in plain words, and saying that this is **your own setting rather
  than an error from Google** — otherwise people go and debug a limit in the Cloud Console that
  does not exist. It is shown once per episode rather than once per message on screen; on the
  selection path the same explanation appears in the popover itself.
- The refusal is not retried and does not count towards the rate-limit breaker, so hitting your own
  cap does not make the plugin behave as though the provider were sick.
- It clears itself when the month rolls over. Raising it or setting it back to 0 takes effect on
  the next message; there is nothing to restart.

**Be clear about what this cap does not do.** It runs inside your own Discord client, which is
precisely where a leaked key is *not* being used:

- It **cannot stop a leaked key.** Someone else spending your key does it from their machine, which
  never sees your settings. Only the quota in step 6c can refuse that request, because only Google
  is in a position to.
- It does **not** stop Google billing you for anything already sent — including a request that
  failed, since the characters had already left.
- It is a **character** cap, not a money cap. It cannot know what Google will charge; it counts
  what this app sends.

So: the cap is a useful guard against *your own* heavy month, and the meter is a useful way to see
one coming. **Step 6c is what protects you from everything else, and it is still not optional.**

## Where the key is stored, and why that matters here

**In the browser extension, your key is stored in `discord.com` localStorage, where any script
running on that page can read it.** [PRIVACY.md](./PRIVACY.md) already says this about the DeepL
key. A Google Cloud key is worse, because a stolen Google Cloud key can be **billed to your card**,
and a stolen DeepL free key cannot.

**The desktop build is the safer place for a paid key.** There your settings are a file in the
app's own data directory, not storage belonging to a web page you are logged into.

If you use the browser extension anyway — which is a reasonable choice, and it is your call — then
**the quota cap in step 6c is your backstop**, and it is the only thing standing between a leaked
key and a bill with no upper bound. Set it low. You can raise it later in a minute.

---

## A note on the two Google hostnames

These look like typos of each other and they are not:

| String | What it is | Where you meet it |
|---|---|---|
| `translate.googleapis.com` | the free, unofficial gtx endpoint the default provider uses | the shipped default; nothing to set up |
| `translation.googleapis.com` | **the paid Cloud Translation v2 API this guide sets up** | the host your key's requests actually go to |
| `translate.googleapis.com` | **also the service name inside Google Cloud Console** | what you search for in the console, and what the quota page is filtered by |

Note the last row. Inside the console the service is called **`translate.googleapis.com`** even
though your requests are sent to **`translation.googleapis.com`**. People search the console for
"translation.googleapis.com", find nothing, and conclude something is broken. Nothing is broken;
they are two different strings for two different things.

---

## 1. Create a Google account and open Cloud Console

If you already use Gmail, YouTube or Google Drive, you already have the Google account part. You
still need to activate Google Cloud on it, which is separate.

1. Go to <https://console.cloud.google.com> and sign in with your Google account.
2. Accept the terms when asked. You will land on the Google Cloud Console dashboard.

**About the free trial.** Google usually offers new Cloud customers a credit — the published figure
has been USD 300, usable within 90 days. Check the current terms on Google's own page rather than
trusting this paragraph, because they change.

What matters here is what the trial is *not*:

- **The trial credit is not the monthly Translation credit.** They are two different things. The
  Translation allowance is a recurring monthly credit of up to USD 10, worth about 500,000
  characters. The trial credit is a one-off temporary balance spendable on many Google Cloud
  services.
- **The trial ending does not delete your key or your project.** It changes what happens when you
  go past the monthly credit: instead of coming out of trial credit, it goes on your card.
- **The trial does not remove the requirement to enable billing.** That is the next step, and it is
  the one that surprises people.

<!--
SCREENSHOT: assets/gcloud/01-console-landing.png
Screenshot needed: the Google Cloud Console dashboard immediately after first sign-in, before any
project exists.
-->

## 2. Understand that billing must be enabled — even to use the monthly credit

This is the part that feels wrong, so it is worth stating flatly:

**The Cloud Translation API will not work unless the project has a billing account attached, even
if you only ever intend to stay inside the monthly credit.** Google's own Cloud Translation setup
documentation states plainly that you must enable billing to use Cloud Translation. What that looks
like in practice, if you skip this step, is the HTTP 403 in step 8's table — a refusal, not a
degraded free mode.

A note on that error's wording, because this document leans on verbatim quotation and this one line
is not verbatim. The phrase *This API method requires billing to be enabled* is a real Google
string, but the place Google documents it is the **Apigee** provisioning error catalog
(<https://cloud.google.com/apigee/docs/api-platform/errorcatalog/provisioning-errorcatalog>), not
Cloud Translation's documentation. This project has not seen Cloud Translation return that exact
sentence and does not claim it does. Expect a 403 whose message says billing must be enabled on the
project; do not match on the exact words.

A **billing account** is a Google Cloud object holding a payment method — a credit or debit card in
most countries. Attaching one to a project means: *if this project runs up charges, bill them here.*

So enabling billing means, in plain words:

- You give Google a card.
- The monthly credit of up to USD 10 covers roughly the first 500,000 characters — *roughly*,
  because that same credit is shared with Cloud Translation - Advanced and does not roll over, so
  anything else on the billing account using it leaves less of it for you.
- Once the credit is used up, you are charged USD 20 per million characters, automatically, without
  being asked again.

**There is no setting anywhere that says "never charge me under any circumstances."** The nearest
thing is the quota cap in step 6c, which makes Google refuse the request instead of billing it. A
budget alert is not that thing — see the top of this document.

If you are not willing to put a card on file, stop here. Discord Translator's default Google (free)
provider and the DeepL free tier both work without one. This provider is for people who want the
official, quota-backed endpoint and accept what that costs.

## 3. Create a project

A **project** is a container. Everything in Google Cloud — keys, enabled APIs, quotas, bills —
belongs to a project. You want one project for this and nothing else, so that its quota and its
bill are about Discord Translator alone.

**Go straight to <https://console.cloud.google.com/projectcreate>.**

1. Give it a name you will recognise later. `discord-translator` is fine. The name is for you; it
   does not have to be unique or clever.
2. Leave **Location** / **Organisation** as it is unless your employer gave you one.
3. Confirm — look for a button named roughly **Create**. It takes a few seconds.

<!--
SCREENSHOT: assets/gcloud/02-create-project.png
Screenshot needed: the New Project form at `console.cloud.google.com/projectcreate`, with the
project name field filled in.
-->

**Now check that the new project is the selected one.** At the top of every console page there is a
project selector — a dropdown in the top bar showing the project name. **Every step after this one
applies to whichever project is selected there, and doing steps 4 to 6 against the wrong project is
the single most common way this goes wrong.** The symptom is horrible: you enable the API on
project A, create a key in project B, and get a 403 that reads exactly like a bad key.

If the selector still shows something else, click it and pick the project you just made.

<!--
SCREENSHOT: assets/gcloud/03-project-selector.png
Screenshot needed: the console top bar with the project selector open, showing the newly created
project highlighted, so a reader can identify the control by sight. Mask any other project names.
-->

Now attach billing to it. **Go to <https://console.cloud.google.com/billing>**, with your project
selected.

1. If the project has no billing account, the page offers to link one — look for a control named
   roughly **Link a billing account**.
2. Either pick an existing billing account or create one, which is where you enter the card.
3. When it is done, the billing page for the project shows a linked billing account rather than a
   prompt to link one.

<!--
SCREENSHOT: assets/gcloud/04-link-billing.png
Screenshot needed: the project's Billing page showing a billing account linked, with the account
name and any personal details masked.
-->

## 4. Enable the Cloud Translation API — do not skip this

**This is the step people miss, and skipping it produces an error that looks exactly like a bad
key.** A project with billing enabled and a perfectly good key still returns HTTP 403 until the
Translation API is switched on for that specific project. Every API is off by default.

**Go straight to
<https://console.cloud.google.com/apis/library/translate.googleapis.com>.**

That link opens the Cloud Translation API's page in the API Library. Check the project selector in
the top bar is still your project, then activate the API — look for a button named roughly
**Enable**.

When it has worked, the **Enable** button is replaced by one named roughly **Manage**, and the API
appears in your project's list of enabled APIs. If you still see **Enable**, it did not take.

Enabling can take a minute or two to propagate. If your first test in step 8 fails with a 403
mentioning that the API "has not been used in project ... before or it is disabled", wait a couple
of minutes and try again before changing anything else.

<!--
SCREENSHOT: assets/gcloud/05-enable-api.png
Screenshot needed: the Cloud Translation API library page, with the Enable button visible and the
correct project shown in the top bar.
-->

## 5. Create an API key

An **API key** is a long string of letters and numbers that identifies your project to Google.
Anyone holding it can spend your quota. Treat it like a password.

**Go to <https://console.cloud.google.com/apis/credentials>.**

1. Start a new credential — look for a control named roughly **+ Create credentials** at the top of
   the page.
2. Choose **API key** from what it offers.
3. A dialog shows the new key. Copy it now — you will paste it into Discord Translator in step 7.
4. Do **not** close the dialog and walk away. Go straight on to step 6 — the dialog usually offers a
   link named roughly **Edit API key** or **Restrict key**. An unrestricted key is a key that can be
   used for anything in your project, by anyone who gets it, up to whatever your card will absorb.

You can always come back later: the same credentials page, then click the key's name.

<!--
SCREENSHOT: assets/gcloud/06-create-key.png
Screenshot needed: the "API key created" dialog, with the key value itself blurred or replaced by
placeholder characters.
-->

## 6. Restrict and cap the key — the most important step in this document

A key that is neither restricted nor capped is an open-ended liability. The three parts below turn
it into a small, bounded one.

Do all three. Parts a and b are on the key's own page at
<https://console.cloud.google.com/apis/credentials> — click your key. Part c is on a different page
and has its own link.

### 6a. Restrict which API the key may call

On the key's page, find the section about **API restrictions**:

1. Choose to restrict the key rather than leaving it unrestricted.
2. In the list, tick **Cloud Translation API** and nothing else.
3. Save.

Now the key is useless for anything except translation. If it leaks, the worst an attacker can do is
spend your translation quota — bad, but bounded, and bounded much harder by 6c.

<!--
SCREENSHOT: assets/gcloud/07-restrict-api.png
Screenshot needed: the API restrictions panel with "Restrict key" selected and Cloud Translation
API ticked.
-->

### 6b. Leave Application restrictions set to None

The other section on that page is **Application restrictions**, and Google offers exactly four
kinds: **Websites** (HTTP referrers), **IP addresses**, **Android apps**, **iOS apps**.

**None of the four fits this app.** The website option looks like exactly what you want, and it will
break your key.

Here is why, in plain terms. An HTTP referrer restriction tells Google: only accept this key when
the request comes from a web page at this address. Google checks a header the browser attaches
saying which page made the request.

**In the two builds this project tells you to install, the request does not come from a web page.**

- **Desktop app:** the request is made from Electron's main process
  (`src/plugins/channelTranslator/native.ts`), which is not a web page at all.
- **Browser extension:** it is made from the extension's background context
  (`browser/translationHost.js`), which is the only part of an extension allowed to make
  cross-origin requests. Requests from there carry no page referrer.

So Google sees a request with no referrer, compares it against your list of allowed websites, finds
no match, and refuses it. The error reads something like *"Requests from referer &lt;empty&gt; are
blocked"*, which is confusing when you never set a referrer in the first place.

**One qualification, so this claim is not overstated.** There is a third path — the userscript and
plain-web bundles, which are not what the README tells you to install. Those use
`browser/translationBridge.ts`, which fetches **directly from the `discord.com` page**, so a request
on that path can carry `https://discord.com` as its referrer. If you are running the userscript
build and nothing else, a Websites restriction on `discord.com` is not automatically doomed. It is
still fragile — a referrer is set by the browser and by the userscript manager, not by this app, and
it is not what protects you from a leak. Test it against step 8 before you rely on it.

For everyone else: **leave Application restrictions set to "None".** The API restriction in 6a and
the quota cap in 6c are what protect this key. That is a real trade-off and you should know you are
making it: the key will work from wherever it is used. Which is precisely why the cap matters.

IP address restriction is not usable either, unless you have a fixed public IP address that never
changes and you are willing to fix it again every time it does. Most home connections do not.

<!--
SCREENSHOT: assets/gcloud/08-application-restrictions-none.png
Screenshot needed: the Application restrictions panel with "None" selected, so readers can confirm
they are looking at the right control.
-->

### 6c. Set a quota cap — the only hard stop that exists

Everything above bounds *what* the key can do. This bounds *how much*. It is the only control in
this document that makes Google **refuse** a request rather than bill it: past a quota you set, the
API returns HTTP 403 and the request is rejected.

**Go to
<https://console.cloud.google.com/iam-admin/quotas?service=translate.googleapis.com>.**

That link opens the quotas page already filtered to the Cloud Translation service. **Note the
service name is `translate.googleapis.com`** — the console spells it differently from the
`translation.googleapis.com` host your requests are sent to. See the hostname note above.

1. Find the quotas measured in **characters per day**. There is usually one for the project and one
   per user. Google renames these from time to time, so match on "characters" and "day" rather than
   on an exact phrase.
2. Select the quota and open its edit control — named roughly **Edit quotas** or shown as a pencil
   on the row.
3. Enter a limit and submit. Some quota changes apply immediately; some are reviewed. The console
   tells you which.

**Remember what you are changing.** The characters-per-day quota is **unlimited by default.** Before
you do this step there is no daily ceiling on this key at all, and the only limit in force is the
6,000,000-characters-per-minute rate limit — the USD 172,800-a-day figure at the top of this
document. This step is what replaces that with a number you chose.

**What number?** The monthly credit covers about 500,000 characters, which is about **16,000 a
day**. Set the daily cap to 16,000 and you will essentially never be billed; on a heavy day
translation simply stops working until tomorrow. That is the trade: an interruption instead of an
invoice.

Set it higher if you would rather pay than pause — but set it to *something*, and set it to a number
whose worst case you would be willing to pay. Work that out before you decide. The middle column
assumes a 30-day month, and the last assumes the credit is entirely yours to spend:

| Daily cap you set | Characters in a 30-day month | Billable after the credit's 500,000 | Worst-case monthly bill |
|---|---|---|---|
| 16,000 | 480,000 | 0 | **USD 0** |
| 100,000 | 3,000,000 | 2,500,000 | **USD 50** |
| 1,000,000 | 30,000,000 | 29,500,000 | **USD 590** |
| *(default: none)* | unlimited | unlimited | **USD 172,800 per day** |

If one of those numbers makes you uncomfortable, lower the cap now rather than reading it on a
statement later.

<!--
SCREENSHOT: assets/gcloud/09-quota-cap.png
Screenshot needed: the Cloud Translation quotas page reached by the link above, with a
characters-per-day quota selected and its edit dialog open.
-->

While you are here you may also want a **budget alert**, for example at USD 5.
**Go to <https://console.cloud.google.com/billing/budgets>**, pick your billing account if asked,
and start one with a control named roughly **Create budget**. It emails you. **It does not stop
anything** — see the top of this document. It is worth having as a second signal and it is not a
substitute for this step.

## 7. Put the key into Discord Translator, and set your target language

1. Open Discord.
2. Open **Settings** (the cog by your username, bottom left).
3. Go to **Plugins**, find **ChannelTranslator**, and click the **cog** on that plugin's entry.
4. **Paste your key into `googleCloudApiKey` first.**
5. **Then** set **Provider** to **Google Cloud Translation (your own key)**. Key first, provider
   second — see the note below on why that order and not the other one.
6. Set **`targetLanguage`**, on the same screen, to the language you want. **The default is
   English**, so if you wanted 繁體中文 and left it alone everything will work perfectly and
   translate into English, which looks exactly like setup having failed. It is a dropdown of 15
   languages listing **ZH-TW - 繁體中文** and **ZH-CN - 简体中文** as separate entries, because
   "Chinese" is not one language code. It is a list rather than a text box on purpose: a provider
   returns a 400 for a code it does not recognise, and a code you cannot type is a 400 you cannot
   cause.
7. Look at the two controls directly beneath the key, because this is where you meet them:
   - the **Spend meter**, which will read 0 characters on a fresh install, and
   - **monthlyCharacterCap**, which ships as **0, meaning no cap**. If you want the plugin to stop
     itself, type a number of characters here now. Both are explained in
     [The spend meter and the monthly character cap](#the-spend-meter-and-the-monthly-character-cap-inside-discord-translator),
     including what the meter cannot see and why the cap is no defence against a leaked key.
8. Close settings.

**Why the key goes in before the provider.** Discord Translator refuses to use a key-requiring
provider with no key, and shows a notice explaining why rather than failing silently on every
message. That notice is correct and it is doing its job — but if you switch the provider over first
you will trigger it, on your own half-finished configuration, and then have to work out that
nothing is actually wrong. Paste the key first and you never see it. This is the same order
[README.md](./README.md) gives for the DeepL key, for the same reason.

<!--
SCREENSHOT: assets/gcloud/10-plugin-settings.png
Screenshot needed: the ChannelTranslator settings panel with Provider set to "Google Cloud
Translation (your own key)", the googleCloudApiKey field filled with a placeholder value, the
targetLanguage dropdown (step 7 sends readers to it on this screen), and — scrolled into the same
frame — the Spend meter panel and the monthlyCharacterCap field beneath the key, so a reader can
see that the cap reads 0 by default.
-->

**There are two controls for the target language and they are one setting.** The `targetLanguage`
dropdown you used in step 6 is on this settings screen; the translator panel carries the same
choice, labelled **Target Language** (step 8 shows you where the panel is). They offer
the same 15 entries and they write the same value, so changing either changes both. Use whichever
is in front of you — there is nothing to keep in sync, and no reason to close settings to set your
language.

Changing the language re-translates what is on screen, and — as the cache section above explains —
each language is cached separately, so switching back and forth costs characters both ways.

## 8. Check that it works

Open a **server channel** — not a DM, where the panel is hidden by design — and look at the
**top-right of the chat area** for the translator panel. There is no toolbar button. Turn
translation on for that server with the panel's toggle.

Working looks like: the panel reads **Translating…** and then **On**, and messages appear in your
target language.

<!--
SCREENSHOT: assets/gcloud/11-translator-panel.png
Screenshot needed: the translator panel open at the top-right of a Discord server channel, with the
toggle On, the Mode switch and the Target Language dropdown all visible, so a reader can find the
panel and the language control by sight. Use a test server; mask usernames and message content.
-->

**If it does not work, test the key on its own.** This is worth doing before you change any setting,
because it gives you Google's own error message word for word instead of a symptom.

On Windows, in PowerShell:

```powershell
$key = "PASTE_YOUR_KEY_HERE"
Invoke-RestMethod -Method Post -Uri "https://translation.googleapis.com/language/translate/v2?key=$key" `
  -ContentType "application/json" `
  -Body '{"q":"hello","target":"es","format":"text"}'
```

On macOS or Linux, in a terminal:

```shell
curl -s -X POST \
  "https://translation.googleapis.com/language/translate/v2?key=PASTE_YOUR_KEY_HERE" \
  -H "Content-Type: application/json" \
  -d '{"q":"hello","target":"es","format":"text"}'
```

A working key returns:

```json
{"data":{"translations":[{"translatedText":"hola"}]}}
```

Anything else is an error message from Google, and it names its own cause. The common ones:

| What you see | What it means | Fix |
|---|---|---|
| `API key not valid. Please pass a valid API key.` (HTTP 400) | The key is mistyped, truncated, or has been deleted. | Re-copy it from the credentials page. Check you did not include a trailing space. |
| `Cloud Translation API has not been used in project ... before or it is disabled` (HTTP 403) | The API is not enabled on this project. **This is the commonest failure and it looks like a bad key.** | Step 4 — and check the project selector was showing the right project. Then wait two minutes. |
| A 403 saying billing must be enabled for the project. **UNVERIFIED wording** — Google documents the sentence *"This API method requires billing to be enabled"* for Apigee provisioning, not for Cloud Translation, so match on the meaning rather than the words. | No billing account is attached to the project. | Steps 2 and 3. |
| `Requests from referer <empty> are blocked` (HTTP 403) | You set a Websites (HTTP referrer) restriction on the key. | Step 6b — set Application restrictions to None. |
| `... requests to this API ... are blocked.` (HTTP 403) | The key's API restriction does not include Cloud Translation. | Step 6a — tick Cloud Translation API. |
| `Daily Limit Exceeded` (HTTP 403) | You hit the **characters-per-day** quota you set in 6c. This is the row you land on when your own cap works. | Wait for the quota to reset, or raise the cap in 6c if you meant to. Google resets daily quotas at midnight Pacific Time, and a quota change can take up to 24 hours to take effect. |
| `User Rate Limit Exceeded` (HTTP 403) | You hit a **per-minute** quota — by default the 6,000,000-characters-per-minute rate limit, or a per-minute figure you set yourself. | Wait. This one clears on its own within the minute. |
| `Invalid Value` on the target language (HTTP 400) | The target language code is not one this API supports. | Pick a language from the panel's dropdown rather than typing a code. |

The two quota rows are Google's own wording, from
<https://cloud.google.com/translate/quotas>: *"The error message states `Daily Limit Exceeded` if
you exceeded a daily quota or `User Rate Limit Exceeded` if you exceeded a per minute quota."* The
same page is where the unlimited characters-per-day default and the 6,000,000-per-minute rate limit
at the top of this document come from.

Inside Discord, a run of failed requests makes the panel read **Rate limited** and translation
pauses. The panel cannot show you Google's message, so when the cause is not obvious, run the test
command above — it is the fastest way to find out which row you are in.

## 9. If the key leaks: delete it. Do not rotate it.

**Do this immediately if the key has been shared, pasted anywhere public, committed to a repository,
or was in the browser extension on a machine you no longer trust.**

**Rotating the key does not stop the old one.** This is the trap. Google's rotation feature creates a
*new* key and, in Google's words, the old key string "remains active during the transition period" —
it keeps working until you manually delete it, and **there is no automatic expiration**. If you
rotate a leaked key and stop there, the leaked value is still spending your money.

So, to deal with a leaked key:

1. Go to <https://console.cloud.google.com/apis/credentials>.
2. Select the compromised key and **delete** it. Look for a control named roughly **Delete**.
3. Create a fresh key with step 5, restrict and cap it with step 6, and paste it into
   **googleCloudApiKey** with step 7.

A deleted key stops working. Google keeps it recoverable for **30 days** — you can undelete within
that window if you deleted the wrong one — after which it is gone for good. That window is a safety
net for your mistakes, not a reason to delay: the key stops working the moment you delete it.

Afterwards, check your billing reports at <https://console.cloud.google.com/billing>, filtered to the
Cloud Translation API, to see whether anything was spent that you did not do yourself.

If you want the strongest possible stop, delete the whole project. That removes every key in it at
once. **Go to <https://console.cloud.google.com/iam-admin/settings>** with the project selected —
that is the IAM &amp; Admin settings page — and look for a control named roughly **Shut down**.
Confirm it by typing the project id when asked. Google holds the project in a recoverable state for
a period before deleting it for good.

To stop using this provider without a leak, the same delete step applies, and then clear the
**googleCloudApiKey** field in Discord Translator and set **Provider** back to **Google (free)** or
**DeepL (your own key)**.

---

## Screenshots still needed

None of the images below exist yet. Google Cloud Console requires a signed-in account, so these have
to be taken by hand. Each placeholder above sits at the point in the text where the image belongs,
and carries its own shooting note **inside** the HTML comment, so end users never read an
instruction addressed to whoever takes the picture. This table is the visible copy, on purpose.

| File | What to capture |
|---|---|
| `assets/gcloud/01-console-landing.png` | The Google Cloud Console dashboard immediately after first sign-in, before any project exists. |
| `assets/gcloud/02-create-project.png` | The New Project form at `console.cloud.google.com/projectcreate`, project name filled in. |
| `assets/gcloud/03-project-selector.png` | The top-bar project selector, **open**, with the new project highlighted. This is the control the guide calls the single most common way setup goes wrong, and readers cannot find it from a text description. Mask other project names. |
| `assets/gcloud/04-link-billing.png` | The project's Billing page showing a billing account linked. Mask the account name and any personal details. |
| `assets/gcloud/05-enable-api.png` | The Cloud Translation API library page, Enable button visible, correct project shown in the top bar. |
| `assets/gcloud/06-create-key.png` | The "API key created" dialog. **Blur or replace the key value.** |
| `assets/gcloud/07-restrict-api.png` | The API restrictions panel, key restricted, Cloud Translation API ticked. |
| `assets/gcloud/08-application-restrictions-none.png` | The Application restrictions panel with "None" selected. |
| `assets/gcloud/09-quota-cap.png` | The quotas page reached by the deep link in 6c, a characters-per-day quota selected, its edit dialog open. |
| `assets/gcloud/10-plugin-settings.png` | The ChannelTranslator settings panel: Provider set to "Google Cloud Translation (your own key)", googleCloudApiKey holding a placeholder, the targetLanguage dropdown, and the Spend meter panel plus the monthlyCharacterCap field visible in the same frame. The cap must be shown at its default of 0 — readers need to see that it arrives switched off. |
| `assets/gcloud/11-translator-panel.png` | The translator panel at the top-right of a server channel, toggle On, Mode and Target Language both visible. Step 8 sends readers to find this panel and they have never seen it. Use a test server; mask usernames and message text. |

Whoever takes these: **no real key value in any frame**, and check the browser tab bar and the
account avatar for anything you did not mean to publish.

One mechanical note: this document lives at the repository root, alongside `README.md`, so the paths
in the table are already correct as written. The markdown that replaces each placeholder is
`![...](assets/gcloud/02-create-project.png)` with no `../` in front. `assets/gcloud/` does not exist
yet and needs creating.
