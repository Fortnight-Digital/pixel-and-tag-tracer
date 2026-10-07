// Real sites, unproxied (node run.mjs live <url> ...): what was recorded on each.
( async () => {
	const out = { checks: [], sites: {} };
	const ok = ( name, cond, detail ) => out.checks.push( ( cond ? 'PASS ' : 'FAIL ' ) + name + ( detail !== undefined ? '  → ' + JSON.stringify( detail ).slice( 0, 400 ) : '' ) );
	try {
		for ( const t of await browser.tabs.query( {} ) ) {
			if ( ! /^https?:/.test( t.url || '' ) || t.url.includes( '127.0.0.1' ) ) continue;
			const { entries } = await browser.runtime.sendMessage( { type: 'get', tabId: t.id } );
			const hits = entries.filter( e => e.type === 'hit' && e.category === 'hit' );
			const by = {};
			for ( const h of hits ) by[ h.vendor ] = ( by[ h.vendor ] || 0 ) + 1;
			const dl = entries.filter( e => e.type === 'dl' ).length;
			const failed = entries.filter( e => e.type === 'hit' && e.status === 'error' );
			const blocked = {};
			for ( const e of failed ) blocked[ e.error ] = ( blocked[ e.error ] || 0 ) + 1;
			const host = new URL( t.url ).hostname + ' (tab ' + t.id + ')';
			const cached = entries.filter( e => e.type === 'hit' && e.status === 'cache' ).map( e => e.kind || e.event );
			out.sites[ host ] = failed.map( e => [ e.error, e.category, e.vendor, e.method, e.url.slice( 0, 90 ) ] );
			ok( host + ': hits recorded', hits.length > 0, { tools: by, dataLayer: dl, blocked, cached } );
		}
	} catch ( e ) {
		out.error = String( e && e.stack || e );
	}
	await fetch( 'http://127.0.0.1:8770/report', { method: 'POST', body: JSON.stringify( out ) } );
} )();
