(() => {
  "use strict";

  /*
   * LAMBE TURAH — DELIVERY ORDER v9.0
   * DIRECT WHATSAPP CHECKOUT
   *
   * Tidak mengirim data ke Apps Script/Spreadsheet.
   * Tidak membuat nomor order database.
   * Tidak membuat tombol WhatsApp melayang.
   *
   * Memerlukan window.LAMBE_APP dari index.html:
   * getOutlet(), getCart(), getProduct(id), getSubtotal().
   */

  const OUTLETS = {
    pahlawan: {
      name: "Pahlawan",
      whatsapp: "6285791655515",
      latitude: -6.9074875,
      longitude: 112.0741406
    },
    mondokan: {
      name: "Mondokan",
      whatsapp: "6285855188856",
      latitude: -6.8861875,
      longitude: 112.0269375
    }
  };

  const MAX_DISTANCE_KM = 9;
  const MINIMUM_ABOVE_7_KM = 75000;
  const ROUTE_TIMEOUT_MS = 15000;

  const app = window.LAMBE_APP;
  const $ = (id) => document.getElementById(id);

  if (!app || ["getOutlet", "getCart", "getProduct", "getSubtotal"]
      .some((name) => typeof app[name] !== "function")) {
    console.error("LAMBE_APP belum tersedia atau tidak lengkap.");
    return;
  }

  const requiredIds = [
    "checkoutButton", "getLocation", "recalculate", "locationStatus",
    "mapsLink", "distanceSummary", "summarySubtotal", "summaryShipping",
    "summaryTotal", "customerName", "customerPhone", "customerAddress",
    "customerNotes", "paymentInfo"
  ];

  if (requiredIds.some((id) => !$(id))) {
    console.error("Ada elemen checkout yang tidak ditemukan pada index.html.");
    return;
  }

  const checkout = $("checkoutButton");
  const rupiah = (value) => "Rp" + Math.round(Number(value) || 0).toLocaleString("id-ID");

  let location = null;
  let route = null;
  let calculating = false;
  let preparingWhatsApp = false;
  let requestSequence = 0;
  let gpsSequence = 0;
  let routeController = null;

  function outletKey() {
    return String(app.getOutlet() || "").toLowerCase();
  }

  function selectedOutlet() {
    return OUTLETS[outletKey()] || null;
  }

  function cartSubtotal() {
    return Number(app.getSubtotal()) || 0;
  }

  function selectedPayment() {
    return document.querySelector('input[name="payment"]:checked')?.value || "Cash";
  }

  function deliveryFee(km) {
    if (km <= 2) return 2000;
    if (km <= 4) return 3000;
    if (km <= 6) return 5000;
    if (km <= 7) return 7000;
    if (km <= MAX_DISTANCE_KM) return Math.ceil(km) * 1000;
    return null;
  }

  function minimumSubtotal(km) {
    return km > 7 ? MINIMUM_ABOVE_7_KM : 0;
  }

  function validRoute() {
    return !!(
      location && route &&
      route.outlet === outletKey() &&
      route.latitude === location.latitude &&
      route.longitude === location.longitude
    );
  }

  function setLocationStatus(message, kind = "") {
    const element = $("locationStatus");
    element.className = "status" + (kind ? " " + kind : "");
    element.textContent = message;
  }

  function updatePaymentInfo() {
    $("paymentInfo").textContent = selectedPayment() === "QRIS"
      ? "QRIS dinamis akan dikirim admin outlet setelah pesanan dan total pembayaran dikonfirmasi. Jangan melakukan pembayaran sebelum menerima arahan admin."
      : "Pembayaran tunai saat pesanan diterima. Total akhir dikonfirmasi admin outlet.";
  }

  function updateSummary() {
    const subtotal = cartSubtotal();
    const currentRoute = validRoute() ? route : null;
    const fee = currentRoute ? currentRoute.fee : null;

    $("summarySubtotal").textContent = rupiah(subtotal);
    $("summaryShipping").textContent = fee === null ? "Belum tersedia" : rupiah(fee);
    $("summaryTotal").textContent = rupiah(subtotal + (fee === null ? 0 : fee));

    if (!currentRoute) {
      $("distanceSummary").textContent = "Jarak dan ongkir menunggu lokasi pengiriman.";
    } else {
      const minimum = minimumSubtotal(currentRoute.km);
      let details = "Jarak rute estimasi: " + currentRoute.km.toFixed(2) + " km | Ongkir: " +
        (fee === null ? "Di luar jangkauan" : rupiah(fee));
      if (minimum > 0) {
        details += " | Minimal belanja: " + rupiah(minimum);
        if (subtotal < minimum) details += " | Kekurangan: " + rupiah(minimum - subtotal);
      }
      $("distanceSummary").textContent = details;
    }

    if (preparingWhatsApp) {
      checkout.disabled = true;
      checkout.textContent = "Membuka WhatsApp...";
    } else if (calculating) {
      checkout.disabled = true;
      checkout.textContent = "Menghitung Ongkir...";
    } else if (!currentRoute) {
      checkout.disabled = true;
      checkout.textContent = "Tentukan Lokasi Pengiriman Dahulu";
    } else if (fee === null) {
      checkout.disabled = true;
      checkout.textContent = "Di Luar Jangkauan Delivery";
    } else if (subtotal <= 0) {
      checkout.disabled = true;
      checkout.textContent = "Pilih Menu Terlebih Dahulu";
    } else if (subtotal < minimumSubtotal(currentRoute.km)) {
      checkout.disabled = true;
      checkout.textContent = "Minimal Order " + rupiah(minimumSubtotal(currentRoute.km));
    } else {
      checkout.disabled = false;
      checkout.textContent = "Kirim Pesanan via WhatsApp";
    }
  }

  function invalidateRoute() {
    requestSequence += 1;
    if (routeController) {
      routeController.abort();
      routeController = null;
    }
    calculating = false;
    route = null;
    updateSummary();
  }

  async function calculateRoute() {
    invalidateRoute();
    const sequence = requestSequence;
    if (!location) {
      setLocationStatus("Silakan tentukan lokasi pengiriman.", "error");
      return;
    }
    const outlet = selectedOutlet();
    if (!outlet) {
      setLocationStatus("Pilih outlet terlebih dahulu.", "error");
      return;
    }

    const requestedLocation = { ...location };
    const requestedOutlet = outletKey();
    calculating = true;
    updateSummary();
    setLocationStatus("Menghitung jarak melalui rute jalan...");

    const controller = new AbortController();
    routeController = controller;
    const timeout = setTimeout(() => controller.abort(), ROUTE_TIMEOUT_MS);

    try {
      const url = "https://router.project-osrm.org/route/v1/driving/" +
        outlet.longitude + "," + outlet.latitude + ";" +
        requestedLocation.longitude + "," + requestedLocation.latitude +
        "?overview=false&steps=false";
      const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error("Layanan rute sedang tidak tersedia.");
      const data = await response.json();
      const meters = data?.routes?.[0]?.distance;
      if (!Number.isFinite(meters) || meters < 0) {
        throw new Error("Rute jalan menuju lokasi tidak ditemukan.");
      }
      if (sequence !== requestSequence) return;

      const km = meters / 1000;
      const fee = deliveryFee(km);
      route = {
        outlet: requestedOutlet,
        latitude: requestedLocation.latitude,
        longitude: requestedLocation.longitude,
        km,
        fee
      };

      setLocationStatus(
        fee === null
          ? "Jarak " + km.toFixed(2) + " km di luar jangkauan maksimal 9 km."
          : "Lokasi ditemukan. Jarak " + km.toFixed(2) + " km, ongkir estimasi " + rupiah(fee) + ".",
        fee === null ? "error" : "success"
      );
    } catch (error) {
      if (sequence !== requestSequence) return;
      route = null;
      setLocationStatus(
        "Ongkir belum dapat dihitung. Periksa koneksi internet dan coba Hitung Ulang Ongkir. " +
        (error.name === "AbortError" ? "Layanan rute terlalu lama merespons." : error.message),
        "error"
      );
    } finally {
      clearTimeout(timeout);
      if (sequence === requestSequence) {
        calculating = false;
        routeController = null;
        updateSummary();
      }
    }
  }

  $("getLocation").addEventListener("click", () => {
    if (preparingWhatsApp) return;
    if (!navigator.geolocation) {
      setLocationStatus("Browser tidak mendukung layanan lokasi.", "error");
      return;
    }
    if (!window.isSecureContext) {
      setLocationStatus("Layanan lokasi membutuhkan HTTPS.", "error");
      return;
    }

    const sequence = ++gpsSequence;
    invalidateRoute();
    setLocationStatus("Meminta titik lokasi. Pilih Izinkan saat browser meminta akses GPS.");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (sequence !== gpsSequence) return;
        const latitude = position.coords.latitude;
        const longitude = position.coords.longitude;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          setLocationStatus("Koordinat GPS tidak valid.", "error");
          return;
        }
        location = { latitude, longitude };
        $("mapsLink").value =
          "https://www.google.com/maps?q=" + latitude + "," + longitude;
        calculateRoute();
      },
      (error) => {
        if (sequence !== gpsSequence) return;
        location = null;
        $("mapsLink").value = "";
        invalidateRoute();
        let message = "Lokasi belum dapat diperoleh. Silakan coba kembali.";
        if (error.code === 1) message = "Izin GPS ditolak. Aktifkan izin lokasi pada browser lalu coba lagi.";
        if (error.code === 2) message = "GPS belum tersedia. Coba di tempat yang lebih terbuka.";
        if (error.code === 3) message = "Pengambilan GPS terlalu lama. Silakan coba lagi.";
        setLocationStatus(message, "error");
      },
      { enableHighAccuracy: true, timeout: 18000, maximumAge: 0 }
    );
  });

  $("recalculate").addEventListener("click", () => {
    if (!preparingWhatsApp) calculateRoute();
  });

  document.addEventListener("lambe-outlet-updated", () => {
    if (preparingWhatsApp) return;
    // GPS yang diminta untuk outlet lama tidak boleh mengubah rute outlet baru.
    gpsSequence += 1;
    if (location) calculateRoute();
    else {
      invalidateRoute();
      setLocationStatus("Outlet diganti. Gunakan lokasi untuk menghitung ongkir.");
    }
  });

  document.addEventListener("lambe-cart-updated", updateSummary);
  document.querySelectorAll('input[name="payment"]').forEach((input) => {
    input.addEventListener("change", updatePaymentInfo);
  });

  function cleanText(value, maxLength = 500) {
    return String(value ?? "").replace(/[\x00-\x1F\x7F]/g, " ").trim().slice(0, maxLength);
  }

  function normalizePhone(value) {
    let digits = String(value || "").replace(/\D/g, "");
    if (digits.startsWith("62")) digits = "0" + digits.slice(2);
    return /^08\d{8,11}$/.test(digits) ? digits : "";
  }

  function getOrder() {
    if (!validRoute() || calculating || route.fee === null) {
      alert("Titik pengiriman atau ongkir belum valid. Silakan hitung ulang.");
      return null;
    }

    const items = app.getCart();
    if (!Array.isArray(items) || !items.length) {
      alert("Pilih menu terlebih dahulu.");
      return null;
    }

    const lines = [];
    let subtotal = 0;
    for (const item of items) {
      const product = app.getProduct(item.id);
      const qty = Number(item.quantity);
      if (!product || !Number.isInteger(qty) || qty < 1 || qty > 99) {
        alert("Keranjang tidak valid. Periksa kembali jumlah pesanan.");
        return null;
      }
      const unitPrice = Number(product.price);
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        alert("Harga salah satu menu tidak valid. Silakan muat ulang halaman.");
        return null;
      }
      const variant = cleanText(item.variant || "", 100);
      const category = String(product.category || "");
      const isFood = ["Paket Hemat", "Paket Kenyang", "Menu Satuan", "Menu Mix"].includes(category);
      const temperature = item.id === "es-teh" || item.id === "es-jeruk";
      if (isFood && !variant) {
        alert("Pilih level kepedasan untuk " + product.name + ".");
        return null;
      }
      if (temperature && !["Es", "Panas"].includes(variant)) {
        alert("Pilih penyajian untuk " + product.name + ".");
        return null;
      }
      const itemTotal = unitPrice * qty;
      subtotal += itemTotal;
      lines.push({ name: cleanText(product.name, 120), qty, unitPrice, itemTotal, variant, temperature });
    }

    if (subtotal !== cartSubtotal()) {
      alert("Total keranjang berubah. Silakan periksa ulang pesanan.");
      return null;
    }
    if (subtotal <= 0 || subtotal > 5000000) {
      alert("Total belanja tidak valid.");
      return null;
    }
    if (subtotal < minimumSubtotal(route.km)) {
      alert("Untuk jarak ini minimal belanja " + rupiah(minimumSubtotal(route.km)) + ".");
      return null;
    }

    const name = cleanText($("customerName").value, 100);
    const phone = normalizePhone($("customerPhone").value);
    const address = cleanText($("customerAddress").value, 500);
    const notes = cleanText($("customerNotes").value, 400) || "-";
    const payment = selectedPayment();
    const outlet = selectedOutlet();

    if (name.length < 2) {
      alert("Isi nama penerima terlebih dahulu.");
      $("customerName").focus();
      return null;
    }
    if (!phone) {
      alert("Nomor WhatsApp tidak valid. Gunakan format 08xxxxxxxxxx.");
      $("customerPhone").focus();
      return null;
    }
    if (address.length < 5) {
      alert("Isi alamat pengiriman lengkap beserta patokan.");
      $("customerAddress").focus();
      return null;
    }
    if (!["Cash", "QRIS"].includes(payment) || !outlet) {
      alert("Pilih outlet dan metode pembayaran yang tersedia.");
      return null;
    }

    return {
      outlet,
      name,
      phone,
      address,
      notes,
      payment,
      items: lines,
      subtotal,
      km: route.km,
      fee: route.fee,
      total: subtotal + route.fee,
      mapsLink: $("mapsLink").value
    };
  }

  function whatsappMessage(order) {
    const message = [
      "Halo Kak, saya mau pesan Delivery Order Lambe Turah.",
      "",
      "*DELIVERY ORDER LAMBE TURAH*",
      "Outlet: " + order.outlet.name,
      "",
      "*RINCIAN PESANAN*",
      "------------------------"
    ];

    order.items.forEach((item, index) => {
      message.push((index + 1) + ". *" + item.name + "* x " + item.qty);
      if (item.variant) {
        message.push("   " + (item.temperature ? "Penyajian: " : "Level: ") + item.variant);
      }
      message.push("   " + rupiah(item.itemTotal), "");
    });

    message.push(
      "*RINCIAN PEMBAYARAN*",
      "------------------------",
      "Subtotal: " + rupiah(order.subtotal),
      "Ongkir estimasi: " + rupiah(order.fee),
      "*TOTAL ESTIMASI: " + rupiah(order.total) + "*",
      "Metode: " + (order.payment === "QRIS" ? "QRIS Dinamis" : "Cash"),
      "",
      "*DATA PENGIRIMAN*",
      "------------------------",
      "Nama: " + order.name,
      "No. WhatsApp: " + order.phone,
      "Alamat: " + order.address,
      "Lokasi Google Maps:",
      order.mapsLink,
      "Jarak estimasi: " + order.km.toFixed(2) + " km",
      "Catatan: " + order.notes,
      "",
      "Mohon admin konfirmasi ketersediaan menu, ongkir, dan total akhir."
    );

    if (order.payment === "QRIS") {
      message.push("Saya menunggu QRIS dinamis dari admin setelah pesanan dikonfirmasi.");
    } else {
      message.push("Pembayaran tunai saat pesanan diterima.");
    }
    message.push("Terima kasih.");
    return message.join("\n");
  }

  checkout.addEventListener("click", () => {
    if (preparingWhatsApp || calculating) return;
    const order = getOrder();
    if (!order) return;

    const ok = window.confirm(
      "KONFIRMASI PESANAN LAMBE TURAH\n\n" +
      "Outlet: " + order.outlet.name + "\n" +
      "Subtotal: " + rupiah(order.subtotal) + "\n" +
      "Ongkir estimasi: " + rupiah(order.fee) + "\n" +
      "Total estimasi: " + rupiah(order.total) + "\n" +
      "Pembayaran: " + order.payment + "\n\n" +
      "WhatsApp outlet akan dibuka dengan rincian pesanan. " +
      "Pastikan menekan Kirim agar admin menerimanya.\n\nLanjutkan?"
    );
    if (!ok) return;

    const text = whatsappMessage(order);
    const url = "https://wa.me/" + order.outlet.whatsapp + "?text=" + encodeURIComponent(text);

    // Tidak mengirim ke API/database. Pindah langsung dari aksi pengguna.
    // Gunakan tab yang sama untuk menghindari popup blocker pada iPhone/iPad.
    preparingWhatsApp = true;
    updateSummary();
    window.location.assign(url);
  });

  // Bila pelanggan kembali dari WhatsApp lewat navigasi browser,
  // pulihkan tombol. Tidak ada transaksi database yang dibuat.
  window.addEventListener("pageshow", () => {
    preparingWhatsApp = false;
    updateSummary();
  });

  updatePaymentInfo();
  updateSummary();
})();
