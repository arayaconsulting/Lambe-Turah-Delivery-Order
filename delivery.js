(()=>{
'use strict';
const $=id=>document.getElementById(id);
let coords=null, route=null, busy=false;
const rup=n=>'Rp'+n.toLocaleString('id-ID');
const subtotal=()=>Object.entries(cart).reduce((sum,[id,qty])=>{const m=byId(id);return sum+(m?m.price*qty:0)},0);
const bracket=km=>km<=2?2000:km<=4?3000:km<=6?5000:km<=7?7000:km<=9?Math.ceil(km)*1000:null;
function show(message,kind=''){$('geoStatus').className='geo-status '+kind;$('geoStatus').textContent=message;}
function update(){
 const sum=subtotal(),fee=route?.fee, min=route&&route.km>7?75000:0;
 let desc=route?`Jarak rute: ${route.km.toFixed(2)} km • Ongkir: ${fee===null?'di luar layanan':rup(fee)} • Minimal order: ${rup(min)}`:'Ongkir menunggu penghitungan jarak rute.';
 if(route&&fee===null)desc+=' • Lebih dari 9 km: tidak dilayani.';
 else if(route&&sum<min)desc+=` • Tambahkan ${rup(min-sum)} untuk checkout.`;
 else if(route)desc+=` • Total dengan ongkir: ${rup(sum+fee)}.`;
 $('deliverySummary').textContent=desc;
 $('checkout').disabled=busy||!route||fee===null||sum<min||sum===0;
 $('checkout').textContent=busy?'Menghitung jarak...':!route?'Tentukan Lokasi Terlebih Dahulu':route.fee===null?'Di Luar Jangkauan Delivery':sum<min?'Belum Memenuhi Minimal Order':'Kirim Pesanan ke WhatsApp →';
}
async function calculate(){
 route=null;const origin=(window.LAMBE_OUTLETS||{})[branch];
 if(!origin||!Number.isFinite(origin.lat)||!Number.isFinite(origin.lng)){show('Koordinat outlet '+branch+' belum diisi oleh pengelola. Checkout belum tersedia.','error');update();return;}
 if(!coords){show('Tekan “Gunakan lokasi saya” saat berada di titik pengiriman.','error');update();return;}
 busy=true;update();show('Menghitung jarak tempuh melalui jalan...');
 try{
  // Server demo OSRM: hanya untuk prototipe, tidak ada jaminan uptime/kuota.
  const url=`https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${coords.lng},${coords.lat}?overview=false&steps=false`;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  let response;try{response=await fetch(url,{signal:controller.signal})}finally{clearTimeout(timer)}
  if(!response.ok)throw Error('Layanan rute tidak tersedia');
  const data=await response.json(),meters=data.routes?.[0]?.distance;
  if(!Number.isFinite(meters)||meters<0)throw Error('Rute tidak ditemukan');
  const km=meters/1000;route={km,fee:bracket(km),origin:branch,coords:{...coords}};
  if(route.fee===null)show(`Jarak rute ${km.toFixed(2)} km. Maaf, maksimal pengiriman 9 km.`, 'error');
  else show(`Lokasi terdeteksi. Jarak rute ${km.toFixed(2)} km, ongkir ${rup(route.fee)}. Periksa kembali titik lokasi dan alamat lengkap.`, 'ok');
 }catch(e){route=null;show('Jarak belum bisa diverifikasi ('+e.message+'). Checkout ditutup sementara. Coba lagi atau hubungi outlet langsung.','error')}
 finally{busy=false;update()}
}
$('getGeo').addEventListener('click',()=>{
 if(!navigator.geolocation){show('Browser ini tidak mendukung lokasi.','error');return}
 show('Meminta izin lokasi...');
 navigator.geolocation.getCurrentPosition(pos=>{
  coords={lat:pos.coords.latitude,lng:pos.coords.longitude};
  $('geoLink').value=`https://www.google.com/maps?q=${coords.lat},${coords.lng}`;
  calculate();
 },err=>{route=null;show('Lokasi gagal diperoleh: '+err.message+'. Aktifkan izin lokasi dan gunakan HTTPS.','error');update()},
 {enableHighAccuracy:true,timeout:15000,maximumAge:0});
});
$('retryRoute').addEventListener('click',calculate);
document.querySelectorAll('[data-branch]').forEach(el=>el.addEventListener('click',()=>{route=null;update();if(coords)calculate();else show('Outlet berubah. Ambil titik lokasi untuk menghitung ulang ongkir.')}));
new MutationObserver(update).observe($('cart'),{childList:true,subtree:true});
$('checkout').onclick=()=>{
 const sum=subtotal();if(!route||route.origin!==branch||route.fee===null||sum===0||sum<(route.km>7?75000:0)){alert('Lokasi, ongkir, atau minimal order belum valid.');return}
 const nama=$('nama').value.trim(),hp=$('hp').value.trim(),alamat=$('alamat').value.trim();
 if(!nama||!hp||!alamat){alert('Lengkapi nama, nomor HP, dan alamat.');return}
 const wa=String(window.LAMBE_WA?.[branch]||'').replace(/\D/g,'');
 if(!/^62\d{8,13}$/.test(wa)){alert('WhatsApp outlet belum dikonfigurasi.');return}
 const lines=Object.entries(cart).filter(([id])=>byId(id)).map(([id,q],i)=>{const m=byId(id);return `${i+1}. ${m.name} x${q} = ${rup(m.price*q)}`});
 const msg=`*DELIVERY ORDER LAMBE TURAH*\nOutlet: ${branch==='pahlawan'?'Pahlawan':'Mondokan'}\n\n*PEMESAN*\nNama: ${nama}\nHP: ${hp}\nAlamat: ${alamat}\nTitik Maps: ${$('geoLink').value}\n\n*PESANAN*\n${lines.join('\n')}\n\nSubtotal: ${rup(sum)}\nJarak rute estimasi: ${route.km.toFixed(2)} km\nOngkir estimasi: ${rup(route.fee)}\n*Total estimasi: ${rup(sum+route.fee)}*\n${cart['es-teh']?'Penyajian teh: '+$('suhuTeh').value+'\n':''}${cart['es-jeruk']?'Penyajian jeruk: '+$('suhuJeruk').value+'\n':''}Level pedas: ${$('pedas').value}\nCatatan: ${$('catatan').value.trim()||'-'}\n\nMohon konfirmasi titik pengiriman, ketersediaan menu, ongkir, dan pembayaran.`;
 window.open('https://wa.me/'+wa+'?text='+encodeURIComponent(msg),'_blank','noopener,noreferrer');
};
update();
})();
