// What the extension records on the demo shop: every tool, consent decoded,
// the pre-consent Meta pixel flagged and nothing after consent flagged,
// "via GTM" labels, dataLayer events, and the live tags read from the page.
( async () => {
	const out = { checks: [] };
	const ok = ( name, cond, detail ) => out.checks.push( ( cond ? 'PASS ' : 'FAIL ' ) + name + ( detail !== undefined ? '  → ' + JSON.stringify( detail ).slice( 0, 160 ) : '' ) );
	try {
		const tab = ( await browser.tabs.query( {} ) ).find( t => ( t.url || '' ).includes( 'shop.example/products' ) );
		const { entries } = await browser.runtime.sendMessage( { type: 'get', tabId: tab.id } );
		const hits = entries.filter( e => e.type === 'hit' && e.category === 'hit' );
		const dl = entries.filter( e => e.type === 'dl' );
		const find = ( vendor, event ) => hits.find( h => h.vendor === vendor && h.event === event );

		const vendors = [ ...new Set( hits.map( h => h.vendor ) ) ].sort();
		ok( 'all seven tools detected', JSON.stringify( vendors ) === JSON.stringify( [ 'clarity', 'google', 'linkedin', 'meta', 'pinterest', 'segment', 'tiktok' ] ), vendors );
		ok( 'eleven hits, all answered (204)', hits.length === 11 && hits.every( h => h.status === 204 ), hits.map( h => h.status ) );

		const pv = find( 'meta', 'PageView' );
		ok( 'Meta PageView before consent is flagged', /ad_storage denied/.test( pv && pv.warning || '' ), pv && pv.warning );
		ok( 'Meta AddToCart after consent is not flagged', ! find( 'meta', 'AddToCart' ).warning );
		ok( 'only one consent warning in total', hits.filter( h => h.warning ).length === 1, hits.filter( h => h.warning ).map( h => h.vendor + ':' + h.event ) );

		const ga1 = hits.find( h => h.kind === 'GA4' && h.event === 'page_view' );
		ok( 'GA4 page_view decoded as denied, cookieless', ga1.consent.analytics_storage.state === 'denied' && ga1.notes.some( n => /cookieless/.test( n ) ) );
		ok( 'GA4 add_to_cart decoded as granted', find( 'google', 'add_to_cart' ) && hits.find( h => h.kind === 'GA4' && h.event === 'add_to_cart' ).consent.analytics_storage.state === 'granted' );
		ok( 'Google Ads remarketing decoded', hits.some( h => h.kind === 'Google Ads remarketing' && h.id === 'AW-987654321' ) );
		ok( 'TikTok AddToCart decoded from its JSON body', /value=289/.test( find( 'tiktok', 'AddToCart' ).summary ), find( 'tiktok', 'AddToCart' ).summary );
		ok( 'Segment track decoded, with write key', find( 'segment', 'Product Added' ) && find( 'segment', 'Product Added' ).id === 'nwDemoWriteKey8Q2' );
		ok( '"via GTM" on Meta, LinkedIn and Pinterest', [ 'meta', 'linkedin', 'pinterest' ].every( v => hits.filter( h => h.vendor === v ).every( h => h.via === 'GTM' ) ) );

		ok( 'dataLayer: consent default (denied) and update (granted)', dl.some( e => e.event === 'consent default' && e.consent.ad_storage.state === 'denied' ) && dl.some( e => e.event === 'consent update' && e.consent.ad_storage.state === 'granted' ) );
		ok( 'dataLayer: GTM events named', dl.some( e => e.event === 'gtm.js' && e.label === 'Container Loaded' ) && dl.some( e => e.event === 'gtm.load' && e.label === 'Window Loaded' ) );
		ok( 'dataLayer: add_to_cart captured with its ecommerce', dl.some( e => e.event === 'add_to_cart' && /ecommerce.value=289/.test( e.summary ) ) );
		const iPv = entries.indexOf( pv ), iUpd = entries.findIndex( e => e.event === 'consent update' );
		ok( 'timeline order: leak, then consent update', iPv > -1 && iUpd > iPv );

		const probe = await browser.runtime.sendMessage( { type: 'probe', tabId: tab.id } );
		ok( 'live read: tag IDs on the page', [ 'GTM-NW4DEMO', 'G-NW7DEMO42', 'AW-987654321' ].every( t => ( probe.tags || [] ).includes( t ) ), probe.tags );
		ok( 'live read: consent now granted', probe.google && probe.google.ad_storage === 'granted' );
	} catch ( e ) {
		out.error = String( e && e.stack || e );
	}
	await fetch( 'http://127.0.0.1:8770/report', { method: 'POST', body: JSON.stringify( out ) } );
} )();
