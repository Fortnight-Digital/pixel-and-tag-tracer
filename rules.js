/*
 * Pixel & Tag Tracer — request classifier: Google, Meta and Segment in full, plus
 * the vendor registry that vendors.js fills with everything else.
 *
 * Pure functions, no browser APIs, so tests/run.js can exercise them under
 * node. Loaded by both the background page and the panel (for labels).
 */
'use strict';

const PW = (() => {

	// What the background listens on (plus each vendor's hosts). Kept narrow
	// so Firefox only copies request bodies for traffic we care about;
	// classify() does the strict host checks.
	const CORE_LISTEN = [
		'*://*.google-analytics.com/*',
		'*://*.analytics.google.com/g/collect*',
		'*://*.doubleclick.net/*',
		'*://*.googleadservices.com/*',
		'*://*.googletagmanager.com/*',
		'*://*/pagead/*',     // google.<any tld>/pagead/1p-user-list etc.
		'*://*/ccm/*',
		'*://*/rmkt/*',
		'*://*/g/collect*',   // GA4 through a server-side GTM on a custom domain
		'*://*.facebook.com/tr*',
		'*://*.facebook.com/privacy_sandbox/*',
		'*://connect.facebook.net/*',
		'*://*.segment.io/*',        // api.segment.io, legacy cdn.segment.io
		'*://*.segmentapis.com/*',   // EU workspaces
		'*://cdn.segment.com/*',
		'*://*.segmentcdn.com/*',
	];

	const SIGNALS = [ 'ad_storage', 'analytics_storage', 'ad_user_data', 'ad_personalization' ];

	// Consent Mode v2 `gcd` letters: what the page set as default, then update.
	const GCD = {
		l: { state: null,      how: 'not set' },
		p: { state: 'denied',  how: 'denied by default' },
		q: { state: 'denied',  how: 'denied by default and by update' },
		t: { state: 'granted', how: 'granted by default' },
		r: { state: 'granted', how: 'denied by default, granted by update' },
		m: { state: 'denied',  how: 'denied by update' },
		n: { state: 'granted', how: 'granted by update' },
		u: { state: 'denied',  how: 'granted by default, denied by update' },
		v: { state: 'granted', how: 'granted by default and by update' },
	};

	const META_AUTO = {
		Microdata: 'Automatic event: the pixel scraped the page\'s structured data',
		SubscribedButtonClick: 'Automatic event: the pixel saw a button click',
	};

	const SEG_TYPES = { t: 'track', p: 'page', i: 'identify', g: 'group', a: 'alias', s: 'screen', b: 'batch' };
	// What analytics.js fills into every page() call; the rest is the site's own.
	const SEG_PAGE_PROPS = [ 'path', 'referrer', 'search', 'title', 'url', 'name', 'category' ];

	const hostIs = ( h, d ) => h === d || h.endsWith( '.' + d );
	const isGoogleHost = h => /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/.test( h );

	function paramsOf( search ) {
		const o = {};
		for ( const [ k, v ] of search ) {
			o[ k ] = k in o ? o[ k ] + ', ' + v : v;
		}
		return o;
	}

	function formDataParams( fd ) {
		const o = {};
		for ( const k of Object.keys( fd ) ) {
			o[ k ] = [].concat( fd[ k ] ).join( ', ' );
		}
		return o;
	}

	// Request body as params: form posts arrive parsed, beacons as text.
	function bodyParams( body ) {
		if ( ! body ) return {};
		if ( body.formData ) return formDataParams( body.formData );
		if ( body.text && /^[^\s{<][^\n]*=/.test( body.text ) ) {
			return paramsOf( new URLSearchParams( body.text.trim() ) );
		}
		return {};
	}

	// JSON, form or urlencoded body as an object; null when it's none of those.
	function parseBody( body ) {
		if ( ! body ) return null;
		if ( body.formData ) return formDataParams( body.formData );
		if ( ! body.text ) return null;
		const t = body.text.trim();
		if ( /^[[{]/.test( t ) ) {
			try { return JSON.parse( t ); } catch ( e ) { return null; }
		}
		return /^[^\s<][^\n]*=/.test( t ) ? paramsOf( new URLSearchParams( t ) ) : null;
	}

	// Some libraries (Mixpanel, Klaviyo's legacy API, PostHog) base64 their JSON.
	function jsonish( v ) {
		if ( v === null || v === undefined ) return null;
		if ( typeof v === 'object' ) return v;
		const t = String( v ).trim();
		try { return JSON.parse( t ); } catch ( e ) {}
		try {
			const bin = atob( t.replace( /-/g, '+' ).replace( /_/g, '/' ) );
			const bytes = Uint8Array.from( bin, c => c.charCodeAt( 0 ) );
			return JSON.parse( new TextDecoder().decode( bytes ) );
		} catch ( e ) {
			return null;
		}
	}

	function googleConsent( q ) {
		const out = {};
		const gcd = q.gcd || '';
		if ( gcd.length >= 9 ) {
			SIGNALS.forEach( ( s, i ) => {
				const L = GCD[ gcd[ 2 + i * 2 ] ];
				if ( L ) out[ s ] = L;
			} );
		}
		const gcs = /^G1([01])([01])$/.exec( q.gcs || '' );
		if ( gcs ) {
			if ( ! out.ad_storage || ! out.ad_storage.state ) {
				out.ad_storage = { state: gcs[ 1 ] === '1' ? 'granted' : 'denied', how: 'from gcs=' + q.gcs };
			}
			if ( ! out.analytics_storage || ! out.analytics_storage.state ) {
				out.analytics_storage = { state: gcs[ 2 ] === '1' ? 'granted' : 'denied', how: 'from gcs=' + q.gcs };
			}
		}
		return Object.keys( out ).length ? out : null;
	}

	function consentNotes( consent, needs ) {
		if ( ! consent ) return [];
		const denied = needs.filter( s => consent[ s ] && consent[ s ].state === 'denied' );
		return denied.length
			? [ denied.join( ' + ' ) + ' denied, so Google treats this as a cookieless ping (Consent Mode)' ]
			: [];
	}

	// Event params worth a glance in the row itself.
	function summarise( params, prefixes ) {
		const bits = [];
		for ( const k of Object.keys( params ) ) {
			const p = prefixes.find( x => k.startsWith( x ) );
			if ( ! p ) continue;
			const name = k.slice( p.length ).replace( /\]$/, '' );
			bits.push( name + '=' + params[ k ] );
		}
		return bits.join( ' · ' );
	}

	// Nested JSON as dotted keys, so it reads like any other param table.
	// Capped: Adobe and replay payloads can run to thousands of fields.
	const MAX_KEYS = 300, MAX_VALUE = 2000;
	function flatten( obj, prefix, out ) {
		out = out || {};
		for ( const [ k, v ] of Object.entries( obj || {} ) ) {
			if ( Object.keys( out ).length >= MAX_KEYS ) {
				out[ '…' ] = 'more fields not shown';
				break;
			}
			const key = prefix ? prefix + '.' + k : k;
			if ( v && typeof v === 'object' && ! Array.isArray( v ) && Object.keys( v ).length ) flatten( v, key, out );
			else out[ key ] = ( v !== null && typeof v === 'object' ? JSON.stringify( v ) : String( v ) ).slice( 0, MAX_VALUE );
		}
		return out;
	}

	const pairs = obj => Object.entries( obj )
		.map( ( [ k, v ] ) => k + '=' + ( v !== null && typeof v === 'object' ? JSON.stringify( v ) : v ) )
		.join( ' · ' );

	function hit( vendor, kind, id, event, params, extra ) {
		return Object.assign( {
			vendor, kind, category: 'hit', id: id || null, event: event || null,
			params, consent: null, notes: [], summary: '',
		}, extra || {} );
	}
	const script = ( vendor, kind, id, params ) => hit( vendor, kind, id, null, params, { category: 'script' } );
	const aux = ( vendor, kind, id, event, params, extra ) => hit( vendor, kind, id, event, params, Object.assign( { category: 'aux' }, extra || {} ) );

	function ga4Hits( q, body, serverHost ) {
		const lines = body && body.text ? body.text.split( /\r?\n/ ).filter( l => l.includes( '=' ) ) : [];
		const events = lines.length
			? lines.map( l => Object.assign( {}, q, paramsOf( new URLSearchParams( l ) ) ) )
			: [ Object.assign( {}, q, body && body.formData ? formDataParams( body.formData ) : {} ) ];
		return events.map( e => {
			const consent = googleConsent( e );
			const notes = consentNotes( consent, [ 'analytics_storage' ] );
			if ( serverHost ) notes.unshift( 'Sent to ' + serverHost + ' (server-side tagging), not straight to Google' );
			if ( lines.length > 1 ) notes.push( 'Batched: one request carried ' + lines.length + ' events' );
			return hit( 'google', serverHost ? 'GA4 (server-side)' : 'GA4', e.tid, e.en || '(no event name)', e, {
				consent, notes, summary: summarise( e, [ 'ep.', 'epn.' ] ),
			} );
		} );
	}

	function adsEvent( q ) {
		if ( q.en ) return q.en;
		const m = /(?:^|;)event=([^;]+)/.exec( q.data || '' );
		return m ? m[ 1 ] : null;
	}

	function adsHit( kind, id, q, category ) {
		const consent = googleConsent( q );
		const notes = consentNotes( consent, [ 'ad_storage' ] );
		if ( q.npa === '1' ) notes.push( 'npa=1: non-personalised ads only' );
		const bits = [];
		if ( q.label ) bits.push( 'label=' + q.label );
		if ( q.value ) bits.push( 'value=' + q.value + ( q.currency_code ? ' ' + q.currency_code : '' ) );
		if ( q.oid || q.transaction_id ) bits.push( 'order=' + ( q.oid || q.transaction_id ) );
		return hit( 'google', kind, id ? 'AW-' + id : q.tid || null, adsEvent( q ) || ( /conversion/i.test( kind ) ? 'conversion' : null ), q, {
			category: category || 'hit', consent, notes,
			summary: [ bits.join( ' · ' ), summarise( q, [ 'ep.', 'epn.' ] ) ].filter( Boolean ).join( ' · ' ),
		} );
	}

	function floodlight( u ) {
		const parts = u.pathname.split( ';' );
		const q = paramsOf( u.searchParams );
		for ( const p of parts.slice( 1 ) ) {
			const i = p.indexOf( '=' );
			if ( i > 0 ) q[ p.slice( 0, i ) ] = decodeURIComponent( p.slice( i + 1 ) );
		}
		const consent = googleConsent( q );
		return hit( 'google', 'Floodlight', q.src ? 'DC-' + q.src : null, [ q.type, q.cat ].filter( Boolean ).join( '/' ) || null, q, {
			consent, notes: consentNotes( consent, [ 'ad_storage' ] ),
		} );
	}

	function metaHit( q, body ) {
		const params = Object.assign( {}, q, bodyParams( body ) );
		const notes = [];
		const ud = Object.keys( params ).filter( k => k.startsWith( 'ud[' ) ).map( k => k.slice( 3, -1 ) );
		if ( ud.length ) notes.push( 'Advanced matching: sends hashed ' + ud.join( ', ' ) );
		if ( META_AUTO[ params.ev ] ) notes.push( META_AUTO[ params.ev ] );
		if ( 'dpo' in params ) notes.push( 'Data processing options set: dpo=' + ( params.dpo || '(empty)' ) );
		return hit( 'meta', 'Meta Pixel', params.id, params.ev || '(no event)', params, {
			notes, summary: summarise( params, [ 'cd[' ] ), needs: 'ad_storage',
		} );
	}

	// Segment sends JSON in a text/plain POST; a batch carries several messages.
	// RudderStack speaks the same format, so it reuses this with its own name.
	function segmentHits( short, body, vendor, kind, writeKey ) {
		vendor = vendor || 'segment';
		kind = kind || 'Segment';
		let data = null;
		try { data = body && body.text ? JSON.parse( body.text ) : null; } catch ( e ) {}
		if ( ! data || typeof data !== 'object' ) {
			return [ hit( vendor, kind, writeKey || null, SEG_TYPES[ short ] || short, {}, {
				notes: [ 'Couldn\'t read the request body' ], needs: 'analytics_storage',
			} ) ];
		}
		const msgs = Array.isArray( data.batch ) ? data.batch : [ data ];
		return msgs.map( msg => {
			const type = msg.type || SEG_TYPES[ short ] || short;
			const notes = [];
			let event = type;
			let shown = msg.properties || {};
			if ( type === 'track' ) {
				event = msg.event || '(no event name)';
			} else if ( type === 'page' || type === 'screen' ) {
				event = type + ( msg.name ? ': ' + msg.name : '' );
				shown = Object.fromEntries( Object.entries( shown ).filter( ( [ k ] ) => ! SEG_PAGE_PROPS.includes( k ) ) );
			} else if ( type === 'identify' || type === 'group' ) {
				shown = msg.traits || {};
				const keys = Object.keys( shown );
				if ( keys.length ) notes.push( 'Sends ' + ( type === 'group' ? 'group' : 'user' ) + ' traits unhashed: ' + keys.join( ', ' ) );
			}
			// Segment's consent wrappers stamp the visitor's choices on each event.
			const prefs = msg.context && msg.context.consent && msg.context.consent.categoryPreferences;
			if ( prefs && typeof prefs === 'object' ) {
				notes.push( 'Consent sent with the event: ' + Object.entries( prefs ).map( ( [ k, v ] ) => k + ( v ? ' ✓' : ' ✗' ) ).join( ', ' ) );
			}
			if ( msgs.length > 1 ) notes.push( 'Batched: one request carried ' + msgs.length + ' events' );
			return hit( vendor, kind, msg.writeKey || data.writeKey || writeKey || null, event, flatten( msg, '', {} ), {
				notes,
				summary: [ msg.userId ? 'userId=' + msg.userId : '', pairs( shown ) ].filter( Boolean ).join( ' · ' ),
				// With its own consent stamp, Segment routes by that; otherwise ask the page.
				needs: prefs ? null : 'analytics_storage',
			} );
		} );
	}

	/*
	 * Vendor registry. vendors.js adds one entry per tool:
	 *   key, name, group (ads | analytics | replay | cdp | marketing | b2b),
	 *   needs   the Google consent signal its hits should wait for,
	 *   hosts   domains it owns (subdomains included; also become listen patterns),
	 *   match   optional (h, p, q) => bool for paths on other hosts,
	 *   listen  extra webRequest patterns for those,
	 *   classify(ctx) => hits, [] to ignore, or null for a generic row,
	 *   labels  optional readable names for its params.
	 */
	const VENDORS = [];
	const BUILT_IN = {
		google: { key: 'google', name: 'Google', group: 'google' },
		meta: { key: 'meta', name: 'Meta', group: 'ads' },
		segment: { key: 'segment', name: 'Segment', group: 'cdp' },
	};
	function addVendor( v ) {
		VENDORS.push( Object.assign( { hosts: [], listen: [] }, v ) );
	}
	const vendorInfo = key => BUILT_IN[ key ] || VENDORS.find( v => v.key === key ) || { key, name: key, group: 'other' };

	function listenUrls() {
		const out = CORE_LISTEN.slice();
		for ( const v of VENDORS ) {
			v.hosts.forEach( d => out.push( '*://*.' + d + '/*' ) );
			out.push( ...v.listen );
		}
		return [ ...new Set( out ) ];
	}

	// Match-pattern semantics as Firefox applies them to webRequest filters.
	function patternRe( pattern ) {
		const [ , scheme, host, path ] = /^(\*|[a-z]+):\/\/([^/]+)(\/.*)$/.exec( pattern );
		const esc = s => s.replace( /[.+?^${}()|[\]\\]/g, '\\$&' );
		const hostRe = host === '*' ? '[^/]+' : host.startsWith( '*.' ) ? '(?:[^/]+\\.)?' + esc( host.slice( 2 ) ) : esc( host );
		const schemeRe = scheme === '*' ? '(?:https?|wss?)' : esc( scheme );
		return new RegExp( '^' + schemeRe + '://' + hostRe + '(?::\\d+)?' + path.split( '*' ).map( esc ).join( '.*' ) + '$' );
	}
	let listenRes = null;
	function listened( url ) {
		if ( ! listenRes ) listenRes = listenUrls().map( patternRe );
		return listenRes.some( re => re.test( url ) );
	}

	function generic( v, p, q ) {
		return /\.m?js$/.test( p )
			? [ script( v.key, v.name + ' script', null, q ) ]
			: [ aux( v.key, v.name + ' request', null, null, q ) ];
	}

	function vendorHits( u, h, p, q, req ) {
		for ( const v of VENDORS ) {
			if ( ! v.hosts.some( d => hostIs( h, d ) ) && ! ( v.match && v.match( h, p, q ) ) ) continue;
			let hits = v.classify ? v.classify( { u, h, p, q, body: req.body, method: req.method } ) : null;
			if ( hits === null || hits === undefined ) hits = generic( v, p, q );
			for ( const x of hits ) {
				if ( x.category === 'hit' && ! ( 'needs' in x ) ) x.needs = v.needs || null;
			}
			return hits;
		}
		return undefined;
	}

	// ---------------------------------------------------------------- GTM

	// GTM's built-in events, named as Tag Assistant names them.
	const GTM_EVENTS = {
		'gtm.init_consent': 'Consent Initialization', 'gtm.init': 'Initialization', 'gtm.js': 'Container Loaded',
		'gtm.dom': 'DOM Ready', 'gtm.load': 'Window Loaded', 'gtm.click': 'Click', 'gtm.linkClick': 'Link Click',
		'gtm.formSubmit': 'Form Submit', 'gtm.historyChange': 'History Change', 'gtm.historyChange-v2': 'History Change',
		'gtm.scrollDepth': 'Scroll Depth', 'gtm.timer': 'Timer', 'gtm.video': 'YouTube Video',
		'gtm.elementVisibility': 'Element Visibility', 'gtm.triggerGroup': 'Trigger Group', 'gtm.pageError': 'JavaScript Error',
	};

	// Readable values only, nested ones as dotted keys, for a one-line summary.
	function brief( obj, max ) {
		const flat = flatten( obj || {} );
		return pairs( Object.fromEntries( Object.entries( flat ).filter( ( [ , v ] ) => v !== '' && v !== '(undefined)' ).slice( 0, max || 8 ) ) );
	}

	function gtagConsent( values, phase ) {
		const out = {};
		const where = Array.isArray( values && values.region ) && values.region.length
			? ' (' + values.region.length + ' regions: ' + values.region.slice( 0, 6 ).join( ', ' ) + ( values.region.length > 6 ? '…' : '' ) + ')'
			: '';
		for ( const sig of SIGNALS ) {
			if ( values && ( values[ sig ] === 'granted' || values[ sig ] === 'denied' ) ) {
				out[ sig ] = { state: values[ sig ], how: 'gtag consent ' + phase + where };
			}
		}
		return Object.keys( out ).length ? out : null;
	}

	/**
	 * One dataLayer push as a timeline entry. Arrays are gtag() calls
	 * (gtag pushes its `arguments`); objects are GTM events or plain data.
	 */
	function dataLayerEntry( item ) {
		if ( Array.isArray( item ) ) {
			const [ cmd, a, b ] = item;
			const entry = { kind: 'gtag', event: String( cmd ), label: '', summary: '', consent: null, params: flatten( { args: item } ), data: item, notes: [] };
			if ( cmd === 'consent' ) {
				entry.event = 'consent ' + a;
				entry.consent = gtagConsent( b, a );
				entry.params = flatten( b || {} );
				if ( b && b.region ) entry.notes.push( 'Only applies to visitors in: ' + [].concat( b.region ).join( ', ' ) );
				if ( b && b.wait_for_update ) entry.notes.push( 'Tags wait up to ' + b.wait_for_update + ' ms for an update' );
			} else if ( cmd === 'config' ) {
				entry.event = 'config ' + a;
				entry.params = flatten( b || {} );
				entry.summary = brief( b );
			} else if ( cmd === 'event' ) {
				entry.event = String( a );
				entry.label = 'gtag event';
				entry.params = flatten( b || {} );
				entry.summary = brief( b );
			} else if ( cmd === 'set' ) {
				entry.params = flatten( a && typeof a === 'object' ? a : { [ a ]: b } );
				entry.summary = brief( a && typeof a === 'object' ? a : { [ a ]: b } );
			} else if ( cmd === 'js' ) {
				entry.event = 'js';
				entry.label = 'gtag.js loaded';
			}
			return entry;
		}
		if ( item && typeof item === 'object' ) {
			const ev = typeof item.event === 'string' ? item.event : null;
			const own = Object.fromEntries( Object.entries( item ).filter( ( [ k ] ) => k !== 'event' && ! k.startsWith( 'gtm.' ) ) );
			const element = item[ 'gtm.element' ];
			return {
				kind: 'dataLayer', event: ev || 'message', label: ev ? GTM_EVENTS[ ev ] || '' : 'data pushed, no event',
				summary: [ typeof element === 'string' ? element : '', brief( own ) ].filter( Boolean ).join( ' · ' ),
				consent: null, params: flatten( item ), data: item, notes: [],
			};
		}
		return { kind: 'dataLayer', event: 'message', label: '', summary: String( item ), consent: null, params: { value: String( item ) }, data: item, notes: [] };
	}

	/*
	 * GTM's data model: what Tag Assistant's Data Layer tab shows. Each plain
	 * object pushed is merged in: nested objects merge key by key, arrays and
	 * other values replace, and `_clear: true` makes a push replace instead of
	 * merge. gtag() commands (arrays) don't change the model.
	 */
	const isPlain = v => v !== null && typeof v === 'object' && ! Array.isArray( v );
	function mergeInto( target, src, replace ) {
		for ( const [ k, v ] of Object.entries( src ) ) {
			if ( k === '_clear' ) continue;
			if ( v === '(undefined)' ) delete target[ k ];
			else if ( ! replace && isPlain( v ) && isPlain( target[ k ] ) ) mergeInto( target[ k ], v, false );
			else target[ k ] = isPlain( v ) ? mergeInto( {}, v, false ) : Array.isArray( v ) ? JSON.parse( JSON.stringify( v ) ) : v;
		}
		return target;
	}
	function mergeDataLayer( model, item ) {
		if ( isPlain( item ) ) mergeInto( model, item, item._clear === true );
		return model;
	}

	// Most pixels say in their own request when GTM installed them.
	const VIA_KEYS = [ 'a', 'tm', 'intg', 'integration', 'i', 'ref', 'it', 'pd.np', 'partner', 'agent' ];
	function viaTagManager( params ) {
		if ( ! params ) return false;
		if ( 'gtmVersion' in params ) return true;
		return VIA_KEYS.some( k => typeof params[ k ] === 'string' && ! /^https?:/.test( params[ k ] ) && /gtm|googletagmanager/i.test( params[ k ] ) );
	}

	/**
	 * @param {{url: string, method?: string, body?: {formData?: Object, text?: string}}} req
	 * @returns {Array|null} hits, or null when the request isn't tracking.
	 */
	function classify( req ) {
		const hits = classifyRequest( req );
		if ( hits ) {
			for ( const h of hits ) {
				if ( h.vendor !== 'google' && viaTagManager( h.params ) ) h.via = 'GTM';
			}
		}
		return hits;
	}

	function classifyRequest( req ) {
		// CORS preflights and HEAD checks would double-count every hit.
		if ( req.method === 'OPTIONS' || req.method === 'HEAD' ) return null;
		let u;
		try { u = new URL( req.url ); } catch ( e ) { return null; }
		const h = u.hostname, p = u.pathname;
		const q = paramsOf( u.searchParams );
		let m;

		const fromVendor = vendorHits( u, h, p, q, req );
		if ( fromVendor !== undefined ) return fromVendor;

		// ---- Meta
		if ( hostIs( h, 'facebook.com' ) ) {
			if ( /^\/tr\/?$/.test( p ) ) return [ metaHit( q, req.body ) ];
			if ( p.startsWith( '/privacy_sandbox/' ) ) return [ aux( 'meta', 'Meta attribution ping', q.id, q.ev, q ) ];
			return null;
		}
		if ( h === 'connect.facebook.net' ) {
			if ( ( m = /^\/signals\/config\/(\d+)/.exec( p ) ) ) return [ script( 'meta', 'Meta Pixel config', m[ 1 ], q ) ];
			if ( /\/fbevents\.js$/.test( p ) ) return [ script( 'meta', 'fbevents.js', null, q ) ];
			if ( /\/sdk\.js$/.test( p ) ) return [ script( 'meta', 'Facebook SDK', null, q ) ];
			return [ script( 'meta', 'connect.facebook.net', null, q ) ];
		}

		// ---- Segment
		if ( hostIs( h, 'segment.io' ) || hostIs( h, 'segmentapis.com' ) ) {
			if ( ( m = /^\/v1\/(t|p|i|g|a|s|b|track|page|identify|group|alias|screen|batch)$/.exec( p ) ) ) return segmentHits( m[ 1 ], req.body );
			if ( p === '/v1/m' ) return [ aux( 'segment', 'Segment library metrics', null, null, q ) ];
			if ( ( m = /^\/analytics\.js\/v1\/([^/]+)\//.exec( p ) ) ) return [ script( 'segment', 'Segment analytics.js', m[ 1 ], q ) ];
			return [ aux( 'segment', 'Segment request', null, null, q ) ];
		}
		if ( h === 'cdn.segment.com' || hostIs( h, 'segmentcdn.com' ) ) {
			if ( ( m = /^\/analytics\.js\/v1\/([^/]+)\//.exec( p ) ) ) return [ script( 'segment', 'Segment analytics.js', m[ 1 ], q ) ];
			if ( ( m = /^\/v1\/projects\/([^/]+)\/settings/.exec( p ) ) ) return [ script( 'segment', 'Segment settings', m[ 1 ], q ) ];
			// Device-mode destinations load their own code: which ones run in the browser.
			if ( ( m = /^\/next-integrations\/(?:actions|integrations)\/([^/]+)\//.exec( p ) ) ) return [ script( 'segment', 'Segment destination code', m[ 1 ], q ) ];
			return [ script( 'segment', 'Segment library', null, q ) ];
		}

		// ---- Google Tag Manager / gtag
		if ( hostIs( h, 'googletagmanager.com' ) ) {
			if ( p === '/gtm.js' ) return [ script( 'google', 'GTM container', q.id, q ) ];
			if ( p.startsWith( '/gtag/' ) ) return [ script( 'google', 'gtag.js', q.id, q ) ];
			return [ aux( 'google', 'Google tag diagnostics', q.id || q.tid, null, q ) ];
		}

		// ---- GA4
		if ( /\/g\/collect$/.test( p ) ) {
			if ( hostIs( h, 'doubleclick.net' ) ) {
				return [ aux( 'google', 'GA4 → Google Signals', q.tid, null, q, { consent: googleConsent( q ) } ) ];
			}
			const google = hostIs( h, 'google-analytics.com' ) || hostIs( h, 'analytics.google.com' );
			if ( ! google && ! /^G-/.test( q.tid || '' ) ) return null;
			return ga4Hits( q, req.body, google ? null : h );
		}

		// ---- Google tag gateway / server-side GTM on the site's own paths
		// (e.g. /metrics/ag/g/c). Spotted by the parameters, not the URL.
		if ( ! hostIs( h, 'google-analytics.com' ) && ! hostIs( h, 'analytics.google.com' ) && ! isGoogleHost( h ) && ! hostIs( h, 'doubleclick.net' ) ) {
			if ( /^G-/.test( q.tid || '' ) && q.gtm && ( q.en || q.v === '2' ) ) return ga4Hits( q, req.body, h );
			if ( q.gtm && ( q.gcd || q.gcs ) && ( m = /\/(?:conversion|viewthroughconversion)\/(\d+)/.exec( p ) ) ) {
				const r = adsHit( 'Google Ads (server-side)', m[ 1 ], q );
				r.notes.unshift( 'Sent to ' + h + ' (first-party tag gateway), not straight to Google' );
				return [ r ];
			}
		}

		// ---- Universal Analytics (switched off by Google in July 2024)
		if ( hostIs( h, 'google-analytics.com' ) ) {
			if ( /^\/(j\/|r\/)?collect$/.test( p ) ) {
				const params = Object.assign( {}, q, bodyParams( req.body ) );
				const ev = [ params.t, params.ec, params.ea ].filter( Boolean ).join( ' / ' );
				return [ hit( 'google', 'Universal Analytics', params.tid, ev || null, params, {
					notes: [ 'Universal Analytics stopped processing data in July 2024; this hit goes nowhere' ],
				} ) ];
			}
			if ( /\/(analytics|ga)\.js$/.test( p ) ) return [ script( 'google', 'analytics.js (UA)', null, q ) ];
			return [ aux( 'google', 'Google Analytics request', null, null, q ) ];
		}

		// ---- Google Ads / DoubleClick
		const dc = hostIs( h, 'doubleclick.net' );
		if ( ! dc && ! hostIs( h, 'googleadservices.com' ) && ! isGoogleHost( h ) ) return null;

		if ( dc && /^\/activityi?;/.test( p ) ) return [ floodlight( u ) ];
		if ( ( m = /^\/pagead\/conversion\/(\d+)/.exec( p ) ) ) return [ adsHit( 'Google Ads conversion', m[ 1 ], q ) ];
		if ( ( m = /^\/pagead\/viewthroughconversion\/(\d+)/.exec( p ) ) ) return [ adsHit( 'Google Ads remarketing', m[ 1 ], q ) ];
		if ( ( m = /^\/rmkt\/collect\/(\d+)/.exec( p ) ) ) return [ adsHit( 'Google Ads remarketing', m[ 1 ], q ) ];
		if ( ( m = /^\/pagead\/1p-conversion\/(\d+)/.exec( p ) ) ) return [ adsHit( 'Google Ads conversion (1p follow-up)', m[ 1 ], q, 'aux' ) ];
		if ( ( m = /^\/pagead\/1p-user-list\/(\d+)/.exec( p ) ) ) return [ adsHit( 'Google Ads audience list (1p)', m[ 1 ], q, 'aux' ) ];
		if ( ( m = /^\/pagead\/form-data\/(\d+)/.exec( p ) ) ) {
			const r = adsHit( 'Google Ads enhanced conversions', m[ 1 ], q, 'aux' );
			r.notes.push( 'Carries hashed user-provided data (email/phone/address)' );
			return [ r ];
		}
		if ( /^\/ccm\/collect/.test( p ) && isGoogleHost( h ) ) return [ adsHit( 'Google tag → Ads (ccm)', null, q ) ];
		if ( /\/pagead\/(conversion_async|conversion)\.js$/.test( p ) ) return [ script( 'google', 'Google Ads conversion.js', null, q ) ];
		if ( p.startsWith( '/pagead/landing' ) ) return [ aux( 'google', 'Google Ads landing ping', null, null, q ) ];
		if ( h === 'td.doubleclick.net' ) return [ aux( 'google', 'Google audience join (td.doubleclick)', null, null, q ) ];
		if ( dc || hostIs( h, 'googleadservices.com' ) ) return [ aux( 'google', 'DoubleClick / Ads request', null, null, q ) ];
		if ( p.startsWith( '/pagead/' ) || p.startsWith( '/ccm/' ) || p.startsWith( '/rmkt/' ) ) {
			return [ aux( 'google', 'Google Ads request', null, null, q ) ];
		}
		return null;
	}

	// Readable names for the parameters people actually look for.
	const LABELS = {
		v: 'protocol version', tid: 'measurement / tag ID', en: 'event name', ev: 'event name', id: 'pixel ID',
		gtm: 'GTM container hash', _p: 'page-load ID', cid: 'client ID (_ga cookie)', sid: 'session ID',
		sct: 'session count', seg: 'engaged session', _s: 'hit sequence', uid: 'user ID',
		dl: 'page URL', dr: 'referrer', dt: 'page title', dp: 'page path', ul: 'language', sr: 'screen size',
		_et: 'engagement time (ms)', _fv: 'first visit', _ss: 'session start', _nsi: 'new session',
		_c: 'conversion', gcs: 'consent (ads/analytics storage)', gcd: 'consent v2 (all four signals)',
		npa: 'non-personalised ads', dma: 'EU DMA applies', dma_cps: 'DMA consent signals',
		frm: 'sent from iframe', tfd: 'ms since tag load', tag_exp: 'Google experiments',
		rl: 'referrer', ts: 'timestamp', it: 'pixel init time', fbp: 'browser ID (_fbp cookie)',
		fbc: 'click ID (_fbc cookie)', eid: 'event ID (dedupe with CAPI)', es: 'event source', ec: 'event count',
		a: 'installed by (agent)', sw: 'screen width', sh: 'screen height', if: 'in iframe', coo: 'cookies off',
		label: 'conversion label', value: 'value', currency_code: 'currency', oid: 'order ID',
		transaction_id: 'transaction ID', gclaw: 'Google click ID', gclid: 'Google click ID',
		auid: 'Ads user ID (_gcl_au cookie)', url: 'page URL', ref: 'referrer', tiba: 'page title',
		src: 'Floodlight advertiser', type: 'Floodlight group', cat: 'Floodlight activity', ord: 'order / cache-buster',
	};

	const SEG_LABELS = {
		type: 'call type', event: 'event name', name: 'page name', category: 'page category',
		userId: 'user ID', anonymousId: 'anonymous ID (ajs_anonymous_id cookie)', previousId: 'previous ID',
		groupId: 'group ID', writeKey: 'source write key', messageId: 'message ID', timestamp: 'event time',
		sentAt: 'sent at', 'context.page.url': 'page URL', 'context.page.referrer': 'referrer',
		'context.page.title': 'page title', 'context.page.path': 'page path', 'context.library.version': 'library version',
		'context.locale': 'locale', 'context.timezone': 'time zone', 'context.userAgent': 'user agent',
	};

	function label( key, vendor ) {
		if ( vendor === 'segment' ) {
			if ( SEG_LABELS[ key ] ) return SEG_LABELS[ key ];
			if ( key.startsWith( 'properties.' ) ) return 'property';
			if ( key.startsWith( 'traits.' ) || key.startsWith( 'context.traits.' ) ) return 'trait';
			if ( key.startsWith( 'context.consent.' ) ) return 'consent category';
			if ( key.startsWith( 'context.campaign.' ) ) return 'campaign (UTM)';
			if ( key.startsWith( 'integrations.' ) ) return 'destination on/off';
			if ( key.startsWith( '_metadata.' ) ) return 'Segment internal';
			return '';
		}
		if ( vendor && vendor !== 'google' && vendor !== 'meta' ) {
			const v = vendorInfo( vendor );
			return ( v.labels && v.labels[ key ] ) || '';
		}
		if ( LABELS[ key ] ) return LABELS[ key ];
		if ( key.startsWith( 'ep.' ) ) return 'event param';
		if ( key.startsWith( 'epn.' ) ) return 'event param (number)';
		if ( key.startsWith( 'up.' ) || key.startsWith( 'upn.' ) ) return 'user property';
		if ( key.startsWith( 'cd[' ) ) return 'custom data';
		if ( key.startsWith( 'ud[' ) ) return 'hashed user data';
		if ( /^ua[a-z]*$/.test( key ) ) return 'browser client hint';
		if ( /^pr\d+$/.test( key ) ) return 'item';
		return '';
	}

	// Params in the order you'd want to read them.
	const FIRST = [ 'en', 'ev', 'id', 'tid', 'label', 'value', 'currency_code', 'oid', 'transaction_id', 'src', 'type', 'cat', 'event', 'name', 'category' ];
	const LATE = [ 'gcs', 'gcd', 'npa', 'dma', 'dma_cps', 'dl', 'dt', 'dr', 'rl', 'cid', 'sid', 'uid', 'fbp', 'fbc', 'eid' ];
	function sortedKeys( params ) {
		const rank = k => {
			if ( FIRST.includes( k ) ) return FIRST.indexOf( k );
			if ( /^(cd\[|ep\.|epn\.|up\.|upn\.|ud\[|pr\d|properties\.|traits\.|context\.traits\.)/.test( k ) ) return 50;
			if ( k.startsWith( 'context.consent.' ) ) return 60;
			if ( k === 'userId' || k === 'anonymousId' ) return 70;
			if ( LATE.includes( k ) ) return 100 + LATE.indexOf( k );
			if ( /^(context\.|integrations\.)/.test( k ) ) return 250;
			if ( k.startsWith( '_metadata' ) ) return 300;
			return 200;
		};
		return Object.keys( params ).sort( ( a, b ) => rank( a ) - rank( b ) );
	}

	function describeError( e ) {
		if ( /TRACKING|FINGERPRINTING|CRYPTOMINING/i.test( e ) ) return 'blocked by Firefox tracking protection';
		if ( /NS_ERROR_ABORT/.test( e ) ) return 'aborted (another extension, or the page moved on)';
		if ( /BLOCKED/i.test( e ) ) return 'blocked';
		return e;
	}

	const api = {
		SIGNALS, GCD, classify, googleConsent, label, sortedKeys, describeError, dataLayerEntry, viaTagManager, GTM_EVENTS, mergeDataLayer,
		addVendor, vendorInfo, listenUrls, listened, vendors: () => VENDORS.slice(),
		helpers: { hit, script, aux, flatten, pairs, paramsOf, parseBody, jsonish, hostIs, segmentHits, googleConsent },
		flatten,
	};
	if ( typeof module === 'object' && module.exports ) module.exports = api;
	return api;
} )();
