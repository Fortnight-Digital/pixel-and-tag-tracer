// The real toolbar popup, opened over the shop tab.
( async () => {
	const out = { checks: [] };
	const ok = ( name, cond, detail ) => out.checks.push( ( cond ? 'PASS ' : 'FAIL ' ) + name + ( detail !== undefined ? '  → ' + JSON.stringify( detail ).slice( 0, 160 ) : '' ) );
	const wait = ms => new Promise( r => setTimeout( r, ms ) );
	try {
		const shop = ( await browser.tabs.query( {} ) ).find( t => ( t.url || '' ).includes( 'shop.example/products' ) );
		await browser.tabs.update( shop.id, { active: true } );
		await browser.windows.update( shop.windowId, { focused: true } );
		await wait( 500 );
		await browser.browserAction.openPopup();
		let pop = null;
		for ( let i = 0; i < 40 && ! pop; i++ ) {
			await wait( 250 );
			pop = browser.extension.getViews( { type: 'popup' } )[ 0 ] || null;
		}
		ok( 'popup opens', !! pop );
		if ( pop ) {
			for ( let i = 0; i < 40 && ! pop.document.querySelector( '.row' ); i++ ) await wait( 250 );
			const d = pop.document;
			ok( 'popup view', d.body.dataset.view === 'popup', d.body.dataset.view );
			ok( 'shows the active tab', d.querySelector( '#host' ).textContent.includes( 'shop.example/products' ), d.querySelector( '#host' ).textContent );
			ok( 'counts', /11 hits from 7 tools/.test( d.querySelector( '#counts' ).textContent ), d.querySelector( '#counts' ).textContent );
			ok( 'one consent warning shown', /1 consent warning/.test( d.querySelector( '#counts' ).textContent ) );
			ok( 'rows drawn', d.querySelectorAll( '.row' ).length > 10, d.querySelectorAll( '.row' ).length );
			ok( 'Sidebar button shown, Lock hidden', pop.getComputedStyle( d.querySelector( '#sidebar' ) ).display !== 'none' && pop.getComputedStyle( d.querySelector( '#lock' ) ).display === 'none' );
			ok( 'popup fits Firefox\'s 800×600 limit', d.body.scrollWidth <= 800 && d.body.scrollHeight <= 600, [ d.body.scrollWidth, d.body.scrollHeight ] );
			const m = d.querySelector( 'main' );
			ok( 'the list scrolls inside the popup', m.scrollHeight > m.clientHeight && pop.getComputedStyle( m ).overflowY === 'auto', [ m.scrollHeight, m.clientHeight ] );
			pop.close();
		}

		// A tab with nothing logged: the popup stays small rather than stretching to 600px.
		const me = await browser.tabs.getCurrent();
		await browser.tabs.update( me.id, { active: true } );
		await wait( 500 );
		await browser.browserAction.openPopup();
		let quiet = null;
		for ( let i = 0; i < 40 && ! quiet; i++ ) {
			await wait( 250 );
			quiet = browser.extension.getViews( { type: 'popup' } )[ 0 ] || null;
		}
		if ( quiet ) {
			for ( let i = 0; i < 20 && ! quiet.document.querySelector( '.empty' ); i++ ) await wait( 250 );
			ok( 'empty popup stays compact', !! quiet.document.querySelector( '.empty' ) && quiet.document.body.scrollHeight < 400, quiet.document.body.scrollHeight );
			quiet.close();
		} else ok( 'empty popup opens', false );
	} catch ( e ) {
		out.error = String( e && e.stack || e );
	}
	await fetch( 'http://127.0.0.1:8770/report', { method: 'POST', body: JSON.stringify( out ) } );
} )();
