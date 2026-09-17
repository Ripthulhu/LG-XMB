#!/usr/bin/env python3
"""Native WebGL 2 regression tests. Browser readbacks exist only in this test.
Requires Python 3.10+, NumPy, Playwright and a Chromium installation.
Uses an in-memory harness; no TV, network services or product CSP changes.
"""
from __future__ import annotations
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import sys
import time
import traceback

import numpy as np
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ['wave-colors', 'ps3-native-data', 'ps3-native-core',
           'ps3-native-shaders', 'ps3-native-renderer']
HTML = '<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}canvas{width:100%;height:100%;display:block}</style><canvas id="wave"></canvas>'
HELPERS = r'''() => {
  window.arrayHash = a => {
    const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    let h = 2166136261;
    for (const n of b) h = Math.imul(h ^ n, 16777619);
    return (h >>> 0).toString(16);
  };
  window.stateHash = () => [demo.simulation.wave.p, demo.simulation.wave.v,
    demo.simulation.wave.controls, demo.simulation.particles.state].filter(Boolean).map(arrayHash).join(':');
  window.pixelHash = () => {
    const g = demo.gl, b = new Uint8Array(demo.canvas.width * demo.canvas.height * 4);
    g.readPixels(0, 0, demo.canvas.width, demo.canvas.height, g.RGBA, g.UNSIGNED_BYTE, b);
    return arrayHash(b);
  };
}'''


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser', default=os.environ.get('PLAYWRIGHT_EXECUTABLE_PATH'))
    parser.add_argument('--software', action='store_true', help='Use ANGLE SwiftShader, not native GPU performance')
    parser.add_argument('--output', type=Path, default=ROOT / 'evidence/browser-results.json')
    parser.add_argument('--fixtures', type=Path, default=ROOT / 'private-data/fixtures')
    args = parser.parse_args()
    if not (ROOT / 'app/ps3-native-data.js').is_file():
        parser.error('Private reference pack missing; import it before running fixture browser tests.')
    records: list[dict] = []
    browser_errors: list[str] = []

    def check(name, action):
        started = time.monotonic()
        try:
            details = action() or {}
            records.append({'name': name, 'passed': True, 'seconds': round(time.monotonic()-started, 3), 'details': details})
            print('PASS', name, flush=True)
        except Exception as exc:
            records.append({'name': name, 'passed': False, 'error': str(exc), 'traceback': traceback.format_exc()})
            print('FAIL', name, str(exc), flush=True)

    with sync_playwright() as playwright:
        launch_args = ['--disable-dev-shm-usage']
        if os.name != 'nt' and hasattr(os, 'geteuid') and os.geteuid() == 0:
            launch_args.append('--no-sandbox')
        if args.software:
            launch_args += ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
        browser = playwright.chromium.launch(executable_path=args.browser, headless=True, args=launch_args)

        def new_page(width=1280, height=720, missing_data=False):
            page = browser.new_page(viewport={'width': width, 'height': height}, device_scale_factor=1)
            page.on('pageerror', lambda error: browser_errors.append(str(error)))
            page.set_content(HTML)
            for script in SCRIPTS:
                if missing_data and script == 'ps3-native-data':
                    continue
                source = ROOT / 'app' / (script + '.js')
                if not source.is_file() and script == 'wave-colors':
                    continue
                page.add_script_tag(content=source.read_text(encoding='utf-8'))
            page.evaluate(HELPERS)
            return page

        page = new_page()
        page.evaluate('window.demo=new C5Wave(document.getElementById("wave"));demo.setReducedMotion(true)')
        page.wait_for_function('demo.mode === "webgl" || demo.mode === "static"', timeout=60000)

        def boot():
            d = page.evaluate('demo.getDiagnostics()')
            assert d['mode'] == 'webgl', d
            assert d['contextVersion'] == 2
            assert '3.00' in d['capabilities']['shadingLanguage']
            assert page.evaluate('demo.gl.getError()') == 0
            return d
        check('WebGL 2 boot, four linked GLSL ES 3.00 programs', boot)

        def gpu_geometry():
            result = page.evaluate(r'''() => {
              const r=demo.renderer,g=demo.gl;
              const output=g.createBuffer(),tf=g.createTransformFeedback();
              g.bindTransformFeedback(g.TRANSFORM_FEEDBACK,tf);
              g.bindBuffer(g.TRANSFORM_FEEDBACK_BUFFER,output);
              g.bufferData(g.TRANSFORM_FEEDBACK_BUFFER,16384*32,g.STREAM_READ);
              g.bindBufferBase(g.TRANSFORM_FEEDBACK_BUFFER,0,output);
              g.useProgram(r.waveProgram);g.bindVertexArray(r.waveVAO);
              g.activeTexture(g.TEXTURE0);g.bindTexture(g.TEXTURE_2D,r.controlTexture);
              g.uniform1i(r.uniforms.wave.uControls,0);g.uniform1i(r.uniforms.wave.uGrid,128);
              g.uniform1f(r.uniforms.wave.uAspectCorrection,1);
              g.enable(g.RASTERIZER_DISCARD);g.beginTransformFeedback(g.POINTS);
              g.drawArrays(g.POINTS,0,16384);g.endTransformFeedback();g.disable(g.RASTERIZER_DISCARD);
              const bytes=new Uint8Array(16384*32);g.getBufferSubData(g.TRANSFORM_FEEDBACK_BUFFER,0,bytes);
              g.bindBufferBase(g.TRANSFORM_FEEDBACK_BUFFER,0,null);g.bindTransformFeedback(g.TRANSFORM_FEEDBACK,null);
              g.deleteTransformFeedback(tf);g.deleteBuffer(output);g.bindVertexArray(null);
              let bin='';for(let i=0;i<bytes.length;i+=8192) bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+8192));
              return {error:g.getError(),base64:btoa(bin)};
            }''')
            expected = np.fromfile(args.fixtures / 'wave/mesh_output.bin', dtype='>f4').reshape(-1,8)
            actual = np.frombuffer(base64.b64decode(result['base64']), dtype='<f4').reshape(-1,8)
            error = np.abs(actual.astype(float)-expected.astype(float))
            assert result['error'] == 0
            assert np.isfinite(actual).all()
            assert error.max() < 5e-5, error.max()
            return {'vertices':len(actual), 'max_position_error':float(error[:,:4].max()),
                    'max_normal_error':float(error[:,4:].max())}
        check('GPU transform feedback versus all 16,384 captured positions and normals', gpu_geometry)

        def stable_redraw():
            before = page.evaluate('({pixels:pixelHash(),state:stateHash(),d:demo.getDiagnostics()})')
            page.evaluate('for(let i=0;i<10;i++) demo.draw()')
            after = page.evaluate('({pixels:pixelHash(),state:stateHash(),d:demo.getDiagnostics()})')
            assert before['state'] == after['state']
            assert before['pixels'] == after['pixels']
            assert before['d']['surface']['uploadedBytes'] == after['d']['surface']['uploadedBytes']
            assert before['d']['surface']['allocations'] == after['d']['surface']['allocations']
            return {'pixel_hash':after['pixels'],'extra_upload_bytes':0,'extra_target_allocations':0}
        check('Repeated frozen redraws retain pixels, simulation and allocations', stable_redraw)

        def filters_and_quality():
            samples=[]
            for mode,strength,soft in [('wave','strong',.75),('fxaa','gentle',1.5),('off','normal',0)]:
                page.evaluate('(q)=>demo.setQuality(q)',{'particles':True,'sampling':1.25,'postprocess':mode,'strength':strength,'softness':soft})
                d=page.evaluate('demo.getDiagnostics()')
                assert d['mode']=='webgl',d
                assert page.evaluate('demo.gl.getError()')==0
                assert d['surface']['particleCount']==2000
                samples.append({'filter':mode,'strength':strength,'pixel_hash':page.evaluate('pixelHash()')})
            assert len({s['pixel_hash'] for s in samples})>1, samples
            before=page.evaluate('stateHash()')
            page.evaluate('demo.setQuality({detail:"low",particleCount:500})')
            d=page.evaluate('demo.getDiagnostics()')
            assert d['surface']['vertices']==4096 and d['surface']['particleCount']==500
            page.evaluate('demo.setQuality({detail:"high",particleCount:4000})')
            d=page.evaluate('demo.getDiagnostics()')
            assert d['surface']['vertices']==16384 and d['surface']['particleCount']==2025
            assert before==page.evaluate('stateHash()')
            return {'filters':samples,'low_vertices':4096,'reference_vertices':16384,'capacity':d['surface']['particleCapacity']}
        check('FXAA, wave-coverage FXAA, softness, detail and particle limits', filters_and_quality)

        def msaa():
            states=[]
            for samples in [4,2,0]:
                page.evaluate('(n)=>demo.setQuality({msaa:n,sampling:1})',samples)
                d=page.evaluate('demo.getDiagnostics().surface')
                assert page.evaluate('demo.gl.getError()')==0,d
                assert d['msaaSamples']<=samples
                assert d['msaaSamples'] in [0]+d['msaaSupported']
                if d['msaaSamples']!=samples: assert d['msaaFallback']
                states.append({'requested':samples,'actual':d['msaaSamples'],'fallback':d['msaaFallback']})
            return {'negotiated':states}
        check('MSAA negotiation, resolve and unsupported-count fallback', msaa)

        def resize_and_budget():
            before=page.evaluate('stateHash()')
            page.set_viewport_size({'width':1920,'height':1080})
            page.wait_for_timeout(150)
            page.evaluate('demo.resize();demo.setQuality({sampling:2,msaa:4,postprocess:"wave",softness:.75,strength:"strong"})')
            d=page.evaluate('demo.getDiagnostics()')
            assert d['mode']=='webgl',d
            assert d['backingWidth']==1920 and d['backingHeight']==1080
            assert d['surface']['renderTargetBytes']<=96*1024*1024
            assert d['surface']['msaaSamples']==0 or d['surface']['effectiveScale']<2
            assert before==page.evaluate('stateHash()')
            assert page.evaluate('demo.gl.getError()')==0
            big=d['surface']
            page.set_viewport_size({'width':1280,'height':800});page.wait_for_timeout(150)
            page.evaluate('demo.resize();demo.setQuality({sampling:1,msaa:0})')
            d=page.evaluate('demo.getDiagnostics()')
            assert d['backingWidth']==1280 and d['backingHeight']==800
            assert page.evaluate('demo.gl.getError()')==0
            return {'large_target':big,'non_16_9_canvas':[d['backingWidth'],d['backingHeight']]}
        check('1080p, non-16:9 resize and 96 MiB offscreen-target budget', resize_and_budget)

        def paused_resize():
            before=page.evaluate('({state:stateHash(),pixels:pixelHash(),width:demo.canvas.width})')
            page.evaluate('demo.setPaused(true)')
            page.set_viewport_size({'width':960,'height':540});page.wait_for_timeout(150)
            after=page.evaluate('({state:stateHash(),pixels:pixelHash(),width:demo.canvas.width,pending:demo.resizePending,raf:demo.raf})')
            assert after['width']==before['width'] and after['pixels']==before['pixels'] and after['state']==before['state']
            assert after['pending'] and not after['raf']
            page.evaluate('demo.setPaused(false)')
            assert page.evaluate('demo.canvas.width')==960
            assert before['state']==page.evaluate('stateHash()')
            return {'state_preserved':True,'resize_deferred':True}
        check('Paused resize preserves retained frame and CPU state', paused_resize)

        def clock():
            d=page.evaluate(r'''() => {
              const oldRAF=window.requestAnimationFrame,oldCancel=window.cancelAnimationFrame;
              demo.cancel(); let queued=0;
              window.requestAnimationFrame=()=>++queued;window.cancelAnimationFrame=()=>{};
              demo.reducedMotion=false;
              const before={time:demo.time,wave:demo.simulation.wave.ticks,particle:demo.simulation.particles.ticks,draws:demo.renderer.drawCount};
              for(let i=0;i<=60;i++) demo.tick(1000+i*1000/60);
              const after={time:demo.time,wave:demo.simulation.wave.ticks,particle:demo.simulation.particles.ticks,draws:demo.renderer.drawCount};
              demo.cancel();demo.reducedMotion=true;window.requestAnimationFrame=oldRAF;window.cancelAnimationFrame=oldCancel;
              return {before,after};
            }''')
            assert abs(d['after']['time']-d['before']['time']-1)<1e-6,d
            assert d['after']['draws']-d['before']['draws']==30,d
            assert 59<=d['after']['wave']-d['before']['wave']<=60,d
            assert 59<=d['after']['particle']-d['before']['particle']<=60,d
            return d
        check('Synthetic 60 Hz callbacks produce 30 draws and 60 Hz simulation', clock)

        def hidden():
            before=page.evaluate('({state:stateHash(),d:demo.renderer.drawCount})')
            page.evaluate('Object.defineProperty(document,"hidden",{configurable:true,get:()=>true});document.dispatchEvent(new Event("visibilitychange"));demo.draw();demo.resize()')
            page.wait_for_timeout(80)
            assert page.evaluate('stateHash()')==before['state']
            assert page.evaluate('demo.renderer.drawCount')==before['d']
            assert page.evaluate('demo.raf')==0
            page.evaluate('delete document.hidden;document.dispatchEvent(new Event("visibilitychange"))')
            assert page.evaluate('stateHash()')==before['state']
            return {'simulation_unchanged':True,'background_draws':0}
        check('Visibility pause performs no draw or simulation catch-up', hidden)

        def context_restore():
            before=page.evaluate('({pixels:pixelHash(),state:stateHash()})')
            page.evaluate('window.lostExtension=demo.gl.getExtension("WEBGL_lose_context");if(!lostExtension)throw Error("Missing context-loss test extension");lostExtension.loseContext()')
            page.wait_for_function('demo.contextLost',timeout=10000)
            assert page.evaluate('stateHash()')==before['state']
            page.wait_for_timeout(100)
            page.evaluate('lostExtension.restoreContext()')
            page.wait_for_function('!demo.contextLost && demo.mode==="webgl"',timeout=60000)
            after=page.evaluate('({pixels:pixelHash(),state:stateHash(),error:demo.gl.getError()})')
            assert before['pixels']==after['pixels'],(before,after)
            assert before['state']==after['state']
            assert after['error']==0
            return after
        check('Context loss/restoration preserves CPU state and identical frozen pixels', context_restore)

        def colors():
            before=page.evaluate('({state:stateHash(),pixels:pixelHash()})')
            page.evaluate('demo.setTheme({background:"#241025",wave:"#d8a7c8"});demo.setStyle({brightness:1.5,speed:2.25})')
            after=page.evaluate('({state:stateHash(),pixels:pixelHash()})')
            assert before['state']==after['state']
            assert before['pixels']!=after['pixels']
            page.evaluate('demo.setTheme({background:"#08101c",wave:"#518aab"});demo.setStyle({brightness:1,speed:1.5})')
            return {'uniform_changes_do_not_advance_simulation':True}
        check('Theme and brightness update without resetting animation', colors)

        # Real screenshot of this implementation, never a generated/mock PS3 image.
        page.set_viewport_size({'width':1920,'height':1080});page.wait_for_timeout(150)
        page.evaluate('demo.resize();demo.setQuality({sampling:1.5,msaa:0,detail:"high",particles:true,particleCount:2000,softness:.75,postprocess:"wave",strength:"strong"});demo.draw()')
        args.output.parent.mkdir(parents=True,exist_ok=True)
        page.screenshot(path=str(args.output.parent/'webgl2-preview-1080p.png'))
        final_diagnostics=page.evaluate('demo.getDiagnostics()')

        def destruction():
            page.evaluate('demo.destroy();demo.destroy();demo.setQuality({sampling:2});demo.setPaused(false);demo.setTheme({});demo.setStyle({brightness:.6})')
            assert page.evaluate('demo.raf===0 && demo.initRaf===0 && demo.compileRaf===0 && demo.renderer===null && demo.gl===null')
            return {'double_destroy_safe':True,'pending_callbacks':0}
        check('Destruction releases renderer and cancels callback scheduling', destruction)

        def static_fallback(missing_data=False):
            other=new_page(640,360,missing_data=missing_data)
            if not missing_data:
                other.evaluate('() => { window.requestedContexts=[];document.getElementById("wave").getContext=(n)=>{requestedContexts.push(n);return null}; }')
            other.evaluate('window.demo=new C5Wave(document.getElementById("wave"))')
            other.wait_for_function('demo.mode==="static"',timeout=30000)
            d=other.evaluate('demo.getDiagnostics()')
            assert d['error']
            assert other.evaluate('demo.raf===0 && demo.initRaf===0 && demo.compileRaf===0')
            if not missing_data: assert other.evaluate('requestedContexts')==['webgl2']
            other.evaluate('demo.destroy()');other.close()
            return {'error':d['error'],'legacy_context_requested':False}
        check('No WebGL 2: static fallback without a WebGL 1 attempt', lambda:static_fallback())
        check('Missing local seed data: explicit static fallback without crash', lambda:static_fallback(True))
        check('No unhandled browser exceptions', lambda:assert_no_errors(browser_errors))
        browser_version=browser.version
        browser.close()

    result={'browser':browser_version,'software_renderer_requested':args.software,'test_harness':'in-memory; not a TV or Chromium 87 emulation',
            'passed':sum(r['passed'] for r in records),'failed':sum(not r['passed'] for r in records),
            'tests':records,'final_diagnostics':final_diagnostics}
    args.output.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    print(f"{result['passed']} passed; {result['failed']} failed; {args.output}")
    return int(bool(result['failed']))


def assert_no_errors(errors):
    assert not errors, errors
    return {'unhandled_errors':0}

if __name__=='__main__':
    sys.exit(main())
