// The panel inside DevTools: works without the tabs/windows APIs, shows the
// inspected tab, copies, and updates live.
( async () => {
	const out = { checks: [] };
	const ok = ( name, cond, detail ) => out.checks.push( ( cond ? 'PASS ' : 'FAIL ' ) + name + ( detail !== undefined ? '  → ' + JSON.stringify( detail ).slice( 0, 160 ) : '' ) );
	const wait = ms => new Promise( r => setTimeout( r, ms ) );
	try {
		const shop = ( await browser.tabs.query( {} ) ).find( t => ( t.url || '' ).includes( 'shop.example/products' ) );
		const f = document.createElement( 'iframe' );
		f.style.cssText = 'width:480px;height:800px';
		f.src = 'devpanel.html?inspect=' + shop.id;
		document.body.append( f );
		await wait( 2000 );
		const w = f.contentWindow, d = f.contentDocument;
		ok( 'runs with tabs/windows APIs removed', w.browser.tabs === undefined && w.browser.windows === undefined );
		ok( 'knows it is in DevTools', d.body.dataset.view === 'devtools', d.body.dataset.view );
		ok( 'shows the inspected tab\'s page', d.querySelector( '#host' ).textContent.includes( 'shop.example/products' ), d.querySelector( '#host' ).textContent );
		ok( 'lists that tab\'s hits and dataLayer events', d.querySelectorAll( '.row' ).length > 10, d.querySelectorAll( '.row' ).length );
		ok( 'tool chips present', d.querySelectorAll( '.vchip' ).length > 3, d.querySelectorAll( '.vchip' ).length );
		ok( 'Sidebar and Lock buttons hidden', getComputedStyle( d.querySelector( '#sidebar' ) ).display === 'none' && getComputedStyle( d.querySelector( '#lock' ) ).display === 'none' );
		ok( 'live consent read works', /consent now/.test( d.querySelector( '#now' ).textContent ), d.querySelector( '#now' ).textContent.slice( 0, 60 ) );

		const copied = [];
		Object.defineProperty( w.navigator, 'clipboard', { value: { writeText: t => { copied.push( t ); return Promise.resolve(); } }, configurable: true } );
		[ ...d.querySelectorAll( '.tagid' ) ].find( x => x.textContent === 'GTM-NW4DEMO' ).click(); await wait( 50 );
		ok( 'click to copy works', copied[ 0 ] === 'GTM-NW4DEMO', copied[ 0 ] );

		// A new hit on the inspected tab shows up without reopening.
		await browser.tabs.executeScript( shop.id, { code: "new Image().src = 'http://www.facebook.com/tr/?id=1234567890123456&ev=DevtoolsCheck';" } );
		await wait( 1500 );
		ok( 'updates live', [ ...d.querySelectorAll( '.row' ) ].some( r => r.textContent.includes( 'DevtoolsCheck' ) ) );
		ok( 'no errors in the panel', w.__errors.length === 0, w.__errors );
	} catch ( e ) {
		out.error = String( e && e.stack || e );
	}
	await fetch( 'http://127.0.0.1:8770/report', { method: 'POST', body: JSON.stringify( out ) } );
} )();
