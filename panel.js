/*
 * Pixel & Tag Tracer — the panel. One page serves four views: the toolbar
 * popup, the sidebar (follows the active tab, stays open while you click
 * about), a DevTools panel (belongs to one tab, like DevTools itself) and a
 * plain tab (panel.html?tab=<id>).
 *
 * DevTools panels get no tabs, windows or extension.getViews APIs, so
 * anything about the tab itself goes through the background page.
 */
'use strict';
/* global PW */

const $ = sel => document.querySelector( sel );
const params = new URLSearchParams( location.search );
const inDevtools = !! ( browser.devtools && browser.devtools.inspectedWindow );
const view = params.get( 'tab' ) ? 'tab'
	: inDevtools ? 'devtools'
	: params.get( 'view' ) === 'sidebar' || browser.extension.getViews( { type: 'sidebar' } ).includes( window ) ? 'sidebar'
	: 'popup';
document.body.dataset.view = view;

const SIG_LABEL = {
	ad_storage: 'ads',
	analytics_storage: 'analytics',
	ad_user_data: 'user data',
	ad_personalization: 'personalisation',
};

const CHIPS = [
	[ /^GA4|Universal Analytics|analytics\.js|Google Analytics/, k => /^GA4/.test( k ) ? 'GA4' : 'UA', 'g-ga' ],
	[ /^Floodlight/, () => 'Floodlight', 'g-ads' ],
	[ /Ads|DoubleClick|audience/, () => 'Ads', 'g-ads' ],
	[ /^GTM|gtag|Google tag/, () => 'GTM', 'g-gtm' ],
];
// Kinds the chip already says in full.
const PLAIN_KINDS = [ 'GA4', 'Meta Pixel' ];

let tabId = null;
let windowId = null;
let data = { entries: [], pageStart: 0 };
let now = null;
let lastProbe = 0;
const expanded = new Set();
const views = new Map(); // uid -> which view an open row shows: 'own' or 'model'

const prefs = ( () => {
	try {
		return Object.assign( { vendor: 'all', extras: false, dl: true }, JSON.parse( localStorage.getItem( 'pw-prefs' ) || '{}' ) );
	} catch ( e ) {
		return { vendor: 'all', extras: false, dl: true };
	}
} )();
function savePrefs() {
	try { localStorage.setItem( 'pw-prefs', JSON.stringify( prefs ) ); } catch ( e ) {}
}

// Builds DOM from strings via textContent only: everything shown here comes
// from web pages and must never be parsed as HTML in a privileged page.
function el( tag, attrs, ...kids ) {
	const n = document.createElement( tag );
	for ( const [ k, v ] of Object.entries( attrs || {} ) ) {
		if ( v === null || v === undefined || v === false ) continue;
		if ( k === 'class' ) n.className = v;
		else if ( k.startsWith( 'on' ) ) n.addEventListener( k.slice( 2 ), v );
		else n.setAttribute( k, v );
	}
	for ( const kid of kids.flat() ) {
		if ( kid === null || kid === undefined || kid === false || kid === '' ) continue;
		n.append( kid instanceof Node ? kid : String( kid ) );
	}
	return n;
}

// Google gets a chip per product; every other tool is coloured by its group
// (ads, analytics, replay, cdp, marketing, b2b).
function chipFor( hit ) {
	if ( hit.vendor === 'google' ) {
		const [ , text, cls ] = CHIPS.find( ( [ re ] ) => re.test( hit.kind ) ) || [ null, () => 'Google', 'g-gtm' ];
		return { text: text( hit.kind ), cls };
	}
	const v = PW.vendorInfo( hit.vendor );
	return { text: v.name, cls: v.group };
}

function sigState( v ) {
	return typeof v === 'string' ? { state: v, how: 'page state when it fired' } : v || { state: null, how: 'not set' };
}

function consentChips( consent, prefix ) {
	if ( ! consent ) return null;
	const sigs = PW.SIGNALS.filter( s => consent[ s ] );
	if ( ! sigs.length ) return null;
	// Four dashes on every row says less than this does.
	if ( sigs.every( s => ! sigState( consent[ s ] ).state ) ) {
		return el( 'span', { class: 'consent', title: 'The page hasn\'t set up Google Consent Mode' }, ( prefix ? prefix + ' ' : '' ) + 'consent mode not set' );
	}
	return el( 'span', { class: 'consent' },
		prefix ? el( 'span', null, prefix ) : null,
		sigs.map( s => {
			const st = sigState( consent[ s ] );
			const mark = st.state === 'granted' ? '✓' : st.state === 'denied' ? '✗' : '–';
			return el( 'span', { class: 'sig ' + ( st.state || '' ), title: s + ': ' + st.how }, SIG_LABEL[ s ] + ' ' + mark );
		} )
	);
}

function consentText( consent ) {
	if ( ! consent ) return '';
	return PW.SIGNALS.filter( s => consent[ s ] )
		.map( s => SIG_LABEL[ s ] + ' ' + ( sigState( consent[ s ] ).state || 'not set' ) )
		.join( ', ' );
}

function statusOf( hit ) {
	if ( hit.status === null || hit.status === undefined ) return { text: '…', title: 'Waiting for a response' };
	if ( hit.status === 'error' ) return { text: '✕ ' + hit.error, err: true };
	if ( hit.status === 'cache' ) return { text: 'cache', title: 'Loaded from Firefox\'s cache' };
	if ( hit.status >= 300 && hit.status < 400 ) return { text: hit.status + ' →', title: 'Redirected' };
	return { text: String( hit.status ), err: hit.status >= 400 };
}

function visible( e ) {
	if ( e.type === 'nav' ) return true;
	// dataLayer events stay in view under a tool filter: they're what made it fire.
	if ( e.type === 'dl' ) return prefs.dl;
	if ( prefs.vendor !== 'all' && e.vendor !== prefs.vendor ) return false;
	if ( e.category === 'hit' ) return true;
	// A blocked script explains missing hits, so always show those.
	return prefs.extras || e.status === 'error';
}

function since( t, start ) {
	if ( ! start ) return new Date( t ).toLocaleTimeString();
	const s = ( t - start ) / 1000;
	return '+' + ( s < 10 ? s.toFixed( 2 ) : s < 100 ? s.toFixed( 1 ) : Math.round( s ) ) + 's';
}

function shortUrl( url ) {
	try {
		const u = new URL( url );
		return u.host + u.pathname + u.search;
	} catch ( e ) {
		return url;
	}
}

// Puts text on the clipboard and flashes a note on the element.
async function copyText( text, node ) {
	try {
		await navigator.clipboard.writeText( String( text ) );
		flash( node, 'Copied' );
	} catch ( e ) {
		flash( node, 'Copy failed' );
	}
}
function flash( node, msg ) {
	node.dataset.flash = msg;
	node.classList.add( 'flashed' );
	clearTimeout( node.flashTimer );
	node.flashTimer = setTimeout( () => node.classList.remove( 'flashed' ), 1100 );
}

// Click (or Enter) copies `text`. Never opens or closes the row underneath,
// and leaves a drag-selection alone so part of a value can still be copied.
function copyable( tag, text, attrs, ...kids ) {
	const node = el( tag, Object.assign( { tabindex: '0', title: 'Click to copy' }, attrs || {} ), ...( kids.length ? kids : [ String( text ) ] ) );
	node.classList.add( 'copyable' );
	const go = ev => {
		if ( ev.type === 'keydown' && ev.key !== 'Enter' && ev.key !== ' ' ) return;
		ev.stopPropagation();
		if ( ev.type === 'click' && String( window.getSelection() ) ) return;
		ev.preventDefault();
		copyText( text, node );
	};
	node.addEventListener( 'click', go );
	node.addEventListener( 'keydown', go );
	return node;
}

// Key/value table where every key and value copies on click.
function kvTable( obj, keys, labelFor ) {
	return el( 'table', null, el( 'tbody', null, keys.map( k => el( 'tr', null,
		copyable( 'td', k, { class: 'k' } ),
		labelFor ? el( 'td', { class: 'l' }, labelFor( k ) ) : null,
		copyable( 'td', obj[ k ], { class: 'v' } )
	) ) ) );
}
// Tab-separated, so it pastes into a spreadsheet as two columns.
const tsv = ( obj, keys ) => keys.map( k => k + '\t' + String( obj[ k ] ).replace( /[\t\r\n]+/g, ' ' ) ).join( '\n' );

function button( label, onclick ) {
	return el( 'button', { type: 'button', onclick: ev => { ev.stopPropagation(); onclick( ev.currentTarget ); } }, label );
}

/*
 * GTM's data model as it stood at an entry: every plain-object push on the
 * same page up to it, merged the way GTM merges them (what Tag Assistant's
 * Data Layer tab shows). `inclusive` counts the entry itself.
 */
function modelAt( entry, inclusive ) {
	const list = data.entries;
	const i = list.indexOf( entry );
	let start = i;
	while ( start > 0 && list[ start - 1 ].type !== 'nav' ) start--;
	const model = {};
	let pushes = 0;
	for ( let j = start; j < ( inclusive ? i + 1 : i ); j++ ) {
		const e = list[ j ];
		if ( e.type === 'dl' ) {
			PW.mergeDataLayer( model, e.data );
			pushes++;
		}
	}
	return { model, pushes };
}

// The merged model as a table, gtm.* housekeeping keys last.
function modelView( model, intro ) {
	const flat = PW.flatten( model );
	const keys = Object.keys( flat ).sort( ( a, b ) => a.startsWith( 'gtm.' ) - b.startsWith( 'gtm.' ) );
	return [
		el( 'div', { class: 'note' }, intro ),
		keys.length ? kvTable( flat, keys ) : el( 'div', { class: 'note' }, 'Nothing pushed yet.' ),
		el( 'div', { class: 'raw' },
			el( 'code', null, keys.length + ( keys.length === 1 ? ' value' : ' values' ) ),
			button( 'Copy table', b => copyText( tsv( flat, keys ), b ) ),
			button( 'Copy JSON', b => copyText( JSON.stringify( model, null, 2 ), b ) )
		),
	];
}

// Two views of an open row: its own data, or the dataLayer at that moment.
function viewTabs( uid, labels ) {
	const current = views.get( uid ) || 'own';
	return el( 'div', { class: 'views', role: 'tablist' }, Object.entries( labels ).map( ( [ key, label ] ) => el( 'button', {
		type: 'button', role: 'tab', 'aria-selected': String( current === key ),
		onclick: ev => {
			ev.stopPropagation();
			views.set( uid, key );
			render();
		},
	}, label ) ) );
}

function detail( hit ) {
	const at = modelAt( hit, false );
	const tabs = at.pushes ? viewTabs( hit.uid, { own: 'Parameters', model: 'dataLayer when it fired' } ) : null;
	if ( at.pushes && views.get( hit.uid ) === 'model' ) {
		return el( 'div', { class: 'detail' }, tabs, modelView( at.model, 'The merged dataLayer at the moment this request was sent, after ' + at.pushes + ( at.pushes === 1 ? ' push.' : ' pushes.' ) ) );
	}
	const keys = PW.sortedKeys( hit.params || {} );
	const facts = [];
	if ( hit.frame ) facts.push( 'Sent from an iframe on ' + hit.frame );
	if ( hit.method && hit.method !== 'GET' ) facts.push( 'Sent as ' + hit.method );
	if ( hit.page ) {
		if ( hit.page.banner ) facts.push( 'Cookie banner (' + hit.page.banner.cookie + '): ' + ( hit.page.banner.categories.join( ', ' ) || 'nothing accepted' ) );
		else facts.push( 'No consent cookie set when it fired' );
		if ( ! hit.page.google ) facts.push( 'No Google consent mode on the page' );
	}
	return el( 'div', { class: 'detail' },
		tabs,
		facts.map( f => el( 'div', { class: 'note' }, f ) ),
		kvTable( hit.params || {}, keys, k => PW.label( k, hit.vendor ) ),
		el( 'div', { class: 'raw' },
			copyable( 'code', hit.url ),
			button( 'Copy table', b => copyText( tsv( hit.params || {}, keys ), b ) ),
			button( 'Copy URL', b => copyText( hit.url, b ) )
		)
	);
}

function dlDetail( e ) {
	const tabs = viewTabs( e.uid, { own: 'This push', model: 'dataLayer after this push' } );
	if ( views.get( e.uid ) === 'model' ) {
		const at = modelAt( e, true );
		return el( 'div', { class: 'detail' }, tabs, modelView( at.model, Array.isArray( e.data )
			? 'gtag() calls don\'t change the dataLayer. This is the merged state after the ' + at.pushes + ( at.pushes === 1 ? ' push' : ' pushes' ) + ' so far.'
			: 'The merged dataLayer after this push: everything pushed on this page so far, combined the way GTM combines it.' ) );
	}
	const keys = PW.sortedKeys( e.params || {} );
	return el( 'div', { class: 'detail' },
		tabs,
		kvTable( e.params || {}, keys ),
		el( 'div', { class: 'raw' },
			el( 'code', null, e.layer + '.push(…)' ),
			button( 'Copy table', b => copyText( tsv( e.params || {}, keys ), b ) ),
			button( 'Copy JSON', b => copyText( JSON.stringify( e.data, null, 2 ), b ) )
		)
	);
}

// A dataLayer push or gtag() call: what GTM saw, rather than a request.
function dlRow( e, start ) {
	const open = expanded.has( e.uid );
	const node = el( 'div', {
		class: 'row dl',
		role: 'button',
		tabindex: '0',
		'aria-expanded': open ? 'true' : 'false',
	},
		el( 'span', { class: 'time', title: new Date( e.t ).toLocaleTimeString() }, since( e.t, start ) ),
		el( 'div', { class: 'main' },
			el( 'div', { class: 'line' },
				el( 'span', { class: 'chip dl' }, e.kind ),
				Array.isArray( e.data ) && e.data[ 0 ] === 'config' && typeof e.data[ 1 ] === 'string'
					? [ el( 'span', { class: 'ev' }, 'config' ), copyable( 'span', e.data[ 1 ], { class: 'id' } ) ]
					: el( 'span', { class: 'ev' }, e.event ),
				e.label ? el( 'span', { class: 'kind' }, e.label ) : null,
				e.layer && e.layer !== 'dataLayer' ? el( 'span', { class: 'id' }, e.layer ) : null,
				e.consent ? consentChips( e.consent ) : null
			),
			e.summary ? el( 'div', { class: 'sum', title: e.summary }, e.summary ) : null,
			( e.notes || [] ).map( n => el( 'div', { class: 'note' }, n ) )
		),
		el( 'span', { class: 'status' } ),
		open ? dlDetail( e ) : null
	);
	const toggle = ev => {
		if ( ev.target.closest( '.detail' ) ) return;
		if ( ev.type === 'keydown' && ev.key !== 'Enter' && ev.key !== ' ' ) return;
		ev.preventDefault();
		if ( expanded.has( e.uid ) ) expanded.delete( e.uid );
		else expanded.add( e.uid );
		render();
	};
	node.addEventListener( 'click', toggle );
	node.addEventListener( 'keydown', toggle );
	return node;
}

function row( hit, start ) {
	const chip = chipFor( hit );
	const st = statusOf( hit );
	const kind = PLAIN_KINDS.includes( hit.kind ) || hit.kind === chip.text ? null : hit.kind;
	const consent = hit.consent
		? consentChips( hit.consent )
		: hit.page && hit.page.google ? consentChips( hit.page.google, 'page:' ) : null;
	const minor = hit.category !== 'hit';
	const open = expanded.has( hit.uid );

	const node = el( 'div', {
		class: 'row' + ( hit.warning ? ' warned' : '' ) + ( minor ? ' minor' : '' ),
		role: 'button',
		tabindex: '0',
		'aria-expanded': open ? 'true' : 'false',
	},
		el( 'span', { class: 'time', title: new Date( hit.t ).toLocaleTimeString() }, since( hit.t, start ) ),
		el( 'div', { class: 'main' },
			el( 'div', { class: 'line' },
				el( 'span', { class: 'chip ' + chip.cls }, chip.text ),
				hit.event ? el( 'span', { class: 'ev' }, hit.event ) : null,
				kind ? el( 'span', { class: 'kind' }, kind ) : null,
				hit.id ? copyable( 'span', hit.id, { class: 'id' } ) : null,
				hit.via ? el( 'span', { class: 'via', title: 'The request says Google Tag Manager installed this tag' }, 'via ' + hit.via ) : null,
				consent
			),
			hit.summary ? el( 'div', { class: 'sum', title: hit.summary }, hit.summary ) : null,
			hit.warning ? el( 'div', { class: 'warning' }, '⚠ ' + hit.warning ) : null,
			( hit.notes || [] ).map( n => el( 'div', { class: 'note' }, n ) )
		),
		el( 'span', { class: 'status' + ( st.err ? ' err' : '' ), title: st.title || null }, st.text ),
		open ? detail( hit ) : null
	);
	const toggle = ev => {
		if ( ev.target.closest( '.detail' ) ) return;
		if ( ev.type === 'keydown' && ev.key !== 'Enter' && ev.key !== ' ' ) return;
		ev.preventDefault();
		if ( expanded.has( hit.uid ) ) expanded.delete( hit.uid );
		else expanded.add( hit.uid );
		render();
	};
	node.addEventListener( 'click', toggle );
	node.addEventListener( 'keydown', toggle );
	return node;
}

// Redrawing replaces the list, which would wipe a selection the moment a new
// hit arrives. Hold redraws while text in the list is selected.
let pendingRender = false;
function selectingInList() {
	const sel = window.getSelection();
	return !! sel && ! sel.isCollapsed && $( '#list' ).contains( sel.anchorNode );
}
document.addEventListener( 'selectionchange', () => {
	if ( pendingRender && ! selectingInList() ) {
		pendingRender = false;
		render();
	}
} );

function render() {
	if ( selectingInList() ) {
		pendingRender = true;
		return;
	}
	const list = $( '#list' );
	const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
	const keep = list.scrollTop;

	const out = [];
	let start = 0;
	for ( const e of data.entries ) {
		if ( e.type === 'nav' ) {
			start = e.t;
			out.push( el( 'div', { class: 'nav' },
				el( 'span', null, e.spa ? 'Route' : 'Page' ),
				el( 'span', { class: 'url', title: e.url }, shortUrl( e.url ) ),
				el( 'span', null, new Date( e.t ).toLocaleTimeString() )
			) );
			continue;
		}
		if ( visible( e ) ) out.push( e.type === 'dl' ? dlRow( e, start ) : row( e, start ) );
	}
	if ( ! data.entries.some( e => e.type !== 'nav' && visible( e ) ) ) {
		out.push( el( 'div', { class: 'empty' },
			data.entries.length
				? 'Nothing matching these filters yet.'
				: 'No tracking requests seen in this tab yet. Reload the page to catch everything from the start.'
		) );
	}
	list.replaceChildren( ...out );
	list.scrollTop = atBottom ? list.scrollHeight : keep;

	renderCounts();
	renderVendors();
	renderNow();
	$( '#extras' ).checked = prefs.extras;
	$( '#dl' ).checked = prefs.dl;
}

// One chip per tool seen in this tab, busiest first. A tool that only loaded
// scripts still gets a chip (with 0), so you can see it's there.
function renderVendors() {
	const seen = new Map();
	for ( const e of data.entries ) {
		if ( e.type !== 'hit' ) continue;
		const c = seen.get( e.vendor ) || { hits: 0, warn: false };
		if ( e.category === 'hit' ) c.hits++;
		if ( e.warning ) c.warn = true;
		seen.set( e.vendor, c );
	}
	if ( prefs.vendor !== 'all' && ! seen.has( prefs.vendor ) ) seen.set( prefs.vendor, { hits: 0, warn: false } );
	const chips = [ [ 'all', 'All', null ] ].concat(
		[ ...seen ].sort( ( a, b ) => b[ 1 ].hits - a[ 1 ].hits ).map( ( [ key, c ] ) => [ key, PW.vendorInfo( key ).name, c ] )
	);
	$( '#vendors' ).replaceChildren( ...chips.map( ( [ key, name, c ] ) => el( 'button', {
		type: 'button',
		class: 'vchip' + ( key === 'all' ? '' : ' ' + PW.vendorInfo( key ).group ) + ( c && c.warn ? ' warned' : '' ),
		'aria-pressed': String( prefs.vendor === key ),
		title: c && c.warn ? 'Has consent warnings' : null,
		onclick: () => {
			prefs.vendor = key;
			savePrefs();
			render();
		},
	}, name, c ? el( 'span', { class: 'n' }, c.hits ) : null ) ) );
}

function renderCounts() {
	const page = data.entries.filter( e => e.type === 'hit' && e.category === 'hit' && e.t >= data.pageStart );
	const tools = new Set( page.map( e => e.vendor ) ).size;
	const warns = page.filter( e => e.warning ).length;
	const blocked = data.entries.filter( e => e.type === 'hit' && e.status === 'error' && e.t >= data.pageStart ).length;
	$( '#counts' ).replaceChildren( ...[
		el( 'span', null, 'This page: ', el( 'b', null, page.length ), page.length === 1 ? ' hit from ' : ' hits from ', el( 'b', null, tools ), tools === 1 ? ' tool' : ' tools' ),
		warns ? el( 'span', { class: 'bad' }, '⚠ ' + warns + ( warns === 1 ? ' consent warning' : ' consent warnings' ) ) : null,
		blocked ? el( 'span', { class: 'bad' }, blocked + ' blocked' ) : null,
	].filter( Boolean ) );
}

function renderNow() {
	const box = $( '#now' );
	if ( ! now ) {
		box.replaceChildren();
		return;
	}
	const parts = [
		( now.google && consentChips( now.google, 'Google consent now:' ) ) || el( 'span', null, 'No Google Consent Mode on this page' ),
		now.banner ? el( 'span', null, 'banner: ' + ( now.banner.categories.join( ', ' ) || 'nothing accepted' ) ) : null,
		now.gpc ? el( 'span', null, 'GPC on' ) : null,
		now.tags && now.tags.length ? el( 'span', { class: 'tags', title: 'Containers and Google tags loaded on the page' }, 'tags:', now.tags.map( t => copyable( 'span', t, { class: 'tagid' } ) ) ) : null,
	].filter( Boolean );
	box.replaceChildren( ...parts.flatMap( ( n, i ) => i ? [ el( 'span', null, '·' ), n ] : [ n ] ) );
}

async function refresh() {
	if ( tabId === null ) return;
	try {
		const [ got, tab ] = await Promise.all( [
			browser.runtime.sendMessage( { type: 'get', tabId } ),
			browser.runtime.sendMessage( { type: 'tab', tabId } ),
		] );
		data = got || data;
		$( '#host' ).textContent = tab && tab.url ? shortUrl( tab.url ) : '';
		$( '#host' ).title = tab && tab.url ? tab.url : '';
	} catch ( e ) {
		return;
	}
	if ( Date.now() - lastProbe > 1000 ) probeNow();
	render();
}

// The page's consent can change without any request (someone clicks the
// banner), so re-read it on a timer as well as on each update.
function probeNow() {
	if ( tabId === null ) return;
	lastProbe = Date.now();
	const asked = tabId;
	browser.runtime.sendMessage( { type: 'probe', tabId } ).then( r => {
		if ( asked !== tabId ) return;
		now = r;
		renderNow();
	}, () => {} );
}
setInterval( probeNow, 2000 );

let queued = false;
function queueRefresh() {
	if ( queued ) return;
	queued = true;
	requestAnimationFrame( () => {
		queued = false;
		refresh();
	} );
}

function logText() {
	const lines = [ 'Pixel & Tag Tracer log, copied ' + new Date().toLocaleString() ];
	let start = 0;
	for ( const e of data.entries ) {
		if ( e.type === 'nav' ) {
			start = e.t;
			lines.push( '', '== ' + e.url + ' (' + new Date( e.t ).toLocaleTimeString() + ')' );
			continue;
		}
		if ( ! visible( e ) ) continue;
		if ( e.type === 'dl' ) {
			lines.push( [ since( e.t, start ), e.kind, e.event, e.label, e.consent && '[' + consentText( e.consent ) + ']' ].filter( Boolean ).join( '  ' ) );
			if ( e.summary ) lines.push( '        ' + e.summary );
			continue;
		}
		const st = statusOf( e ).text;
		const consent = e.consent ? consentText( e.consent ) : e.page && e.page.google ? 'page: ' + consentText( e.page.google ) : '';
		lines.push( [ since( e.t, start ), e.kind, e.event, e.id, consent && '[' + consent + ']', st ].filter( Boolean ).join( '  ' ) );
		if ( e.summary ) lines.push( '        ' + e.summary );
		if ( e.warning ) lines.push( '        ! ' + e.warning );
		( e.notes || [] ).forEach( n => lines.push( '        - ' + n ) );
	}
	return lines.join( '\n' );
}

async function copy( text, button ) {
	const was = button.textContent;
	try {
		await navigator.clipboard.writeText( text );
		button.textContent = 'Copied';
	} catch ( e ) {
		button.textContent = 'Copy failed';
	}
	setTimeout( () => { button.textContent = was; }, 1200 );
}

$( '#copy' ).addEventListener( 'click', ev => copy( logText(), ev.currentTarget ) );
$( '#clear' ).addEventListener( 'click', async () => {
	expanded.clear();
	await browser.runtime.sendMessage( { type: 'clear', tabId } );
	refresh();
} );
$( '#sidebar' ).addEventListener( 'click', () => {
	// Must run inside the click handler: sidebars only open on user input.
	browser.sidebarAction.open();
	window.close();
} );
$( '#dl' ).addEventListener( 'change', ev => {
	prefs.dl = ev.target.checked;
	savePrefs();
	render();
} );
$( '#extras' ).addEventListener( 'change', ev => {
	prefs.extras = ev.target.checked;
	savePrefs();
	render();
} );

browser.runtime.onMessage.addListener( msg => {
	if ( msg && msg.type === 'changed' && msg.tabId === tabId ) queueRefresh();
} );

function showTab( id ) {
	tabId = id;
	expanded.clear();
	views.clear();
	now = null;
	lastProbe = 0;
	refresh();
}

// Sidebar only: keep showing one tab's log while you work in others.
let locked = false;
function setLocked( on ) {
	locked = on;
	const b = $( '#lock' );
	b.setAttribute( 'aria-pressed', String( on ) );
	b.textContent = on ? 'Locked to tab' : 'Lock to this tab';
	b.title = on
		? 'Showing this tab while you use others. Click to follow the active tab again.'
		: 'Keep showing this tab while you use other tabs';
	document.body.classList.toggle( 'locked', on );
}
async function unlock() {
	setLocked( false );
	const [ active ] = await browser.tabs.query( { active: true, windowId } );
	if ( active && active.id !== tabId ) showTab( active.id );
}
$( '#lock' ).addEventListener( 'click', () => {
	if ( locked ) unlock();
	else setLocked( true );
} );

( async () => {
	if ( view === 'tab' ) {
		tabId = Number( params.get( 'tab' ) );
	} else if ( view === 'devtools' ) {
		tabId = browser.devtools.inspectedWindow.tabId;
	} else {
		const win = await browser.windows.getCurrent();
		windowId = win.id;
		const [ active ] = await browser.tabs.query( { active: true, windowId } );
		tabId = active ? active.id : null;
	}
	if ( view === 'sidebar' ) {
		// The sidebar follows the active tab unless it's locked to one.
		browser.tabs.onActivated.addListener( info => {
			if ( info.windowId !== windowId || locked ) return;
			showTab( info.tabId );
		} );
		browser.tabs.onRemoved.addListener( closed => {
			if ( locked && closed === tabId ) unlock();
		} );
	}
	refresh();
} )();
