# Firefox Add-ons listing: Pixel & Tag Tracer

Copy-paste text for the addons.mozilla.org listing. Not packaged.

## Name

Pixel & Tag Tracer

## Summary (max 250 characters)

See every tracking pixel and tag a page fires (Google, Meta, TikTok, LinkedIn, Segment and 50+ more), with decoded events, IDs, consent state and the GTM dataLayer events behind them. Nothing leaves your browser.

## Description

Pixel & Tag Tracer shows every request a page sends to 57 ad, analytics, session-replay and marketing tools, including Google, Meta, TikTok, LinkedIn and Segment: the event, the IDs, every parameter, the consent state and the GTM events behind it.

WHAT IT SHOWS
- Every hit, in order: tool, event name, pixel or account ID, and response status, so a pixel blocked by tracking protection or another extension doesn't go missing silently.
- Click any hit for every parameter with a plain-English label, plus the raw URL.
- Click any ID (GTM-…, G-…, pixel IDs) or any table cell to copy it. Copy table copies a whole table, ready to paste into a spreadsheet.
- Google Consent Mode decoded on each Google hit: ads, analytics, user data and personalisation, and how each was set (e.g. "denied by default, granted by update").
- Consent-leak flags: a hit from any other tool that fires while the page's consent says no is marked red, and so is the toolbar badge.
- Audit notes: hashed or unhashed personal data, IP-to-company lookups, form capture, session recordings, and tracking routed through the site's own domain.

GTM DEBUGGING
- Every dataLayer push and gtag() call in the same timeline: GTM's built-in events (Container Loaded, DOM Ready, Click, Form Submit and so on), custom events, and consent default/update calls, including region-scoped defaults.
- Pixels installed by Google Tag Manager are labelled "via GTM".
- dataLayer snapshots, like Tag Assistant's Data Layer tab: the merged dataLayer after any push, and at the moment any hit fired.
- The GTM containers and Google tag IDs live on the page are listed at the top.

TOOLS COVERED
Google (GA4, Google Ads, Floodlight, GTM, server-side GTM and tag gateways), Meta, Segment, TikTok, LinkedIn, Microsoft Ads, Pinterest, Snapchat, X, Reddit, Quora, Spotify, Amazon Ads, Criteo, The Trade Desk, StackAdapt, AdRoll, RTB House, AppLovin, Taboola, Outbrain, Xandr, Quantcast, Adobe Advertising, Adobe Analytics, Amplitude, Mixpanel, Heap, PostHog, Matomo, Plausible, Fathom, Comscore, Hotjar, Microsoft Clarity, FullStory, Contentsquare, Quantum Metric, Mouseflow, Crazy Egg, RudderStack, mParticle, Tealium, HubSpot, Marketo, Marketo Measure, Pardot, Klaviyo, Attentive, Impact, Northbeam, Customer.io, 6sense, Demandbase, ZoomInfo, Clearbit and G2.

HOW TO USE IT
- Toolbar popup for the current tab; the badge counts the page's hits.
- A sidebar that stays open while you click around and follows whichever tab you're on, or locks to one tab while you work in others (say, the client site while you're in GTM): the view for testing a cookie banner.
- A "Tag Tracer" panel in DevTools, there only on the tabs you open it on: dock it to the right for a per-tab sidebar.
- Filter chips for each tool on the page, a toggle for scripts and side-requests, and Copy log, which puts the timeline on the clipboard as plain text.

PRIVACY
Pixel & Tag Tracer sends nothing anywhere: no analytics, no accounts, no requests of its own. Everything stays in your browser, held in memory, and clears when Firefox closes. It doesn't block or alter any request.

LIMITS
It sees what the browser sends. Server-side tracking (Meta Conversions API, GA4 Measurement Protocol, Segment server sources) never passes through the browser. GTM tag names aren't included in published containers; use GTM's Preview mode for those.

Not affiliated with Google, Meta or any of the vendors listed. Their names are used only to say which tools it recognises.

## Categories

- Web Development
- Privacy & Security

(Mozilla has no "Developer Tools" category; Web Development is the developer one.)

## Tags

privacy, google, facebook

(Mozilla only accepts tags from its own list of 42; these are the ones that fit.)

## Screenshots

Upload in this order, from `docs/screenshots/` (taken on a made-up shop,
`demo-shop.html`, with every request answered locally). Captions, English (US):

1. `1-timeline.png`: Every hit in order: consent defaults to denied, a Meta pixel fires before consent (flagged in red), the visitor accepts, then pixels from seven tools follow.
2. `2-detail.png`: One add_to_cart dataLayer push, opened up, followed by the TikTok, Segment, GA4, Meta and Google Ads events it triggered.
3. `3-popup.png`: The toolbar popup: hits per tool, the page's live Google Consent Mode state, and the GTM and Google tag IDs on the page.
4. `4-snapshot.png`: dataLayer snapshots: exactly what the dataLayer held when the Meta AddToCart event fired, ready to copy as a table or JSON.

## Licence

The MIT License

## Links

Edit Product Page, under Support information and Homepage:

- Homepage: https://github.com/Fortnight-Digital/pixel-and-tag-tracer
- Support site: https://github.com/Fortnight-Digital/pixel-and-tag-tracer/issues

## Notes for reviewers

Pixel & Tag Tracer is a read-only inspector for marketers and developers. It
makes no network requests, collects no data (`data_collection_permissions:
none`), loads no remote code, and ships unminified, unbundled source. The
`tests/` and `docs/` folders are excluded from the package.

Why each permission:
- `webRequest` (non-blocking, with `requestBody`): observes tracking requests
  to known vendor hosts to decode them. It never blocks or modifies a request.
  One extra non-blocking listener on `<all_urls>`, without request bodies, looks
  only for Google tag parameters (`tid=` / `gtm=`) to spot Google tags served
  from a site's own domain.
- `webNavigation`: marks page loads in the timeline.
- `devtools_page`: adds a "Tag Tracer" DevTools panel showing the same log as
  the popup, for the inspected tab only.
- `<all_urls>`: tracking fires on every site, so observing it, and reading the
  page's consent state, needs host access everywhere.

Page access:
- `content.js` (declared content script, top frame only) reads the page's
  `dataLayer` through `wrappedJSObject` to show Google Tag Manager events. It
  wraps `dataLayer.push` with `exportFunction` only to timestamp each push, and
  calls the original via `Reflect.apply` with the arguments unchanged.
- `probe.js` is injected on demand with `tabs.executeScript({ file })`. It
  reads, without writing, Google's consent state (`google_tag_data.ics`), the
  loaded GTM container IDs, a consent cookie and `navigator.globalPrivacyControl`.

All data stays in the background page's memory and is shown only in the
extension's own popup and sidebar.
