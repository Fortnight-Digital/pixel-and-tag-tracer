/*
 * Pixel & Tag Tracer tests. Zero dependencies: `node tests/run.js`.
 *
 * The GA4 URLs are real hits captured from a live site, and the Segment
 * bodies are analytics-next 1.84.3's real payloads with the IDs swapped out,
 * both captured 2026-10-05.
 */
'use strict';

const assert = require( 'assert' );
const fs = require( 'fs' );
const path = require( 'path' );
const vm = require( 'vm' );
const PW = require( '../rules.js' );
global.PW = PW;
require( '../vendors.js' );

let passed = 0;
const failures = [];
function test( name, fn ) {
	try {
		fn();
		passed++;
	} catch ( e ) {
		failures.push( name + '\n    ' + e.message );
	}
}
async function testAsync( name, fn ) {
	try {
		await fn();
		passed++;
	} catch ( e ) {
		failures.push( name + '\n    ' + e.message );
	}
}

const one = ( url, body ) => {
	const hits = PW.classify( { url, method: body ? 'POST' : 'GET', body } );
	assert.ok( hits, 'expected a hit for ' + url );
	assert.strictEqual( hits.length, 1 );
	return hits[ 0 ];
};

// Match-pattern semantics as Firefox applies them to webRequest filters.
function matches( pattern, url ) {
	if ( pattern === '<all_urls>' ) return true;
	const [ , scheme, host, p ] = /^(\*|https?):\/\/([^/]+)(\/.*)$/.exec( pattern );
	const u = new URL( url );
	if ( scheme !== '*' && u.protocol !== scheme + ':' ) return false;
	if ( host !== '*' ) {
		if ( host.startsWith( '*.' ) ) {
			const d = host.slice( 2 );
			if ( u.hostname !== d && ! u.hostname.endsWith( '.' + d ) ) return false;
		} else if ( u.hostname !== host ) return false;
	}
	const re = new RegExp( '^' + p.split( '*' ).map( s => s.replace( /[.+?^${}()|[\]\\]/g, '\\$&' ) ).join( '.*' ) + '$' );
	return re.test( u.pathname + u.search );
}
// Checked with this file's own matcher, not PW.listened, so the two cross-check.
const listened = url => PW.listenUrls().some( p => matches( p, url ) );

const GA4_PAGE_VIEW = 'https://analytics.google.com/g/collect?v=2&tid=G-SHOPDEMO42&gtm=45je69u2v878222536za200zd878222536xf1&_p=1791212458528&_gaz=1&gcs=G111&gcd=13r3r3r3r5l1&npa=0&dma=0&gdid=dY2E1Nz.dZTNiMT&_eu=AAAAACAC&cid=746406658.1791212460&frm=0&ibt=1&ngs=1&pscdl=noapi&rcb=9&sr=2560x1440&uaa=arm&uab=64&uafvl=Not%253FA_Brand%3B24.0.0.0%7CChromium%3B152.0.7977.130&uam=&uamb=0&uap=macOS&uapv=26.6.2&uaw=0&ul=en-us&_s=1&tag_exp=115616986~115938466&sid=1791212459&sct=1&seg=0&dl=https%3A%2F%2Fshop.example%2F&dt=Trailhead%20Outfitters%20%7C%20Tents%20and%20Trail%20Gear&_tu=CA&en=page_view&_fv=1&_nsi=1&_ss=1&_ee=1&ep.googlesitekit_post_type=page&tfd=1679';
const GA4_OFFER = 'https://analytics.google.com/g/collect?v=2&tid=G-SHOPDEMO42&gtm=45je69u2v878222536za200zd878222536xf1&_p=1791212458528&gcs=G111&gcd=13r3r3r3r5l1&npa=0&dma=0&cid=746406658.1791212460&_s=2&dp=%2F&sid=1791212459&sct=1&seg=0&dl=https%3A%2F%2Fshop.example%2F&en=lead_offer_impression&_ee=1&ep.googlesitekit_post_type=page&epn.offer_id=147340&ep.offer_title=Get%20Sam%27s%20trail%20notes&ep.surface=inline&ep.trigger=shortcode&tfd=7751';
const SIGNALS_PING = 'https://stats.g.doubleclick.net/g/collect?v=2&ngs=1&ibt=1&tid=G-SHOPDEMO42&cid=746406658.1791212460&gtm=45je69u2v878222536za200zd878222536xf1&rcb=9&aip=1&dma=0&gcs=G111&gcd=13r3r3r3r5l1&npa=0&frm=0';
const META_PAGEVIEW = 'https://www.facebook.com/tr/?id=246813579024680&ev=PageView&dl=https%3A%2F%2Fshop.example%2F&rl=&if=false&ts=1791212460000&sw=2560&sh=1440&v=2.9.170&r=stable&ec=0&o=4126&fbp=fb.1.1791212460000.123&cs_est=true&ler=empty&it=1791212459000&coo=false&rqm=GET';

// ---- GA4

test( 'GA4 page_view from shop.example', () => {
	const h = one( GA4_PAGE_VIEW );
	assert.strictEqual( h.vendor, 'google' );
	assert.strictEqual( h.kind, 'GA4' );
	assert.strictEqual( h.category, 'hit' );
	assert.strictEqual( h.id, 'G-SHOPDEMO42' );
	assert.strictEqual( h.event, 'page_view' );
	assert.strictEqual( h.params.dl, 'https://shop.example/' );
	for ( const s of PW.SIGNALS ) assert.strictEqual( h.consent[ s ].state, 'granted', s );
	assert.strictEqual( h.consent.ad_storage.how, 'denied by default, granted by update' );
	assert.deepStrictEqual( h.notes, [] );
} );

test( 'GA4 custom event summarises its event params', () => {
	const h = one( GA4_OFFER );
	assert.strictEqual( h.event, 'lead_offer_impression' );
	assert.ok( h.summary.includes( 'offer_id=147340' ), h.summary );
	assert.ok( h.summary.includes( "offer_title=Get Sam's trail notes" ), h.summary );
} );

test( 'Google Signals ping is a side-ping, not a hit', () => {
	const h = one( SIGNALS_PING );
	assert.strictEqual( h.category, 'aux' );
	assert.strictEqual( h.kind, 'GA4 → Google Signals' );
} );

test( 'GA4 batched beacon splits into one hit per event', () => {
	const hits = PW.classify( {
		url: 'https://region1.google-analytics.com/g/collect?v=2&tid=G-ABC123&gcs=G100&gcd=13p3p3p3p5l1&cid=1.2',
		method: 'POST',
		body: { text: 'en=scroll&epn.percent_scrolled=90\r\nen=user_engagement&_et=5123\r\n' },
	} );
	assert.strictEqual( hits.length, 2 );
	assert.deepStrictEqual( hits.map( h => h.event ), [ 'scroll', 'user_engagement' ] );
	assert.ok( hits.every( h => h.id === 'G-ABC123' ) );
	assert.strictEqual( hits[ 0 ].consent.analytics_storage.state, 'denied' );
	assert.ok( hits[ 0 ].notes.some( n => /cookieless/.test( n ) ), hits[ 0 ].notes.join( '|' ) );
	assert.ok( hits[ 0 ].notes.some( n => /Batched: one request carried 2 events/.test( n ) ) );
} );

test( 'GA4 through server-side GTM on a custom domain', () => {
	const h = one( 'https://sgtm.example.com/g/collect?v=2&tid=G-ABC123&en=page_view' );
	assert.strictEqual( h.kind, 'GA4 (server-side)' );
	assert.ok( /sgtm\.example\.com/.test( h.notes[ 0 ] ) );
	assert.strictEqual( PW.classify( { url: 'https://example.com/g/collect?foo=1' } ), null );
} );

test( 'GTM and gtag loads are scripts', () => {
	const g = one( 'https://www.googletagmanager.com/gtm.js?id=GTM-SHOP42X' );
	assert.deepStrictEqual( [ g.category, g.kind, g.id ], [ 'script', 'GTM container', 'GTM-SHOP42X' ] );
	const t = one( 'https://www.googletagmanager.com/gtag/js?id=G-SHOPDEMO42' );
	assert.deepStrictEqual( [ t.category, t.kind, t.id ], [ 'script', 'gtag.js', 'G-SHOPDEMO42' ] );
} );

// ---- Universal Analytics

test( 'Universal Analytics hit says it goes nowhere', () => {
	const h = one( 'https://www.google-analytics.com/collect?v=1&t=event&ec=Video&ea=play&tid=UA-123-1' );
	assert.strictEqual( h.kind, 'Universal Analytics' );
	assert.strictEqual( h.event, 'event / Video / play' );
	assert.ok( /July 2024/.test( h.notes[ 0 ] ) );
} );

// ---- Google Ads / Floodlight

test( 'Google Ads conversion with ads storage denied', () => {
	const h = one( 'https://www.googleadservices.com/pagead/conversion/123456789/?label=AbC-dEf&value=80&currency_code=AUD&oid=ORD-1&gcs=G101&gcd=13p3r3p3p5l1&npa=1' );
	assert.strictEqual( h.kind, 'Google Ads conversion' );
	assert.strictEqual( h.id, 'AW-123456789' );
	assert.strictEqual( h.event, 'conversion' );
	assert.strictEqual( h.summary, 'label=AbC-dEf · value=80 AUD · order=ORD-1' );
	assert.strictEqual( h.consent.ad_storage.state, 'denied' );
	assert.strictEqual( h.consent.analytics_storage.state, 'granted' );
	assert.ok( h.notes.some( n => /ad_storage denied/.test( n ) ) );
	assert.ok( h.notes.some( n => /npa=1/.test( n ) ) );
} );

test( 'Google Ads remarketing reads the event from data=', () => {
	const h = one( 'https://googleads.g.doubleclick.net/pagead/viewthroughconversion/123456789/?data=event%3Dpage_view%3Becomm_pagetype%3Dhome' );
	assert.strictEqual( h.kind, 'Google Ads remarketing' );
	assert.strictEqual( h.event, 'page_view' );
} );

test( '1p follow-ups on a country Google domain are side-pings', () => {
	const h = one( 'https://www.google.com.au/pagead/1p-user-list/123456789/?random=1' );
	assert.strictEqual( h.category, 'aux' );
	assert.strictEqual( h.id, 'AW-123456789' );
	const c = one( 'https://www.google.com/pagead/1p-conversion/123456789/?label=x' );
	assert.strictEqual( c.category, 'aux' );
} );

test( 'Google tag ccm/collect is a hit', () => {
	const h = one( 'https://www.google.com/ccm/collect?en=page_view&dl=https%3A%2F%2Fshop.example%2F&gcs=G111' );
	assert.strictEqual( h.category, 'hit' );
	assert.strictEqual( h.event, 'page_view' );
} );

test( 'Floodlight reads its semicolon params', () => {
	const h = one( 'https://ad.doubleclick.net/activity;src=1234567;type=sales;cat=purch0;ord=1;num=2?' );
	assert.strictEqual( h.kind, 'Floodlight' );
	assert.strictEqual( h.id, 'DC-1234567' );
	assert.strictEqual( h.event, 'sales/purch0' );
} );

// ---- Meta

test( 'Meta PageView', () => {
	const h = one( META_PAGEVIEW );
	assert.deepStrictEqual( [ h.vendor, h.kind, h.id, h.event, h.category ], [ 'meta', 'Meta Pixel', '246813579024680', 'PageView', 'hit' ] );
	assert.deepStrictEqual( h.notes, [] );
} );

test( 'Meta advanced matching and custom data', () => {
	const h = one( 'https://www.facebook.com/tr?id=1&ev=Lead&cd[content_name]=Newsletter&ud[em]=abc123&ud[ph]=def456' );
	assert.strictEqual( h.summary, 'content_name=Newsletter' );
	assert.ok( h.notes.includes( 'Advanced matching: sends hashed em, ph' ), h.notes.join( '|' ) );
} );

test( 'Meta POST with form data', () => {
	const h = one( 'https://www.facebook.com/tr/', { formData: { id: [ '246813579024680' ], ev: [ 'Purchase' ], 'cd[value]': [ '80' ], 'cd[currency]': [ 'AUD' ] } } );
	assert.strictEqual( h.event, 'Purchase' );
	assert.strictEqual( h.summary, 'value=80 · currency=AUD' );
} );

test( 'Meta automatic events are explained', () => {
	const h = one( 'https://www.facebook.com/tr/?id=1&ev=SubscribedButtonClick' );
	assert.ok( /Automatic event/.test( h.notes[ 0 ] ) );
} );

test( 'Meta scripts', () => {
	const c = one( 'https://connect.facebook.net/signals/config/246813579024680?v=2.9.170&r=stable' );
	assert.deepStrictEqual( [ c.category, c.kind, c.id ], [ 'script', 'Meta Pixel config', '246813579024680' ] );
	assert.strictEqual( one( 'https://connect.facebook.net/en_US/fbevents.js' ).kind, 'fbevents.js' );
} );

// ---- Segment

const segMsg = ( extra ) => Object.assign( {
	timestamp: '2026-10-05T15:23:27.068Z',
	integrations: {},
	context: {
		page: { path: '/pricing', referrer: '', search: '', title: 'Pricing', url: 'https://client.example/pricing' },
		userAgent: 'Mozilla/5.0', locale: 'en-US', library: { name: 'analytics.js', version: 'next-1.84.3' },
		timezone: 'America/New_York',
	},
	messageId: 'ajs-next-1791213807068-abc',
	anonymousId: 'anon-123',
	writeKey: 'WRITEKEY123',
	userId: null,
	sentAt: '2026-10-05T15:23:27.072Z',
	_metadata: { bundled: [ 'Segment.io' ], unbundled: [], bundledIds: [] },
}, extra );
const segBody = obj => ( { text: JSON.stringify( obj ) } );

test( 'Segment track', () => {
	const h = one( 'https://api.segment.io/v1/t', segBody( segMsg( { type: 'track', event: 'Signed Up', properties: { plan: 'pro', value: 49 } } ) ) );
	assert.deepStrictEqual( [ h.vendor, h.kind, h.category, h.id, h.event ], [ 'segment', 'Segment', 'hit', 'WRITEKEY123', 'Signed Up' ] );
	assert.strictEqual( h.summary, 'plan=pro · value=49' );
	assert.strictEqual( h.params[ 'properties.plan' ], 'pro' );
	assert.strictEqual( h.params[ 'context.page.url' ], 'https://client.example/pricing' );
	assert.strictEqual( h.params.userId, 'null' );
	assert.strictEqual( h.params.integrations, '{}' );
	assert.strictEqual( h.params[ '_metadata.bundled' ], '["Segment.io"]' );
	assert.strictEqual( h.needs, 'analytics_storage' );
} );

test( 'Segment page names the page and hides the standard page props', () => {
	const h = one( 'https://api.segment.io/v1/p', segBody( segMsg( {
		type: 'page', name: 'Pricing', category: 'Docs',
		properties: { path: '/pricing', referrer: '', search: '', title: 'Pricing', url: 'https://client.example/pricing', name: 'Pricing', category: 'Docs', variant: 'b' },
	} ) ) );
	assert.strictEqual( h.event, 'page: Pricing' );
	assert.strictEqual( h.summary, 'variant=b' );
} );

test( 'Segment identify flags unhashed traits', () => {
	const h = one( 'https://api.segment.io/v1/i', segBody( segMsg( { type: 'identify', userId: 'u_42', traits: { email: 'a@b.co', plan: 'pro' } } ) ) );
	assert.strictEqual( h.event, 'identify' );
	assert.strictEqual( h.summary, 'userId=u_42 · email=a@b.co · plan=pro' );
	assert.ok( h.notes.includes( 'Sends user traits unhashed: email, plan' ), h.notes.join( '|' ) );
} );

test( 'Segment consent stamp is shown and skips the page check', () => {
	const h = one( 'https://api.segment.io/v1/t', segBody( segMsg( {
		type: 'track', event: 'Clicked',
		context: { consent: { categoryPreferences: { Analytics: true, Advertising: false } } },
	} ) ) );
	assert.ok( h.notes.includes( 'Consent sent with the event: Analytics ✓, Advertising ✗' ), h.notes.join( '|' ) );
	assert.strictEqual( h.needs, null );
} );

test( 'Segment batch on the EU endpoint splits into one hit per message', () => {
	const hits = PW.classify( {
		url: 'https://events.eu1.segmentapis.com/v1/batch', method: 'POST',
		body: segBody( { writeKey: 'EUKEY', sentAt: 'x', batch: [
			{ type: 'track', event: 'A', properties: {} },
			{ type: 'page', name: 'Home', properties: {} },
		] } ),
	} );
	assert.deepStrictEqual( hits.map( h => h.event ), [ 'A', 'page: Home' ] );
	assert.ok( hits.every( h => h.id === 'EUKEY' ) );
	assert.ok( hits[ 0 ].notes.includes( 'Batched: one request carried 2 events' ) );
} );

test( 'Segment with an unreadable body still counts', () => {
	const h = one( 'https://api.segment.io/v1/t' );
	assert.strictEqual( h.event, 'track' );
	assert.strictEqual( h.vendor, 'segment' );
} );

test( 'Segment scripts and side-pings', () => {
	const a = one( 'https://cdn.segment.com/analytics.js/v1/WRITEKEY123/analytics.min.js' );
	assert.deepStrictEqual( [ a.category, a.kind, a.id ], [ 'script', 'Segment analytics.js', 'WRITEKEY123' ] );
	const st = one( 'https://cdn.segment.com/v1/projects/WRITEKEY123/settings' );
	assert.deepStrictEqual( [ st.kind, st.id ], [ 'Segment settings', 'WRITEKEY123' ] );
	const d = one( 'https://cdn.segment.com/next-integrations/actions/google-analytics-4-web/abc123.js' );
	assert.deepStrictEqual( [ d.kind, d.id ], [ 'Segment destination code', 'google-analytics-4-web' ] );
	assert.strictEqual( one( 'https://cdn.segment.com/analytics-next/bundles/ajs-destination.bundle.40628baed746e9904edc.js' ).kind, 'Segment library' );
	assert.strictEqual( one( 'https://api.segment.io/v1/m' ).category, 'aux' );
} );

test( 'Segment labels are vendor-aware', () => {
	assert.strictEqual( PW.label( 'type', 'segment' ), 'call type' );
	assert.strictEqual( PW.label( 'type' ), 'Floodlight group' );
	assert.strictEqual( PW.label( 'properties.plan', 'segment' ), 'property' );
	const keys = PW.sortedKeys( { '_metadata.bundled': 1, 'context.page.url': 1, anonymousId: 1, 'properties.plan': 1, event: 1, type: 1 } );
	assert.deepStrictEqual( keys, [ 'type', 'event', 'properties.plan', 'anonymousId', 'context.page.url', '_metadata.bundled' ] );
} );

// ---- Every other tool (vendors.js). URLs and bodies are real requests
// captured from live sites, IDs and all; a few bodies are trimmed.

const J = o => ( { text: JSON.stringify( o ) } );
const F = o => ( { formData: Object.fromEntries( Object.entries( o ).map( ( [ k, v ] ) => [ k, [ v ] ] ) ) } );
const b64 = o => Buffer.from( JSON.stringify( o ) ).toString( 'base64' );

// [ url, body, expected first hit: v vendor, c category, e event, id, n hit count ]
const VENDOR_CASES = [
	// Ad pixels
	[ 'https://analytics.tiktok.com/api/v2/pixel', J( { event: 'LandingPageView', context: { pixel: { code: 'C97F14JC77U63IDI7U40' }, user: { anonymous_id: 'a', email: 'hash' } }, properties: { value: 1 } } ), { v: 'tiktok', c: 'hit', e: 'LandingPageView', id: 'C97F14JC77U63IDI7U40' } ],
	[ 'https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=C97F14JC77U63IDI7U40&lib=ttq', null, { v: 'tiktok', c: 'script', id: 'C97F14JC77U63IDI7U40' } ],
	[ 'https://px.ads.linkedin.com/collect?v=2&fmt=js&pid=3346164&time=1&url=https%3A%2F%2Fforbusiness.snapchat.com%2F', null, { v: 'linkedin', c: 'hit', e: 'page view', id: '3346164' } ],
	[ 'https://px.ads.linkedin.com/collect/?pid=3127001&conversionId=8105412&fmt=gif', null, { v: 'linkedin', e: 'conversion', id: '3127001' } ],
	[ 'https://snap.licdn.com/li.lms-analytics/insight.min.js', null, { v: 'linkedin', c: 'script' } ],
	[ 'https://www.linkedin.com/px/li_sync?redirect=x', null, { v: 'linkedin', c: 'aux' } ],
	[ 'https://bat.bing.com/action/0?ti=26101359&tm=gtm002&Ver=2&evt=page&p=https%3A%2F%2Fforbusiness.snapchat.com%2F', null, { v: 'microsoft', c: 'hit', e: 'page view', id: '26101359' } ],
	[ 'https://bat.bing.com/actionp/0?ti=52012471&tm=gtm002&Ver=2&evt=consent&src=update&cdb=AQER&asc=G', null, { v: 'microsoft', c: 'aux' } ],
	[ 'https://bat.bing.com/p/action/26101359.js', null, { v: 'microsoft', c: 'script', id: '26101359' } ],
	[ 'https://ct.pinterest.com/v3/?tid=2612733222301&event=init&ad=%7B%22loc%22%3A%22https%3A%2F%2Fskims.com%2F%22%7D&cb=1', null, { v: 'pinterest', c: 'aux' } ],
	[ 'https://ct.pinterest.com/v3/?tid=2612733222301&event=checkout&ed=%7B%22value%22%3A%2280%22%2C%22currency%22%3A%22USD%22%7D', null, { v: 'pinterest', c: 'hit', e: 'checkout', id: '2612733222301' } ],
	[ 'https://tr.snapchat.com/p?pid=6e8044a0-9669-417b-8667-cfd1d4c37f5d&ev=PAGE_VIEW&intg=gtm', null, { v: 'snapchat', c: 'hit', e: 'PAGE_VIEW', id: '6e8044a0-9669-417b-8667-cfd1d4c37f5d' } ],
	[ 'https://tr6.snapchat.com/p', J( { ctx: { url: 'u' }, req: [ { i: { pids: [ '04b21810' ] }, del: 1003 } ] } ), { v: 'snapchat', c: 'aux' } ],
	[ 'https://sc-static.net/scevent.min.js', null, { v: 'snapchat', c: 'script' } ],
	[ 'https://tr.snapchat.com/p', J( { ctx: {}, req: [ { t: { pid: '301bc76a-867d-419a-afb1-1ce91680f333', ev: 'PAGE_VIEW', intg: 'blotout' } }, { i: { pids: [ '301bc76a' ] } } ] } ), { v: 'snapchat', c: 'hit', e: 'PAGE_VIEW', id: '301bc76a-867d-419a-afb1-1ce91680f333' } ],
	[ 'https://tr.snapchat.com/p', J( { ctx: {}, req: [ { log: { name: 'SB', message: '' } } ] } ), { v: 'snapchat', c: 'aux' } ],
	[ 'https://analytics.tiktok.com/api/v2/pixel/act', J( { action: 'Metadata', auto_collected_properties: { page_trigger: 'PageView' }, context: { pixel: { code: 'D0ME9HRC77U2LS75RJCG' } } } ), { v: 'tiktok', c: 'hit', e: 'Metadata (PageView)', id: 'D0ME9HRC77U2LS75RJCG' } ],
	[ 'https://secure.adnxs.com/px?id=1234&t=2', null, { v: 'xandr', c: 'hit', e: 'conversion', id: '1234' } ],
	[ 'https://ib.adnxs.com/getuid?https://dis.criteo.com/x', null, { v: 'xandr', c: 'aux' } ],
	[ 'https://pixel.quantserve.com/pixel/p-QEZzGPnZe_xCx.gif?labels=x', null, { v: 'quantcast', c: 'hit', e: 'page view', id: 'p-QEZzGPnZe_xCx' } ],
	[ 'https://rules.quantcount.com/rules-p-QEZzGPnZe_xCx.js', null, { v: 'quantcast', c: 'script', id: 'p-QEZzGPnZe_xCx' } ],
	[ 'https://allbirds.pxf.io/xc/2871871/1080123/13831', F( { _ir: 'U54||1|2d', landurl: 'https://www.allbirds.com/' } ), { v: 'impact', c: 'hit', e: 'visit', id: '2871871' } ],
	[ 'https://utt.impactcdn.com/A2840043-f763-41d9-b989-637b09feea141.js', null, { v: 'impact', c: 'script' } ],
	[ 'https://j.northbeam.io/vendor/nb-sp.min.js', null, { v: 'northbeam', c: 'script' } ],
	[ 'https://analytics.twitter.com/i/adsctp', F( { events: '[["pageview",{}]]', txn_id: 'o7kth', tw_sale_amount: '0' } ), { v: 'x', c: 'hit', e: 'pageview', id: 'o7kth' } ],
	[ 'https://analytics.x.com/1/i/adsctp', F( { event: '{}', txn_id: 'num2q' } ), { v: 'x', c: 'hit', e: 'page view', id: 'num2q' } ],
	[ 'https://t.co/1/i/adsctp', F( { event: '{}', txn_id: 'num2q' } ), { v: 'x', c: 'aux' } ],
	[ 'https://alb.reddit.com/rp.gif?ts=1&id=t2_b4kw4fzh&event=PageVisit&m.itemCount=&m.value=', null, { v: 'reddit', c: 'hit', e: 'PageVisit', id: 't2_b4kw4fzh' } ],
	[ 'https://alb.reddit.com/rp?id=a2_j892kaf0wxc6&event=Custom', F( { 'm.customEventName': 'Signup', 'm.value': '' } ), { v: 'reddit', e: 'Signup' } ],
	[ 'https://www.redditstatic.com/ads/pixel.js?pixel_id=a2_j892kaf0wxc6', null, { v: 'reddit', c: 'script', id: 'a2_j892kaf0wxc6' } ],
	[ 'https://q.quora.com/_/ad/ffa67ce8aa1a4f80b24619dfebd91bec/pixel?tag=ViewContent&i=gtm', null, { v: 'quora', c: 'hit', e: 'ViewContent', id: 'ffa67ce8aa1a4f80b24619dfebd91bec' } ],
	[ 'https://pixels.spotify.com/v1/ingest', J( { batch: [ { pid: '788901d7db0b41b78306a2872a6bbbc4', events: [ { action: 'view', body: { url: 'u' } } ] } ] } ), { v: 'spotify', c: 'hit', e: 'view', id: '788901d7db0b41b78306a2872a6bbbc4' } ],
	[ 'https://s.amazon-adsystem.com/iu3?pid=1b3cf6ff-9fc9-4499-813a-12e87e83751e&event=PageView&gtmVersion=3.4', null, { v: 'amazon', c: 'hit', e: 'PageView' } ],
	[ 'https://aax-eu.amazon-adsystem.com/s/iu3?pid=b69567c1&event=PageView', null, { v: 'amazon', c: 'hit' } ],
	[ 'https://sslwidget.criteo.com/event?a=12345&v=5.23.0&p0=e%3Dexd%26site_type%3Dd&p1=e%3Dvh&p2=e%3Dvh&p3=e%3Ddis', null, { v: 'criteo', c: 'hit', e: 'viewHome', id: '12345' } ],
	[ 'https://insight.adsrvr.org/track/pxl/?adv=0h0ik7r&ct=0:pazrbdr&fmt=3', null, { v: 'ttd', c: 'hit', e: 'conversion', id: '0h0ik7r' } ],
	[ 'https://match.adsrvr.org/track/cmf/generic?ttd_pid=vxsrv3i&ttd_tpi=1', null, { v: 'ttd', c: 'aux' } ],
	[ 'https://tags.srv.stackadapt.com/saq_pxl?uid=7MBVbwhh1j9tcRrjPEqfIw&is_js=true', null, { v: 'stackadapt', c: 'hit', e: 'page view', id: '7MBVbwhh1j9tcRrjPEqfIw' } ],
	[ 'https://d.adroll.com/pixel/RUQAFPWNWZHLFCRPB4GQJ6/FMKQFSM6T5FS7PYP72Y7BW?af0=e4a5a768', null, { v: 'adroll', c: 'hit', e: 'page view', id: 'RUQAFPWNWZHLFCRPB4GQJ6' } ],
	[ 'https://d.adroll.com/pex/RUQAFPWNWZHLFCRPB4GQJ6/FMKQFSM6T5FS7PYP72Y7BW?ev=chktcf', null, { v: 'adroll', c: 'aux' } ],
	[ 'https://us.creativecdn.com/tags/v2?type=json', J( { th: 'eUCQernNGGvdlKl1D5sc', tags: [ { eventType: 'home' }, { eventType: 'uid', id: 'unknown' } ] } ), { v: 'rtbhouse', c: 'hit', e: 'home', id: 'eUCQernNGGvdlKl1D5sc' } ],
	[ 'https://trc.taboola.com/1234567/log/3/unip?en=page_view', null, { v: 'taboola', c: 'hit', e: 'page_view', id: '1234567' } ],
	[ 'https://tr.outbrain.com/unifiedPixel?marketerId=00abc&obApiVersion=1.1&name=PAGE_VIEW', null, { v: 'outbrain', c: 'hit', e: 'PAGE_VIEW', id: '00abc' } ],
	// Analytics
	[ 'https://smetrics.client.example/b/ss/clientprod/1/JS-2.22.0/s123?AQB=1&pageName=home&events=event1&AQE=1', null, { v: 'adobe', c: 'hit', e: 'page view: home', id: 'clientprod' } ],
	[ 'https://client.sc.omtrdc.net/b/ss/clientprod/1/JS-2.22.0/s9?AQB=1&pe=lnk_o&pev2=Signup&AQE=1', null, { v: 'adobe', e: 'link: Signup' } ],
	[ 'https://edge.adobedc.net/ee/v1/interact?configId=5651875a&requestId=x', J( { events: [ { xdm: { eventType: 'web.webpagedetails.pageViews', web: { webPageDetails: { name: 'home' } } } } ] } ), { v: 'adobe', c: 'hit', e: 'web.webpagedetails.pageViews', id: '5651875a' } ],
	[ 'https://data.client.example/ee/va6/v1/interact?configId=abc', J( { events: [ { xdm: { eventType: 'decisioning.propositionDisplay' } } ] } ), { v: 'adobe', e: 'decisioning.propositionDisplay' } ],
	[ 'https://assets.adobedtm.com/38aee39cc23f/1468c748dfc1/launch-a653f5a3fe63.min.js', null, { v: 'adobe', c: 'script', id: '38aee39cc23f/1468c748dfc1' } ],
	[ 'https://twilio.tt.omtrdc.net/rest/v1/delivery?client=twilio', null, { v: 'adobe', c: 'aux' } ],
	[ 'https://api.eu.amplitude.com/2/httpapi', J( { api_key: 'd1a1', events: [ { event_type: '$identify' }, { event_type: 'Page Viewed', event_properties: { path: '/' } } ] } ), { v: 'amplitude', c: 'hit', e: '$identify', id: 'd1a1', n: 2 } ],
	[ 'https://api-js.mixpanel.com/track/?ip=1', F( { data: JSON.stringify( { event: '$opt_in', properties: { token: 'metrics-1', distinct_id: 'x', plan: 'pro' } } ) } ), { v: 'mixpanel', c: 'hit', e: '$opt_in', id: 'metrics-1' } ],
	[ 'https://api-js.mixpanel.com/track/?ip=1', F( { data: b64( [ { event: 'Signed Up', properties: { token: 't' } }, { event: 'Clicked', properties: { token: 't' } } ] ) } ), { v: 'mixpanel', e: 'Signed Up', n: 2 } ],
	[ 'https://api-js.mixpanel.com/flags/?token=metrics-1', null, { v: 'mixpanel', c: 'aux' } ],
	[ 'https://heapanalytics.com/h?a=236035469&u=1&h=%2F&t=Heap', null, { v: 'heap', c: 'hit', e: 'pageview', id: '236035469' } ],
	[ 'https://c.us.heap-api.com/api/capture/v2/track', { text: '\u0000binary' }, { v: 'heap', c: 'hit', e: 'track' } ],
	[ 'https://cdn.heapanalytics.com/js/heap-236035469.js', null, { v: 'heap', c: 'script', id: '236035469' } ],
	[ 'https://us.i.posthog.com/e/?ver=1', J( { event: '$pageview', properties: { token: 'phc_x', distinct_id: 'd', plan: 'pro' } } ), { v: 'posthog', c: 'hit', e: '$pageview', id: 'phc_x' } ],
	[ 'https://eu.i.posthog.com/batch/', J( { api_key: 'phc_y', batch: [ { event: 'a', properties: {} }, { event: 'b', properties: {} } ] } ), { v: 'posthog', e: 'a', id: 'phc_y', n: 2 } ],
	[ 'https://us.i.posthog.com/decide/?v=3', null, { v: 'posthog', c: 'aux' } ],
	[ 'https://demo-web.matomo.org/piwik.php?action_name=Matomo&idsite=12&rec=1&url=https%3A%2F%2Fmatomo.org%2F', F( {} ), { v: 'matomo', c: 'hit', e: 'pageview', id: '12' } ],
	[ 'https://stats.client.example/matomo.php?idsite=3&rec=1&e_c=Video&e_a=Play', null, { v: 'matomo', e: 'event: Video / Play', id: '3' } ],
	[ 'https://stats.client.example/matomo.php', J( { requests: [ '?idsite=3&rec=1&action_name=A', '?idsite=3&rec=1&ping=1' ] } ), { v: 'matomo', c: 'hit', n: 2 } ],
	[ 'https://cdn.matomo.cloud/demo-web.matomo.org/container_bugnCohE.js', null, { v: 'matomo', c: 'script' } ],
	[ 'https://plausible.io/api/event', J( { n: 'pageview', u: 'https://client.example/', d: 'client.example', r: null } ), { v: 'plausible', c: 'hit', e: 'pageview', id: 'client.example' } ],
	[ 'https://client.example/api/event', J( { n: 'Signup', u: 'https://client.example/', d: 'client.example', p: '{"plan":"pro"}' } ), { v: 'plausible', e: 'Signup' } ],
	[ 'https://plausible.io/js/pa-6_srOGVV9SLMWJ1ZpUAbG.js', null, { v: 'plausible', c: 'script', id: 'pa-6_srOGVV9SLMWJ1ZpUAbG' } ],
	[ 'https://sb.scorecardresearch.com/b?c1=2&c2=18896682&ns_site=x', null, { v: 'comscore', c: 'hit', e: 'page view', id: '18896682' } ],
	[ 'https://quick-esteemed.usefathom.com/?h=https%3A%2F%2Fusefathom.com&p=%2F&r=&sid=ABCDEF&qs=%7B%7D', null, { v: 'fathom', c: 'hit', e: 'pageview', id: 'ABCDEF' } ],
	// Session replay
	[ 'https://static.hotjar.com/c/hotjar-5212309.js?sv=7', null, { v: 'hotjar', c: 'script', id: '5212309' } ],
	[ 'wss://ws.hotjar.com/api/v2/client/ws?v=7&site_id=5212309', null, { v: 'hotjar', c: 'hit', e: 'live session stream', id: '5212309' } ],
	[ 'https://content.hotjar.io/?site_id=5212309&gzip=1', null, { v: 'hotjar', c: 'hit', e: 'page snapshot' } ],
	[ 'https://vc.hotjar.io/sessions/5212309?s=0.25', null, { v: 'hotjar', c: 'aux' } ],
	[ 'https://static.hj.contentsquare.net/c/hotjar-5204814.js', null, { v: 'hotjar', c: 'script', id: '5204814' } ],
	[ 'https://www.clarity.ms/tag/kxdc4874py', null, { v: 'clarity', c: 'script', id: 'kxdc4874py' } ],
	[ 'https://www.clarity.ms/tag/uet/26101359?conversions=1', null, { v: 'clarity', c: 'script', id: '26101359' } ],
	[ 'https://www.clarity.ms/eus2-j/collect', { text: 'x' }, { v: 'clarity', c: 'hit', e: 'session recording' } ],
	[ 'https://c.clarity.ms/c.gif', null, { v: 'clarity', c: 'aux' } ],
	[ 'https://edge.fullstory.com/s/fs.js', null, { v: 'fullstory', c: 'script' } ],
	[ 'https://rs.fullstory.com/rec/page', J( { OrgId: 'o-22BMFZ-na1', Url: 'https://forbusiness.snapchat.com/' } ), { v: 'fullstory', c: 'hit', e: 'page start', id: 'o-22BMFZ-na1' } ],
	[ 'https://rs.fullstory.com/rec/bundle/v2?OrgId=o-22BMFZ-na1&UserId=1', null, { v: 'fullstory', e: 'session recording' } ],
	[ 'https://t.contentsquare.net/uxa/355d5ac78f8a5.js', null, { v: 'contentsquare', c: 'script', id: '355d5ac78f8a5' } ],
	[ 'https://c.contentsquare.net/pageview?pid=4451&url=https%3A%2F%2Fwww.adobe.com%2F', null, { v: 'contentsquare', c: 'hit', e: 'pageview', id: '4451' } ],
	[ 'https://k-aeu1.contentsquare.net/v2/recording?rt=5&pid=276', { text: 'x' }, { v: 'contentsquare', e: 'session recording', id: '276' } ],
	[ 'https://script.crazyegg.com/pages/scripts/0123/8463.js', null, { v: 'crazyegg', c: 'script', id: '01238463' } ],
	[ 'https://cdn.quantummetric.com/qscripts/quantum-skims.js', null, { v: 'quantummetric', c: 'script', id: 'skims' } ],
	[ 'https://ingest.quantummetric.com/horizon/skims?T=B&u=https%3A%2F%2Fskims.com%2F', { text: 'x' }, { v: 'quantummetric', c: 'hit', id: 'skims' } ],
	// CDPs
	[ 'https://www.rudderstack.com/rsdataplane/beacon/v1/batch?writeKey=1pzVfDB9gw7TG2NtfqzQ55H10Ef', J( { batch: [ { type: 'page', name: 'Home', properties: { url: 'u', path: '/' } } ] } ), { v: 'rudderstack', c: 'hit', e: 'page: Home', id: '1pzVfDB9gw7TG2NtfqzQ55H10Ef' } ],
	[ 'https://acme.dataplane.rudderstack.com/v1/track', J( { type: 'track', event: 'Signed Up', properties: { plan: 'pro' } } ), { v: 'rudderstack', e: 'Signed Up' } ],
	[ 'https://jssdks.mparticle.com/v3/JS/eu1-ebd2cad076757c498ce604d818b0d8ae/events', J( { events: [ { event_type: 'session_start', data: {} }, { event_type: 'custom_event', data: { event_name: 'Add To Cart', custom_attributes: { sku: '1' } } } ] } ), { v: 'mparticle', c: 'hit', e: 'session_start', id: 'eu1-ebd2cad076757c498ce604d818b0d8ae', n: 2 } ],
	[ 'https://identity.mparticle.com/v1/identify', J( { known_identities: { email: 'a@b.co', device_application_stamp: 'x' } } ), { v: 'mparticle', c: 'hit', e: 'identify' } ],
	[ 'https://tags.tiqcdn.com/utag/tealium/main/prod/utag.js', null, { v: 'tealium', c: 'script', id: 'tealium/main (prod)' } ],
	[ 'https://collect.tealiumiq.com/event', J( { tealium_account: 'acme', tealium_profile: 'main', tealium_event: 'page_view' } ), { v: 'tealium', c: 'hit', e: 'page_view', id: 'acme/main' } ],
	// Marketing automation
	[ 'https://track.hubspot.com/__ptq.gif?k=1&a=19922862&t=Reach+your+customers', null, { v: 'hubspot', c: 'hit', e: 'page view', id: '19922862' } ],
	[ 'https://track-eu1.hubspot.com/__ptq.gif?k=1&a=143535613', null, { v: 'hubspot', c: 'hit', id: '143535613' } ],
	[ 'https://js.hs-scripts.com/19922862.js', null, { v: 'hubspot', c: 'script', id: '19922862' } ],
	[ 'https://forms.hscollectedforms.net/collected-forms/submit/form', J( { portalId: 1 } ), { v: 'hubspot', c: 'hit', e: 'collected form submission' } ],
	[ 'https://cta-na2.hubspot.com/web-interactives/public/v1/track/view?portalId=49161888', null, { v: 'hubspot', c: 'hit', e: 'CTA view', id: '49161888' } ],
	[ 'https://294-tkb-300.mktoresp.com/webevents/visitWebPage?_mchNc=1&_mchId=294-TKB-300&_mchHo=www.twilio.com', F( {} ), { v: 'marketo', c: 'hit', e: 'page visit', id: '294-TKB-300' } ],
	[ 'https://munchkin.marketo.net/165/munchkin.js', null, { v: 'marketo', c: 'script' } ],
	[ 'https://app-ab48.marketo.com/js/forms2/js/forms2.min.js', null, { v: 'marketo', c: 'script', id: 'app-ab48' } ],
	[ 'https://cdn.bizible.com/ipv?_biz_u=53da&_biz_l=https%3A%2F%2Fwww.thetradedesk.com%2F', null, { v: 'bizible', c: 'hit', e: 'page view' } ],
	[ 'https://pi.pardot.com/analytics?ver=3&account_id=123&title=Home', null, { v: 'pardot', c: 'hit', e: 'page view', id: '123' } ],
	[ 'https://static.klaviyo.com/onsite/js/klaviyo.js?company_id=XkHHQx', null, { v: 'klaviyo', c: 'script', id: 'XkHHQx' } ],
	[ 'https://a.klaviyo.com/client/events/?company_id=XkHHQx', J( { data: { type: 'event', attributes: { metric: { data: { type: 'metric', attributes: { name: 'Active on Site' } } }, properties: { page: 'u' }, profile: { data: { type: 'profile', attributes: { email: 'a@b.co' } } } } } } ), { v: 'klaviyo', c: 'hit', e: 'Active on Site', id: 'XkHHQx' } ],
	[ 'https://a.klaviyo.com/api/track?data=' + encodeURIComponent( b64( { token: 'pk_1', event: 'Viewed Product', properties: { sku: '1' } } ) ), null, { v: 'klaviyo', e: 'Viewed Product', id: 'pk_1' } ],
	[ 'https://cdn.attn.tv/fashionnova/dtag.js', null, { v: 'attentive', c: 'script', id: 'fashionnova' } ],
	[ 'https://fashionnova-us.attn.tv/d?attn_vid=3146', null, { v: 'attentive', c: 'aux' } ],
	[ 'https://track.customer.io/events/page.gif?name=%2F&s=abc', null, { v: 'customerio', c: 'hit', e: 'page: /' } ],
	// B2B
	[ 'https://b.6sc.co/v1/beacon/img.gif?token=cd4ba9100b4470e1dde33ce034e651c7&event=a_pageload', null, { v: '6sense', c: 'hit', e: 'a_pageload' } ],
	[ 'https://epsilon.6sense.com/v3/company/details', null, { v: '6sense', c: 'hit', e: 'company lookup' } ],
	[ 'https://api.company-target.com/api/v3/ip.json?referrer=&page=x', J( { src: 'tag', auth: 'a' } ), { v: 'demandbase', c: 'hit', e: 'company lookup' } ],
	[ 'https://et.company-target.com/events/', J( { type: 'experience_fired' } ), { v: 'demandbase', e: 'experience_fired' } ],
	[ 'https://ws.zoominfo.com/pixel/eMjcrweMP12ixywHjML2', null, { v: 'zoominfo', c: 'hit', e: 'WebSights visit', id: 'eMjcrweMP12ixywHjML2' } ],
	[ 'https://ws.zoominfo.com/formcomplete-v2/forms', J( { url: 'u' } ), { v: 'zoominfo', c: 'aux' } ],
	[ 'https://reveal.clearbit.com/v1/companies/reveal?authorization=pk_b6ba', null, { v: 'clearbit', c: 'hit', e: 'company lookup' } ],
	[ 'https://tag.clearbitscripts.com/v1/pk_0ff2488f59791c47711ae8173845dff6/tags.js', null, { v: 'clearbit', c: 'script', id: 'pk_0ff2488f59791c47711ae8173845dff6' } ],
	[ 'https://tracking-api.g2.com/attribution_tracking/conversions/assign', F( { sid: '1399', p: 'https://www.criteo.com/' } ), { v: 'g2', c: 'hit', e: 'buyer intent visit', id: '1399' } ],
];

test( 'every vendor case classifies as captured, and is listened for', () => {
	const bad = [];
	for ( const [ url, body, x ] of VENDOR_CASES ) {
		const hits = PW.classify( { url, method: body ? 'POST' : 'GET', body } );
		const h = hits && hits[ 0 ];
		const got = h ? { v: h.vendor, c: h.category, e: h.event, id: h.id, n: hits.length } : null;
		const want = Object.assign( { c: got && got.c, e: got && got.e, id: got && got.id, n: got && got.n }, x );
		if ( ! got || [ 'v', 'c', 'e', 'id', 'n' ].some( k => want[ k ] !== got[ k ] ) ) bad.push( url.slice( 0, 90 ) + '\n      want ' + JSON.stringify( want ) + '\n      got  ' + JSON.stringify( got ) );
		if ( ! listened( url ) ) bad.push( 'not listened: ' + url );
		if ( ! PW.listened( url ) ) bad.push( 'PW.listened disagrees: ' + url );
	}
	assert.ok( ! bad.length, bad.join( '\n    ' ) );
} );

test( 'vendor hits carry the consent signal they need', () => {
	const need = url => PW.classify( { url } )[ 0 ].needs;
	assert.strictEqual( need( 'https://ct.pinterest.com/v3/?tid=1&event=pagevisit' ), 'ad_storage' );
	assert.strictEqual( need( 'https://heapanalytics.com/h?a=1' ), 'analytics_storage' );
	assert.strictEqual( need( 'https://www.clarity.ms/eus2-j/collect' ), 'analytics_storage' );
	// Scripts and side-pings never get a consent check.
	assert.strictEqual( PW.classify( { url: 'https://static.hotjar.com/c/hotjar-1.js' } )[ 0 ].needs, undefined );
} );

test( 'Microsoft UET reads its own consent flag', () => {
	const h = PW.classify( { url: 'https://bat.bing.com/action/0?ti=1&evt=custom&ea=purchase&gv=10&asc=D' } )[ 0 ];
	assert.strictEqual( h.event, 'purchase' );
	assert.strictEqual( h.consent.ad_storage.state, 'denied' );
	assert.strictEqual( h.needs, null );
	assert.ok( /without cookies/.test( h.notes[ 0 ] ) );
	assert.strictEqual( h.summary, 'gv=10' );
} );

test( 'vendor notes: advanced matching, emails, lookups, collected forms', () => {
	const tiktok = PW.classify( { url: VENDOR_CASES[ 0 ][ 0 ], body: VENDOR_CASES[ 0 ][ 1 ] } )[ 0 ];
	assert.ok( tiktok.notes.includes( 'Advanced matching: sends hashed email' ), tiktok.notes.join( '|' ) );
	const kl = VENDOR_CASES.find( c => c[ 0 ].includes( 'client/events' ) );
	assert.ok( PW.classify( { url: kl[ 0 ], body: kl[ 1 ] } )[ 0 ].notes[ 0 ].includes( 'email' ) );
	const mp = VENDOR_CASES.find( c => c[ 0 ].includes( 'identity.mparticle' ) );
	assert.deepStrictEqual( PW.classify( { url: mp[ 0 ], body: mp[ 1 ] } )[ 0 ].notes, [ 'Sends identities: email' ] );
	assert.ok( /company/.test( PW.classify( { url: 'https://epsilon.6sense.com/v3/company/details' } )[ 0 ].notes[ 0 ] ) );
	assert.ok( /non-HubSpot/.test( PW.classify( { url: 'https://forms.hscollectedforms.net/collected-forms/submit/form' } )[ 0 ].notes[ 0 ] ) );
	const rs = PW.classify( { url: VENDOR_CASES.find( c => c[ 0 ].includes( 'rsdataplane' ) )[ 0 ], body: VENDOR_CASES.find( c => c[ 0 ].includes( 'rsdataplane' ) )[ 1 ] } )[ 0 ];
	assert.ok( /proxied/.test( rs.notes[ 0 ] ), rs.notes.join( '|' ) );
} );

test( 'Google tag gateway and server-side GTM on the site\'s own paths', () => {
	const ga = 'https://6sense.com/pntd/ag/g/c?v=2&tid=G-Q57CXMB28P&gtm=45g92e69u2v871577823&gcs=G111&gcd=13v3v3v3v5l1&en=page_view';
	const h = PW.classify( { url: ga } )[ 0 ];
	assert.deepStrictEqual( [ h.vendor, h.kind, h.event, h.id ], [ 'google', 'GA4 (server-side)', 'page_view', 'G-Q57CXMB28P' ] );
	assert.strictEqual( PW.listened( ga ), false, 'reaches us through the catch-all listener' );
	const ads = PW.classify( { url: 'https://6sense.com/pntd/g/d/ccm/conversion/969809790/?random=1&en=conversion&gtm=45892e69&gcs=G111&gcd=13v3v3v3v5l1' } )[ 0 ];
	assert.deepStrictEqual( [ ads.kind, ads.id ], [ 'Google Ads (server-side)', 'AW-969809790' ] );
	const sgtm = PW.classify( { url: 'https://www.tiktok.com/sgtm/g/collect?v=2&tid=G-HV1FL86553&gtm=45je&en=page_view' } )[ 0 ];
	assert.strictEqual( sgtm.kind, 'GA4 (server-side)' );
} );

test( 'preflights and lookalikes are ignored', () => {
	assert.strictEqual( PW.classify( { url: 'https://api.segment.io/v1/t', method: 'OPTIONS' } ), null );
	assert.strictEqual( PW.classify( { url: 'https://ingest.quantummetric.com/horizon/d', method: 'HEAD' } ), null );
	assert.deepStrictEqual( PW.classify( { url: 'https://example.com/api/event', method: 'POST', body: J( { foo: 1 } ) } ), [] );
	for ( const url of [ 'https://www.tiktok.com/@someone', 'https://www.linkedin.com/feed/', 'https://www.reddit.com/r/marketing/', 'https://www.pinterest.com/', 'https://x.com/home', 'https://posthog.com/', 'https://usefathom.com/', 'https://www.mouseflow.com/' ] ) {
		assert.strictEqual( PW.classify( { url } ), null, url );
	}
} );

test( 'probe.js reads the same consent signals as rules.js', () => {
	const src = fs.readFileSync( path.join( __dirname, '..', 'probe.js' ), 'utf8' );
	const listed = JSON.parse( /const SIGNALS = (\[[^\]]*\])/.exec( src )[ 1 ].replace( /'/g, '"' ) );
	assert.deepStrictEqual( listed, PW.SIGNALS );
} );

test( 'vendor registry is well formed', () => {
	const vs = PW.vendors();
	const keys = vs.map( v => v.key );
	assert.strictEqual( new Set( keys ).size, keys.length, 'duplicate keys' );
	for ( const v of vs ) {
		assert.ok( [ 'ads', 'analytics', 'replay', 'cdp', 'marketing', 'b2b' ].includes( v.group ), v.key + ' group' );
		assert.ok( [ 'ad_storage', 'analytics_storage' ].includes( v.needs ), v.key + ' needs' );
		assert.ok( v.hosts.length || v.match, v.key + ' has no way to match' );
		v.listen.forEach( pat => assert.ok( /^\*:\/\/[^/]+\//.test( pat ), v.key + ' bad pattern ' + pat ) );
	}
	assert.strictEqual( PW.vendorInfo( 'tiktok' ).name, 'TikTok' );
	assert.strictEqual( PW.vendorInfo( 'meta' ).group, 'ads' );
	assert.strictEqual( PW.label( 'ti', 'microsoft' ), 'UET tag ID' );
	assert.strictEqual( PW.label( 'type', 'tiktok' ), '' );
} );

// ---- GTM: dataLayer pushes and gtag() calls (as content.js reports them)

test( 'gtag consent default, with region, decodes to consent chips', () => {
	const e = PW.dataLayerEntry( [ 'consent', 'default', { ad_storage: 'denied', analytics_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', region: [ 'AT', 'BE', 'DE' ], wait_for_update: 500 } ] );
	assert.deepStrictEqual( [ e.kind, e.event ], [ 'gtag', 'consent default' ] );
	assert.deepStrictEqual( PW.SIGNALS.map( s => e.consent[ s ].state ), [ 'denied', 'denied', 'denied', 'denied' ] );
	assert.ok( /3 regions: AT, BE, DE/.test( e.consent.ad_storage.how ), e.consent.ad_storage.how );
	assert.ok( e.notes.includes( 'Only applies to visitors in: AT, BE, DE' ) );
	assert.ok( e.notes.includes( 'Tags wait up to 500 ms for an update' ) );
	const u = PW.dataLayerEntry( [ 'consent', 'update', { ad_storage: 'granted' } ] );
	assert.strictEqual( u.event, 'consent update' );
	assert.strictEqual( u.consent.ad_storage.how, 'gtag consent update' );
} );

test( 'gtag event and config', () => {
	const e = PW.dataLayerEntry( [ 'event', 'purchase', { value: 80, currency: 'USD', items: [ { id: 'sku1' } ] } ] );
	assert.deepStrictEqual( [ e.kind, e.event, e.label ], [ 'gtag', 'purchase', 'gtag event' ] );
	assert.strictEqual( e.summary, 'value=80 · currency=USD · items=[{"id":"sku1"}]' );
	assert.strictEqual( PW.dataLayerEntry( [ 'config', 'G-SHOPDEMO42', { send_page_view: false } ] ).event, 'config G-SHOPDEMO42' );
	assert.strictEqual( PW.dataLayerEntry( [ 'js', '2026-10-05T00:00:00.000Z' ] ).label, 'gtag.js loaded' );
} );

test( 'GTM events get Tag Assistant names; custom events and messages', () => {
	const js = PW.dataLayerEntry( { event: 'gtm.js', 'gtm.start': 1791212458528, 'gtm.uniqueEventId': 1 } );
	assert.deepStrictEqual( [ js.kind, js.event, js.label, js.summary ], [ 'dataLayer', 'gtm.js', 'Container Loaded', '' ] );
	const click = PW.dataLayerEntry( { event: 'gtm.linkClick', 'gtm.element': '<a#cta.btn.primary>', 'gtm.elementUrl': 'https://x.example/' } );
	assert.deepStrictEqual( [ click.label, click.summary ], [ 'Link Click', '<a#cta.btn.primary>' ] );
	const custom = PW.dataLayerEntry( { event: 'lead_submit', form: { id: 'contact', fields: 4 } } );
	assert.deepStrictEqual( [ custom.event, custom.label, custom.summary ], [ 'lead_submit', '', 'form.id=contact · form.fields=4' ] );
	const msg = PW.dataLayerEntry( { ecommerce: null } );
	assert.deepStrictEqual( [ msg.event, msg.label, msg.summary ], [ 'message', 'data pushed, no event', 'ecommerce=null' ] );
} );

test( 'dataLayer model merges like GTM', () => {
	const m = {};
	PW.mergeDataLayer( m, { event: 'gtm.js', 'gtm.start': 1 } );
	PW.mergeDataLayer( m, { user: { id: 'u1', tier: 'gold' }, page: { type: 'pdp' } } );
	PW.mergeDataLayer( m, [ 'consent', 'default', { ad_storage: 'denied' } ] ); // gtag: no change
	PW.mergeDataLayer( m, { user: { tier: 'platinum' }, items: [ 1, 2 ] } );    // nested merge
	PW.mergeDataLayer( m, { items: [ 3 ] } );                                  // arrays replace
	assert.deepStrictEqual( m, { event: 'gtm.js', 'gtm.start': 1, user: { id: 'u1', tier: 'platinum' }, page: { type: 'pdp' }, items: [ 3 ] } );
	PW.mergeDataLayer( m, { ecommerce: { value: 289, currency: 'USD' } } );
	PW.mergeDataLayer( m, { ecommerce: null } );                               // null clears
	assert.strictEqual( m.ecommerce, null );
	PW.mergeDataLayer( m, { user: { id: 'u2' }, _clear: true } );              // _clear replaces
	assert.deepStrictEqual( m.user, { id: 'u2' } );
	assert.ok( ! ( '_clear' in m ) );
	PW.mergeDataLayer( m, { page: '(undefined)' } );                           // undefined removes
	assert.ok( ! ( 'page' in m ) );
	// The model never shares objects with the pushes it came from.
	const push = { cart: { lines: 1 } };
	PW.mergeDataLayer( m, push );
	push.cart.lines = 99;
	assert.strictEqual( m.cart.lines, 1 );
} );

test( 'hits installed through GTM say so', () => {
	const via = url => ( PW.classify( { url } ) || [] )[ 0 ].via;
	assert.strictEqual( via( 'https://px.ads.linkedin.com/collect?v=2&fmt=js&pid=3346164&tm=gtmv2' ), 'GTM' );
	assert.strictEqual( via( 'https://bat.bing.com/action/0?ti=1&tm=gtm002&evt=page' ), 'GTM' );
	assert.strictEqual( via( 'https://tr.snapchat.com/p?pid=x&ev=PAGE_VIEW&intg=gtm' ), 'GTM' );
	assert.strictEqual( via( 'https://q.quora.com/_/ad/abc/pixel?tag=ViewContent&i=gtm' ), 'GTM' );
	assert.strictEqual( via( 'https://ct.pinterest.com/v3/?tid=1&event=pagevisit&pd=%7B%22np%22%3A%22gtm%22%7D' ), 'GTM' );
	assert.strictEqual( via( 'https://s.amazon-adsystem.com/iu3?pid=1&event=PageView&gtmVersion=3.4' ), 'GTM' );
	const meta = PW.classify( { url: 'https://www.facebook.com/tr/', method: 'POST', body: { formData: { id: [ '1' ], ev: [ 'PageView' ], a: [ 'tmSimo-GTM-WebTemplate' ] } } } )[ 0 ];
	assert.strictEqual( meta.via, 'GTM' );
	assert.strictEqual( via( 'https://px.ads.linkedin.com/collect?v=2&pid=1' ), undefined );
	// Google hits all come from Google's own tag; and URLs that merely mention gtm don't count.
	assert.strictEqual( PW.classify( { url: 'https://www.googleadservices.com/pagead/conversion/1/?ref=https%3A%2F%2Fx.com%2Fgtm' } )[ 0 ].via, undefined );
} );

// ---- Not tracking

test( 'ordinary Google, Facebook and AdSense traffic is ignored', () => {
	for ( const url of [
		'https://www.google.com/search?q=visa',
		'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js',
		'https://www.facebook.com/someshop',
		'https://www.facebook.com/translations/x',
		'https://analytics.google.com/analytics/web/',
		'https://example.com/pagead/conversion/1/',
		'https://segment.com/docs/',
		'not a url',
	] ) {
		assert.strictEqual( PW.classify( { url } ), null, url );
	}
} );

// ---- Consent decoding

test( 'gcs alone fills ads and analytics storage', () => {
	const c = PW.googleConsent( { gcs: 'G100' } );
	assert.strictEqual( c.ad_storage.state, 'denied' );
	assert.strictEqual( c.analytics_storage.state, 'denied' );
	assert.strictEqual( c.ad_user_data, undefined );
} );

test( 'gcd letters decode default and update', () => {
	const c = PW.googleConsent( { gcd: '13u3v3q3t5l1' } );
	assert.deepStrictEqual( PW.SIGNALS.map( s => c[ s ].state ), [ 'denied', 'granted', 'denied', 'granted' ] );
	assert.strictEqual( c.ad_storage.how, 'granted by default, denied by update' );
	assert.strictEqual( PW.googleConsent( {} ), null );
} );

test( 'gcs fills signals gcd left unset', () => {
	const c = PW.googleConsent( { gcd: '13l3l3l3l5l1', gcs: 'G110' } );
	assert.strictEqual( c.ad_storage.state, 'granted' );
	assert.strictEqual( c.analytics_storage.state, 'denied' );
	assert.strictEqual( c.ad_user_data.state, null );
} );

// ---- Every URL classify accepts must reach it through the listener filter

test( 'listener patterns cover every classified URL', () => {
	for ( const url of [
		GA4_PAGE_VIEW, GA4_OFFER, SIGNALS_PING, META_PAGEVIEW,
		'https://region1.google-analytics.com/g/collect?v=2&tid=G-ABC123',
		'https://sgtm.example.com/g/collect?v=2&tid=G-ABC123&en=page_view',
		'https://www.googletagmanager.com/gtm.js?id=GTM-SHOP42X',
		'https://www.google-analytics.com/collect?v=1&t=pageview&tid=UA-1-1',
		'https://www.googleadservices.com/pagead/conversion/123/?label=x',
		'https://googleads.g.doubleclick.net/pagead/viewthroughconversion/123/',
		'https://www.google.com.au/pagead/1p-user-list/123/',
		'https://www.google.com/ccm/collect?en=page_view',
		'https://www.google.com/rmkt/collect/123/',
		'https://ad.doubleclick.net/activity;src=1;type=a;cat=b',
		'https://td.doubleclick.net/td/rul/123',
		'https://www.facebook.com/tr?id=1&ev=PageView',
		'https://facebook.com/tr/?id=1&ev=PageView',
		'https://www.facebook.com/privacy_sandbox/pixel/register/trigger/?id=1&ev=PageView',
		'https://connect.facebook.net/en_US/fbevents.js',
		'https://api.segment.io/v1/t',
		'https://events.eu1.segmentapis.com/v1/batch',
		'https://cdn.segment.com/analytics.js/v1/WRITEKEY123/analytics.min.js',
		'https://cdn.segment.io/analytics.js/v1/WRITEKEY123/analytics.min.js',
	] ) {
		assert.ok( PW.classify( { url } ), 'classify: ' + url );
		assert.ok( listened( url ), 'not listened: ' + url );
	}
	assert.ok( ! listened( 'https://analytics.google.com/analytics/web/' ), 'GA UI should not be listened' );
	assert.ok( ! listened( 'https://www.facebook.com/someshop' ), 'Facebook browsing should not be listened' );
	assert.ok( ! listened( 'https://segment.com/docs/' ), 'Segment docs should not be listened' );
} );

// ---- Labels and ordering

test( 'params sort event first, page context late', () => {
	const keys = PW.sortedKeys( { dl: 1, zz: 1, en: 1, 'ep.a': 1, tid: 1, gcs: 1 } );
	assert.deepStrictEqual( keys, [ 'en', 'tid', 'ep.a', 'gcs', 'dl', 'zz' ] );
	assert.strictEqual( PW.label( 'ep.offer_id' ), 'event param' );
	assert.strictEqual( PW.label( 'ud[em]' ), 'hashed user data' );
} );

// ---- Background page, against a fake browser API

function fakeBrowser( probeResult ) {
	// Like Firefox: each event goes to every listener whose URL filter matches.
	const regs = {};
	const listeners = {};
	const on = name => ( {
		addListener: ( fn, filter ) => {
			( regs[ name ] = regs[ name ] || [] ).push( { fn, filter } );
			listeners[ name ] = ( details, ...rest ) => {
				let out;
				for ( const l of regs[ name ] ) {
					if ( l.filter && details && details.url && ! l.filter.urls.some( pat => matches( pat, details.url ) ) ) continue;
					out = l.fn( details, ...rest );
				}
				return out;
			};
		},
	} );
	const badges = {};
	const sent = [];
	const api = {
		webRequest: {
			onBeforeRequest: on( 'beforeRequest' ), onCompleted: on( 'completed' ),
			onBeforeRedirect: on( 'redirect' ), onErrorOccurred: on( 'error' ),
		},
		webNavigation: { onCommitted: on( 'committed' ), onHistoryStateUpdated: on( 'history' ) },
		tabs: {
			onRemoved: on( 'removed' ),
			get: async id => ( { id, url: 'https://client.example/page', title: 'Client page' } ),
			executeScript: async ( tabId, opts ) => {
				assert.strictEqual( opts.file, '/probe.js' );
				return [ probeResult ];
			},
		},
		browserAction: {
			setBadgeText: ( { tabId, text } ) => { ( badges[ tabId ] = badges[ tabId ] || {} ).text = text; },
			setBadgeBackgroundColor: ( { tabId, color } ) => { ( badges[ tabId ] = badges[ tabId ] || {} ).color = color; },
		},
		runtime: {
			onMessage: on( 'message' ),
			sendMessage: async msg => { sent.push( msg ); },
		},
	};
	return { api, listeners, badges, sent };
}

// Runs background.js in its own realm. Arrays coming back out have that
// realm's prototype, so assertions copy them with Array.from first.
function loadBackground( browser ) {
	const ctx = vm.createContext( { browser, console, URL, URLSearchParams, TextDecoder, setTimeout, Promise, Blob, Response, DecompressionStream, atob } );
	vm.runInContext( fs.readFileSync( path.join( __dirname, '..', 'rules.js' ), 'utf8' ), ctx );
	vm.runInContext( fs.readFileSync( path.join( __dirname, '..', 'vendors.js' ), 'utf8' ), ctx );
	vm.runInContext( fs.readFileSync( path.join( __dirname, '..', 'background.js' ), 'utf8' ), ctx );
	return ctx;
}

const tick = ms => new Promise( r => setTimeout( r, ms ) );

( async () => {
	await testAsync( 'background logs a page, flags Meta firing while ads consent is denied', async () => {
		const f = fakeBrowser( { gpc: false, google: { ad_storage: 'denied', analytics_storage: 'granted' } } );
		loadBackground( f.api );
		const L = f.listeners;
		L.committed( { tabId: 7, frameId: 0, url: 'https://shop.example/', timeStamp: 1000 } );
		L.beforeRequest( { tabId: 7, frameId: 0, requestId: 'a', url: 'https://www.googletagmanager.com/gtm.js?id=GTM-SHOP42X', method: 'GET', timeStamp: 1100 } );
		L.beforeRequest( { tabId: 7, frameId: 0, requestId: 'b', url: GA4_PAGE_VIEW, method: 'GET', timeStamp: 1700 } );
		L.beforeRequest( { tabId: 7, frameId: 0, requestId: 'c', url: META_PAGEVIEW, method: 'GET', timeStamp: 1800 } );
		L.completed( { tabId: 7, requestId: 'b', statusCode: 204 } );
		L.error( { tabId: 7, requestId: 'c', error: 'NS_ERROR_TRACKING_URI' } );
		// Firefox "fails" a script it serves from its cache of parsed scripts; it still ran.
		L.error( { tabId: 7, requestId: 'a', error: 'NS_ERROR_PARSED_DATA_CACHED' } );
		// A late webRequest event from before the navigation slots in ahead of the nav.
		L.beforeRequest( { tabId: 7, frameId: 0, requestId: 'z', url: GA4_OFFER, method: 'GET', timeStamp: 900 } );
		await tick( 150 );

		const got = await L.message( { type: 'get', tabId: 7 } );
		assert.deepStrictEqual( Array.from( got.entries, e => e.type === 'nav' ? 'nav' : e.event || e.kind ),
			[ 'lead_offer_impression', 'nav', 'GTM container', 'page_view', 'PageView' ] );
		const [ , , gtm, ga, meta ] = got.entries;
		assert.strictEqual( gtm.status, 'cache' );
		assert.strictEqual( gtm.error, undefined );
		assert.strictEqual( ga.status, 204 );
		assert.strictEqual( meta.status, 'error' );
		assert.strictEqual( meta.error, 'blocked by Firefox tracking protection' );
		assert.ok( /pre-consent/.test( meta.warning ), meta.warning );
		assert.strictEqual( got.pageStart, 1000 );
		// Badge counts this page's hits only (not the GTM script, not the pre-nav hit) and turns red.
		assert.deepStrictEqual( f.badges[ 7 ], { text: '2', color: '#d93025' } );
		assert.ok( f.sent.some( m => m.type === 'changed' && m.tabId === 7 ) );
	} );

	await testAsync( 'background trusts Meta when consent is granted, and the banner check', async () => {
		const f = fakeBrowser( { gpc: true, google: { ad_storage: 'granted' } } );
		loadBackground( f.api );
		f.listeners.beforeRequest( { tabId: 3, frameId: 0, requestId: 'm', url: META_PAGEVIEW, method: 'GET', timeStamp: 1 } );
		await tick( 150 );
		let got = await f.listeners.message( { type: 'get', tabId: 3 } );
		assert.strictEqual( got.entries[ 0 ].warning, undefined );
		assert.strictEqual( f.badges[ 3 ].color, '#3c4043' );

		const g = fakeBrowser( { gpc: false, banner: { cookie: 'cc_cookie', categories: [ 'necessary', 'analytics' ] } } );
		loadBackground( g.api );
		g.listeners.beforeRequest( { tabId: 4, frameId: 0, requestId: 'n', url: META_PAGEVIEW, method: 'GET', timeStamp: 1 } );
		await tick( 150 );
		got = await g.listeners.message( { type: 'get', tabId: 4 } );
		assert.ok( /no advertising consent/.test( got.entries[ 0 ].warning ), got.entries[ 0 ].warning );
	} );

	await testAsync( 'background checks Segment against analytics consent, once per request', async () => {
		const f = fakeBrowser( { gpc: false, google: { ad_storage: 'granted', analytics_storage: 'denied' } } );
		let probes = 0;
		const exec = f.api.tabs.executeScript;
		f.api.tabs.executeScript = ( ...a ) => { probes++; return exec( ...a ); };
		loadBackground( f.api );
		const body = JSON.stringify( { writeKey: 'K', batch: [ { type: 'track', event: 'A' }, { type: 'track', event: 'B' } ] } );
		f.listeners.beforeRequest( {
			tabId: 6, frameId: 0, requestId: 's', method: 'POST', timeStamp: 1, url: 'https://api.segment.io/v1/batch',
			requestBody: { raw: [ { bytes: new TextEncoder().encode( body ).buffer } ] },
		} );
		f.listeners.beforeRequest( {
			tabId: 6, frameId: 0, requestId: 'u', method: 'POST', timeStamp: 2, url: 'https://api.segment.io/v1/t',
			requestBody: { raw: [ { bytes: new TextEncoder().encode( JSON.stringify( { type: 'track', event: 'C', context: { consent: { categoryPreferences: { Analytics: false } } } } ) ).buffer } ] },
		} );
		await tick( 150 );
		const got = await f.listeners.message( { type: 'get', tabId: 6 } );
		assert.deepStrictEqual( Array.from( got.entries, e => e.event ), [ 'A', 'B', 'C' ] );
		assert.ok( /analytics_storage denied/.test( got.entries[ 0 ].warning ), got.entries[ 0 ].warning );
		assert.ok( /analytics_storage denied/.test( got.entries[ 1 ].warning ) );
		assert.strictEqual( got.entries[ 2 ].warning, undefined, 'stamped events route by their own consent' );
		assert.strictEqual( probes, 1, 'one probe for the batch, none for the stamped event' );
		assert.strictEqual( f.badges[ 6 ].color, '#d93025' );
	} );

	await testAsync( 'background unzips gzip bodies, catches tag gateways, skips preflights', async () => {
		const f = fakeBrowser( { gpc: false, google: { analytics_storage: 'granted', ad_storage: 'granted' } } );
		loadBackground( f.api );
		const zl = require( 'zlib' );
		const gz = zl.gzipSync( JSON.stringify( [ { event: '$pageview', properties: { token: 'phc_z' } } ] ) );
		const bytes = gz.buffer.slice( gz.byteOffset, gz.byteOffset + gz.length );
		f.listeners.beforeRequest( { tabId: 8, frameId: 0, requestId: 'g', method: 'POST', timeStamp: 1, url: 'https://us.i.posthog.com/e/?compression=gzip-js', requestBody: { raw: [ { bytes } ] } } );
		// The response lands before the unzip finishes; the status must still stick.
		f.listeners.completed( { tabId: 8, requestId: 'g', statusCode: 200, url: 'https://us.i.posthog.com/e/?compression=gzip-js' } );
		f.listeners.beforeRequest( { tabId: 8, frameId: 0, requestId: 'o', method: 'OPTIONS', timeStamp: 2, url: 'https://api.segment.io/v1/t' } );
		f.listeners.beforeRequest( { tabId: 8, frameId: 0, requestId: 'w', method: 'GET', timeStamp: 3, url: 'https://client.example/metrics/ag/g/c?v=2&tid=G-ABC123&gtm=45g9&gcs=G111&en=page_view' } );
		f.listeners.beforeRequest( { tabId: 8, frameId: 0, requestId: 'n', method: 'GET', timeStamp: 4, url: 'https://client.example/app.js?gtm=1' } );
		await tick( 200 );
		const got = await f.listeners.message( { type: 'get', tabId: 8 } );
		assert.deepStrictEqual( Array.from( got.entries, e => [ e.vendor, e.event, e.status ] ), [ [ 'posthog', '$pageview', 200 ], [ 'google', 'page_view', null ] ] );
		assert.strictEqual( got.entries[ 0 ].id, 'phc_z' );
	} );

	await testAsync( 'background slots dataLayer pushes into the timeline by time', async () => {
		const f = fakeBrowser( null );
		loadBackground( f.api );
		f.listeners.committed( { tabId: 9, frameId: 0, url: 'https://client.example/', timeStamp: 1000 } );
		f.listeners.beforeRequest( { tabId: 9, frameId: 0, requestId: 'h', method: 'GET', timeStamp: 1300, url: GA4_PAGE_VIEW } );
		const top = { tab: { id: 9 }, frameId: 0 };
		f.listeners.message( { type: 'dl', name: 'dataLayer', t: 1200, items: [ { event: 'gtm.js', 'gtm.start': 1 }, [ 'consent', 'default', { ad_storage: 'denied' } ] ] }, top );
		f.listeners.message( { type: 'dl', name: 'dataLayer', t: 1500, items: [ { event: 'lead_submit' } ] }, top );
		// Iframes and non-tab senders are ignored.
		f.listeners.message( { type: 'dl', name: 'dataLayer', t: 1600, items: [ { event: 'from_iframe' } ] }, { tab: { id: 9 }, frameId: 3 } );
		await tick( 150 );
		const got = await f.listeners.message( { type: 'get', tabId: 9 } );
		assert.deepStrictEqual( Array.from( got.entries, e => e.type + ':' + ( e.event || '' ) ),
			[ 'nav:', 'dl:gtm.js', 'dl:consent default', 'hit:page_view', 'dl:lead_submit' ] );
		assert.strictEqual( got.entries[ 2 ].consent.ad_storage.state, 'denied' );
		assert.strictEqual( f.badges[ 9 ].text, '1', 'dataLayer events are not hits' );
	} );

	await testAsync( 'background tells the DevTools panel which page its tab is on', async () => {
		const f = fakeBrowser( null );
		loadBackground( f.api );
		const t = await f.listeners.message( { type: 'tab', tabId: 4 } );
		assert.strictEqual( t.url, 'https://client.example/page' );
		assert.strictEqual( t.title, 'Client page' );
	} );

	await testAsync( 'background decodes a beacon body and follows redirects', async () => {
		const f = fakeBrowser( null );
		loadBackground( f.api );
		const bytes = new TextEncoder().encode( 'en=scroll\nen=click&ep.link_domain=humanitix.com' ).buffer;
		f.listeners.beforeRequest( {
			tabId: 5, frameId: 0, requestId: 'p', method: 'POST', timeStamp: 1,
			url: 'https://region1.analytics.google.com/g/collect?v=2&tid=G-SHOPDEMO42&gcs=G111',
			requestBody: { raw: [ { bytes } ] },
		} );
		f.listeners.beforeRequest( { tabId: 5, frameId: 0, requestId: 'r', method: 'GET', timeStamp: 2, url: 'https://www.googleadservices.com/pagead/conversion/123/?label=x' } );
		f.listeners.redirect( { tabId: 5, requestId: 'r', statusCode: 302 } );
		f.listeners.beforeRequest( { tabId: 5, frameId: 0, requestId: 'r', method: 'GET', timeStamp: 3, url: 'https://www.google.com/pagead/1p-conversion/123/?label=x' } );
		f.listeners.completed( { tabId: 5, requestId: 'r', statusCode: 200 } );
		await tick( 150 );
		const got = await f.listeners.message( { type: 'get', tabId: 5 } );
		assert.deepStrictEqual( Array.from( got.entries, e => e.event ), [ 'scroll', 'click', 'conversion', 'conversion' ] );
		assert.strictEqual( got.entries[ 1 ].summary, 'link_domain=humanitix.com' );
		assert.deepStrictEqual( Array.from( got.entries.slice( 2 ), e => e.status ), [ 302, 200 ] );
		assert.strictEqual( f.badges[ 5 ].text, '3' );
	} );

	console.log( passed + ' passed, ' + failures.length + ' failed' );
	failures.forEach( f => console.log( '  ✗ ' + f ) );
	process.exit( failures.length ? 1 : 0 );
} )();
