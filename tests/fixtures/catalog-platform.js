// Browser-test doubles only. No native service calls, downloads, or renderer work.
(() => {
  const h = window.catalogHarness = {launches:[],inputLaunches:[],objects:[],directions:[],failLaunch:false};
  window.C5Wave = class {
    constructor() { this.mode='static'; this.error=null; }
    setTheme() {} setStyle() {} setQuality() {} setReducedMotion() {} setPaused() {} destroy() {}
    getDiagnostics() { return {mode:'static',surface:null}; }
    setMenuObjects(items) { h.objects=items; }
    navigated(direction) { h.directions.push(direction); }
  };
  window.C5InputPreview = class {
    constructor() {this.port=null;}
    select(p) {this.port=p;} stop() {this.port=null;} destroy() {}
    getState() {return {port:this.port};}
  };
  window.C5Thumbnail = class {
    constructor() {this.port=null;this.paused=true;}
    select(p) {this.port=p;} setPaused(p) {this.paused=p;} refresh() {} destroy() {}
    getState() {return {port:this.port,paused:this.paused,status:'idle'};}
  };
  window.LGXMBBackgroundMusic = class {
    constructor() {this.active=false;}
    getState() {return {phase:'off',active:this.active};}
    setContext(active) {this.active=active;}
    gesture() {} setEnabled() {} setVolume() {} retry() {} destroy() {}
  };
  window.LGXMBWaveColors = {normalize:v=>v||{},resolve:()=>null};
  window.C5RemoteSettings = {close(){},open(){},getState(){return {};}};
  window.LGXMBWaveColorSettings = {open(){},key(){}};
  window.C5TV = {
    isTV:()=>true,
    listApps:()=>new Promise((resolve,reject)=>{h.apps=resolve;h.appsFail=reject;}),
    listInputLabels:()=>new Promise((resolve,reject)=>{h.labels=resolve;h.labelsFail=reject;}),
    launch:async id=>{h.launches.push(id);if(h.failLaunch)throw new Error('Unavailable on this TV.');return {preview:true};},
    openInput:async id=>{h.inputLaunches.push(id);return {preview:true};},
    platformBack:async()=>({preview:true}),connectMusicAudio:async()=>({preview:true})
  };
})();
