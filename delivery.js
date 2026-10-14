(() => {
"use strict";

/*
  LAMBE TURAH — DELIVERY ORDER v5.0

  Fitur:
  - Penghitungan estimasi jarak jalan
  - Ongkir berdasarkan jarak
  - Minimum order untuk jarak >7 km
  - Pembayaran Cash / QRIS Dinamis
  - WhatsApp rapi per variasi menu
  - Konfirmasi lokasi pengiriman
*/

const $ = id => document.getElementById(id);
const app = window.LAMBE_APP;

const OUTLETS = {
  pahlawan: {
    name:"Pahlawan",
    whatsapp:"6285791655515",
    lat:-6.9074875,
    lng:112.0741406
  },
  mondokan: {
    name:"Mondokan",
    whatsapp:"6285855188856",
    lat:-6.8861875,
    lng:112.0269375
  }
};

const rp = value =>
  "Rp"+Math.round(Number(value)||0).toLocaleString("id-ID");

let customerLocation = null;
let calculatedRoute = null;
let calculating = false;
let routeRequest = 0;

function currentOutlet() {
  return OUTLETS[app.getOutlet()];
}

function subtotal() {
  return app.getSubtotal();
}

function calculateFee(km) {
  if (km<=2) return 2000;
  if (km<=4) return 3000;
  if (km<=6) return 5000;
  if (km<=7) return 7000;

  if (km<=9) {
    return Math.ceil(km)*1000;
  }

  return null;
}

function minimumOrder(km) {
  return km>7 ? 75000 : 0;
}

function paymentMethod() {
  return document.querySelector(
    'input[name="payment"]:checked'
  )?.value || "Cash";
}

function showLocationStatus(message,type="") {
  const target = $("locationStatus");
  target.className = "status "+type;
  target.textContent = message;
}

function routeIsValid() {
  return (
    calculatedRoute !== null &&
    calculatedRoute.outlet===app.getOutlet() &&
    customerLocation !== null &&
    calculatedRoute.lat===customerLocation.lat &&
    calculatedRoute.lng===customerLocation.lng
  );
}

function refreshPaymentInfo() {
  const payment = paymentMethod();

  $("paymentInfo").textContent = payment==="QRIS"
    ? "📱 Anda memilih QRIS. Setelah admin mengonfirmasi menu, titik pengiriman, dan total pembayaran, admin akan mengirim QRIS dinamis sesuai nominal transaksi. Jangan membayar sebelum menerima konfirmasi admin."
    : "💵 Anda memilih Cash. Pembayaran tunai dilakukan saat pesanan diterima, sesuai total yang sudah dikonfirmasi admin.";
}

function refreshSummary() {
  const sub = subtotal();

  $("summarySubtotal").textContent = rp(sub);

  const valid = routeIsValid();
  const route = valid ? calculatedRoute : null;
  const fee = route ? route.fee : null;

  const total = fee===null ? sub : sub+fee;

  $("summaryShipping").textContent =
    fee===null ? "Belum tersedia" : rp(fee);

  $("summaryTotal").textContent = rp(total);

  if (!route) {
    $("distanceSummary").textContent =
      "Jarak dan ongkir menunggu lokasi pengiriman.";
  } else {
    const min = minimumOrder(route.km);

    let text =
      "Jarak rute estimasi: "+route.km.toFixed(2)+" km"+
      " | Ongkir: "+(
        fee===null ? "Di luar jangkauan" : rp(fee)
      );

    if (min>0) {
      text +=
        " | Minimal belanja: "+rp(min);

      if (sub<min) {
        text +=
          " | Kurang: "+rp(min-sub);
      }
    }

    $("distanceSummary").textContent = text;
  }

  const button = $("checkoutButton");

  if (calculating) {
    button.disabled = true;
    button.textContent = "Menghitung Ongkir...";
    return;
  }

  if (!route) {
    button.disabled = true;
    button.textContent = "Tentukan Lokasi Pengiriman Dahulu";
    return;
  }

  if (fee===null) {
    button.disabled = true;
    button.textContent = "Di Luar Jangkauan Delivery";
    return;
  }

  if (sub<=0) {
    button.disabled = true;
    button.textContent = "Pilih Menu Terlebih Dahulu";
    return;
  }

  const min = minimumOrder(route.km);

  if (sub<min) {
    button.disabled = true;
    button.textContent =
      "Minimal Order "+rp(min);
    return;
  }

  button.disabled = false;
  button.textContent = "💬 Kirim Pesanan ke WhatsApp";
}

/*
  Jarak diambil dari layanan routing publik OSRM.
  Bila layanan tidak tersedia, ongkir tidak dianggap
  berhasil dihitung dan checkout dinonaktifkan.
*/
async function calculateRoute() {
  const requestId = ++routeRequest;
  calculatedRoute = null;

  if (!customerLocation) {
    calculating = false;
    showLocationStatus(
      "Silakan gunakan GPS lokasi pengiriman terlebih dahulu.",
      "error"
    );
    refreshSummary();
    return;
  }

  const outlet = currentOutlet();

  if (!outlet) {
    calculating = false;
    showLocationStatus("Outlet tidak ditemukan.","error");
    refreshSummary();
    return;
  }

  calculating = true;
  refreshSummary();

  showLocationStatus(
    "Lokasi diterima. Sedang menghitung jarak melalui jalan..."
  );

  const lat = customerLocation.lat;
  const lng = customerLocation.lng;
  const outletKey = app.getOutlet();

  try {
    const endpoint =
      "https://router.project-osrm.org/route/v1/driving/"+
      outlet.lng+","+outlet.lat+";"+
      lng+","+lat+
      "?overview=false&steps=false";

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      15000
    );

    let response;

    try {
      response = await fetch(endpoint,{
        signal:controller.signal,
        cache:"no-store"
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error("Layanan rute sedang tidak tersedia.");
    }

    const result = await response.json();
    const distanceMeters = result.routes?.[0]?.distance;

    if (
      !Number.isFinite(distanceMeters) ||
      distanceMeters<0
    ) {
      throw new Error("Rute jalan tidak ditemukan.");
    }

    if (requestId!==routeRequest) return;

    const km = distanceMeters/1000;
    const fee = calculateFee(km);

    calculatedRoute = {
      outlet:outletKey,
      lat,
      lng,
      km,
      fee
    };

    if (fee===null) {
      showLocationStatus(
        "Titik pengiriman terdeteksi, tetapi jaraknya "+
        km.toFixed(2)+
        " km. Maaf, maksimal jangkauan delivery 9 km.",
        "error"
      );
    } else {
      showLocationStatus(
        "✅ Lokasi terdeteksi. Estimasi jarak "+
        km.toFixed(2)+
        " km, ongkir "+rp(fee)+
        ". Mohon tunggu konfirmasi akhir dari admin.",
        "success"
      );
    }

  } catch(error) {
    if (requestId!==routeRequest) return;

    calculatedRoute = null;

    showLocationStatus(
      "Ongkir belum berhasil dihitung. "+
      "Periksa koneksi internet lalu tekan Hitung Ulang Ongkir. "+
      error.message,
      "error"
    );

  } finally {
    if (requestId===routeRequest) {
      calculating = false;
      refreshSummary();
    }
  }
}

/*
  GPS pelanggan
*/
$("getLocation").addEventListener("click",() => {
  if (!navigator.geolocation) {
    showLocationStatus(
      "Browser tidak mendukung layanan lokasi.",
      "error"
    );
    return;
  }

  if (!window.isSecureContext) {
    showLocationStatus(
      "Layanan lokasi memerlukan koneksi HTTPS.",
      "error"
    );
    return;
  }

  showLocationStatus(
    "Meminta izin lokasi. Pilih Izinkan apabila muncul pemberitahuan."
  );

  navigator.geolocation.getCurrentPosition(
    position => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        showLocationStatus(
          "Koordinat tidak valid. Silakan coba kembali.",
          "error"
        );
        return;
      }

      customerLocation = {lat,lng};

      const mapsUrl =
        "https://www.google.com/maps?q="+
        lat+","+lng;

      $("mapsLink").value = mapsUrl;

      calculateRoute();
    },

    error => {
      ++routeRequest;
      calculating = false;
      calculatedRoute = null;

      let message =
        "Lokasi belum berhasil diperoleh.";

      if (error.code===1) {
        message =
          "Izin lokasi ditolak. Buka pengaturan situs Safari, "+
          "izinkan akses lokasi, lalu coba kembali.";
      } else if (error.code===2) {
        message =
          "Sinyal GPS belum tersedia. "+
          "Coba pindah ke tempat yang lebih terbuka.";
      } else if (error.code===3) {
        message =
          "Pengambilan lokasi terlalu lama. "+
          "Silakan coba kembali.";
      }

      showLocationStatus(message,"error");
      refreshSummary();
    },

    {
      enableHighAccuracy:true,
      timeout:18000,
      maximumAge:0
    }
  );
});

$("recalculate").addEventListener(
  "click",
  calculateRoute
);

/*
  Bila outlet berubah, ongkir wajib dihitung ulang.
*/
document.addEventListener("lambe-outlet-updated",() => {
  ++routeRequest;
  calculatedRoute = null;
  calculating = false;
  refreshSummary();

  if (customerLocation) {
    calculateRoute();
  } else {
    showLocationStatus(
      "Outlet diperbarui. Gunakan lokasi untuk menghitung ongkir."
    );
  }
});

document.addEventListener("lambe-cart-updated",refreshSummary);

document.querySelectorAll(
  'input[name="payment"]'
).forEach(input => {
  input.addEventListener("change",refreshPaymentInfo);
});

/*
  Nomor pelanggan divalidasi sebelum pesan dikirim.
*/
function validPhone(value) {
  const digits = value.replace(/[^\d]/g,"");

  return /^08\d{8,11}$/.test(digits) ||
         /^628\d{8,11}$/.test(digits);
}

function safeText(value) {
  return String(value||"").trim();
}

/*
  Nama variasi dalam WhatsApp.
  Setiap item membawa pilihannya sendiri.
*/
function formatVariant(item,product) {
  if (!item.variant) return "";

  if (["es-teh","es-jeruk"].includes(product.id)) {
    return "   Penyajian: "+item.variant+"\n";
  }

  return "   Level: "+item.variant+"\n";
}

function buildOrderLines(items) {
  return items.map((item,index) => {
    const product = app.getProduct(item.id);

    const lineTotal = product.price*item.quantity;

    return (
      (index+1)+". *"+product.name+"* × "+item.quantity+"\n"+
      formatVariant(item,product)+
      "   "+rp(product.price)+" × "+item.quantity+
      " = *"+rp(lineTotal)+"*"
    );
  }).join("\n\n");
}

/*
  Format pesan WhatsApp:
  - sapaan ramah
  - rincian pesanan per variasi
  - subtotal, ongkir, total
  - metode pembayaran
  - data pengiriman
  - permintaan konfirmasi titik pengiriman
*/
function buildWhatsAppMessage({
  outlet,
  items,
  name,
  phone,
  address,
  notes,
  payment,
  route
}) {
  const sub = subtotal();
  const total = sub+route.fee;

  const paymentDetails = payment==="QRIS"
    ? [
        "💳 *Metode Pembayaran:* QRIS Dinamis",
        "Status: Belum Dibayar",
        "QRIS akan dikirim admin setelah pesanan dikonfirmasi."
      ].join("\n")
    : [
        "💵 *Metode Pembayaran:* Cash",
        "Status: Belum Dibayar",
        "Pembayaran tunai saat pesanan diterima."
      ].join("\n");

  const closing = payment==="QRIS"
    ? [
        "Mohon dibantu konfirmasi ketersediaan menu,",
        "ketepatan titik lokasi pengiriman, ongkir,",
        "serta total pembayarannya ya, Kak.",
        "",
        "Untuk pembayaran QRIS, saya menunggu",
        "kode QR dari admin setelah pesanan dikonfirmasi.",
        "",
        "Terima kasih 🙏"
      ].join("\n")
    : [
        "Mohon dibantu konfirmasi ketersediaan menu,",
        "ketepatan titik lokasi pengiriman, ongkir,",
        "serta total pembayarannya ya, Kak.",
        "",
        "Pembayaran saya lakukan secara tunai",
        "saat pesanan diterima.",
        "",
        "Terima kasih 🙏"
      ].join("\n");

  return [
    "Halo Kak, saya mau Delivery Order Lambe Turah 😊",
    "",
    "Mohon dibantu pesanan saya berikut ya, Kak.",
    "",
    "🍽️ *PESANAN DELIVERY LAMBE TURAH*",
    "📍 *Outlet: "+outlet.name+"*",
    "",
    "*RINCIAN PESANAN*",
    "━━━━━━━━━━━━━━━━",
    buildOrderLines(items),
    "",
    "*RINCIAN PEMBAYARAN*",
    "━━━━━━━━━━━━━━━━",
    "Subtotal: "+rp(sub),
    "Ongkir estimasi: "+rp(route.fee),
    "*TOTAL ESTIMASI: "+rp(total)+"*",
    "",
    paymentDetails,
    "",
    "*DATA PENGIRIMAN*",
    "━━━━━━━━━━━━━━━━",
    "👤 Nama: "+name,
    "📱 WhatsApp: "+phone,
    "🏠 Alamat: "+address,
    "📍 Titik Google Maps:",
    $("mapsLink").value,
    "",
    "🛵 Estimasi jarak: "+route.km.toFixed(2)+" km",
    "📝 Catatan: "+notes,
    "",
    closing
  ].join("\n");
}

/*
  Checkout ke WhatsApp
*/
$("checkoutButton").addEventListener("click",() => {
  if (!routeIsValid()) {
    alert(
      "Lokasi dan ongkir belum valid. "+
      "Silakan hitung ulang ongkir."
    );
    return;
  }

  const route = calculatedRoute;

  if (route.fee===null) {
    alert("Lokasi di luar jangkauan delivery.");
    return;
  }

  const items = app.getCart().filter(item =>
    app.getProduct(item.id)
  );

  if (!items.length) {
    alert("Silakan pilih makanan atau minuman dahulu.");
    return;
  }

  if (subtotal()<minimumOrder(route.km)) {
    alert(
      "Minimal belanja untuk jarak ini adalah "+
      rp(minimumOrder(route.km))
    );
    return;
  }

  const name = safeText($("customerName").value);
  const phone = safeText($("customerPhone").value);
  const address = safeText($("customerAddress").value);
  const notes = safeText($("customerNotes").value)||"-";
  const payment = paymentMethod();

  if (!name) {
    alert("Silakan isi nama penerima.");
    $("customerName").focus();
    return;
  }

  if (!validPhone(phone)) {
    alert("Silakan isi nomor WhatsApp yang valid.");
    $("customerPhone").focus();
    return;
  }

  if (!address) {
    alert("Silakan isi alamat pengiriman lengkap.");
    $("customerAddress").focus();
    return;
  }

  const outlet = currentOutlet();

  if (!outlet || !/^62\d{9,13}$/.test(outlet.whatsapp)) {
    alert("Nomor WhatsApp outlet tidak valid.");
    return;
  }

  const message = buildWhatsAppMessage({
    outlet,
    items,
    name,
    phone,
    address,
    notes,
    payment,
    route
  });

  const whatsappUrl =
    "https://wa.me/"+outlet.whatsapp+
    "?text="+encodeURIComponent(message);

  // Navigasi langsung dari klik pelanggan
  // agar lebih andal di Safari iPhone.
  window.location.href = whatsappUrl;
});

refreshPaymentInfo();
refreshSummary();

})();
