// Browser-test doubles only. No native service calls, downloads, or renderer work.
(() => {
  const h = window.catalogHarness = {launches:[],inputLaunches:[],objects:[],directions:[],failLaunch:false};
  window.C5Wave = class {
    constructor() { this.mode='static'; this.error=null; this.motionHeld=false; }
    setTheme() {} setStyle() {} setQuality() {} setReducedMotion() {} setPaused() {} destroy() {}
    setMotionHeld(held) { this.motionHeld=!!held; }
    getDiagnostics() { return {mode:'static',surface:null,motionHeld:this.motionHeld}; }
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
  let appReply = null, appValue = null, appError = null;
  h.apps = value => {appValue=value;appError=null;if(appReply){const r=appReply;appReply=null;r.resolve(value);}};
  h.appsFail = error => {appError=error;if(appReply){const r=appReply;appReply=null;r.reject(error);}};
  window.C5TV = {
    isTV:()=>true,
    listApps:()=>{let rejectRead;const p=new Promise((resolve,reject)=>{rejectRead=reject;if(appError)reject(appError);else if(appValue)resolve(appValue);else appReply={resolve,reject};});p.cancel=()=>{appReply=null;rejectRead(Error('Cancelled'));};return p;},
    listInputLabels:()=>new Promise((resolve,reject)=>{h.labels=resolve;h.labelsFail=reject;}),
    launch:async id=>{h.launches.push(id);if(h.failLaunch)throw new Error('Unavailable on this TV.');return {preview:true};},
    openInput:async id=>{h.inputLaunches.push(id);return {preview:true};},
    platformBack:async()=>({preview:true}),connectMusicAudio:async()=>({preview:true})
  };
})();
