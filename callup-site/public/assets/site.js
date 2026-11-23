(function(){var i=document.getElementById('staff');if(!i)return;var m=function(n){return new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(n)};
var whole=function(n){return new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD',maximumFractionDigits:0}).format(n)};
function u(){var extra=Math.min(999,Math.max(0,Math.floor(Number(i.value)||0)));var t=20+5*extra;document.getElementById('subtotal').textContent=m(t);document.getElementById('gst').textContent=m(t*.1);document.getElementById('total').textContent=m(t*1.1);
var who=document.getElementById('savewho');if(!who)return;var n=extra+1,weeks=4.33,staffHrs=n*weeks,officeHrs=(2+0.5*n)*weeks,hours=Math.round(staffHrs+officeHrs),worth=Math.round(staffHrs*45+officeHrs*60);
who.textContent=extra?('Estimate for you and '+extra+' extra staff'):'Estimate for you';
document.getElementById('savehrs').textContent='~'+hours;document.getElementById('saveworth').textContent='~'+whole(worth);document.getElementById('savenet').textContent='~'+whole(worth-t)}
i.addEventListener('input',u);i.addEventListener('change',function(){i.value=Math.min(999,Math.max(0,Math.floor(Number(i.value)||0)));u()});u()})();
