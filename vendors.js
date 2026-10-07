/*
 * Pixel & Tag Tracer — every tool beyond Google, Meta and Segment.
 *
 * Endpoints and payloads here were taken from real traffic (October 2026),
 * not from docs. Where a vendor's event format isn't known, its requests
 * still show up, as scripts and side-pings, so you can see it's on the page.
 * See PW.addVendor in rules.js for what each field means.
 */
'use strict';
/* global PW */

( () => {
	const { hit, script, aux, flatten, pairs, paramsOf, parseBody, jsonish, hostIs, segmentHits } = PW.helpers;
	const add = PW.addVendor;
	const last = p => p.split( '/' ).filter( Boolean ).pop() || '';
	const isScript = p => /\.m?js$/.test( p );
	// Drop empty values so summaries stay readable (Reddit sends a dozen blanks).
	const filled = o => Object.fromEntries( Object.entries( o || {} ).filter( ( [ , v ] ) => v !== '' && v !== null && v !== undefined ) );
	const pick = ( o, keys ) => Object.fromEntries( keys.filter( k => o[ k ] !== undefined && o[ k ] !== '' ).map( k => [ k, o[ k ] ] ) );
	const merged = ( q, body ) => Object.assign( {}, q, ( () => {
		const b = parseBody( body );
		return b && ! Array.isArray( b ) && typeof b === 'object' ? b : {};
	} )() );

	// ================================================================ Ad pixels

	add( {
		key: 'tiktok', name: 'TikTok', group: 'ads', needs: 'ad_storage',
		hosts: [ 'analytics.tiktok.com', 'analytics-sg.tiktok.com', 'analytics.us.tiktok.com', 'tiktokw.us' ],
		classify( { p, q, body } ) {
			if ( /^\/api\/v2\/pixel(\/act|\/track|\/batch)?\/?$/.test( p ) ) {
				const d = parseBody( body );
				const list = d && Array.isArray( d.batch ) ? d.batch : d ? [ d ] : [];
				if ( ! list.length ) return [ hit( 'tiktok', 'TikTok', null, 'event', q ) ];
				return list.map( e => {
					const user = ( e.context && e.context.user ) || {};
					const matched = Object.keys( user ).filter( k => /email|phone|external_id/.test( k ) && user[ k ] );
					const notes = matched.length ? [ 'Advanced matching: sends hashed ' + matched.join( ', ' ) ] : [];
					// /act posts carry an `action`; Metadata is the pixel scraping the page on load or leave.
					const trigger = e.auto_collected_properties && e.auto_collected_properties.page_trigger;
					if ( e.action === 'Metadata' ) notes.push( 'Automatic: the pixel collected the page\'s title, description and structure' );
					const event = e.event || ( e.action ? e.action + ( trigger ? ' (' + trigger + ')' : '' ) : '(no event)' );
					return hit( 'tiktok', 'TikTok', e.context && e.context.pixel ? e.context.pixel.code : null, event, flatten( e ), {
						summary: pairs( filled( e.properties ) ), notes,
					} );
				} );
			}
			if ( p === '/i18n/pixel/events.js' ) return [ script( 'tiktok', 'TikTok pixel', q.sdkid || null, q ) ];
			return null;
		},
		labels: { event: 'event name', 'context.pixel.code': 'pixel ID', 'context.page.url': 'page URL', 'context.user.anonymous_id': 'anonymous ID (_ttp cookie)', event_id: 'event ID (dedupe with Events API)' },
	} );

	add( {
		key: 'linkedin', name: 'LinkedIn', group: 'ads', needs: 'ad_storage',
		hosts: [ 'px.ads.linkedin.com', 'snap.licdn.com' ],
		match: ( h, p ) => h === 'www.linkedin.com' && p.startsWith( '/px/' ),
		listen: [ '*://www.linkedin.com/px/*' ],
		classify( { h, p, q } ) {
			if ( h === 'snap.licdn.com' ) return [ script( 'linkedin', 'LinkedIn Insight Tag', null, q ) ];
			if ( /^\/collect\/?$/.test( p ) ) {
				return [ hit( 'linkedin', 'LinkedIn', q.pid || null, q.conversionId ? 'conversion' : 'page view', q, {
					summary: q.conversionId ? 'conversionId=' + q.conversionId : '',
				} ) ];
			}
			if ( p.startsWith( '/wa' ) ) return [ aux( 'linkedin', 'LinkedIn web analytics (compressed)', null, null, q ) ];
			return null;
		},
		labels: { pid: 'partner ID', conversionId: 'conversion ID', url: 'page URL', li_adsId: 'ads ID (li_adsId)', fmt: 'format' },
	} );

	add( {
		key: 'microsoft', name: 'Microsoft Ads', group: 'ads', needs: 'ad_storage',
		hosts: [ 'bat.bing.com', 'bat.bing.net', 'c.bing.com' ],
		classify( { h, p, q } ) {
			if ( h === 'c.bing.com' ) return [ aux( 'microsoft', 'Microsoft cookie sync', null, null, q ) ];
			if ( /^\/actionp?\/0$/.test( p ) ) {
				// UET carries its own consent flag: asc=G (granted) or D (denied).
				const consent = /^[GD]$/.test( q.asc || '' )
					? { ad_storage: { state: q.asc === 'G' ? 'granted' : 'denied', how: 'from asc=' + q.asc } }
					: null;
				const notes = consent && consent.ad_storage.state === 'denied' ? [ 'ad_storage denied, so UET sends this without cookies' ] : [];
				if ( q.evt === 'consent' ) return [ aux( 'microsoft', 'UET consent update', q.ti, null, q, { consent } ) ];
				const event = q.evt === 'custom' ? ( q.ea || q.ec || 'custom' ) : q.evt === 'page' || q.evt === 'pageLoad' ? 'page view' : ( q.evt || 'event' );
				return [ hit( 'microsoft', 'Microsoft Ads', q.ti || null, event, q, {
					consent, notes, needs: consent ? null : 'ad_storage',
					summary: pairs( pick( q, [ 'ec', 'el', 'ev', 'gv', 'gc' ] ) ),
				} ) ];
			}
			if ( p === '/bat.js' ) return [ script( 'microsoft', 'UET tag', null, q ) ];
			const m = /^\/p\/action\/(\d+)\.js$/.exec( p );
			if ( m ) return [ script( 'microsoft', 'UET tag config', m[ 1 ], q ) ];
			return null;
		},
		labels: { ti: 'UET tag ID', evt: 'event type', ea: 'event action', ec: 'event category', el: 'event label', ev: 'event value', gv: 'goal value', gc: 'goal currency', asc: 'ad storage consent', p: 'page URL', tl: 'page title', r: 'referrer', msclkid: 'Microsoft click ID' },
	} );

	add( {
		key: 'pinterest', name: 'Pinterest', group: 'ads', needs: 'ad_storage',
		hosts: [ 'ct.pinterest.com' ],
		match: ( h, p ) => h === 's.pinimg.com' && p.startsWith( '/ct/' ),
		listen: [ '*://s.pinimg.com/ct/*' ],
		classify( { h, p, q } ) {
			if ( h === 's.pinimg.com' ) return [ script( 'pinterest', p === '/ct/core.js' ? 'Pinterest tag' : 'Pinterest tag library', null, q ) ];
			if ( /^\/v3\/?$/.test( p ) ) {
				const params = Object.assign( {}, q );
				for ( const k of [ 'ed', 'ad', 'pd' ] ) {
					const j = jsonish( q[ k ] );
					if ( j && typeof j === 'object' ) {
						delete params[ k ];
						Object.assign( params, flatten( j, k ) );
					}
				}
				const ed = jsonish( q.ed ) || {};
				if ( q.event === 'init' ) return [ aux( 'pinterest', 'Pinterest tag init', q.tid, 'init', params ) ];
				return [ hit( 'pinterest', 'Pinterest', q.tid || null, q.event || 'event', params, { summary: pairs( filled( ed ) ) } ) ];
			}
			return null;
		},
		labels: { tid: 'tag ID', event: 'event name', 'ad.loc': 'page URL', 'ad.ref': 'referrer' },
	} );

	add( {
		key: 'snapchat', name: 'Snapchat', group: 'ads', needs: 'ad_storage',
		hosts: [ 'sc-static.net' ],
		match: h => /^tr[\w-]*\.snapchat\.com$/.test( h ),
		listen: [ '*://tr.snapchat.com/*', '*://tr6.snapchat.com/*', '*://tr-shadow.snapchat.com/*' ],
		classify( { h, p, q, body } ) {
			if ( h === 'sc-static.net' ) return [ script( 'snapchat', p === '/scevent.min.js' ? 'Snap pixel' : 'Snap pixel library', null, q ) ];
			if ( p === '/p' || p === '/gateway/p' ) {
				if ( q.ev ) return [ hit( 'snapchat', 'Snapchat', q.pid || null, q.ev, q, { summary: pairs( pick( q, [ 'price', 'currency', 'transaction_id', 'item_ids' ] ) ) } ) ];
				// The v3 pixel posts JSON; its `i` request is the init, not an event.
				const d = parseBody( body );
				const reqs = d && Array.isArray( d.req ) ? d.req : [];
				const tracked = reqs.filter( r => r.t ).map( r => r.t );
				if ( tracked.length ) return tracked.map( t => hit( 'snapchat', 'Snapchat', t.pid || null, t.ev || 'event', flatten( t ) ) );
				const init = reqs.find( r => r.i );
				if ( init ) return [ aux( 'snapchat', 'Snap pixel init', ( init.i.pids || [] ).join( ', ' ) || null, null, d ? flatten( d ) : q ) ];
				return [ aux( 'snapchat', reqs.some( r => r.log ) ? 'Snap pixel error report' : 'Snapchat request', null, null, d ? flatten( d ) : q ) ];
			}
			const m = /^\/config\/[a-z]+\/([\w-]+)\.js$/.exec( p );
			if ( m ) return [ script( 'snapchat', 'Snap pixel config', m[ 1 ], q ) ];
			return [ aux( 'snapchat', 'Snapchat request', null, null, q ) ];
		},
		labels: { pid: 'pixel ID', ev: 'event name', pl: 'page URL', u_sclid: 'Snap cookie ID (_scid)' },
	} );

	add( {
		key: 'x', name: 'X (Twitter)', group: 'ads', needs: 'ad_storage',
		hosts: [ 'analytics.twitter.com', 'analytics.x.com', 'static.ads-twitter.com' ],
		match: ( h, p ) => h === 't.co' && /\/i\/adsctp?$/.test( p ),
		listen: [ '*://t.co/*adsct*' ],
		classify( { h, p, q, body } ) {
			if ( h === 'static.ads-twitter.com' ) return [ script( 'x', p === '/oct.js' ? 'X conversion tag' : 'X pixel', null, q ) ];
			if ( ! /\/i\/adsctp?$/.test( p ) ) return null;
			const params = merged( q, body );
			const list = jsonish( params.events );
			const names = Array.isArray( list ) ? list.map( e => Array.isArray( e ) ? e[ 0 ] : e ).filter( Boolean ) : [];
			const event = names.join( ', ' ) || 'page view';
			const extra = { summary: pairs( pick( params, [ 'tw_sale_amount', 'tw_order_quantity' ] ) ) };
			// X sends every hit twice; the t.co copy lets it read its own cookies.
			if ( h === 't.co' ) return [ aux( 'x', 'X pixel (t.co copy)', params.txn_id, event, params, extra ) ];
			return [ hit( 'x', 'X (Twitter)', params.txn_id || null, event, params, extra ) ];
		},
		labels: { txn_id: 'pixel ID', events: 'events', tw_document_href: 'page URL', twpid: 'X browser ID', tw_sale_amount: 'sale amount' },
	} );

	add( {
		key: 'reddit', name: 'Reddit', group: 'ads', needs: 'ad_storage',
		hosts: [ 'alb.reddit.com', 'pixel-config.reddit.com', 'conversions-config.reddit.com' ],
		match: ( h, p ) => h === 'www.redditstatic.com' && p.startsWith( '/ads/' ),
		listen: [ '*://www.redditstatic.com/ads/*' ],
		classify( { h, p, q, body } ) {
			if ( h === 'www.redditstatic.com' ) return [ script( 'reddit', 'Reddit pixel', q.pixel_id || null, q ) ];
			if ( /^\/rp(\.gif)?$/.test( p ) ) {
				const params = merged( q, body );
				const event = params.event === 'Custom' && params[ 'm.customEventName' ] ? params[ 'm.customEventName' ] : params.event;
				const meta = Object.fromEntries( Object.entries( filled( params ) ).filter( ( [ k ] ) => k.startsWith( 'm.' ) && k !== 'm.conversionId' ).map( ( [ k, v ] ) => [ k.slice( 2 ), v ] ) );
				return [ hit( 'reddit', 'Reddit', params.id || null, event || 'event', params, { summary: pairs( meta ) } ) ];
			}
			const m = /^\/pixels\/([\w-]+)\/config/.exec( p );
			if ( m ) return [ aux( 'reddit', 'Reddit pixel config', m[ 1 ], null, q ) ];
			return null;
		},
		labels: { id: 'pixel / advertiser ID', event: 'event name', uuid: 'Reddit click ID', external_id: 'hashed external ID' },
	} );

	add( {
		key: 'quora', name: 'Quora', group: 'ads', needs: 'ad_storage',
		hosts: [ 'q.quora.com', 'a.quora.com' ],
		classify( { h, p, q } ) {
			if ( h === 'a.quora.com' ) return [ script( 'quora', 'Quora pixel', null, q ) ];
			const m = /^\/_\/ad\/(\w+)\/pixel/.exec( p );
			if ( m ) return [ hit( 'quora', 'Quora', m[ 1 ], q.tag || 'event', q ) ];
			return null;
		},
		labels: { tag: 'event name', u: 'page URL' },
	} );

	add( {
		key: 'spotify', name: 'Spotify', group: 'ads', needs: 'ad_storage',
		hosts: [ 'pixels.spotify.com', 'pixel.byspotify.com' ],
		classify( { p, q, body } ) {
			if ( p === '/v1/ingest' ) {
				const d = parseBody( body );
				const out = [];
				for ( const b of ( d && d.batch ) || [] ) {
					for ( const e of b.events || [] ) {
						out.push( hit( 'spotify', 'Spotify', b.pid || null, e.action + ( e.label ? ': ' + e.label : '' ), flatten( e ) ) );
					}
				}
				return out.length ? out : [ hit( 'spotify', 'Spotify', null, 'event', q ) ];
			}
			if ( p.startsWith( '/v1/config/' ) ) return [ aux( 'spotify', 'Spotify pixel config', last( p ), null, q ) ];
			return null;
		},
	} );

	add( {
		key: 'amazon', name: 'Amazon Ads', group: 'ads', needs: 'ad_storage',
		hosts: [ 'amazon-adsystem.com' ],
		classify( { p, q } ) {
			if ( /\/iu3$/.test( p ) ) return [ hit( 'amazon', 'Amazon Ads', q.pid || null, q.event || 'event', q ) ];
			if ( p === '/aat/amzn.js' ) return [ script( 'amazon', 'Amazon Ads tag', null, q ) ];
			return null;
		},
		labels: { pid: 'tag ID', event: 'event name' },
	} );

	const CRITEO_EVENTS = { vh: 'viewHome', vl: 'viewList', vp: 'viewItem', vb: 'viewBasket', vc: 'trackTransaction', vs: 'viewSearch' };
	// Calls that configure the tag rather than record anything.
	const CRITEO_SETUP = [ 'ce', 'exd', 'dis' ];
	add( {
		key: 'criteo', name: 'Criteo', group: 'ads', needs: 'ad_storage',
		hosts: [ 'sslwidget.criteo.com', 'widget.criteo.com', 'dynamic.criteo.com', 'static.criteo.net', 'gum.criteo.com', 'dis.criteo.com', 'dnacdn.net' ],
		classify( { p, q } ) {
			if ( /^\/event\/?$/.test( p ) ) {
				// Each pN param is itself a little query: e=vh&... ; the e codes are the events.
				const codes = Object.keys( q ).filter( k => /^p\d+$/.test( k ) ).map( k => paramsOf( new URLSearchParams( q[ k ] ) ).e ).filter( Boolean );
				const events = [ ...new Set( codes.filter( c => ! CRITEO_SETUP.includes( c ) ).map( c => CRITEO_EVENTS[ c ] || c ) ) ];
				return [ hit( 'criteo', 'Criteo', q.a || null, events.join( ', ' ) || 'event', q ) ];
			}
			if ( /\/ld\.js$/.test( p ) ) return [ script( 'criteo', 'Criteo OneTag', q.a || null, q ) ];
			return null;
		},
		labels: { a: 'account ID' },
	} );

	add( {
		key: 'ttd', name: 'The Trade Desk', group: 'ads', needs: 'ad_storage',
		hosts: [ 'adsrvr.org', 'adsrvr.cn' ],
		classify( { h, p, q } ) {
			if ( h.startsWith( 'js.' ) ) return [ script( 'ttd', 'TTD universal pixel', null, q ) ];
			if ( h.startsWith( 'match.' ) ) return [ aux( 'ttd', 'TTD cookie sync', null, null, q ) ];
			if ( p.startsWith( '/track/up' ) ) return [ hit( 'ttd', 'The Trade Desk', q.adv || null, 'page view', q, { summary: q.upid ? 'upid=' + q.upid : '' } ) ];
			if ( p.startsWith( '/track/pxl' ) || p.startsWith( '/track/conv' ) ) return [ hit( 'ttd', 'The Trade Desk', q.adv || null, 'conversion', q, { summary: q.ct ? 'tag=' + q.ct : '' } ) ];
			return null;
		},
		labels: { adv: 'advertiser ID', upid: 'universal pixel ID', ct: 'conversion tag' },
	} );

	add( {
		key: 'stackadapt', name: 'StackAdapt', group: 'ads', needs: 'ad_storage',
		hosts: [ 'srv.stackadapt.com' ],
		classify( { p, q } ) {
			if ( p === '/saq_pxl' ) return [ hit( 'stackadapt', 'StackAdapt', q.uid || null, q.event || ( q.conv ? 'conversion' : 'page view' ), q ) ];
			return null;
		},
		labels: { uid: 'pixel ID', landing_url: 'page URL' },
	} );

	add( {
		key: 'adroll', name: 'AdRoll', group: 'ads', needs: 'ad_storage',
		hosts: [ 'd.adroll.com', 's.adroll.com' ],
		classify( { h, p, q } ) {
			if ( h === 's.adroll.com' ) return [ script( 'adroll', 'AdRoll pixel', p.split( '/' )[ 3 ] || null, q ) ];
			let m;
			if ( ( m = /^\/pixel\/(\w+)\//.exec( p ) ) ) return [ hit( 'adroll', 'AdRoll', m[ 1 ], 'page view', q ) ];
			if ( ( m = /^\/pex\/(\w+)\//.exec( p ) ) ) {
				if ( q.ev === 'chktcf' ) return [ aux( 'adroll', 'AdRoll consent check', m[ 1 ], null, q ) ];
				return [ hit( 'adroll', 'AdRoll', m[ 1 ], q.ev || 'event', q ) ];
			}
			if ( p.startsWith( '/cm/' ) ) return [ aux( 'adroll', 'AdRoll cookie sync', null, null, q ) ];
			return null;
		},
	} );

	add( {
		key: 'rtbhouse', name: 'RTB House', group: 'ads', needs: 'ad_storage',
		hosts: [ 'creativecdn.com' ],
		classify( { h, p, q, body } ) {
			if ( h.startsWith( 'tags.' ) && isScript( p ) ) return [ script( 'rtbhouse', 'RTB House tag', last( p ).replace( /\.js$/, '' ), q ) ];
			if ( /^\/tags(\/v2)?$/.test( p ) ) {
				const d = parseBody( body );
				if ( d && Array.isArray( d.tags ) ) {
					const events = d.tags.map( t => t.eventType ).filter( t => t && t !== 'uid' && t !== 'lid' );
					return [ hit( 'rtbhouse', 'RTB House', d.th || null, events.join( ', ' ) || 'event', flatten( d ) ) ];
				}
				return [ hit( 'rtbhouse', 'RTB House', null, q.id || 'event', q ) ];
			}
			return null;
		},
	} );

	add( {
		key: 'applovin', name: 'AppLovin', group: 'ads', needs: 'ad_storage',
		hosts: [],
		match: h => /^(b|d|res\d*)\.applovin\.com$/.test( h ),
		listen: [ '*://b.applovin.com/*', '*://d.applovin.com/*', '*://*.applovin.com/p/*' ],
		classify( { p, q, body } ) {
			if ( p === '/v1/pixel/config' ) return [ aux( 'applovin', 'AppLovin pixel config', q.event_key || null, null, q ) ];
			if ( p.startsWith( '/v1/pixel/' ) ) {
				const d = parseBody( body ) || {};
				return [ hit( 'applovin', 'AppLovin', q.event_key || d.event_key || null, d.name || d.event || last( p ), Object.keys( d ).length ? flatten( d ) : q ) ];
			}
			return null;
		},
	} );

	add( {
		key: 'taboola', name: 'Taboola', group: 'ads', needs: 'ad_storage',
		hosts: [ 'taboola.com' ],
		classify( { p, q } ) {
			let m;
			if ( ( m = /^\/(\d+)\/log\/3\/unip/.exec( p ) ) ) return [ hit( 'taboola', 'Taboola', m[ 1 ], q.en || q.name || 'event', q ) ];
			if ( ( m = /\/libtrc\/unip\/(\d+)\/tfa\.js$/.exec( p ) ) ) return [ script( 'taboola', 'Taboola pixel', m[ 1 ], q ) ];
			return null;
		},
	} );

	add( {
		key: 'outbrain', name: 'Outbrain', group: 'ads', needs: 'ad_storage',
		hosts: [ 'tr.outbrain.com', 'amplify.outbrain.com', 'sync.outbrain.com', 'widgets.outbrain.com', 'odb.outbrain.com' ],
		classify( { p, q } ) {
			if ( p === '/unifiedPixel' ) return [ hit( 'outbrain', 'Outbrain', q.marketerId || null, q.name || 'event', q ) ];
			return null;
		},
	} );

	add( {
		key: 'adobeads', name: 'Adobe Advertising', group: 'ads', needs: 'ad_storage',
		hosts: [ 'everesttech.net', 'everestjs.net' ],
	} );

	add( {
		key: 'xandr', name: 'Xandr', group: 'ads', needs: 'ad_storage',
		hosts: [ 'adnxs.com', 'adnxs-simple.com' ],
		classify( { p, q } ) {
			if ( p === '/px' ) return [ hit( 'xandr', 'Xandr', q.id || null, 'conversion', q ) ];
			if ( p === '/seg' ) return [ hit( 'xandr', 'Xandr', q.add || null, 'segment', q ) ];
			if ( /^\/(getuid|setuid|bounce|getuidj)/.test( p ) ) return [ aux( 'xandr', 'Xandr cookie sync', null, null, q ) ];
			return null;
		},
	} );

	add( {
		key: 'quantcast', name: 'Quantcast', group: 'ads', needs: 'ad_storage',
		hosts: [ 'quantserve.com', 'quantcount.com' ],
		classify( { p, q } ) {
			let m;
			if ( ( m = /^\/pixel\/(p-[\w-]+)/.exec( p ) ) ) return [ hit( 'quantcast', 'Quantcast', m[ 1 ].replace( /\.gif$/, '' ), 'page view', q ) ];
			if ( ( m = /^\/rules-(p-[\w-]+)\.js$/.exec( p ) ) ) return [ script( 'quantcast', 'Quantcast rules', m[ 1 ], q ) ];
			if ( p === '/cs' ) return [ aux( 'quantcast', 'Quantcast cookie sync', q.a || null, null, q ) ];
			return null;
		},
	} );

	// ================================================================ Analytics

	add( {
		key: 'adobe', name: 'Adobe', group: 'analytics', needs: 'analytics_storage',
		hosts: [ 'omtrdc.net', '2o7.net', 'demdex.net', 'adobedc.net', 'adobedtm.com' ],
		// AppMeasurement (/b/ss/) and the Web SDK (/ee/.../interact) often run on the client's own domain.
		match: ( h, p, q ) => /\/b\/ss\//.test( p ) || ( /\/ee\/(.+\/)?v\d\/(interact|collect)$/.test( p ) && !! q.configId ),
		listen: [ '*://*/b/ss/*', '*://*/ee/*' ],
		classify( { h, p, q, body } ) {
			let m;
			if ( ( m = /\/b\/ss\/([^/]+)\//.exec( p ) ) ) {
				const params = merged( q, body );
				const event = params.pe
					? 'link: ' + ( params.pev2 || params.pe )
					: 'page view' + ( params.pageName ? ': ' + params.pageName : '' );
				return [ hit( 'adobe', 'Adobe Analytics', m[ 1 ], event, params, {
					summary: pairs( pick( params, [ 'events', 'products', 'ch' ] ) ),
				} ) ];
			}
			if ( /\/ee\/(.+\/)?v\d\/(interact|collect)$/.test( p ) ) {
				const d = parseBody( body );
				const events = ( d && d.events ) || [];
				if ( ! events.length ) return [ hit( 'adobe', 'Adobe Web SDK', q.configId || null, 'event', q ) ];
				return events.map( e => {
					const xdm = e.xdm || {};
					const page = xdm.web && xdm.web.webPageDetails;
					return hit( 'adobe', 'Adobe Web SDK', q.configId || null, xdm.eventType || 'event', flatten( e ), {
						summary: page && page.name ? 'page=' + page.name : '',
					} );
				} );
			}
			if ( h === 'assets.adobedtm.com' ) return [ script( 'adobe', 'Adobe Launch', p.split( '/' ).slice( 1, 3 ).join( '/' ) || null, q ) ];
			if ( /\.tt\.omtrdc\.net$/.test( h ) ) return [ aux( 'adobe', 'Adobe Target', h.split( '.' )[ 0 ], null, q ) ];
			if ( hostIs( h, 'demdex.net' ) ) return [ aux( 'adobe', 'Adobe ID sync (Audience Manager)', null, null, q ) ];
			if ( p === '/id' ) return [ aux( 'adobe', 'Adobe visitor ID', null, null, q ) ];
			return null;
		},
		labels: { pageName: 'page name', g: 'page URL', r: 'referrer', events: 'events', products: 'products', pe: 'link type', pev2: 'link name', ch: 'site section', mid: 'Experience Cloud visitor ID', configId: 'datastream ID', 'xdm.eventType': 'event type' },
	} );

	add( {
		key: 'amplitude', name: 'Amplitude', group: 'analytics', needs: 'analytics_storage',
		hosts: [ 'api.amplitude.com', 'api2.amplitude.com', 'api.eu.amplitude.com', 'cdn.amplitude.com', 'cdn.eu.amplitude.com', 'api-sr.amplitude.com', 'api-sr.eu.amplitude.com', 'sr-client-cfg.amplitude.com', 'sr-client-cfg.eu.amplitude.com', 'api.lab.amplitude.com', 'api.lab.eu.amplitude.com' ],
		classify( { h, p, q, body } ) {
			if ( h.startsWith( 'api-sr.' ) ) return [ hit( 'amplitude', 'Amplitude session replay', null, 'session recording', q ) ];
			if ( p === '/2/httpapi' || p === '/batch' || ( h === 'api.amplitude.com' && p === '/' ) ) {
				const d = parseBody( body ) || {};
				const events = Array.isArray( d.events ) ? d.events : jsonish( d.e ) || [];
				const key = d.api_key || d.client || null;
				if ( ! events.length ) return [ hit( 'amplitude', 'Amplitude', key, 'event', q ) ];
				return events.map( e => hit( 'amplitude', 'Amplitude', key, e.event_type || 'event', flatten( e ), {
					summary: pairs( filled( e.event_properties ) ),
				} ) );
			}
			return null;
		},
		labels: { event_type: 'event name', device_id: 'device ID', user_id: 'user ID', session_id: 'session ID' },
	} );

	add( {
		key: 'mixpanel', name: 'Mixpanel', group: 'analytics', needs: 'analytics_storage',
		hosts: [ 'api-js.mixpanel.com', 'api.mixpanel.com', 'api-eu.mixpanel.com', 'api-in.mixpanel.com', 'mxpnl.com' ],
		classify( { h, p, q, body } ) {
			const what = /^\/(track|engage|groups|record|decide|flags)\b/.exec( p );
			if ( ! what || hostIs( h, 'mxpnl.com' ) ) return null;
			if ( what[ 1 ] === 'decide' || what[ 1 ] === 'flags' ) return [ aux( 'mixpanel', 'Mixpanel flags', q.token || null, null, q ) ];
			if ( what[ 1 ] === 'record' ) return [ hit( 'mixpanel', 'Mixpanel session replay', null, 'session recording', q ) ];
			const b = parseBody( body ) || {};
			let data = jsonish( b.data !== undefined ? b.data : q.data !== undefined ? q.data : b );
			const list = Array.isArray( data ) ? data : data ? [ data ] : [];
			const name = what[ 1 ] === 'track' ? null : what[ 1 ] === 'engage' ? 'people update' : 'group update';
			if ( ! list.length ) return [ hit( 'mixpanel', 'Mixpanel', null, name || 'event', q ) ];
			return list.map( e => {
				const props = e.properties || {};
				const own = Object.fromEntries( Object.entries( props ).filter( ( [ k ] ) => ! /^(\$|mp_|token$|distinct_id$|time$)/.test( k ) ) );
				return hit( 'mixpanel', 'Mixpanel', props.token || e.$token || null, name || e.event || 'event', flatten( e ), { summary: pairs( own ) } );
			} );
		},
		labels: { event: 'event name', 'properties.token': 'project token', 'properties.distinct_id': 'distinct ID', 'properties.$current_url': 'page URL' },
	} );

	add( {
		key: 'heap', name: 'Heap', group: 'analytics', needs: 'analytics_storage',
		hosts: [ 'heapanalytics.com', 'heap-api.com' ],
		classify( { h, p, q } ) {
			let m;
			if ( ( m = /\/heap-(\d+)\.js$/.exec( p ) ) || ( m = /^\/config\/(\d+)\//.exec( p ) ) ) return [ script( 'heap', 'Heap', m[ 1 ], q ) ];
			if ( p === '/h' ) return [ hit( 'heap', 'Heap', q.a || null, 'pageview', q, { summary: q.h ? 'path=' + q.h : '' } ) ];
			if ( ( m = /\/api\/capture\/v\d\/(\w+)/.exec( p ) ) || ( m = /^\/api\/(track|identify|add_user_properties)/.exec( p ) ) ) {
				return [ hit( 'heap', 'Heap', q.a || null, m[ 1 ].replace( /_/g, ' ' ), q, { notes: hostIs( h, 'heap-api.com' ) ? [ 'Binary payload, not decoded' ] : [] } ) ];
			}
			return null;
		},
		labels: { a: 'environment ID', h: 'page path', t: 'page title', u: 'user ID' },
	} );

	add( {
		key: 'posthog', name: 'PostHog', group: 'analytics', needs: 'analytics_storage',
		hosts: [],
		match: h => hostIs( h, 'posthog.com' ) && h !== 'posthog.com' && h !== 'www.posthog.com',
		listen: [ '*://*.posthog.com/*' ],
		classify( { p, q, body } ) {
			let m;
			if ( ( m = /^\/array\/([\w-]+)\/config/.exec( p ) ) ) return [ script( 'posthog', 'PostHog config', m[ 1 ], q ) ];
			if ( /^\/(decide|flags|report)\b/.test( p ) ) return [ aux( 'posthog', 'PostHog ' + p.split( '/' )[ 1 ], q.token || null, null, q ) ];
			if ( /^\/s\/?$/.test( p ) ) return [ hit( 'posthog', 'PostHog session replay', null, 'session recording', q ) ];
			if ( /^\/(e|i\/v0\/e|batch|capture|track|engage)\/?$/.test( p ) ) {
				const b = parseBody( body );
				const d = b && b.data !== undefined ? jsonish( b.data ) : b;
				const list = Array.isArray( d ) ? d : d && Array.isArray( d.batch ) ? d.batch : d ? [ d ] : [];
				const key = d && d.api_key;
				if ( ! list.length ) return [ hit( 'posthog', 'PostHog', null, 'event', q, { notes: q.compression ? [ 'Compressed (' + q.compression + '), not decoded' ] : [] } ) ];
				return list.map( e => {
					const props = e.properties || {};
					const own = Object.fromEntries( Object.entries( props ).filter( ( [ k ] ) => ! /^\$|^token$|^distinct_id$/.test( k ) ) );
					return hit( 'posthog', 'PostHog', props.token || key || null, e.event || 'event', flatten( e ), { summary: pairs( own ) } );
				} );
			}
			return null;
		},
		labels: { event: 'event name', 'properties.token': 'project key', 'properties.distinct_id': 'distinct ID', 'properties.$current_url': 'page URL' },
	} );

	function matomoEvent( r ) {
		if ( r.e_c ) return 'event: ' + [ r.e_c, r.e_a, r.e_n ].filter( Boolean ).join( ' / ' );
		if ( r.idgoal && r.idgoal !== '0' ) return 'goal ' + r.idgoal;
		if ( r.ec_id ) return 'ecommerce order';
		if ( r.search ) return 'site search';
		if ( r.link ) return 'outlink';
		if ( r.download ) return 'download';
		return 'pageview';
	}
	add( {
		key: 'matomo', name: 'Matomo', group: 'analytics', needs: 'analytics_storage',
		hosts: [ 'matomo.cloud' ],
		match: ( h, p ) => /\/(matomo|piwik)\.(php|js)$/.test( p ),
		listen: [ '*://*/*matomo.php*', '*://*/*piwik.php*', '*://*/*matomo.js*', '*://*/*piwik.js*' ],
		classify( { p, q, body } ) {
			if ( isScript( p ) ) return [ script( 'matomo', /container_/.test( p ) ? 'Matomo Tag Manager' : 'Matomo', null, q ) ];
			if ( ! /\.php$/.test( p ) ) return null;
			// Bulk tracking posts {"requests": ["?idsite=1&...", ...]}.
			const b = parseBody( body );
			const reqs = b && Array.isArray( b.requests )
				? b.requests.map( r => Object.assign( {}, q, paramsOf( new URLSearchParams( r.replace( /^\?/, '' ) ) ) ) )
				: [ Object.assign( {}, q, b && ! Array.isArray( b ) ? b : {} ) ];
			return reqs.map( r => r.ping
				? aux( 'matomo', 'Matomo heartbeat', r.idsite, null, r )
				: hit( 'matomo', 'Matomo', r.idsite || null, matomoEvent( r ), r, { summary: r.action_name ? 'title=' + r.action_name : '' } ) );
		},
		labels: { idsite: 'site ID', action_name: 'page title', url: 'page URL', urlref: 'referrer', _id: 'visitor ID', e_c: 'event category', e_a: 'event action', e_n: 'event name', e_v: 'event value', idgoal: 'goal ID', revenue: 'revenue', ec_id: 'order ID', uid: 'user ID' },
	} );

	add( {
		key: 'plausible', name: 'Plausible', group: 'analytics', needs: 'analytics_storage',
		hosts: [ 'plausible.io' ],
		match: ( h, p ) => p === '/api/event',
		listen: [ '*://*/api/event' ],
		classify( { h, p, q, body } ) {
			if ( isScript( p ) ) return [ script( 'plausible', 'Plausible script', last( p ).replace( /\.js$/, '' ), q ) ];
			if ( p !== '/api/event' ) return null;
			const d = parseBody( body );
			// Plenty of other sites have an /api/event; only Plausible's shape counts.
			if ( ! d || ! d.n || ! ( d.u || d.url ) ) return h === 'plausible.io' ? [ hit( 'plausible', 'Plausible', null, 'event', q ) ] : [];
			const props = jsonish( d.p ) || d.props || {};
			const r = hit( 'plausible', 'Plausible', d.d || d.domain || null, d.n, flatten( d ), { summary: pairs( props ) } );
			if ( h !== 'plausible.io' ) r.notes.push( 'Sent through ' + h + ' (proxied)' );
			return [ r ];
		},
		labels: { n: 'event name', u: 'page URL', d: 'site domain', r: 'referrer' },
	} );

	add( {
		key: 'comscore', name: 'Comscore', group: 'analytics', needs: 'analytics_storage',
		hosts: [ 'scorecardresearch.com' ],
		classify( { h, p, q } ) {
			if ( /^\/b2?$/.test( p ) ) return [ hit( 'comscore', 'Comscore', q.c2 || null, 'page view', q ) ];
			if ( h.startsWith( 'ads.' ) ) return [ aux( 'comscore', 'Comscore cookie sync', q.c2 || null, null, q ) ];
			return null;
		},
		labels: { c2: 'client ID' },
	} );

	add( {
		key: 'fathom', name: 'Fathom', group: 'analytics', needs: 'analytics_storage',
		hosts: [],
		match: h => hostIs( h, 'usefathom.com' ) && h !== 'usefathom.com' && h !== 'www.usefathom.com',
		listen: [ '*://*.usefathom.com/*' ],
		classify( { p, q } ) {
			if ( isScript( p ) ) return [ script( 'fathom', 'Fathom script', null, q ) ];
			if ( q.sid || q.p ) return [ hit( 'fathom', 'Fathom', q.sid || null, q.name || 'pageview', q, { summary: q.p ? 'path=' + q.p : '' } ) ];
			return null;
		},
		labels: { sid: 'site ID', p: 'page path', h: 'host', r: 'referrer' },
	} );

	// ================================================================ Session replay

	add( {
		key: 'hotjar', name: 'Hotjar', group: 'replay', needs: 'analytics_storage',
		hosts: [ 'hotjar.com', 'hotjar.io' ],
		match: h => h === 'static.hj.contentsquare.net',
		classify( { h, p, q } ) {
			let m;
			if ( ( m = /\/hotjar-(\d+)\.js$/.exec( p ) ) ) return [ script( 'hotjar', 'Hotjar', m[ 1 ], q ) ];
			if ( isScript( p ) ) return [ script( 'hotjar', 'Hotjar library', null, q ) ];
			if ( /^ws/.test( h ) || p.endsWith( '/client/ws' ) ) return [ hit( 'hotjar', 'Hotjar', q.site_id || null, 'live session stream', q ) ];
			if ( h === 'content.hotjar.io' ) return [ hit( 'hotjar', 'Hotjar', q.site_id || null, 'page snapshot', q ) ];
			if ( ( m = /\/sites\/(\d+)\/(visit-data|recordings)/.exec( p ) ) ) return [ hit( 'hotjar', 'Hotjar', m[ 1 ], m[ 2 ] === 'recordings' ? 'session recording' : 'visit', q ) ];
			if ( ( m = /^\/sessions\/(\d+)/.exec( p ) ) ) return [ aux( 'hotjar', 'Hotjar sampling check', m[ 1 ], null, q ) ];
			return null;
		},
	} );

	add( {
		key: 'clarity', name: 'Microsoft Clarity', group: 'replay', needs: 'analytics_storage',
		hosts: [ 'clarity.ms' ],
		classify( { h, p, q } ) {
			let m;
			if ( ( m = /^\/tag\/(?:[a-z]+\/)?(\w+)$/.exec( p ) ) ) return [ script( 'clarity', 'Clarity tag', m[ 1 ], q ) ];
			if ( isScript( p ) ) return [ script( 'clarity', 'Clarity library', null, q ) ];
			if ( /\/collect$/.test( p ) ) return [ hit( 'clarity', 'Microsoft Clarity', null, 'session recording', q ) ];
			if ( p === '/c.gif' ) return [ aux( 'clarity', 'Clarity cookie sync', null, null, q ) ];
			return null;
		},
	} );

	add( {
		key: 'fullstory', name: 'FullStory', group: 'replay', needs: 'analytics_storage',
		hosts: [],
		match: h => /^(edge|rs)(\.[a-z0-9]+)?\.fullstory\.com$/.test( h ),
		listen: [ '*://*.fullstory.com/*' ],
		classify( { p, q, body } ) {
			if ( p === '/s/fs.js' ) return [ script( 'fullstory', 'FullStory', null, q ) ];
			let m;
			if ( ( m = /^\/s\/settings\/([\w-]+)/.exec( p ) ) ) return [ aux( 'fullstory', 'FullStory settings', m[ 1 ], null, q ) ];
			if ( p === '/rec/page' ) {
				const d = parseBody( body ) || {};
				return [ hit( 'fullstory', 'FullStory', d.OrgId || null, 'page start', Object.keys( d ).length ? flatten( d ) : q ) ];
			}
			if ( p.startsWith( '/rec/bundle' ) ) return [ hit( 'fullstory', 'FullStory', q.OrgId || null, 'session recording', q ) ];
			return null;
		},
		labels: { OrgId: 'org ID', UserId: 'user ID', SessionId: 'session ID', Url: 'page URL' },
	} );

	add( {
		key: 'contentsquare', name: 'Contentsquare', group: 'replay', needs: 'analytics_storage',
		hosts: [ 'contentsquare.net' ],
		classify( { h, p, q } ) {
			let m;
			if ( ( m = /^\/uxa\/(\w+)\.js$/.exec( p ) ) || ( m = /^\/ss\/(\d+)\//.exec( p ) ) ) return [ script( 'contentsquare', 'Contentsquare tag', m[ 1 ], q ) ];
			if ( isScript( p ) ) return [ script( 'contentsquare', 'Contentsquare library', null, q ) ];
			if ( p === '/pageview' ) return [ hit( 'contentsquare', 'Contentsquare', q.pid || null, 'pageview', q ) ];
			if ( p === '/events' ) return [ hit( 'contentsquare', 'Contentsquare', q.pid || null, 'events', q ) ];
			if ( /\/recording$/.test( p ) ) return [ hit( 'contentsquare', 'Contentsquare', q.pid || null, 'session recording', q ) ];
			return null;
		},
		labels: { pid: 'project ID', uu: 'visitor ID', url: 'page URL' },
	} );

	add( {
		key: 'quantummetric', name: 'Quantum Metric', group: 'replay', needs: 'analytics_storage',
		hosts: [ 'quantummetric.com' ],
		classify( { p, q } ) {
			let m;
			if ( ( m = /\/quantum-([\w-]+)\.js$/.exec( p ) ) ) return [ script( 'quantummetric', 'Quantum Metric', m[ 1 ], q ) ];
			if ( ( m = /^\/horizon\/([\w-]+)/.exec( p ) ) ) return [ hit( 'quantummetric', 'Quantum Metric', m[ 1 ], 'session data', q, { notes: [ 'Compressed session payload, not decoded' ] } ) ];
			return null;
		},
	} );

	add( {
		key: 'mouseflow', name: 'Mouseflow', group: 'replay', needs: 'analytics_storage',
		hosts: [],
		match: h => hostIs( h, 'mouseflow.com' ) && ! /^(www\.)?mouseflow\.com$/.test( h ),
		listen: [ '*://*.mouseflow.com/*' ],
		classify( { p, q } ) {
			const m = /^\/projects\/([\w-]+)\.js$/.exec( p );
			if ( m ) return [ script( 'mouseflow', 'Mouseflow', m[ 1 ], q ) ];
			if ( /session|record|event/i.test( p ) ) return [ hit( 'mouseflow', 'Mouseflow', null, 'session recording', q ) ];
			return null;
		},
	} );

	add( {
		key: 'crazyegg', name: 'Crazy Egg', group: 'replay', needs: 'analytics_storage',
		hosts: [ 'crazyegg.com' ],
		classify( { p, q } ) {
			const m = /^\/pages\/scripts\/(\d+)\/(\d+)\.js$/.exec( p );
			if ( m ) return [ script( 'crazyegg', 'Crazy Egg', m[ 1 ] + m[ 2 ], q ) ];
			return null;
		},
	} );

	// ================================================================ CDPs and tag managers

	add( {
		key: 'rudderstack', name: 'RudderStack', group: 'cdp', needs: 'analytics_storage',
		hosts: [ 'dataplane.rudderstack.com', 'rudderlabs.com', 'api.rudderstack.com' ],
		// Often proxied through the client's own domain: /<anything>/beacon/v1/batch?writeKey=…
		match: ( h, p, q ) => /\/beacon\/v1\/batch\/?$/.test( p ) && !! q.writeKey,
		listen: [ '*://*/*beacon/v1/batch*' ],
		classify( { h, p, q, body } ) {
			let m;
			if ( ( m = /\/v1\/(track|page|identify|group|alias|screen|batch)\/?$/.exec( p ) ) ) {
				const hits = segmentHits( m[ 1 ], body, 'rudderstack', 'RudderStack', q.writeKey );
				if ( ! hostIs( h, 'dataplane.rudderstack.com' ) ) hits.forEach( x => x.notes.unshift( 'Sent through ' + h + ' (proxied)' ) );
				return hits;
			}
			if ( p.startsWith( '/sourceConfig' ) ) return [ aux( 'rudderstack', 'RudderStack source config', q.writeKey || null, null, q ) ];
			return null;
		},
		labels: { writeKey: 'source write key', type: 'call type', event: 'event name', anonymousId: 'anonymous ID', userId: 'user ID' },
	} );

	add( {
		key: 'mparticle', name: 'mParticle', group: 'cdp', needs: 'analytics_storage',
		hosts: [ 'mparticle.com' ],
		classify( { h, p, q, body } ) {
			let m;
			if ( ( m = /\/v\d\/JS\/([\w-]+)\/events$/i.exec( p ) ) ) {
				const d = parseBody( body ) || {};
				const events = d.events || ( d.msgs ) || [];
				if ( ! events.length ) return [ hit( 'mparticle', 'mParticle', m[ 1 ], 'event', q ) ];
				return events.map( e => {
					const data = e.data || e;
					const name = data.event_name || data.screen_name || e.event_type || e.dt || 'event';
					return hit( 'mparticle', 'mParticle', m[ 1 ], name, flatten( e ), { summary: pairs( filled( data.custom_attributes ) ) } );
				} );
			}
			if ( h.startsWith( 'identity.' ) ) {
				const d = parseBody( body ) || {};
				const ids = Object.keys( filled( d.known_identities ) ).filter( k => ! /device|cookie/.test( k ) );
				return [ hit( 'mparticle', 'mParticle', null, last( p ), Object.keys( d ).length ? flatten( d ) : q, {
					notes: ids.length ? [ 'Sends identities: ' + ids.join( ', ' ) ] : [],
				} ) ];
			}
			if ( ( m = /\/js\/v\d\/([\w-]+)\/mparticle/.exec( p ) ) ) return [ script( 'mparticle', 'mParticle', m[ 1 ], q ) ];
			return null;
		},
	} );

	add( {
		key: 'tealium', name: 'Tealium', group: 'cdp', needs: 'analytics_storage',
		hosts: [ 'tiqcdn.com', 'tealiumiq.com' ],
		classify( { h, p, q, body } ) {
			let m;
			if ( ( m = /^\/utag\/([\w-]+)\/([\w-]+)\/([\w-]+)\/utag(\.sync)?\.js$/.exec( p ) ) ) return [ script( 'tealium', 'Tealium iQ', m[ 1 ] + '/' + m[ 2 ] + ' (' + m[ 3 ] + ')', q ) ];
			if ( ( m = /\/utag\.(\d+)\.js$/.exec( p ) ) ) return [ script( 'tealium', 'Tealium tag template', 'utag.' + m[ 1 ], q ) ];
			if ( hostIs( h, 'tealiumiq.com' ) && ( p === '/event' || /\/i\.gif$/.test( p ) ) ) {
				const d = merged( q, body );
				const data = jsonish( d.data ) || d;
				const pick1 = ( ...ks ) => ks.map( k => data[ k ] ).find( Boolean );
				return [ hit( 'tealium', 'Tealium', [ pick1( 'tealium_account' ), pick1( 'tealium_profile' ) ].filter( Boolean ).join( '/' ) || null,
					pick1( 'tealium_event', 'event_name', 'tealium_event_type' ) || 'event', flatten( data ) ) ];
			}
			return null;
		},
	} );

	// ================================================================ Marketing automation

	add( {
		key: 'hubspot', name: 'HubSpot', group: 'marketing', needs: 'analytics_storage',
		hosts: [ 'hubspot.com', 'hs-scripts.com', 'hs-analytics.net', 'hsadspixel.net', 'hs-banner.com', 'hscollectedforms.net', 'hsforms.com', 'hsforms.net', 'usemessages.com', 'hubapi.com' ],
		classify( { h, p, q } ) {
			let m;
			if ( p === '/__ptq.gif' ) {
				const event = q.n || ( q.k === '1' ? 'page view' : 'event (k=' + q.k + ')' );
				return [ hit( 'hubspot', 'HubSpot', q.a || null, event, q, { summary: q.t ? 'title=' + q.t : '' } ) ];
			}
			if ( p.includes( '/collected-forms/submit' ) ) {
				return [ hit( 'hubspot', 'HubSpot', q.portalId || null, 'collected form submission', q, {
					notes: [ 'Collected forms: HubSpot captures submissions of the site\'s own (non-HubSpot) forms' ],
				} ) ];
			}
			if ( ( m = /\/submissions\/v3\/integration\/submit\/(\d+)\//.exec( p ) ) ) return [ hit( 'hubspot', 'HubSpot', m[ 1 ], 'form submission', q ) ];
			if ( ( m = /\/web-interactives\/public\/v1\/track\/(\w+)/.exec( p ) ) ) return [ hit( 'hubspot', 'HubSpot', q.portalId || null, 'CTA ' + m[ 1 ], q ) ];
			if ( ( m = /^\/(\d+)\.js$/.exec( p ) ) && hostIs( h, 'hs-scripts.com' ) ) return [ script( 'hubspot', 'HubSpot tracking code', m[ 1 ], q ) ];
			if ( ( m = /\/analytics\/\d+\/(\d+)\.js$/.exec( p ) ) ) return [ script( 'hubspot', 'HubSpot analytics', m[ 1 ], q ) ];
			if ( hostIs( h, 'hsadspixel.net' ) ) return [ script( 'hubspot', 'HubSpot ads pixel', last( p ).replace( /\.js$/, '' ), q ) ];
			if ( hostIs( h, 'hs-banner.com' ) ) return [ script( 'hubspot', 'HubSpot cookie banner', null, q ) ];
			if ( hostIs( h, 'hscollectedforms.net' ) && isScript( p ) ) return [ script( 'hubspot', 'HubSpot collected forms', null, q ) ];
			return null;
		},
		labels: { a: 'portal ID', k: 'event type', t: 'page title', pu: 'page URL', n: 'event name', portalId: 'portal ID' },
	} );

	add( {
		key: 'marketo', name: 'Marketo', group: 'marketing', needs: 'analytics_storage',
		hosts: [ 'mktoresp.com', 'marketo.net' ],
		match: h => /^app-[a-z0-9]+\.marketo\.com$/.test( h ),
		listen: [ '*://*.marketo.com/js/forms2/*' ],
		classify( { h, p, q } ) {
			if ( hostIs( h, 'marketo.net' ) ) return [ script( 'marketo', 'Munchkin', null, q ) ];
			if ( hostIs( h, 'marketo.com' ) ) return [ script( 'marketo', 'Marketo forms', h.split( '.' )[ 0 ], q ) ];
			if ( p === '/webevents/visitWebPage' ) return [ hit( 'marketo', 'Marketo', q._mchId || null, 'page visit', q ) ];
			if ( p === '/webevents/clickLink' ) return [ hit( 'marketo', 'Marketo', q._mchId || null, 'link click', q, { summary: q._mchHr ? 'link=' + q._mchHr : '' } ) ];
			return null;
		},
		labels: { _mchId: 'Munchkin ID', _mchTk: 'tracking cookie (_mkto_trk)', _mchHo: 'host', _mchRu: 'page path', _mchHr: 'link URL' },
	} );

	add( {
		key: 'bizible', name: 'Marketo Measure', group: 'marketing', needs: 'analytics_storage',
		hosts: [ 'bizible.com', 'bizibly.com' ],
		classify( { p, q } ) {
			if ( p === '/ipv' ) return [ hit( 'bizible', 'Marketo Measure', null, 'page view', q, { summary: q._biz_l ? 'url=' + q._biz_l : '' } ) ];
			if ( p === '/u' ) return [ aux( 'bizible', 'Marketo Measure ID map', null, null, q ) ];
			return null;
		},
	} );

	add( {
		key: 'pardot', name: 'Pardot', group: 'marketing', needs: 'analytics_storage',
		hosts: [ 'pardot.com' ],
		classify( { p, q } ) {
			if ( p === '/analytics' ) return [ hit( 'pardot', 'Pardot', q.account_id || q.piAId || null, 'page view', q, { summary: q.title ? 'title=' + q.title : '' } ) ];
			return null;
		},
	} );

	add( {
		key: 'klaviyo', name: 'Klaviyo', group: 'marketing', needs: 'analytics_storage',
		hosts: [ 'klaviyo.com' ],
		classify( { p, q, body } ) {
			if ( p === '/onsite/js/klaviyo.js' ) return [ script( 'klaviyo', 'Klaviyo', q.company_id || null, q ) ];
			if ( /^\/client\/events\/?$/.test( p ) ) {
				const d = parseBody( body ) || {};
				const a = ( d.data && d.data.attributes ) || {};
				const metric = a.metric && a.metric.data && a.metric.data.attributes && a.metric.data.attributes.name;
				const profile = ( a.profile && a.profile.data && a.profile.data.attributes ) || {};
				return [ hit( 'klaviyo', 'Klaviyo', q.company_id || null, metric || 'event', Object.keys( d ).length ? flatten( d ) : q, {
					summary: pairs( filled( a.properties ) ),
					notes: profile.email ? [ 'Sends the visitor\'s email address' ] : [],
				} ) ];
			}
			if ( /^\/client\/profile/.test( p ) ) return [ hit( 'klaviyo', 'Klaviyo', q.company_id || null, 'identify', q ) ];
			if ( /^\/api\/(track|identify)/.test( p ) ) {
				const b = Object.assign( {}, q, parseBody( body ) || {} );
				const d = jsonish( b.data ) || {};
				return [ hit( 'klaviyo', 'Klaviyo', d.token || null, d.event || last( p ), flatten( d ), { summary: pairs( filled( d.properties ) ) } ) ];
			}
			return null;
		},
		labels: { company_id: 'company ID' },
	} );

	add( {
		key: 'attentive', name: 'Attentive', group: 'marketing', needs: 'ad_storage',
		hosts: [ 'attn.tv', 'attentivemobile.com' ],
		classify( { h, p, q } ) {
			const m = /^\/([\w-]+)\/dtag\.js$/.exec( p );
			if ( m && h === 'cdn.attn.tv' ) return [ script( 'attentive', 'Attentive tag', m[ 1 ], q ) ];
			return null;
		},
	} );

	add( {
		key: 'impact', name: 'Impact', group: 'marketing', needs: 'ad_storage',
		hosts: [ 'impactradius-event.com', 'impactcdn.com', 'pxf.io' ],
		classify( { h, p, q } ) {
			const m = /^\/xc\/(\d+)\//.exec( p );
			if ( m && hostIs( h, 'pxf.io' ) ) return [ hit( 'impact', 'Impact', m[ 1 ], 'visit', q ) ];
			if ( isScript( p ) ) return [ script( 'impact', 'Impact tracking tag', last( p ).replace( /\.js$/, '' ), q ) ];
			return null;
		},
	} );

	add( {
		key: 'northbeam', name: 'Northbeam', group: 'marketing', needs: 'ad_storage',
		hosts: [ 'northbeam.io' ],
	} );

	add( {
		key: 'customerio', name: 'Customer.io', group: 'marketing', needs: 'analytics_storage',
		hosts: [ 'track.customer.io', 'track-eu.customer.io', 'assets.customer.io' ],
		classify( { p, q } ) {
			const m = /^\/events\/(\w+)\.gif$/.exec( p );
			if ( m ) return [ hit( 'customerio', 'Customer.io', q.s || null, m[ 1 ] + ( q.name ? ': ' + q.name : '' ), q ) ];
			return null;
		},
	} );

	// ================================================================ B2B intent and reveal

	const LOOKUP = 'Looks up the visitor\'s company from their IP address';
	add( {
		key: '6sense', name: '6sense', group: 'b2b', needs: 'ad_storage',
		hosts: [ '6sc.co', 'epsilon.6sense.com' ],
		classify( { h, p, q } ) {
			if ( p === '/v1/beacon/img.gif' ) return [ hit( '6sense', '6sense', q.token || null, q.event || 'beacon', q ) ];
			if ( h === 'epsilon.6sense.com' ) return [ hit( '6sense', '6sense', null, 'company lookup', q, { notes: [ LOOKUP ] } ) ];
			if ( h === 'j.6sc.co' ) return [ script( '6sense', '6sense tag', last( p ).replace( /\.js$/, '' ), q ) ];
			return null;
		},
	} );

	add( {
		key: 'demandbase', name: 'Demandbase', group: 'b2b', needs: 'ad_storage',
		hosts: [ 'company-target.com', 'tag.demandbase.com', 'tag-logger.demandbase.com' ],
		classify( { h, p, q, body } ) {
			if ( /^\/api\/v\d\/ip\.json$/.test( p ) ) return [ hit( 'demandbase', 'Demandbase', null, 'company lookup', q, { notes: [ LOOKUP ] } ) ];
			if ( h === 'et.company-target.com' ) {
				const d = parseBody( body ) || {};
				return [ hit( 'demandbase', 'Demandbase', null, d.type || 'event', Object.keys( d ).length ? flatten( d ) : q ) ];
			}
			if ( h === 'tag.demandbase.com' ) return [ script( 'demandbase', 'Demandbase tag', last( p ).replace( /\.min\.js$|\.js$/, '' ), q ) ];
			return null;
		},
	} );

	add( {
		key: 'zoominfo', name: 'ZoomInfo', group: 'b2b', needs: 'ad_storage',
		hosts: [ 'ws.zoominfo.com', 'wss.zoominfo.com', 'ws-assets.zoominfo.com', 'zi-scripts.com' ],
		classify( { h, p, q } ) {
			const m = /^\/pixel\/(\w+)/.exec( p );
			if ( m ) return [ hit( 'zoominfo', 'ZoomInfo', m[ 1 ], 'WebSights visit', q, { notes: [ LOOKUP ] } ) ];
			if ( p.startsWith( '/formcomplete' ) ) return [ aux( 'zoominfo', 'ZoomInfo FormComplete', null, null, q ) ];
			if ( hostIs( h, 'zi-scripts.com' ) && p === '/zi-tag.js' ) return [ script( 'zoominfo', 'ZoomInfo tag', null, q ) ];
			return null;
		},
	} );

	add( {
		key: 'clearbit', name: 'Clearbit', group: 'b2b', needs: 'ad_storage',
		hosts: [ 'reveal.clearbit.com', 'app.clearbit.com', 'clearbitjs.com', 'clearbitscripts.com' ],
		classify( { h, p, q } ) {
			if ( p.startsWith( '/v1/companies/reveal' ) ) return [ hit( 'clearbit', 'Clearbit', null, 'company lookup', q, { notes: [ LOOKUP ] } ) ];
			if ( h === 'app.clearbit.com' && /^\/v1\/[pt]$/.test( p ) ) return [ hit( 'clearbit', 'Clearbit', null, p.endsWith( 'p' ) ? 'page' : 'track', q ) ];
			const m = /\/(pk_\w+)\//.exec( p );
			if ( m && isScript( p ) ) return [ script( 'clearbit', 'Clearbit', m[ 1 ], q ) ];
			return null;
		},
	} );

	add( {
		key: 'g2', name: 'G2', group: 'b2b', needs: 'ad_storage',
		hosts: [ 'tracking.g2crowd.com', 'tracking-api.g2.com' ],
		classify( { p, q, body } ) {
			if ( p.includes( '/conversions/assign' ) ) {
				const d = merged( q, body );
				return [ hit( 'g2', 'G2', d.sid || null, 'buyer intent visit', d ) ];
			}
			return null;
		},
	} );
} )();
