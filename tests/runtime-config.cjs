const assert=require('assert'),fs=require('fs'),vm=require('vm');
(async()=>{
 let finishSetup;const calls=[];
 const context={Promise,JSON,encodeURIComponent,unescape,btoa:value=>Buffer.from(value,'binary').toString('base64'),
  Luma:{exec(command){calls.push(command);return command.includes('setup.sh')
   ?new Promise(resolve=>{finishSetup=resolve})
   :Promise.resolve('{"success":true}');}}};
 context.window=context;vm.createContext(context);
 vm.runInContext(fs.readFileSync('src/com.spinoff.lumahome/runtime.js','utf8'),context);
 const change=context.LumaRuntime.configure({settings:{input_button_cycle:true}});
 assert.equal(calls.length,1);
 assert(calls[0].includes('setup.sh'),'configuration must first wait for runtime installation');
 finishSetup('{"success":true}');await change;
 assert(calls[1].includes('runtime-config.py'));
 await context.LumaRuntime.configure({settings:{input_button_cycle:true}});
 assert.equal(calls.length,2,'only a successfully applied setting may be skipped');
 console.log('Passed: settings wait for updated runtime tools before being marked applied.');
})().catch(error=>{console.error(error);process.exitCode=1});
