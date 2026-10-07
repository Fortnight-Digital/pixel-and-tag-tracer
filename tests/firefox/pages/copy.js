// Click to copy (IDs, table cells, Copy table) and dataLayer snapshots. The
// clipboard is stubbed so each copied value can be checked.
( async () => {
	const out = { checks: [] };
	const ok = ( name, cond, detail ) => out.checks.push( ( cond ? 'PASS ' : 'FAIL ' ) + name + ( detail !== undefined ? '  → ' + JSON.stringify( detail ).slice( 0, 160 ) : '' ) );
	const wait = ms => new Promise( r => setTimeout( r, ms ) );
	try {
		const tab = ( await browser.tabs.query( {} ) ).find( t => ( t.url || '' ).includes( 'shop.example/products' ) );
		const f = document.createElement( 'iframe' );
		f.style.cssText = 'width:1280px;height:800px';
		f.src = 'panel.html?tab=' + tab.id;
		document.body.append( f );
		await wait( 1500 );
		const w = f.contentWindow, d = f.contentDocument;
		const copied = [];
		Object.defineProperty( w.navigator, 'clipboard', { value: { writeText: t => { copied.push( t ); return Promise.resolve(); } }, configurable: true } );
		const last = () => copied[ copied.length - 1 ];
		const openRow = () => d.querySelector( '.row[aria-expanded="true"]' );
		const cell = ( root, k ) => { const td = [ ...root.querySelectorAll( 'td.k' ) ].find( x => x.textContent === k ); return td && td.parentElement.querySelector( 'td.v' ); };
		const viewButton = label => [ ...openRow().querySelectorAll( '.views button' ) ].find( b => b.textContent.startsWith( label ) );

		const tagEl = [ ...d.querySelectorAll( '.tagid' ) ].find( x => x.textContent === 'GTM-NW4DEMO' );
		tagEl.click(); await wait( 50 );
		ok( 'header tag ID copies', last() === 'GTM-NW4DEMO', last() );
		ok( 'copied flash shows', tagEl.classList.contains( 'flashed' ) && tagEl.dataset.flash === 'Copied' );

		const metaRow = [ ...d.querySelectorAll( '.row' ) ].find( r => r.textContent.includes( 'AddToCart' ) && r.textContent.includes( 'Meta' ) );
		metaRow.querySelector( '.id' ).click(); await wait( 50 );
		ok( 'row ID copies', last() === '1234567890123456', last() );
		ok( 'clicking the ID leaves the row closed', metaRow.getAttribute( 'aria-expanded' ) === 'false' );

		metaRow.click(); await wait( 100 );
		cell( openRow(), 'ev' ).click(); await wait( 50 );
		ok( 'value cell copies', last() === 'AddToCart', last() );
		[ ...openRow().querySelectorAll( '.raw button' ) ].find( b => b.textContent === 'Copy table' ).click(); await wait( 50 );
		ok( 'Copy table is tab-separated', /^ev\tAddToCart$/m.test( last() ) && /^id\t1234567890123456$/m.test( last() ), last() );

		viewButton( 'dataLayer' ).click(); await wait( 100 );
		ok( 'hit snapshot: event is add_to_cart', cell( openRow(), 'event' ).textContent === 'add_to_cart' );
		ok( 'hit snapshot: ecommerce.value 289', cell( openRow(), 'ecommerce.value' ).textContent === '289' );
		openRow().click(); await wait( 100 );

		[ ...d.querySelectorAll( '.row.dl' ) ].find( r => r.textContent.includes( 'message' ) ).click(); await wait( 100 );
		viewButton( 'dataLayer' ).click(); await wait( 100 );
		ok( 'push snapshot: ecommerce cleared to null', cell( openRow(), 'ecommerce' ).textContent === 'null' );

		const firstRow = d.querySelector( '#list' ).firstChild;
		const range = d.createRange();
		range.selectNodeContents( openRow().querySelector( 'td.v' ) );
		w.getSelection().removeAllRanges();
		w.getSelection().addRange( range );
		w.render();
		ok( 'redraw waits while text is selected', d.querySelector( '#list' ).firstChild === firstRow );
		w.getSelection().removeAllRanges(); await wait( 100 );
		ok( 'redraw happens once the selection clears', d.querySelector( '#list' ).firstChild !== firstRow );
	} catch ( e ) {
		out.error = String( e && e.stack || e );
	}
	await fetch( 'http://127.0.0.1:8770/report', { method: 'POST', body: JSON.stringify( out ) } );
} )();
