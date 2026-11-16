(function(){
 'use strict';
 var selector='button,input,select,[tabindex="0"]',anchorX=null,keepAnchor=false,history=[];
 function visible(e){return !!(e&&!e.disabled&&e.offsetParent!==null&&e.getClientRects().length);}
 function card(e){return e&&e.closest&&e.closest('[data-nav-card]');}
 function items(root,inside){var out=Array.from(root.querySelectorAll(selector)).filter(function(e){var owner=card(e);return visible(e)&&(inside||!owner||owner===e);});if(root.matches&&root.matches(selector)&&visible(root))out.unshift(root);return out;}
 function focus(e,vertical,pointer){if(!visible(e))return false;if(!vertical)anchorX=e.getBoundingClientRect().left+e.getBoundingClientRect().width/2;keepAnchor=!!vertical;try{e.focus({preventScroll:true});}catch(_){e.focus();}keepAnchor=false;if(!pointer)e.scrollIntoView({block:'nearest',inline:'nearest'});return true;}
 function gap(a,b,key){if(key===37)return a.left-b.right;if(key===39)return b.left-a.right;if(key===38)return a.top-b.bottom;return b.top-a.bottom;}
 function overlap(a,b,key){return key===38||key===40?Math.min(a.right,b.right)-Math.max(a.left,b.left):Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);}
 function pick(list,from,key,zones){
  var r=from.getBoundingClientRect(),vertical=key===38||key===40,x=anchorX===null?r.left+r.width/2:anchorX,y=r.top+r.height/2;
  var candidates=list.filter(function(e){return e!==from;}).map(function(e){var q=e.getBoundingClientRect();return {e:e,r:q,gap:gap(r,q,key),beam:overlap(r,q,key)>2};}).filter(function(c){return c.gap>=-2&&(vertical||c.beam);});
  if(!candidates.length)return null;
  // Between regions, stay in the same column. Inside a grid, visit the next
  // visible row first, even when its cards have different widths.
  if(zones&&candidates.some(function(c){return c.beam;}))candidates=candidates.filter(function(c){return c.beam;});
  var nearest=Math.min.apply(null,candidates.map(function(c){return Math.max(0,c.gap);}));
  candidates=candidates.filter(function(c){return c.gap<=nearest+12;});
  candidates.sort(function(a,b){function score(c){var q=c.r,axis=vertical?x:y,lo=vertical?q.left:q.top,hi=vertical?q.right:q.bottom,distance=Math.max(lo-axis,0,axis-hi);return distance*10+Math.abs((lo+hi)/2-axis)*.01+Math.max(0,c.gap)*.001;}return score(a)-score(b);});
  return candidates[0].e;
 }
 function enter(zone,from,key){var list=items(zone),vertical=key===38||key===40;if(!list.length)return null;var edge=key===40?'top':key===38?'bottom':key===39?'left':'right',values=list.map(function(e){return e.getBoundingClientRect()[edge];}),boundary=(key===40||key===39?Math.min:Math.max).apply(null,values);list=list.filter(function(e){return Math.abs(e.getBoundingClientRect()[edge]-boundary)<12;});var r=from.getBoundingClientRect(),at=vertical?(anchorX===null?r.left+r.width/2:anchorX):r.top+r.height/2;list.sort(function(a,b){function distance(e){var q=e.getBoundingClientRect(),lo=vertical?q.left:q.top,hi=vertical?q.right:q.bottom;return Math.max(lo-at,0,at-hi)*10+Math.abs((lo+hi)/2-at)*.01;}return distance(a)-distance(b);});return list[0];}
 function move(root,key){
  var active=document.activeElement,owner=card(active);
  if(owner&&owner!==active){var child=pick(items(owner,true),active,key,false);if(child)focus(child,key===38||key===40);return;}
  var zone=active&&active.closest&&active.closest('[data-nav-zone]');if(!zone||!root.contains(zone)){focus(items(root)[0]);return;}
  var list=items(zone),target;
  if(zone.dataset.navRow!==undefined&&(key===37||key===39)){var index=list.indexOf(active);target=list[index+(key===39?1:-1)];if(target)focus(target,false);return;}
  target=pick(list,active,key,false);
  if(!target){var zones=Array.from(root.querySelectorAll('[data-nav-zone]')).filter(function(e){return e!==zone&&visible(e)&&items(e).length;});var next=pick(zones,active,key,true);if(next)target=enter(next,active,key);}
  if(target)focus(target,key===38||key===40);
 }
 function stop(e){e.preventDefault();e.stopImmediatePropagation();return true;}
 function handle(e,root){
  var key=e.keyCode,active=document.activeElement;if(!root||!root.contains(active))return false;
  var owner=card(active),field=active.matches('input,select'),range=field&&active.type==='range';
  if(field&&active.dataset.edit==='1'){
   if(key===27||key===461||key===13){delete active.dataset.edit;if(active.tagName==='INPUT')active.readOnly=true;if(key===13&&active.tagName==='SELECT')return false;stop(e);return true;}
   e.stopImmediatePropagation();return true;
  }
  if((key===27||key===461)&&owner&&owner!==active){focus(owner);return stop(e);}
  if(key===13){
   if(e.repeat)return stop(e);
   if(owner===active){if(active.dataset.dim){var input=active.querySelector('input:not(:disabled)');if(input)focus(input);}else active.click();return stop(e);}
   if(range&&owner){focus(owner);return stop(e);}
   if(field&&!range){active.dataset.edit='1';if(active.tagName==='INPUT'){active.blur();active.readOnly=false;active.focus();active.dataset.edit='1';return stop(e);}return false;}
  }
  if(key<37||key>40)return false;
  if(range&&(key===37||key===39)){if(owner&&window.LumaLights){LumaLights.adjust(owner,key===39?1:-1,active);return stop(e);}e.stopImmediatePropagation();return true;}
  move(root,key);return stop(e);
 }
 function bookmark(root){var active=document.activeElement;if(!root.contains(active))return null;var owner=card(active);return {node:active,id:active.id,setting:active.dataset.setting||active.dataset.tileEntity,entity:owner&&owner.dataset.entity,input:active.dataset.input,app:active.dataset.appid,index:items(root,true).indexOf(active),child:owner&&owner!==active?(active.matches('input')?'input':active.className):null};}
 function restore(root,b){if(!b||root.contains(b.node))return;var all=items(root,true),target=all.filter(function(e){return b.id?e.id===b.id:b.setting?(e.dataset.setting||e.dataset.tileEntity)===b.setting:b.input?e.dataset.input===b.input:b.app?e.dataset.appid===b.app:b.entity?e.dataset.entity===b.entity:false;})[0];if(target&&b.child)target=b.child==='input'?target.querySelector('input'):Array.from(target.querySelectorAll('button')).filter(function(e){return e.className===b.child;})[0]||target;focus(target||all[Math.max(0,Math.min(b.index,all.length-1))]);}
 function pointer(){var lastX=null,lastY=null;document.addEventListener('mousemove',function(e){if(e.buttons||e.clientX===lastX&&e.clientY===lastY)return;lastX=e.clientX;lastY=e.clientY;var active=document.activeElement;if(active&&active.dataset.edit==='1')return;var target=e.target.closest&&e.target.closest(selector);if(!target||!visible(target)||target===active)return;focus(target,false,true);});document.addEventListener('mousedown',function(e){var target=e.target.closest&&e.target.closest('input:not([type=range]),select');if(target){target.dataset.edit='1';if(target.tagName==='INPUT')target.readOnly=false;}});document.addEventListener('focusout',function(e){if(e.target.dataset){delete e.target.dataset.edit;if(e.target.tagName==='INPUT'&&e.target.type!=='range'&&e.target.type!=='file')e.target.readOnly=true;}});}
 // Use window rather than newer focus-visible/SpatialNavigation APIs on webOS.
 document.addEventListener('focusin',function(e){history=history.filter(function(n){return n!==e.target;});history.push(e.target);if(history.length>30)history.shift();if(!keepAnchor){var r=e.target.getBoundingClientRect();anchorX=r.left+r.width/2;}});
 window.LumaNav={handle:handle,move:move,focus:focus,bookmark:bookmark,restore:restore,items:items,resume:function(){if(visible(document.activeElement))return;for(var i=history.length-1;i>=0;i--)if(visible(history[i])){focus(history[i]);return;}}};pointer();
})();
