(function(){var i=document.getElementById('staff');if(!i)return;var m=function(n){return new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(n)};
function u(){var s=Math.min(999,Math.max(0,Math.floor(Number(i.value)||0)));var t=20+5*s;document.getElementById('subtotal').textContent=m(t);document.getElementById('gst').textContent=m(t*.1);document.getElementById('total').textContent=m(t*1.1)}
i.addEventListener('input',u);i.addEventListener('change',function(){i.value=Math.min(999,Math.max(0,Math.floor(Number(i.value)||0)));u()});u()})();
