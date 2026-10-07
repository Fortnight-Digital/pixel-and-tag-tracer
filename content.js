/*
 * Pixel & Tag Tracer — dataLayer watcher.
 *
 * Runs in each page's top frame and reports every dataLayer push (GTM
 * events, gtag() calls) to the background, so the timeline shows what GTM
 * saw next to the hits it fired. Reads the page's own objects through
 * wrappedJSObject and never changes anything the page relies on: push is
 * wrapped only to learn the exact moment, and a poll catches anything else.
 */
'use strict';

( () => {
	const page = window.wrappedJSObject;
	if ( ! page ) return;

	const MAX_DEPTH = 5, MAX_KEYS = 80, MAX_STR = 1000;
	const arrays = new Map(); // dataLayer name -> { id, seen }

	// A plain, cloneable copy of whatever the page pushed. Pushes can hold DOM
	// elements (gtm.element), callbacks (eventCallback) and gtag's `arguments`.
	function describe( v, depth ) {
		try {
			if ( v === null ) return null;
			if ( v === undefined ) return '(undefined)';
			const t = typeof v;
			if ( t === 'string' ) return v.length > MAX_STR ? v.slice( 0, MAX_STR ) + '…' : v;
			if ( t === 'number' || t === 'boolean' ) return v;
			if ( t === 'function' ) return 'ƒ ' + ( v.name || 'function' );
			if ( t !== 'object' ) return String( v );
			if ( typeof v.nodeType === 'number' && typeof v.nodeName === 'string' ) {
				const cls = typeof v.className === 'string' && v.className.trim() ? '.' + v.className.trim().split( /\s+/ ).slice( 0, 3 ).join( '.' ) : '';
				return '<' + v.nodeName.toLowerCase() + ( v.id ? '#' + v.id : '' ) + cls + '>';
			}
			if ( v.window === v ) return '(window)';
			if ( depth >= MAX_DEPTH ) return Array.isArray( v ) ? '[…]' : '{…}';
			const keys = Object.keys( v );
			// gtag() pushes its `arguments`: array-like, numeric keys only.
			if ( Array.isArray( v ) || ( typeof v.length === 'number' && keys.every( k => /^\d+$/.test( k ) ) ) ) {
				return Array.from( v ).slice( 0, MAX_KEYS ).map( x => describe( x, depth + 1 ) );
			}
			const out = {};
			for ( const k of keys.slice( 0, MAX_KEYS ) ) out[ k ] = describe( v[ k ], depth + 1 );
			return out;
		} catch ( e ) {
			return '(unreadable)';
		}
	}

	function report( name, items, t ) {
		browser.runtime.sendMessage( { type: 'dl', name, t, items: items.map( x => describe( x, 0 ) ) } ).catch( () => {} );
	}

	let nextId = 0;
	function scan( name, t ) {
		let arr;
		try { arr = page[ name ]; } catch ( e ) { return; }
		if ( ! arr || typeof arr.length !== 'number' ) return;
		// Recognise the array by a hidden marker rather than by object identity,
		// so it's only ever wrapped once however Firefox hands it back.
		let id = 0;
		try { id = arr.__pixelWatch || 0; } catch ( e ) {}
		if ( ! id ) {
			id = ++nextId;
			try { Object.defineProperty( arr, '__pixelWatch', { value: id } ); } catch ( e ) { return; }
			hook( name, arr );
		}
		let s = arrays.get( name );
		if ( ! s || s.id !== id ) {
			s = { id, seen: 0 };
			arrays.set( name, s );
		}
		const n = arr.length;
		if ( n <= s.seen ) return;
		const items = [];
		for ( let i = s.seen; i < n; i++ ) items.push( arr[ i ] );
		s.seen = n;
		report( name, items, t || Date.now() );
	}

	// Wrap push so each event is timed the moment it happens: GTM fires tags
	// inside push, so the time is taken before passing it on. GTM wraps push
	// again on top of this and still calls through.
	//
	// The call to the original push must be made from this side with the
	// arguments spread (Reflect.apply), so Firefox hands the page back its own
	// objects. Calling the page's own apply with this side's `arguments` throws
	// "Permission denied", which would break the site's dataLayer.
	function hook( name, arr ) {
		try {
			const orig = arr.push;
			arr.push = exportFunction( function ( ...args ) {
				const t = Date.now();
				const r = Reflect.apply( orig, arr, args );
				try { scan( name, t ); } catch ( e ) {}
				return r;
			}, page );
		} catch ( e ) {}
	}

	// GTM can use a renamed dataLayer: gtm.js?id=GTM-X&l=myLayer.
	function names() {
		const out = new Set( [ 'dataLayer' ] );
		for ( const s of document.querySelectorAll( 'script[src*="googletagmanager.com/"]' ) ) {
			try {
				const l = new URL( s.src ).searchParams.get( 'l' );
				if ( l && /^[\w$]+$/.test( l ) ) out.add( l );
			} catch ( e ) {}
		}
		return out;
	}

	let layerNames = names();
	let ticks = 0;
	const poll = () => {
		if ( ++ticks % 4 === 0 ) layerNames = names();
		layerNames.forEach( n => scan( n ) );
	};
	poll();
	document.addEventListener( 'DOMContentLoaded', poll );
	setInterval( poll, 500 );
} )();
