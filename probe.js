/*
 * Pixel & Tag Tracer — consent probe.
 *
 * Injected into a page on demand (tabs.executeScript with this file) to read
 * what the page itself believes about consent right now. Runs as a content
 * script: wrappedJSObject reaches the page's own globals, where gtag keeps its
 * resolved consent state, whichever banner set it. Also reads the
 * CookieConsent library's cookie, whether the browser sends GPC, and which
 * GTM containers and Google tags are loaded. Read-only.
 *
 * The file's value is its last expression, which executeScript hands back.
 */
( () => {
	// The same four signals as PW.SIGNALS in rules.js; the tests check they match.
	const SIGNALS = [ 'ad_storage', 'analytics_storage', 'ad_user_data', 'ad_personalization' ];
	const w = window.wrappedJSObject || window;
	const out = { gpc: navigator.globalPrivacyControl === true };
	try {
		const e = w.google_tag_data && w.google_tag_data.ics && w.google_tag_data.ics.entries;
		if ( e ) {
			const g = {};
			for ( const k of SIGNALS ) {
				const v = e[ k ];
				if ( ! v ) continue;
				const val = v.update !== undefined ? v.update : v.default;
				g[ k ] = val === true ? 'granted' : val === false ? 'denied' : null;
			}
			if ( Object.keys( g ).length ) out.google = g;
		}
	} catch ( err ) {}
	try {
		const gtm = w.google_tag_manager;
		if ( gtm ) out.tags = Object.keys( gtm ).filter( k => /^(GTM|G|AW|DC|GT)-/.test( k ) );
	} catch ( err ) {}
	try {
		const m = document.cookie.match( /(?:^|; )(cc_cookie)=([^;]*)/ );
		if ( m ) {
			const c = JSON.parse( decodeURIComponent( m[ 2 ] ) );
			out.banner = { cookie: m[ 1 ], categories: Array.isArray( c.categories ) ? c.categories.slice() : [] };
		}
	} catch ( err ) {}
	return out;
} )();
