// Sidebar lock: follows the active tab, locks to one, unlocks, and lets go
// when the locked tab closes.
( async () => {
	const out = { checks: [] };
	const ok = ( name, cond, detail ) => out.checks.push( ( cond ? 'PASS ' : 'FAIL ' ) + name + ( detail !== undefined ? '  → ' + JSON.stringify( detail ) : '' ) );
	const wait = ms => new Promise( r => setTimeout( r, ms ) );
	try {
		const shop = ( await browser.tabs.query( {} ) ).find( t => ( t.url || '' ).includes( 'shop.example/products' ) );
		const other = await browser.tabs.create( { url: 'http://shop.example/cart', active: false } );
		await wait( 1500 );
		const f = document.createElement( 'iframe' );
		f.style.cssText = 'width:360px;height:800px';
		f.src = 'panel.html?view=sidebar';
		document.body.append( f );
		await wait( 1500 );
		const d = f.contentDocument;
		const host = () => d.querySelector( '#host' ).textContent;
		const lock = () => d.querySelector( '#lock' );
		ok( 'lock button shows in the sidebar', getComputedStyle( lock() ).display !== 'none' );
		ok( 'Sidebar button hidden in the sidebar', getComputedStyle( d.querySelector( '#sidebar' ) ).display === 'none' );

		await browser.tabs.update( shop.id, { active: true } ); await wait( 1500 );
		ok( 'unlocked: follows the active tab (shop)', host().includes( '/products/' ), host() );
		lock().click(); await wait( 200 );
		ok( 'lock pressed', lock().getAttribute( 'aria-pressed' ) === 'true' && lock().textContent === 'Locked to tab', lock().textContent );

		await browser.tabs.update( other.id, { active: true } ); await wait( 1500 );
		ok( 'locked: still shows the shop tab after switching', host().includes( '/products/' ), host() );
		ok( 'locked: still shows the shop tab\'s hits', d.querySelectorAll( '.row' ).length > 5, d.querySelectorAll( '.row' ).length );

		lock().click(); await wait( 1500 );
		ok( 'unlock jumps to the active tab (cart)', host().includes( '/cart' ), host() );
		ok( 'lock released', lock().getAttribute( 'aria-pressed' ) === 'false' );

		lock().click(); await wait( 200 );
		await browser.tabs.update( shop.id, { active: true } ); await wait( 1500 );
		ok( 'locked to cart while on shop', host().includes( '/cart' ), host() );
		await browser.tabs.remove( other.id ); await wait( 1500 );
		ok( 'closing the locked tab unlocks', lock().getAttribute( 'aria-pressed' ) === 'false' );
		ok( 'and it follows the active tab again', host().includes( '/products/' ), host() );
	} catch ( e ) {
		out.error = String( e && e.stack || e );
	}
	await fetch( 'http://127.0.0.1:8770/report', { method: 'POST', body: JSON.stringify( out ) } );
} )();
