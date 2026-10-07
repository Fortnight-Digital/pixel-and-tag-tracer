/*
 * Pixel & Tag Tracer — background page.
 *
 * Watches tracking requests per tab (Google, Meta, Segment and every vendor
 * in vendors.js), keeps a log the panel reads, and keeps the toolbar badge
 * current. All state is in memory; it goes when Firefox restarts.
 */
'use strict';
/* global PW */

const MAX_ENTRIES = 1000;
const tabs = new Map();      // tabId -> { entries, pageStart }
const byRequest = new Map(); // requestId -> hits waiting for a status
let seq = 0;

function state( tabId ) {
	let s = tabs.get( tabId );
	if ( ! s ) {
		s = { entries: [], pageStart: 0 };
		tabs.set( tabId, s );
	}
	return s;
}

// webRequest and webNavigation events aren't ordered relative to each other,
// so slot each entry in by timestamp rather than appending.
function push( s, entry ) {
	let i = s.entries.length;
	while ( i > 0 && s.entries[ i - 1 ].t > entry.t ) i--;
	s.entries.splice( i, 0, entry );
	if ( s.entries.length > MAX_ENTRIES ) s.entries.splice( 0, s.entries.length - MAX_ENTRIES );
}

// requestBody.raw can arrive in several parts; join them.
function rawBytes( rb ) {
	if ( ! rb || ! rb.raw || ! rb.raw.length ) return null;
	const parts = rb.raw.filter( part => part.bytes ).map( part => new Uint8Array( part.bytes ) );
	const all = new Uint8Array( parts.reduce( ( n, part ) => n + part.length, 0 ) );
	let at = 0;
	for ( const part of parts ) {
		all.set( part, at );
		at += part.length;
	}
	return all;
}

function gunzip( bytes ) {
	const stream = new Blob( [ bytes ] ).stream().pipeThrough( new DecompressionStream( 'gzip' ) );
	return new Response( stream ).text();
}

// The body as classify() wants it. Gzipped bodies (PostHog, Microsoft) come
// back as a promise because unpacking them is async.
function bodyOf( rb ) {
	if ( ! rb ) return null;
	if ( rb.formData ) return { formData: rb.formData };
	const bytes = rawBytes( rb );
	if ( ! bytes || ! bytes.length ) return null;
	if ( bytes[ 0 ] === 0x1f && bytes[ 1 ] === 0x8b ) {
		return bytes.length < 2e6 ? gunzip( bytes ).then( text => ( { text } ), () => null ) : null;
	}
	return { text: new TextDecoder().decode( bytes ) };
}

const hostOf = url => {
	try { return new URL( url ).hostname; } catch ( e ) { return null; }
};

// Some browserAction calls return promises and some throw on a closed tab.
function quietly( fn ) {
	try {
		const r = fn();
		if ( r && r.catch ) r.catch( () => {} );
	} catch ( e ) {}
}

// What the page itself believes about consent right now: probe.js, injected
// on demand and read-only. See that file for what it reads.
async function probe( tabId, frameId ) {
	try {
		const [ r ] = await browser.tabs.executeScript( tabId, { file: '/probe.js', frameId: frameId || 0, runAt: 'document_start' } );
		return r || null;
	} catch ( e ) {
		return null;
	}
}

// A page load can fire a dozen tools at once; one read of the page's consent
// serves them all.
const probes = new Map();
function probeSoon( tabId, frameId ) {
	const key = tabId + ':' + frameId;
	const hit = probes.get( key );
	if ( hit && Date.now() - hit.t < 300 ) return hit.result;
	if ( probes.size > 200 ) probes.clear();
	const result = probe( tabId, frameId );
	probes.set( key, { t: Date.now(), result } );
	return result;
}

// Banner category names that count as consent for each Google signal.
const BANNER = {
	ad_storage: { re: /advert|marketing|^ads$|targeting/i, what: 'advertising' },
	analytics_storage: { re: /analytic|statistic|performance|measurement/i, what: 'analytics' },
};

// Hits from tools other than Google carry no Google consent signal of their
// own, so ask the page what its consent state was the moment they fired.
// hit.needs names the signal that has to be granted.
async function checkConsent( tabId, frameId, hits ) {
	let page = await probeSoon( tabId, frameId );
	if ( ! page && frameId ) page = await probeSoon( tabId, 0 );
	if ( ! page ) return;
	for ( const hit of hits ) {
		hit.page = page;
		const need = BANNER[ hit.needs ];
		if ( page.google && page.google[ hit.needs ] === 'denied' ) {
			hit.warning = 'Fired while the page\'s Google consent had ' + hit.needs + ' denied: this looks like a pre-consent leak';
		} else if ( page.banner && ! page.banner.categories.some( c => need.re.test( c ) ) ) {
			hit.warning = 'Fired although the cookie banner (' + page.banner.cookie + ') has no ' + need.what + ' consent';
		}
	}
	changed( tabId );
}

const decoding = new Set(); // requestIds whose body is still being unzipped
const early = new Map();    // their status, if the response beat the unzip

function record( details, body ) {
	const hits = PW.classify( { url: details.url, method: details.method, body } );
	if ( ! hits || ! hits.length ) return;
	const s = state( details.tabId );
	const frame = details.frameId ? hostOf( details.documentUrl || details.originUrl ) : null;
	for ( const hit of hits ) {
		Object.assign( hit, {
			type: 'hit', uid: ++seq, t: details.timeStamp, url: details.url, method: details.method,
			requestId: details.requestId, status: null, frame,
		} );
		push( s, hit );
	}
	const check = hits.filter( hit => hit.category === 'hit' && hit.needs );
	if ( check.length ) checkConsent( details.tabId, details.frameId, check );
	byRequest.set( details.requestId, hits );
	if ( byRequest.size > 2000 ) byRequest.delete( byRequest.keys().next().value );
	const done = early.get( details.requestId );
	if ( done ) {
		early.delete( details.requestId );
		settle( { requestId: details.requestId, tabId: details.tabId }, done.status, done.error );
	}
	changed( details.tabId );
}

browser.webRequest.onBeforeRequest.addListener( details => {
	if ( details.tabId < 0 ) return;
	const body = bodyOf( details.requestBody );
	if ( body && typeof body.then === 'function' ) {
		decoding.add( details.requestId );
		body.then( b => {
			decoding.delete( details.requestId );
			record( details, b );
		} );
	} else {
		record( details, body );
	}
}, { urls: PW.listenUrls() }, [ 'requestBody' ] );

// Everything else, without bodies, for Google tag gateways and server-side
// GTM on the site's own paths: only recognisable by their parameters.
browser.webRequest.onBeforeRequest.addListener( details => {
	if ( details.tabId < 0 || ! /[?&](tid|gtm)=/.test( details.url ) || PW.listened( details.url ) ) return;
	record( details, null );
}, { urls: [ '<all_urls>' ] } );

function settle( details, status, error ) {
	const hits = byRequest.get( details.requestId );
	if ( ! hits ) {
		if ( decoding.has( details.requestId ) ) early.set( details.requestId, { status, error } );
		return;
	}
	byRequest.delete( details.requestId );
	for ( const hit of hits ) {
		hit.status = status;
		if ( error ) hit.error = error;
	}
	changed( details.tabId );
}

const filter = { urls: [ '<all_urls>' ] };
browser.webRequest.onCompleted.addListener( d => settle( d, d.statusCode ), filter );
// A redirect reuses the requestId for the next hop, so close this hop first.
browser.webRequest.onBeforeRedirect.addListener( d => settle( d, d.statusCode ), filter );
// Firefox ends a request for a script or video it already holds parsed in its
// cache with an "error", but the file still loaded, so don't call it blocked.
browser.webRequest.onErrorOccurred.addListener( d => /NS_ERROR_PARSED_DATA_CACHED/.test( d.error )
	? settle( d, 'cache' )
	: settle( d, 'error', PW.describeError( d.error ) ), filter );

browser.webNavigation.onCommitted.addListener( d => {
	if ( d.frameId !== 0 ) return;
	const s = state( d.tabId );
	s.pageStart = d.timeStamp;
	if ( /^https?:/.test( d.url ) ) push( s, { type: 'nav', uid: ++seq, t: d.timeStamp, url: d.url } );
	changed( d.tabId );
} );

browser.webNavigation.onHistoryStateUpdated.addListener( d => {
	if ( d.frameId !== 0 ) return;
	push( state( d.tabId ), { type: 'nav', uid: ++seq, t: d.timeStamp, url: d.url, spa: true } );
	changed( d.tabId );
} );

browser.tabs.onRemoved.addListener( tabId => tabs.delete( tabId ) );

function badge( tabId ) {
	const s = tabs.get( tabId );
	if ( ! s ) return;
	let n = 0, warn = false;
	for ( const e of s.entries ) {
		if ( e.type !== 'hit' || e.category !== 'hit' || e.t < s.pageStart ) continue;
		n++;
		if ( e.warning ) warn = true;
	}
	quietly( () => browser.browserAction.setBadgeText( { tabId, text: n ? String( n ) : '' } ) );
	quietly( () => browser.browserAction.setBadgeBackgroundColor( { tabId, color: warn ? '#d93025' : '#3c4043' } ) );
}

// Coalesce bursts (GTM can fire a dozen hits at once) into one update.
const timers = new Map();
function changed( tabId ) {
	if ( timers.has( tabId ) ) return;
	timers.set( tabId, setTimeout( () => {
		timers.delete( tabId );
		badge( tabId );
		quietly( () => browser.runtime.sendMessage( { type: 'changed', tabId } ) );
	}, 100 ) );
}

browser.runtime.onMessage.addListener( ( msg, sender ) => {
	// dataLayer pushes reported by content.js in a page's top frame.
	if ( msg.type === 'dl' ) {
		const tabId = sender && sender.tab ? sender.tab.id : -1;
		if ( tabId < 0 || sender.frameId || ! Array.isArray( msg.items ) ) return undefined;
		const s = state( tabId );
		for ( const item of msg.items ) {
			push( s, Object.assign( PW.dataLayerEntry( item ), { type: 'dl', uid: ++seq, t: msg.t, layer: msg.name } ) );
		}
		changed( tabId );
		return undefined;
	}
	if ( msg.type === 'get' ) {
		const s = tabs.get( msg.tabId );
		return Promise.resolve( s ? { entries: s.entries, pageStart: s.pageStart } : { entries: [], pageStart: 0 } );
	}
	if ( msg.type === 'clear' ) {
		const s = tabs.get( msg.tabId );
		if ( s ) s.entries = [];
		changed( msg.tabId );
		return Promise.resolve( true );
	}
	if ( msg.type === 'probe' ) return probe( msg.tabId, 0 );
	// For the DevTools panel, which can't use the tabs API itself.
	if ( msg.type === 'tab' ) {
		return browser.tabs.get( msg.tabId ).then( t => ( { url: t.url, title: t.title } ), () => null );
	}
	return undefined;
} );
