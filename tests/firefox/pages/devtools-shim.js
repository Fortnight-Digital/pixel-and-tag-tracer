// Recreates the world a DevTools panel runs in: no tabs, windows,
// extension.getViews or sidebarAction APIs, and devtools.inspectedWindow
// pointing at one tab (?inspect=<tabId>). Also records any error.
( () => {
	window.__errors = [];
	window.addEventListener( 'error', e => window.__errors.push( String( e.message ) ) );
	window.addEventListener( 'unhandledrejection', e => window.__errors.push( String( e.reason ) ) );
	const real = browser;
	const tabId = Number( new URLSearchParams( location.search ).get( 'inspect' ) );
	const missing = [ 'tabs', 'windows', 'sidebarAction' ];
	const shim = new Proxy( real, {
		get( t, k ) {
			if ( missing.includes( k ) ) return undefined;
			if ( k === 'devtools' ) return { inspectedWindow: { tabId } };
			if ( k === 'extension' ) return { getURL: p => real.runtime.getURL( p ) };
			return Reflect.get( t, k );
		},
	} );
	Object.defineProperty( window, 'browser', { value: shim, configurable: true, writable: true } );
} )();
