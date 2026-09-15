// Focused shader/music tests. The full browser regression suite remains separate.
'use strict';
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
(async()=>{
  const root=path.resolve(__dirname,'..'),checks=[],errors=[];
  fs.mkdirSync(path.join(root,'qa'),{recursive:true});
  const server=spawn(process.execPath,['tools/preview.cjs'],{cwd:root,stdio:['ignore','pipe','pipe']});
  let browser,serverLog='';server.stdout.on('data',b=>serverLog+=b);server.stderr.on('data',b=>serverLog+=b);
  try {
    let ready=false;
    for(let i=0;i<50;i++){
      if(server.exitCode!==null)throw new Error('Preview server exited: '+serverLog);
      try{if((await fetch('http://127.0.0.1:8765/')).ok){ready=true;break;}}catch(ignore){}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    if(!ready)throw new Error('Preview server did not start');
    browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    for(const suite of ['wave-msaa-browser','ps3-particles-browser','background-music-browser','wave-quality-browser','wave-post-browser']){
      console.log('Effects suite: '+suite);await require('./'+suite+'.cjs')(browser,checks,errors);
    }
    const result={checks,errors,browser:await browser.version(),normalURL:true,testedOnTV:false};
    fs.writeFileSync(path.join(root,'qa/effects-check.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
  }finally{if(browser)await browser.close();server.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});
