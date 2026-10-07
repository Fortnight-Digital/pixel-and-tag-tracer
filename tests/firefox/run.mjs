/*
 * Real-Firefox checks for Pixel & Tag Tracer.
 *
 *   cd tests/firefox && npm install && node run.mjs sidebar
 *   node run.mjs live https://example.com/ …   (real sites, no proxy)
 *
 * Loads a test copy of the extension into headless Firefox, opens a made-up
 * shop (docs/screenshots/demo-shop.html) and runs one test page from
 * pages/<name>.js inside the extension, which reports PASS/FAIL lines back.
 *
 * Nothing reaches a real vendor: every http request goes to a local proxy
 * that answers 204, HTTPS is sent to a dead end, and HSTS preloading is off
 * (otherwise google-analytics, facebook and pinterest upgrade to HTTPS and
 * would go direct).
 */
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not .pathname: the project path has a space in it.
const ROOT = fileURLToPath( new URL( '../../', import.meta.url ) );
const HERE = fileURLToPath( new URL( './', import.meta.url ) );
const FIREFOX = process.env.FIREFOX || '/Applications/Firefox.app/Contents/MacOS/firefox';
const PORT = 8770;
const UUID = 'ad4d9a52-3c1e-4c5b-9a0e-1b2c3d4e5f64';
const name = process.argv[ 2 ] || 'sidebar';
// `live` loads real sites directly, as a normal visit would; everything else
// runs on the made-up shop behind the proxy.
const LIVE = name === 'live';
const liveUrls = process.argv.slice( 3 );
const sleep = ms => new Promise( r => setTimeout( r, ms ) );

if ( ! fs.existsSync( HERE + 'pages/' + name + '.js' ) ) {
	console.error( 'No test page pages/' + name + '.js' );
	process.exit( 2 );
}

// A test copy: the real files, plus the test page, exposed to web pages
// (WebDriver won't navigate to moz-extension: URLs, but a page can redirect).
const ext = fs.mkdtempSync( path.join( os.tmpdir(), 'ptt-' ) );
for ( const f of fs.readdirSync( ROOT ) ) {
	if ( /\.(js|html|css|svg)$/.test( f ) ) fs.copyFileSync( ROOT + f, path.join( ext, f ) );
}
for ( const f of fs.readdirSync( HERE + 'pages' ) ) fs.copyFileSync( HERE + 'pages/' + f, path.join( ext, f ) );
fs.writeFileSync( path.join( ext, 'test.html' ), '<!doctype html><meta charset="utf-8"><style>html,body{margin:0}iframe{border:0;display:block}</style><script src="' + name + '.js"></script>' );
// The panel as a DevTools panel would get it: devtools-shim.js runs first.
fs.writeFileSync( path.join( ext, 'devpanel.html' ), fs.readFileSync( ROOT + 'panel.html', 'utf8' ).replace( '<script src="rules.js">', '<script src="devtools-shim.js"></script>\n<script src="rules.js">' ) );
const manifest = JSON.parse( fs.readFileSync( ROOT + 'manifest.json', 'utf8' ) );
manifest.web_accessible_resources = [ 'test.html', 'panel.html', 'devpanel.html' ];
fs.writeFileSync( path.join( ext, 'manifest.json' ), JSON.stringify( manifest ) );

const DEMO = fs.readFileSync( ROOT + 'docs/screenshots/demo-shop.html', 'utf8' );
let report = null;
const leaks = new Set();
const server = http.createServer( ( req, res ) => {
	// Proxied requests carry a full URL, direct ones a path: accept both.
	const u = new URL( req.url, 'http://127.0.0.1:' + PORT );
	const local = u.hostname === '127.0.0.1' || u.hostname === 'localhost';
	if ( local && u.pathname === '/report' ) {
		let b = '';
		req.on( 'data', c => { b += c; } );
		req.on( 'end', () => { res.end( 'ok' ); if ( report ) report( b ); } );
		return;
	}
	if ( local && u.pathname === '/go' ) {
		res.setHeader( 'content-type', 'text/html' );
		return res.end( `<script>location.href = 'moz-extension://${ UUID }/test.html';</script>` );
	}
	if ( u.hostname === 'shop.example' ) {
		res.setHeader( 'content-type', 'text/html' );
		return res.end( DEMO );
	}
	req.resume();
	res.statusCode = 204;
	res.end();
} );
server.on( 'connect', ( req, socket ) => {
	if ( ! /mozilla\.(com|net|org)/.test( req.url ) ) leaks.add( req.url );
	socket.destroy();
} );
server.listen( PORT, '127.0.0.1' );

const prefs = {
	'extensions.webextensions.uuids': JSON.stringify( { [ manifest.browser_specific_settings.gecko.id ]: UUID } ),
	// Lets a test open the real toolbar popup (browserAction.openPopup).
	'extensions.openPopupWithoutUserGesture.enabled': true,
};
if ( ! LIVE ) {
	Object.assign( prefs, {
		'network.proxy.type': 1, 'network.proxy.http': '127.0.0.1', 'network.proxy.http_port': PORT,
		'network.proxy.ssl': '127.0.0.1', 'network.proxy.ssl_port': PORT, 'network.proxy.share_proxy_settings': false,
		'network.proxy.allow_hijacking_localhost': false, 'network.stricttransportsecurity.preloadlist': false,
		'dom.security.https_first': false, 'dom.security.https_only_mode': false,
	} );
}
const browser = await puppeteer.launch( { browser: 'firefox', executablePath: FIREFOX, headless: true, extraPrefsFirefox: prefs } );
let failed = true;
try {
	await browser.installExtension( ext );
	if ( LIVE ) {
		// One after another, as a person would, so repeat visits hit Firefox's cache.
		for ( const url of liveUrls ) {
			const p = await browser.newPage();
			try { await p.goto( url, { waitUntil: 'load', timeout: 30000 } ); } catch ( e ) { console.log( 'could not load', url, e.message.slice( 0, 60 ) ); }
			try { await p.evaluate( () => window.scrollTo( 0, document.body.scrollHeight / 2 ) ); } catch ( e ) {}
			await sleep( 4000 );
		}
		await sleep( 6000 );
	} else {
		const shop = await browser.newPage();
		await shop.goto( 'http://shop.example/products/trailhead-2p-tent', { waitUntil: 'load' } );
		await sleep( 5000 );
	}
	const r = await browser.newPage();
	await r.setViewport( { width: 1280, height: 800 } );
	const got = new Promise( res => { report = res; } );
	r.goto( `http://127.0.0.1:${ PORT }/go` ).catch( () => {} );
	const out = JSON.parse( await Promise.race( [ got, sleep( 60000 ).then( () => '{"error":"timed out"}' ) ] ) );
	( out.checks || [] ).forEach( c => console.log( c ) );
	if ( LIVE && process.env.SHOW_FAILED ) console.log( JSON.stringify( out.sites, null, 1 ) );
	if ( out.error ) console.log( 'ERROR', out.error );
	if ( ! LIVE ) console.log( 'Requests that tried to leave over HTTPS (all blocked):', leaks.size ? [ ...leaks ].join( ', ' ) : 'none' );
	failed = !! out.error || ! ( out.checks || [] ).length || out.checks.some( c => c.startsWith( 'FAIL' ) );
} finally {
	await browser.close();
	server.close();
	fs.rmSync( ext, { recursive: true, force: true } );
}
process.exit( failed ? 1 : 0 );
