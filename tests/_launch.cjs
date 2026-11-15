// Finds Playwright and a Chrome binary on this machine (Mac default or any Linux box with `npm i playwright`).
const fs=require('fs');
function load(){
 for(const p of [process.env.PLAYWRIGHT_PATH,'playwright']){
  if(!p)continue;try{return require(p);}catch(_){}
 }
 throw Error('Playwright not found. Run `npm i playwright` or set PLAYWRIGHT_PATH.');
}
exports.launch=()=>{
 const mac='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
 const executablePath=process.env.CHROME_PATH||(fs.existsSync(mac)?mac:undefined);
 return load().chromium.launch(Object.assign({headless:true},executablePath?{executablePath}:{}));
};
