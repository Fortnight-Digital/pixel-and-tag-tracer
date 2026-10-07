/*
 * Pixel & Tag Tracer — DevTools page.
 *
 * Adds a "Tag Tracer" panel to DevTools. DevTools belongs to a single tab,
 * so the panel is only there on tabs where DevTools is open: the per-tab
 * alternative to the window-wide sidebar.
 */
'use strict';

browser.devtools.panels.create( 'Tag Tracer', '/icon.svg', '/panel.html' );
