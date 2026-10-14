(() => {
  "use strict";

  /*
   * LAMBE TURAH — DELIVERY ORDER v7.1
   *
   * Pembaruan:
   * 1. Komunikasi iframe Google Apps Script
   * 2. Validasi origin dan token transaksi
   * 3. Pencegahan checkout berulang
   * 4. Penanganan respons lambat
   * 5. Ongkir berdasarkan jarak jalan
   * 6. WhatsApp Bantuan melayang
   */

  const API_URL =
    "https://script.google.com/macros/s/AKfycbxeNI9gVEryLDCAZNNXTZiKzUG2mTCu5V4o7HTiSssHgAmh6o_e7W8idEBoG3_jml69eQ/exec";

  const CONFIRM_URL = "./konfirmasi.html";

  const STORAGE_KEY =
    "lambe_turah_order_result_v1";

  const PENDING_KEY =
    "lambe_turah_pending_order_v71";

  const HELP_PHONE = "6285232526003";

  const HELP_MESSAGE =
    "Halo Kak, saya mau tanya seputar pemesanan " +
    "Delivery Order Lambe Turah. " +
    "Bisa dibantu, Kak? 😊";

  const RESPONSE_TIMEOUT = 45000;

  const OUTLETS = {
    pahlawan: {
      name: "Pahlawan",
      whatsapp: "6285791655515",
      lat: -6.9074875,
      lng: 112.0741406
    },
    mondokan: {
      name: "Mondokan",
      whatsapp: "6285855188856",
      lat: -6.8861875,
      lng: 112.0269375
    }
  };

  const app = window.LAMBE_APP;
  const $ = id => document.getElementById(id);

  if (!app) {
    console.error(
      "LAMBE_APP tidak ditemukan. " +
      "Periksa urutan script di index.html."
    );
    return;
  }

  const checkout = $("checkoutButton");

  if (!checkout) {
    console.error(
      "Tombol checkout tidak ditemukan."
    );
    return;
  }

  const rp = value =>
    "Rp" +
    Math.round(Number(value) || 0)
      .toLocaleString("id-ID");

  let customerLocation = null;
  let calculatedRoute = null;

  let calculating = false;
  let submitting = false;
  let resultUncertain = false;

  let routeRequestId = 0;

  let pendingToken = "";
  let pendingFrame = null;
  let responseTimer = null;

  // ========================================
  // 1. DATA OUTLET DAN METODE PEMBAYARAN
  // ========================================

  function currentOutlet() {
    return OUTLETS[app.getOutlet()];
  }

  function subtotal() {
    return app.getSubtotal();
  }

  function paymentMethod() {
    return document.querySelector(
      'input[name="payment"]:checked'
    )?.value || "Cash";
  }

  function calculateFee(km) {
    if (km <= 2) return 2000;
    if (km <= 4) return 3000;
    if (km <= 6) return 5000;
    if (km <= 7) return 7000;

    if (km <= 9) {
      return Math.ceil(km) * 1000;
    }

    return null;
  }

  function minimumOrder(km) {
    return km > 7 ? 75000 : 0;
  }

  function updatePaymentInfo() {
    const element = $("paymentInfo");

    if (!element) return;

    element.textContent =
      paymentMethod() === "QRIS"
        ? "📱 QRIS dinamis akan dikirim admin " +
          "setelah pesanan diverifikasi. " +
          "Jangan melakukan pembayaran " +
          "sebelum menerima arahan admin."
        : "💵 Pembayaran tunai saat pesanan " +
          "diterima. Total akhir dikonfirmasi " +
          "oleh admin outlet.";
  }

  // ========================================
  // 2. STATUS LOKASI
  // ========================================

  function setLocationStatus(
    message,
    type = ""
  ) {
    const element = $("locationStatus");

    if (!element) return;

    element.className =
      "status " + type;

    element.textContent = message;
  }

  function routeIsValid() {
    return Boolean(
      calculatedRoute &&
      customerLocation &&
      calculatedRoute.outlet === app.getOutlet() &&
      calculatedRoute.lat === customerLocation.lat &&
      calculatedRoute.lng === customerLocation.lng
    );
  }

  // ========================================
  // 3. RINGKASAN PESANAN
  // ========================================

  function updateSummary() {
    const foodTotal = subtotal();

    const route = routeIsValid()
      ? calculatedRoute
      : null;

    const fee =
      route ? route.fee : null;

    $("summarySubtotal").textContent =
      rp(foodTotal);

    $("summaryShipping").textContent =
      fee === null
        ? "Belum tersedia"
        : rp(fee);

    $("summaryTotal").textContent =
      rp(
        foodTotal +
        (fee === null ? 0 : fee)
      );

    if (!route) {
      $("distanceSummary").textContent =
        "Jarak dan ongkir menunggu lokasi pengiriman.";
    } else {
      const minimum = minimumOrder(route.km);

      let message =
        "Jarak estimasi: " +
        route.km.toFixed(2) +
        " km | Ongkir: " +
        (
          fee === null
            ? "Di luar jangkauan"
            : rp(fee)
        );

      if (minimum > 0) {
        message +=
          " | Minimal belanja: " +
          rp(minimum);

        if (foodTotal < minimum) {
          message +=
            " | Kekurangan: " +
            rp(minimum - foodTotal);
        }
      }

      $("distanceSummary").textContent =
        message;
    }

    if (resultUncertain) {
      checkout.disabled = true;
      checkout.textContent =
        "Periksa Pesanan — Jangan Checkout Ulang";
      return;
    }

    if (submitting) {
      checkout.disabled = true;
      checkout.textContent =
        "Sedang Menyimpan Pesanan...";
      return;
    }

    if (calculating) {
      checkout.disabled = true;
      checkout.textContent =
        "Menghitung Ongkir...";
      return;
    }

    if (!route) {
      checkout.disabled = true;
      checkout.textContent =
        "Tentukan Lokasi Pengiriman Dahulu";
      return;
    }

    if (fee === null) {
      checkout.disabled = true;
      checkout.textContent =
        "Di Luar Jangkauan Delivery";
      return;
    }

    if (foodTotal <= 0) {
      checkout.disabled = true;
      checkout.textContent =
        "Pilih Menu Terlebih Dahulu";
      return;
    }

    const minimum =
      minimumOrder(route.km);

    if (foodTotal < minimum) {
      checkout.disabled = true;
      checkout.textContent =
        "Minimal Order " + rp(minimum);
      return;
    }

    checkout.disabled = false;
    checkout.textContent =
      "💬 Simpan Pesanan & Lanjut ke WhatsApp";
  }

  // ========================================
  // 4. PERHITUNGAN JARAK JALAN
  // ========================================

  async function calculateRoute() {
    const requestId =
      ++routeRequestId;

    calculatedRoute = null;

    if (!customerLocation) {
      calculating = false;

      setLocationStatus(
        "Silakan tentukan lokasi pengiriman.",
        "error"
      );

      updateSummary();
      return;
    }

    const outlet = currentOutlet();

    if (!outlet) {
      calculating = false;

      setLocationStatus(
        "Outlet belum dipilih.",
        "error"
      );

      updateSummary();
      return;
    }

    calculating = true;
    updateSummary();

    setLocationStatus(
      "Sedang menghitung jarak melalui jalan..."
    );

    const lat = customerLocation.lat;
    const lng = customerLocation.lng;
    const outletKey = app.getOutlet();

    try {
      const url =
        "https://router.project-osrm.org/" +
        "route/v1/driving/" +
        outlet.lng + "," + outlet.lat +
        ";" + lng + "," + lat +
        "?overview=false&steps=false";

      const controller =
        new AbortController();

      const timeout = setTimeout(
        () => controller.abort(),
        15000
      );

      let response;

      try {
        response = await fetch(url, {
          signal: controller.signal,
          cache: "no-store"
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        throw new Error(
          "Layanan rute sedang tidak tersedia."
        );
      }

      const result =
        await response.json();

      const meters =
        result.routes?.[0]?.distance;

      if (
        !Number.isFinite(meters) ||
        meters < 0
      ) {
        throw new Error(
          "Rute jalan tidak ditemukan."
        );
      }

      if (requestId !== routeRequestId) {
        return;
      }

      const km = meters / 1000;
      const fee = calculateFee(km);

      calculatedRoute = {
        outlet: outletKey,
        lat,
        lng,
        km,
        fee
      };

      if (fee === null) {
        setLocationStatus(
          "Jarak " +
          km.toFixed(2) +
          " km berada di luar jangkauan " +
          "delivery maksimal 9 km.",
          "error"
        );
      } else {
        setLocationStatus(
          "✅ Lokasi terdeteksi. " +
          "Jarak " +
          km.toFixed(2) +
          " km. Ongkir estimasi " +
          rp(fee) + ".",
          "success"
        );
      }

    } catch (error) {
      if (requestId !== routeRequestId) {
        return;
      }

      calculatedRoute = null;

      setLocationStatus(
        "Ongkir belum berhasil dihitung. " +
        "Periksa koneksi dan coba kembali. " +
        error.message,
        "error"
      );

    } finally {
      if (requestId === routeRequestId) {
        calculating = false;
        updateSummary();
      }
    }
  }

  // ========================================
  // 5. GPS PELANGGAN
  // ========================================

  $("getLocation").addEventListener(
    "click",
    () => {
      if (!navigator.geolocation) {
        setLocationStatus(
          "Browser tidak mendukung GPS.",
          "error"
        );
        return;
      }

      if (!window.isSecureContext) {
        setLocationStatus(
          "GPS membutuhkan koneksi HTTPS.",
          "error"
        );
        return;
      }

      setLocationStatus(
        "Meminta lokasi. Pilih Izinkan " +
        "jika browser meminta izin."
      );

      navigator.geolocation.getCurrentPosition(
        position => {
          const lat =
            position.coords.latitude;

          const lng =
            position.coords.longitude;

          if (
            !Number.isFinite(lat) ||
            !Number.isFinite(lng)
          ) {
            setLocationStatus(
              "Koordinat lokasi tidak valid.",
              "error"
            );
            return;
          }

          customerLocation = {
            lat,
            lng
          };

          $("mapsLink").value =
            "https://www.google.com/maps?q=" +
            lat + "," + lng;

          calculateRoute();
        },

        error => {
          ++routeRequestId;

          calculating = false;
          calculatedRoute = null;

          let message =
            "Lokasi belum berhasil diperoleh.";

          if (error.code === 1) {
            message =
              "Izin lokasi ditolak. " +
              "Aktifkan izin lokasi browser.";
          } else if (error.code === 2) {
            message =
              "GPS tidak tersedia. " +
              "Silakan coba kembali.";
          } else if (error.code === 3) {
            message =
              "Pengambilan lokasi terlalu lama. " +
              "Silakan coba kembali.";
          }

          setLocationStatus(
            message,
            "error"
          );

          updateSummary();
        },

        {
          enableHighAccuracy: true,
          timeout: 18000,
          maximumAge: 0
        }
      );
    }
  );

  $("recalculate").addEventListener(
    "click",
    calculateRoute
  );

  // ========================================
  // 6. PEMBARUAN OUTLET DAN KERANJANG
  // ========================================

  document.addEventListener(
    "lambe-outlet-updated",
    () => {
      ++routeRequestId;

      calculatedRoute = null;
      calculating = false;

      updateSummary();

      if (customerLocation) {
        calculateRoute();
      } else {
        setLocationStatus(
          "Outlet diperbarui. " +
          "Tentukan lokasi untuk menghitung ongkir."
        );
      }
    }
  );

  document.addEventListener(
    "lambe-cart-updated",
    updateSummary
  );

  document.querySelectorAll(
    'input[name="payment"]'
  ).forEach(input => {
    input.addEventListener(
      "change",
      updatePaymentInfo
    );
  });

  // ========================================
  // 7. VALIDASI FORMULIR
  // ========================================

  function cleanText(value) {
    return String(value || "").trim();
  }

  function validPhone(value) {
    const digits =
      String(value || "")
        .replace(/\D/g, "");

    return (
      /^08\d{8,11}$/.test(digits) ||
      /^628\d{8,11}$/.test(digits)
    );
  }

  function validateOrder() {
    if (!routeIsValid()) {
      alert(
        "Lokasi dan ongkir belum valid. " +
        "Silakan hitung ulang."
      );
      return null;
    }

    if (calculatedRoute.fee === null) {
      alert(
        "Lokasi di luar jangkauan delivery."
      );
      return null;
    }

    const items = app.getCart().filter(
      item => app.getProduct(item.id)
    );

    if (!items.length) {
      alert(
        "Pilih menu terlebih dahulu."
      );
      return null;
    }

    if (
      subtotal() <
      minimumOrder(calculatedRoute.km)
    ) {
      alert(
        "Minimal belanja untuk jarak ini " +
        rp(minimumOrder(calculatedRoute.km))
      );
      return null;
    }

    const name =
      cleanText($("customerName").value);

    const phone =
      cleanText($("customerPhone").value);

    const address =
      cleanText($("customerAddress").value);

    const notes =
      cleanText($("customerNotes").value) ||
      "-";

    const payment = paymentMethod();

    if (name.length < 2) {
      alert(
        "Silakan isi nama penerima."
      );

      $("customerName").focus();
      return null;
    }

    if (!validPhone(phone)) {
      alert(
        "Nomor WhatsApp belum valid."
      );

      $("customerPhone").focus();
      return null;
    }

    if (address.length < 5) {
      alert(
        "Isi alamat pengiriman dengan lengkap."
      );

      $("customerAddress").focus();
      return null;
    }

    if (
      !["Cash", "QRIS"].includes(payment)
    ) {
      alert(
        "Pilih metode pembayaran."
      );
      return null;
    }

    const outletKey =
      app.getOutlet();

    if (!OUTLETS[outletKey]) {
      alert(
        "Outlet tidak valid."
      );
      return null;
    }

    return {
      outlet: outletKey,
      name,
      phone,
      address,
      notes,
      payment,

      latitude:
        customerLocation.lat,

      longitude:
        customerLocation.lng,

      items: items.map(item => ({
        id: item.id,
        quantity: item.quantity,
        variant: item.variant || ""
      }))
    };
  }

  // ========================================
  // 8. VALIDASI KOMUNIKASI APPS SCRIPT
  // ========================================

  function trustedOrigin(origin) {
    try {
      const url = new URL(origin);

      if (url.protocol !== "https:") {
        return false;
      }

      const host =
        url.hostname.toLowerCase();

      return (
        host === "script.google.com" ||
        host === "script.googleusercontent.com" ||
        host.endsWith(
          ".script.googleusercontent.com"
        )
      );

    } catch (error) {
      return false;
    }
  }

  function validWhatsAppUrl(value) {
    if (typeof value !== "string") {
      return false;
    }

    try {
      const url = new URL(value);

      return (
        url.protocol === "https:" &&
        url.hostname === "wa.me" &&
        [
          "/6285791655515",
          "/6285855188856"
        ].includes(url.pathname) &&
        url.searchParams.has("text")
      );

    } catch (error) {
      return false;
    }
  }

  function makeToken() {
    if (
      window.crypto &&
      typeof window.crypto.randomUUID === "function"
    ) {
      return window.crypto.randomUUID();
    }

    if (
      !window.crypto ||
      typeof window.crypto.getRandomValues !== "function"
    ) {
      throw new Error(
        "Browser tidak mendukung token aman."
      );
    }

    const values =
      new Uint32Array(4);

    window.crypto.getRandomValues(values);

    return Array.from(values)
      .map(value => value.toString(16))
      .join("-");
  }

  // ========================================
  // 9. STATUS TRANSAKSI TERTUNDA
  // ========================================

  function savePendingOrder(data) {
    try {
      sessionStorage.setItem(
        PENDING_KEY,
        JSON.stringify(data)
      );
    } catch (error) {
      console.warn(
        "Tidak dapat menyimpan status transaksi."
      );
    }
  }

  function clearPendingOrder() {
    try {
      sessionStorage.removeItem(
        PENDING_KEY
      );
    } catch (error) {
      console.warn(error);
    }
  }

  function readPendingOrder() {
    try {
      const saved =
        sessionStorage.getItem(
          PENDING_KEY
        );

      return saved
        ? JSON.parse(saved)
        : null;

    } catch (error) {
      return null;
    }
  }

  function showOrderWarning(message) {
    let box =
      $("lambeOrderWarning");

    if (!box) {
      box =
        document.createElement("div");

      box.id = "lambeOrderWarning";
      box.setAttribute(
        "role",
        "alert"
      );

      box.style.cssText = [
        "margin:16px 0",
        "padding:18px",
        "border:1px solid #f2d8a1",
        "background:#fff8e8",
        "color:#654a14",
        "border-radius:14px",
        "font-size:14px",
        "line-height:1.7",
        "overflow-wrap:anywhere"
      ].join(";");

      checkout.insertAdjacentElement(
        "afterend",
        box
      );
    }

    box.textContent = message;

    const helpLink =
      document.createElement("a");

    helpLink.href =
      "https://wa.me/" +
      HELP_PHONE +
      "?text=" +
      encodeURIComponent(
        "Halo Kak, saya perlu bantuan " +
        "mengecek pesanan Delivery Order " +
        "Lambe Turah. Pesanan mungkin " +
        "sudah masuk ke sistem."
      );

    helpLink.target = "_blank";
    helpLink.rel =
      "noopener noreferrer";

    helpLink.textContent =
      "💬 Hubungi WhatsApp Bantuan";

    helpLink.style.cssText = [
      "display:block",
      "margin-top:13px",
      "padding:13px",
      "border-radius:11px",
      "background:#16854b",
      "color:#fff",
      "text-decoration:none",
      "font-weight:800",
      "text-align:center"
    ].join(";");

    box.appendChild(helpLink);

    box.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });
  }

  function clearOrderWarning() {
    const box =
      $("lambeOrderWarning");

    if (box) {
      box.remove();
    }
  }

  function markResultUncertain(message) {
    submitting = false;
    resultUncertain = true;

    savePendingOrder({
      token: pendingToken,
      createdAt: Date.now(),
      status: "uncertain"
    });

    updateSummary();
    showOrderWarning(message);
  }

  // ========================================
  // 10. MENGIRIM PESANAN KE DATABASE
  // ========================================

  function submitToDatabase(order) {
    if (
      submitting ||
      resultUncertain
    ) {
      return;
    }

    let token;

    try {
      token = makeToken();
    } catch (error) {
      alert(error.message);
      return;
    }

    pendingToken = token;
    order.clientToken = token;

    submitting = true;
    clearOrderWarning();
    updateSummary();

    savePendingOrder({
      token,
      createdAt: Date.now(),
      status: "sending"
    });

    const iframe =
      document.createElement("iframe");

    iframe.name =
      "lambeOrderFrame_" +
      token.replace(/-/g, "");

    iframe.title =
      "Pengiriman pesanan Lambe Turah";

    iframe.style.cssText = [
      "position:absolute",
      "width:1px",
      "height:1px",
      "opacity:0",
      "border:0",
      "pointer-events:none",
      "left:-9999px",
      "top:0"
    ].join(";");

    pendingFrame = iframe;
    document.body.appendChild(iframe);

    const form =
      document.createElement("form");

    form.method = "POST";
    form.action = API_URL;
    form.target = iframe.name;
    form.style.display = "none";

    const input =
      document.createElement("input");

    input.type = "hidden";
    input.name = "payload";
    input.value =
      JSON.stringify(order);

    form.appendChild(input);
    document.body.appendChild(form);

    responseTimer = setTimeout(() => {
      if (!submitting) {
        return;
      }

      markResultUncertain(
        "Kami belum menerima respons dari sistem. " +
        "Pesanan mungkin sudah tersimpan di database. " +
        "Jangan checkout ulang. Silakan hubungi " +
        "WhatsApp Bantuan agar admin memeriksa " +
        "pesanan Anda."
      );

    }, RESPONSE_TIMEOUT);

    try {
      form.submit();

    } catch (error) {
      clearTimeout(responseTimer);

      markResultUncertain(
        "Kami tidak dapat memastikan hasil " +
        "pengiriman data. Jangan checkout ulang " +
        "sebelum admin memeriksa pesanan."
      );

    } finally {
      form.remove();
    }
  }

  // ========================================
  // 11. TERIMA RESPONS DARI APPS SCRIPT
  // ========================================

  function processDatabaseResponse(event) {
    /*
     * Perubahan utama versi 7.1:
     *
     * Tidak lagi mewajibkan event.source
     * sama dengan pendingFrame.contentWindow.
     *
     * Google Apps Script dapat membuat
     * iframe internal tambahan.
     *
     * Respons tetap diperiksa menggunakan:
     * - Origin HTTPS Google yang diizinkan
     * - Tipe dan versi pesan
     * - Token unik transaksi
     * - Format nomor order
     * - Nomor WhatsApp outlet yang sah
     */

    if (!submitting) {
      return;
    }

    if (!trustedOrigin(event.origin)) {
      return;
    }

    const result =
      event.data;

    if (
      !result ||
      typeof result !== "object" ||
      result.type !==
        "LAMBE_TURAH_ORDER_RESULT" ||
      result.version !== 3 ||
      result.token !== pendingToken
    ) {
      return;
    }

    clearTimeout(responseTimer);

    submitting = false;

    if (!result.success) {
      /*
       * Backend menyatakan pesanan gagal.
       * Namun apabila kegagalan terjadi
       * setelah penulisan sebagian data,
       * pesanan tetap perlu diperiksa.
       */
      resultUncertain = true;

      savePendingOrder({
        token: pendingToken,
        createdAt: Date.now(),
        status: "server_error"
      });

      updateSummary();

      showOrderWarning(
        "Sistem melaporkan masalah: " +
        (result.message || "Kesalahan tidak diketahui.") +
        " Jangan checkout ulang sebelum " +
        "admin memastikan pesanan belum tercatat."
      );

      return;
    }

    if (
      !/^LT-[A-Za-z0-9-]+$/.test(result.orderId) ||
      !validWhatsAppUrl(result.whatsapp)
    ) {
      markResultUncertain(
        "Pesanan mungkin sudah tercatat, " +
        "tetapi data konfirmasi belum lengkap. " +
        "Silakan hubungi WhatsApp Bantuan."
      );

      return;
    }

    const confirmationData = {
      orderId: result.orderId,
      whatsapp: result.whatsapp,
      whatsappOpened: false
    };

    // Simpan hasil transaksi.
    // Halaman konfirmasi akan membaca
    // informasi ini dari sessionStorage.

    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(confirmationData)
      );

      clearPendingOrder();
      pendingToken = "";

      window.location.assign(
        CONFIRM_URL
      );

    } catch (error) {
      /*
       * Jika sessionStorage tidak tersedia,
       * gunakan fragment sebagai cadangan.
       *
       * Fragment ini mengandung isi
       * pesan WhatsApp pelanggan, sehingga
       * hanya dipakai dalam kondisi darurat.
       */

      clearPendingOrder();
      pendingToken = "";

      const fragment =
        "#order=" +
        encodeURIComponent(
          JSON.stringify(
            confirmationData
          )
        );

      window.location.assign(
        CONFIRM_URL + fragment
      );
    }
  }

  window.addEventListener(
    "message",
    processDatabaseResponse
  );

  // ========================================
  // 12. TOMBOL CHECKOUT
  // ========================================

  checkout.addEventListener(
    "click",
    () => {
      if (
        submitting ||
        calculating ||
        resultUncertain
      ) {
        return;
      }

      const order =
        validateOrder();

      if (!order) return;

      const confirmed = confirm(
        "Konfirmasi Pesanan Lambe Turah\n\n" +
        "Outlet: " +
        currentOutlet().name + "\n" +
        "Subtotal: " +
        rp(subtotal()) + "\n" +
        "Ongkir estimasi: " +
        rp(calculatedRoute.fee) + "\n" +
        "Total estimasi: " +
        rp(
          subtotal() +
          calculatedRoute.fee
        ) + "\n" +
        "Pembayaran: " +
        paymentMethod() + "\n\n" +
        "Pesanan akan dicatat ke sistem. " +
        "Setelah berhasil, Anda akan " +
        "diarahkan ke konfirmasi dan WhatsApp.\n\n" +
        "Lanjutkan?"
      );

      if (!confirmed) {
        return;
      }

      submitToDatabase(order);
    }
  );

  // ========================================
  // 13. WHATSAPP BANTUAN MELAYANG
  // ========================================

  function createFloatingHelp() {
    if ($("lambeFloatingHelp")) {
      return;
    }

    const style =
      document.createElement("style");

    style.textContent = `
      #lambeFloatingHelp {
        position:fixed;
        right:15px;
        bottom:calc(
          94px + env(safe-area-inset-bottom)
        );
        z-index:950;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        gap:9px;
        background:#16854b;
        color:white;
        padding:12px 16px;
        border-radius:999px;
        text-decoration:none;
        font:800 13px Arial,sans-serif;
        box-shadow:0 7px 25px rgba(0,0,0,.22);
        border:2px solid #fff;
        max-width:calc(100vw - 30px);
        transition:transform .2s ease;
      }

      #lambeFloatingHelp:hover {
        transform:translateY(-2px);
      }

      #lambeFloatingHelp svg {
        width:24px;
        height:24px;
        flex-shrink:0;
      }

      #lambeFloatingHelp span {
        white-space:nowrap;
      }

      @media(min-width:900px) {
        #lambeFloatingHelp {
          right:25px;
          bottom:105px;
          padding:14px 19px;
          font-size:14px;
        }
      }

      @media(max-width:380px) {
        #lambeFloatingHelp {
          right:9px;
          padding:11px 13px;
          font-size:12px;
          bottom:calc(
            92px + env(safe-area-inset-bottom)
          );
        }
      }
    `;

    document.head.appendChild(style);

    const link =
      document.createElement("a");

    link.id = "lambeFloatingHelp";

    link.href =
      "https://wa.me/" +
      HELP_PHONE +
      "?text=" +
      encodeURIComponent(
        HELP_MESSAGE
      );

    link.target = "_blank";

    link.rel =
      "noopener noreferrer";

    link.setAttribute(
      "aria-label",
      "Hubungi WhatsApp Bantuan Lambe Turah"
    );

    link.innerHTML = `
      <svg
        viewBox="0 0 32 32"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true">

        <path
          fill="currentColor"
          d="M16 .8C7.6.8.8 7.6.8 16c0 2.7.7 5.2 2 7.5L.5 31l7.7-2.1c2.3 1.3 5 2 7.8 2 8.4 0 15.2-6.8 15.2-15.2S24.4.8 16 .8Zm0 27.3c-2.5 0-4.9-.7-7-2l-.5-.3-4.5 1.2 1.2-4.4-.3-.5c-1.3-2.1-2-4.5-2-7C2.9 8.5 8.4 3 16 3s13 5.5 13 13-5.5 12.1-13 12.1Zm7.1-9.6c-.4-.2-2.3-1.1-2.7-1.2-.4-.2-.6-.2-.9.2-.3.4-1 1.2-1.3 1.5-.2.2-.5.3-.9.1-.4-.2-1.6-.6-3-1.9-1.1-1-1.9-2.3-2.1-2.7-.2-.4 0-.6.2-.8l.6-.7.4-.7c.1-.2 0-.5 0-.7l-1.2-2.9c-.3-.7-.6-.6-.9-.6h-.8c-.3 0-.7.1-1 .5-.4.4-1.4 1.3-1.4 3.2s1.4 3.8 1.6 4c.2.3 2.7 4.2 6.5 5.9.9.4 1.6.6 2.1.8.9.3 1.7.2 2.3.1.7-.1 2.3-.9 2.6-1.8.3-.9.3-1.7.2-1.8-.1-.2-.3-.3-.7-.5Z"
        />
      </svg>

      <span>Butuh Bantuan?</span>
    `;

    document.body.appendChild(
      link
    );
  }

  // ========================================
  // 14. CEK TRANSAKSI SEBELUMNYA
  // ========================================

  function checkPreviousTransaction() {
    const pending =
      readPendingOrder();

    if (!pending) {
      return;
    }

    /*
     * Jika browser ditutup ketika proses
     * penyimpanan berlangsung, jangan
     * mengaktifkan checkout otomatis.
     *
     * Pesanan mungkin sudah tersimpan.
     */

    resultUncertain = true;

    updateSummary();

    showOrderWarning(
      "Terdapat proses pemesanan sebelumnya " +
      "yang belum dipastikan hasilnya. " +
      "Jangan checkout ulang sebelum " +
      "admin memeriksa Google Spreadsheet."
    );
  }

  // ========================================
  // 15. INISIALISASI
  // ========================================

  createFloatingHelp();
  updatePaymentInfo();
  updateSummary();
  checkPreviousTransaction();

})();
