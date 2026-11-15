(function(){
 'use strict';
 window.LumaAppRail={attach:function(shell,rail,active){
  var frame=0,last=0,speed=0;
  function indicators(){var max=rail.scrollWidth-rail.clientWidth;shell.classList.toggle('can-left',rail.scrollLeft>2);shell.classList.toggle('can-right',rail.scrollLeft<max-2);}
  function stop(){if(frame)cancelAnimationFrame(frame);frame=0;last=0;speed=0;}
  function tick(now){frame=0;if(!active()){stop();return;}var before=rail.scrollLeft;rail.scrollLeft+=speed*Math.min(last?now-last:16,40)/1000;last=now;indicators();if(Math.abs(rail.scrollLeft-before)<.1){stop();return;}frame=requestAnimationFrame(tick);}
  shell.addEventListener('mousemove',function(e){
   if(!active()){stop();return;}var r=shell.getBoundingClientRect(),scale=r.width/shell.clientWidth,x=(e.clientX-r.left)/scale,edge=Math.min(120,shell.clientWidth/5);
   speed=x<edge?-750*(1-x/edge):x>shell.clientWidth-edge?750*(1-(shell.clientWidth-x)/edge):0;
   if(!speed){stop();return;}if(!frame)frame=requestAnimationFrame(tick);
  });
  shell.addEventListener('mouseleave',stop);
  shell.addEventListener('mousedown',stop);
  rail.addEventListener('wheel',function(e){if(!active()||rail.scrollWidth<=rail.clientWidth)return;e.preventDefault();stop();var delta=Math.abs(e.deltaX)>Math.abs(e.deltaY)?e.deltaX:e.deltaY;rail.scrollLeft+=delta*(e.deltaMode===1?32:e.deltaMode===2?rail.clientWidth:1);indicators();},{passive:false});
  rail.addEventListener('scroll',indicators);
  document.addEventListener('keydown',stop);
  document.addEventListener('visibilitychange',stop);
  new MutationObserver(function(){stop();indicators();}).observe(rail,{childList:true});
  window.addEventListener('resize',indicators);indicators();
 }};
})();
