'use strict';
// Runs with the TV's Node 8 runtime.
// --fast       : resolve only the saved Bonjour service, validating its UUID and current address.
// --browse     : also browse for other advertised names (slow, last resort).
// --connection : include the stored token (only the apps and voice helper use this).
// A successful Bonjour lookup stores its address as last_url so the next open can use --fast.
var fs = require('fs');
var spawn = require('child_process').spawn;
var ROOT = '/var/lib/webosbrew/lumahome';
function query(args, ms) {
  return new Promise(function (resolve) {
    var out = '', done = false, child;
    function finish() { if (done) return; done = true; clearTimeout(timer); if(child) child.kill(); resolve(out); }
    try { child = spawn('/usr/bin/dns-sd', args); } catch (_) { resolve(''); return; }
    child.stdout.on('data', function (chunk) { out += chunk.toString(); var ready=args[0]==='-L'?/uuid=[a-f0-9]{32}/i.test(out)&&/can be reached at/.test(out):args[0]==='-G'?/(?:[0-9]{1,3}\.){3}[0-9]{1,3}/.test(out):/Add.*_home-assistant\._tcp/.test(out);if(ready)setTimeout(finish,100); });
    child.on('error', finish); child.on('close', finish);
    var timer = setTimeout(finish, ms || 2200);
  });
}
function normalize(uuid) { return String(uuid || '').replace(/-/g, '').toLowerCase(); }
function saveLastUrl(config, url) {
  if (config.last_url === url) return;
  config.last_url = url;
  try {
    var tmp = ROOT + '/connection.json.tmp';
    fs.writeFileSync(tmp, JSON.stringify(config), { mode: 384 });
    fs.renameSync(tmp, ROOT + '/connection.json');
  } catch (_) {}
}
async function fast(config) {
  if (!config.uuid) throw new Error('Home Assistant is not paired.');
  // discovery_info was removed from HA. Validate the saved Bonjour service's
  // UUID and current address instead; never send credentials to an unchecked IP.
  var found = await discover(config);
  saveLastUrl(config, found.url);
  if(config.tv_id)found.tv_id=config.tv_id;
  return found;
}
async function discover(config, browseAll) {
  var names = [config.service_name || 'Home'];
  if(browseAll) {
    var browse = await query(['-B', '_home-assistant._tcp', 'local']);
    browse.split(/\r?\n/).forEach(function(line) {
      var match=line.match(/_home-assistant\._tcp\.?\s+(.+)$/);
      if(match && names.indexOf(match[1].trim())<0) names.push(match[1].trim());
    });
  }
  for(var i=0;i<names.length;i++) {
    var info=await query(['-L',names[i],'_home-assistant._tcp','local']);
    var uuid=(info.match(/\buuid=([a-f0-9]{32})\b/i)||[])[1];
    var endpoint=info.match(/can be reached at ([^\s:]+):(\d+)/);
    if(!uuid || !endpoint || (config.uuid && normalize(uuid)!==normalize(config.uuid))) continue;
    var addresses=await query(['-G','v4',endpoint[1]]);
    var ip=(addresses.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)||[]).filter(function(v){return v!=='0.0.0.0'&&v!=='127.0.0.1';})[0];
    if(!ip) continue;
    return {url:'http://'+ip+':'+endpoint[2],uuid:uuid,service_name:names[i]};
  }
  throw new Error('The paired Home Assistant was not found through Bonjour. Check multicast or the saved service name.');
}
async function connection(options) {
  options=options||{};
  var config={};
  try { config=JSON.parse(fs.readFileSync(ROOT+'/connection.json','utf8')); } catch(_) {}
  var found;
  if(options.fast) {
    try {found=await fast(config);}
    catch(error) {if(options.fastOnly)throw error;found=await discover(config,true);}
  } else found=await discover(config,options.browse);
  saveLastUrl(config,found.url);
  if(options.credentials) {
    if(!config.token) throw new Error('Home Assistant is not paired.');
    found.token=config.token;
  }
  if(config.tv_id)found.tv_id=config.tv_id;
  return found;
}
module.exports={connection:connection};
if(require.main===module) connection({fast:process.argv.indexOf('--fast')>=0,fastOnly:true,browse:process.argv.indexOf('--browse')>=0,credentials:process.argv.indexOf('--connection')>=0}).then(function(found){
  process.stdout.write(JSON.stringify(found)+'\n');
}).catch(function(err){process.stdout.write(JSON.stringify({error:err.message})+'\n');process.exitCode=1;});
