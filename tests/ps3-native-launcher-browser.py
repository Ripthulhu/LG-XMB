#!/usr/bin/env python3
"""Exercise the real LG-XMB UI after native-renderer integration.

Requires Python 3.10+ and Playwright. Uses in-memory assets and mocked preferences;
network requests are aborted. It is not a TV API, package-CSP or full CI test.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, default=ROOT)
    parser.add_argument('--app-dir', type=Path, help='Explicit app directory instead of --repo/app')
    parser.add_argument('--browser', default=os.environ.get('PLAYWRIGHT_EXECUTABLE_PATH'))
    parser.add_argument('--software', action='store_true')
    parser.add_argument('--output', type=Path, default=ROOT/'evidence/launcher-integration.json')
    parser.add_argument('--screenshot', type=Path, default=ROOT/'evidence/lg-xmb-integrated-1080p.png')
    parser.add_argument('--scope-note', default='Integrated local clone. Not project-wide CI.')
    args = parser.parse_args()
    app = (args.app_dir or args.repo/'app').resolve()
    for name in ('app.js', 'index.html', 'style.css', 'ps3-native-data.js'):
        if not (app/name).is_file():
            parser.error(f'Missing {app/name}; install the native overlay and local pack first.')
    html = (app/'index.html').read_text(encoding='utf-8')
    scripts = re.findall(r'<script src="([^"]+)"></script>', html)
    if 'ps3-native-renderer.js' not in scripts or 'wave.js' in scripts:
        parser.error('Target index.html has not switched to the native renderer.')
    for name in scripts:
        if not (app/name).resolve().is_relative_to(app) or not (app/name).is_file():
            parser.error('Non-local or missing app script: '+name)
    # Remove the CSP only from this injected harness, never from product files.
    html = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.S)
    html = re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]+>', '', html)
    html = html.replace('<link rel="stylesheet" href="style.css">',
                        '<style>'+(app/'style.css').read_text(encoding='utf-8')+'</style>')
    errors: list[str] = []
    checks: list[dict] = []
    result = {'passed': 0, 'failed': 0, 'checks': checks, 'errors': errors,
              'scope': args.scope_note+' In-memory assets, mocked storage, network blocked; no TV APIs.',
              'asset_sha256': {name: hashlib.sha256((app/name).read_bytes()).hexdigest()
                               for name in scripts+['index.html', 'style.css']}}
    try:
        with sync_playwright() as p:
            launch = ['--disable-dev-shm-usage']
            if os.name != 'nt' and hasattr(os, 'geteuid') and os.geteuid() == 0:
                launch.append('--no-sandbox')
            if args.software:
                launch += ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
            browser = p.chromium.launch(executable_path=args.browser, headless=True, args=launch)
            result['browser'] = browser.version
            result['software_renderer_requested'] = args.software
            page = browser.new_page(viewport={'width': 1920, 'height': 1080})
            page.route('**/*', lambda route: route.abort())
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.set_content(html)
            page.evaluate('''() => {
              const store={'lg-xmb-preferences-v1':JSON.stringify({motion:'reduced',waveDetail:'high',waveSampling:1.5,wavePostprocess:'wave',waveSoftness:.75,waveSmoothing:'strong',waveParticles:true})};
              Object.defineProperty(window,'localStorage',{value:{getItem:k=>store[k]||null,setItem:(k,v)=>{store[k]=String(v)},removeItem:k=>{delete store[k]}}});
            }''')
            for name in scripts:
                page.add_script_tag(content=(app/name).read_text(encoding='utf-8'))
            page.wait_for_function('window.C5App && C5App.getState().waveMode==="webgl"', timeout=60000)
            state = page.evaluate('C5App.getState()')
            diag = state['waveDiagnostics']
            assert diag['contextVersion'] == 2
            assert diag['renderQuality']['softness'] == 1.5
            assert diag['renderQuality']['strength'] == 'strong'
            checks.append({'name': 'Launcher initializes with existing preferences', 'passed': True})
            result['initial_renderer'] = diag
            args.screenshot.parent.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(args.screenshot))

            def open_settings(item):
                if page.evaluate('C5App.getState().modal'):
                    page.keyboard.press('Escape')
                page.get_by_role('button', name='Settings', exact=True).click()
                delta = page.evaluate('target=>{const ids=C5Catalog.find(c=>c.id==="settings").items.map(i=>i.id);return ids.indexOf(target)-ids.indexOf(C5App.getState().item)}', item)
                for _ in range(abs(delta)):
                    page.keyboard.press('ArrowDown' if delta > 0 else 'ArrowUp')
                page.keyboard.press('Enter')
                page.wait_for_function('!!C5App.getState().modal')

            open_settings('appearance')
            assert page.evaluate('C5App.getState().waveDiagnostics.contextVersion') == 2
            detail = page.get_by_role('group', name='Mesh detail', exact=True)
            detail.get_by_role('button', name='Reduced', exact=True).click()
            assert page.evaluate('C5App.getState().waveDiagnostics.surface.grid') == 64
            detail.get_by_role('button', name='Original', exact=True).click()
            assert page.evaluate('C5App.getState().waveDiagnostics.surface.grid') == 128
            checks.append({'name': 'Wave settings select reduced/original grid', 'passed': True})
            group = page.get_by_role('group', name='Particles', exact=True)
            group.get_by_role('button', name='Off', exact=True).click()
            assert page.evaluate('C5App.getState().waveDiagnostics.surface.particleCount') == 0
            group.get_by_role('button', name='On', exact=True).click()
            assert page.evaluate('C5App.getState().waveDiagnostics.surface.particleCount') == 2000
            checks.append({'name': 'Particle settings toggle native instanced draws', 'passed': True})
            open_settings('appearance')
            page.get_by_role('button', name='Theme', exact=True).click()
            page.get_by_role('button', name='Forest', exact=True).click()
            assert page.evaluate('C5App.getState().preferences.theme') == 'forest'
            assert page.evaluate('C5App.getState().waveMode') == 'webgl'
            checks.append({'name': 'Appearance dialog changes native theme', 'passed': True})
            assert not errors, errors
            checks.append({'name': 'No unhandled browser exceptions', 'passed': True})
            browser.close()
    except Exception as exc:
        checks.append({'name': 'Launcher integration', 'passed': False, 'error': str(exc)})
    result['passed'] = sum(check['passed'] for check in checks)
    result['failed'] = len(checks)-result['passed']
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2)+'\n', encoding='utf-8')
    print(f"{result['passed']} passed; {result['failed']} failed; {args.output}")
    return int(bool(result['failed']))


if __name__ == '__main__':
    raise SystemExit(main())
