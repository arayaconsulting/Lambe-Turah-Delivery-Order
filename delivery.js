
(() => {
  "use strict";

  /*
   * CEKER & KERANG PEDAS LAMBE TURAH
   * DELIVERY.JS v9.3.4 — FINAL
   *
   * KOMPATIBEL DENGAN INDEX.HTML v9.4.4
   *
   * CHECKOUT LANGSUNG KE WHATSAPP
   * TANPA GOOGLE APPS SCRIPT
   * TANPA DATABASE
   *
   * ONGKIR:
   * - Rp1.000 per kilometer
   * - Tarif minimal Rp1.000
   * - Pecahan <= 0,5 km dibulatkan ke bawah
   * - Pecahan > 0,5 km dibulatkan ke atas
   * - Minimal belanja Rp75.000 jika jarak tarif > 7 km
   * - Maksimal rute sebenarnya 9 km
   *
   * OPERASIONAL:
   * - Delivery 10.00–20.00 WIB
   * - Takeaway 10.00–21.30 WIB
   * - Katalog dan keranjang tersedia 24 jam
   * - Checkout ditutup di luar jam layanan
   *
   * PEMBAYARAN:
   *
   * QRIS:
   * - Bayar penuh sesuai total pesanan
   * - Tidak perlu memilih status pelanggan
   * - Admin mengirimkan QRIS dinamis
   * - Pembayaran sebelum QRIS kedaluwarsa
   *
   * CASH DELIVERY:
   * - Pelanggan baru wajib DP minimal 50%
   * - DP melalui transfer setelah instruksi admin
   * - Sisa dibayar tunai saat pesanan diterima
   * - Pelanggan lama bayar tunai saat diterima
   *
   * TAKEAWAY:
   * - Cash atau QRIS
   * - Tidak memerlukan status pelanggan
   * - Tidak dikenakan aturan DP pelanggan baru
   *
   * PEMBAYARAN TIDAK OTOMATIS.
   * ADMIN TETAP MELAKUKAN VERIFIKASI.
   */

  // ==========================================
  // KONFIGURASI OUTLET
  // ==========================================

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

  // ==========================================
  // KONFIGURASI ONGKIR
  // ==========================================

  const MAX_DISTANCE_KM = 9;
  const SHIPPING_RATE_PER_KM = 1000;
  const MINIMUM_ABOVE_7_KM = 75000;
  const ROUTE_TIMEOUT_MS = 15000;

  // ==========================================
  // KONFIGURASI PEMBAYARAN
  // ==========================================

  const FIRST_ORDER_DP_RATE = 0.5;

  // ==========================================
  // JAM OPERASIONAL
  // ==========================================

  const TIME_ZONE = "Asia/Jakarta";

  const SERVICE_HOURS = {
    delivery: {
      open: 10 * 60,
      close: 20 * 60,
      label: "10.00–20.00 WIB"
    },

    takeaway: {
      open: 10 * 60,
      close: 21 * 60 + 30,
      label: "10.00–21.30 WIB"
    }
  };

  const HOURS_REFRESH_MS = 15000;

  // ==========================================
  // KONEKSI INDEX.HTML v9.4.4
  // ==========================================

  const app = window.LAMBE_APP;

  const $ = id => document.getElementById(id);

  const requiredFunctions = [
    "getOutlet",
    "getMode",
    "getCart",
    "getProduct",
    "getSubtotal",
    "getCustomerType",
    "getFirstOrderPayment"
  ];

  if (
    !app ||
    requiredFunctions.some(
      name => typeof app[name] !== "function"
    )
  ) {
    console.error(
      "LAMBE_APP belum tersedia atau tidak lengkap. " +
      "Pastikan index.html menggunakan v9.4.4."
    );

    return;
  }

  const requiredIds = [
    "checkoutButton",
    "getLocation",
    "recalculate",
    "locationStatus",
    "mapsLink",
    "distanceSummary",
    "summarySubtotal",
    "summaryShipping",
    "summaryTotal",
    "customerName",
    "customerPhone",
    "customerAddress",
    "customerNotes",
    "paymentInfo",
    "pickupWhen",
    "pickupTime",
    "customerPolicySection",
    "firstOrderPaymentSection",
    "returningCustomerInfo",
    "qrisPaymentInfo",
    "depositAmount",
    "remainingAmount",
    "depositAmountLabel",
    "remainingAmountLabel",
    "depositInstruction"
  ];

  const missingIds = requiredIds.filter(
    id => !$(id)
  );

  if (missingIds.length) {
    console.error(
      "Elemen index.html tidak lengkap:",
      missingIds.join(", ")
    );

    return;
  }

  const checkout = $("checkoutButton");

  const rupiah = value =>
    "Rp" +
    Math.round(Number(value) || 0)
      .toLocaleString("id-ID");

  // ==========================================
  // STATUS LOKASI DAN RUTE
  // ==========================================

  let location = null;
  let route = null;

  let calculating = false;
  let preparingWhatsApp = false;

  let requestSequence = 0;
  let gpsSequence = 0;

  let routeController = null;

  // ==========================================
  // OUTLET DAN MODE
  // ==========================================

  function outletKey() {
    return String(
      app.getOutlet() || ""
    ).toLowerCase();
  }

  function selectedOutlet() {
    return OUTLETS[outletKey()] || null;
  }

  function isTakeaway() {
    return app.getMode() === "takeaway";
  }

  function currentMode() {
    return isTakeaway()
      ? "takeaway"
      : "delivery";
  }

  function cartSubtotal() {
    return Number(app.getSubtotal()) || 0;
  }

  function selectedPayment() {
    return (
      document.querySelector(
        'input[name="payment"]:checked'
      )?.value || ""
    );
  }

  // ==========================================
  // STATUS PELANGGAN v9.3.4
  // ==========================================

  function selectedCustomerType() {
    return app.getCustomerType();
  }

  function selectedFirstOrderPayment() {
    return app.getFirstOrderPayment();
  }

  function isQRIS() {
    return selectedPayment() === "QRIS";
  }

  function isCashDelivery() {
    return (
      !isTakeaway() &&
      selectedPayment() === "Cash"
    );
  }

  function isFirstOrderCashDelivery() {
    return (
      isCashDelivery() &&
      selectedCustomerType() === "new"
    );
  }

  // ==========================================
  // ATURAN PEMBAYARAN
  // ==========================================

  /*
   * QRIS:
   * - Semua pelanggan membayar penuh.
   * - Tidak menanyakan pelanggan baru/lama.
   *
   * Cash Delivery pelanggan baru:
   * - DP 50% dari total termasuk ongkir.
   * - Sisa pembayaran tunai saat diterima.
   *
   * Cash Delivery pelanggan lama:
   * - Bayar tunai saat diterima.
   *
   * Takeaway:
   * - Cash atau QRIS seperti biasa.
   */

  function expectedPaymentChoice() {
    if (isQRIS() && !isTakeaway()) {
      return "full100";
    }

    if (isFirstOrderCashDelivery()) {
      return "dp50";
    }

    return null;
  }

  function calculateInitialPayment(
    total,
    payment,
    customerType,
    takeaway
  ) {
    if (
      !Number.isFinite(total) ||
      total < 0
    ) {
      return null;
    }

    if (payment === "QRIS") {
      return {
        initial: total,
        remaining: 0,
        label: "Bayar sesuai total pesanan",
        method: "QRIS Dinamis",
        percentage: 100,
        requiresAdvance: true
      };
    }

    if (
      !takeaway &&
      payment === "Cash" &&
      customerType === "new"
    ) {
      const initial = Math.ceil(
        total * FIRST_ORDER_DP_RATE
      );

      return {
        initial,
        remaining: total - initial,
        label: "DP minimal 50%",
        method: "Transfer",
        percentage: 50,
        requiresAdvance: true
      };
    }

    return {
      initial: 0,
      remaining: total,
      label: "Bayar saat pesanan diterima",
      method: "Cash",
      percentage: 0,
      requiresAdvance: false
    };
  }

  // ==========================================
  // WAKTU INDONESIA BARAT
  // ==========================================

  const jakartaFormatter =
    new Intl.DateTimeFormat("en-GB", {
      timeZone: TIME_ZONE,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    });

  function currentWIBMinutes() {
    const parts =
      jakartaFormatter.formatToParts(
        new Date()
      );

    const hourPart = parts.find(
      part => part.type === "hour"
    );

    const minutePart = parts.find(
      part => part.type === "minute"
    );

    const hour = Number(
      hourPart?.value
    );

    const minute = Number(
      minutePart?.value
    );

    if (
      !Number.isInteger(hour) ||
      !Number.isInteger(minute) ||
      hour < 0 ||
      hour > 23 ||
      minute < 0 ||
      minute > 59
    ) {
      return null;
    }

    return hour * 60 + minute;
  }

  function serviceStatus(mode = currentMode()) {
    const hours = SERVICE_HOURS[mode];
    const minutes = currentWIBMinutes();

    if (!hours || minutes === null) {
      return {
        open: false,
        reason: "unknown",
        minutes,
        hours
      };
    }

    if (minutes < hours.open) {
      return {
        open: false,
        reason: "before",
        minutes,
        hours
      };
    }

    if (minutes >= hours.close) {
      return {
        open: false,
        reason: "after",
        minutes,
        hours
      };
    }

    return {
      open: true,
      reason: "open",
      minutes,
      hours
    };
  }

  function canCheckoutNow() {
    return serviceStatus().open;
  }

  // ==========================================
  // INFORMASI JAM OPERASIONAL
  // ==========================================

  function ensureHoursElement() {
    let element = $("serviceHoursStatus");

    if (element) {
      return element;
    }

    element = document.createElement("div");

    element.id = "serviceHoursStatus";

    element.setAttribute(
      "role",
      "status"
    );

    element.setAttribute(
      "aria-live",
      "polite"
    );

    element.style.marginTop = "14px";
    element.style.padding = "14px";
    element.style.borderRadius = "12px";
    element.style.fontSize = "12px";
    element.style.lineHeight = "1.7";

    const modeHelp = $("modeHelp");

    if (modeHelp) {
      modeHelp.insertAdjacentElement(
        "afterend",
        element
      );
    } else {
      checkout.insertAdjacentElement(
        "beforebegin",
        element
      );
    }

    return element;
  }

  function updateHoursInfo() {
    const element = ensureHoursElement();

    const mode = currentMode();
    const status = serviceStatus(mode);
    const hours = SERVICE_HOURS[mode];

    const modeName =
      mode === "delivery"
        ? "Delivery"
        : "Takeaway";

    let message = "";

    let background = "#e8f6eb";
    let color = "#176c33";

    if (status.open) {
      message =
        "✓ Pemesanan " +
        modeName +
        " sedang dibuka. " +
        "Jam layanan: " +
        hours.label +
        ".";

    } else {
      background = "#fff6e5";
      color = "#775615";

      if (status.reason === "before") {
        message =
          "⏰ Pemesanan " +
          modeName +
          " belum dibuka. " +
          "Layanan tersedia mulai " +
          "pukul 10.00 WIB. " +
          "Kakak tetap bisa melihat menu " +
          "dan menyiapkan keranjang.";

      } else if (status.reason === "after") {
        if (
          mode === "delivery" &&
          serviceStatus("takeaway").open
        ) {
          message =
            "⏰ Delivery hari ini sudah ditutup " +
            "pukul 20.00 WIB. " +
            "Namun, Takeaway masih tersedia " +
            "sampai sebelum pukul 21.30 WIB. " +
            "Silakan pilih Takeaway " +
            "jika ingin mengambil sendiri " +
            "pesanan di outlet.";

        } else {
          message =
            "⏰ Pemesanan " +
            modeName +
            " hari ini sudah ditutup. " +
            "Layanan kembali dibuka " +
            "besok pukul 10.00 WIB. " +
            "Menu tetap bisa dilihat " +
            "dan dimasukkan ke keranjang.";
        }

      } else {
        message =
          "Jam layanan belum dapat diperiksa. " +
          "Silakan periksa pengaturan waktu " +
          "perangkat dan muat ulang halaman.";
      }
    }

    element.textContent = message;
    element.style.background = background;
    element.style.color = color;
  }

  // ==========================================
  // PEMBULATAN JARAK
  // ==========================================

  /*
   * Contoh:
   *
   * 0,8 km => 1 km
   * 1,5 km => 1 km
   * 1,6 km => 2 km
   * 2,5 km => 2 km
   * 2,6 km => 3 km
   * 4,6 km => 5 km
   * 7,5 km => 7 km
   * 7,6 km => 8 km
   * 8,6 km => 9 km
   *
   * Nilai tepat x,5 dibulatkan ke bawah.
   * Tarif minimum tetap 1 km.
   */

  function roundedDistance(km) {
    if (
      !Number.isFinite(km) ||
      km < 0
    ) {
      return null;
    }

    return Math.max(
      1,
      Math.ceil(km - 0.5)
    );
  }

  // ==========================================
  // TARIF ONGKIR RP1.000 PER KM
  // ==========================================

  function deliveryFee(km) {
    if (
      !Number.isFinite(km) ||
      km < 0 ||
      km > MAX_DISTANCE_KM
    ) {
      return null;
    }

    const distance = roundedDistance(km);

    if (distance === null) {
      return null;
    }

    return distance * SHIPPING_RATE_PER_KM;
  }

  // ==========================================
  // MINIMAL BELANJA
  // ==========================================

  /*
   * 7,5 km => tarif 7 km.
   * Tidak terkena minimal belanja Rp75.000.
   *
   * 7,6 km => tarif 8 km.
   * Minimal belanja Rp75.000 berlaku.
   */

  function minimumSubtotal(km) {
    const distance = roundedDistance(km);

    if (distance === null) {
      return 0;
    }

    return distance > 7
      ? MINIMUM_ABOVE_7_KM
      : 0;
  }

  // ==========================================
  // VALIDASI RUTE
  // ==========================================

  function validRoute() {
    return !!(
      location &&
      route &&
      route.outlet === outletKey() &&
      route.latitude === location.latitude &&
      route.longitude === location.longitude
    );
  }

  function setLocationStatus(
    message,
    kind = ""
  ) {
    const element = $("locationStatus");

    element.className =
      "status" +
      (kind ? " " + kind : "");

    element.textContent = message;
  }

  // ==========================================
  // INFORMASI PEMBAYARAN
  // ==========================================

  function updatePaymentInfo() {
    const takeaway = isTakeaway();
    const payment = selectedPayment();

    if (payment === "QRIS") {
      $("paymentInfo").textContent =
        "Bayar sesuai total pesanan. " +
        "QRIS dinamis dikirim admin setelah " +
        "pesanan dikonfirmasi. " +
        "Segera bayar sebelum kode kedaluwarsa. " +
        "Pesanan diproses setelah " +
        "pembayaran diverifikasi admin.";

      return;
    }

    if (
      !takeaway &&
      selectedCustomerType() === "new"
    ) {
      $("paymentInfo").textContent =
        "Pelanggan baru: DP minimal 50% " +
        "melalui transfer setelah konfirmasi admin. " +
        "Sisa pembayaran tunai saat pesanan diterima. " +
        "Pesanan diproses setelah DP diverifikasi.";

      return;
    }

    if (
      !takeaway &&
      selectedCustomerType() === "returning"
    ) {
      $("paymentInfo").textContent =
        "Pembayaran tunai saat pesanan diterima. " +
        "Riwayat pemesanan akan diverifikasi admin.";

      return;
    }

    if (
      !takeaway &&
      !selectedCustomerType()
    ) {
      $("paymentInfo").textContent =
        "Pilih apakah ini pesanan Delivery pertama Anda " +
        "untuk melihat ketentuan pembayaran Cash.";

      return;
    }

    $("paymentInfo").textContent =
      "Pembayaran tunai saat mengambil pesanan " +
      "di outlet. Waktu pengambilan dan total akhir " +
      "dikonfirmasi admin.";
  }

  // ==========================================
  // RINGKASAN DAN STATUS CHECKOUT
  // ==========================================

  function updateSummary() {
    const subtotal = cartSubtotal();
    const takeaway = isTakeaway();

    const currentRoute =
      validRoute()
        ? route
        : null;

    const fee = takeaway
      ? 0
      : currentRoute
        ? currentRoute.fee
        : null;

    $("summarySubtotal").textContent =
      rupiah(subtotal);

    $("summaryShipping").textContent =
      fee === null
        ? "Belum tersedia"
        : rupiah(fee);

    $("summaryTotal").textContent =
      rupiah(
        subtotal +
        (fee === null ? 0 : fee)
      );

    if (!takeaway) {
      if (!currentRoute) {
        $("distanceSummary").textContent =
          "Jarak dan ongkir menunggu lokasi pengiriman.";

      } else {
        const minimum =
          minimumSubtotal(currentRoute.km);

        const rounded =
          roundedDistance(currentRoute.km);

        let details =
          "Jarak rute: " +
          currentRoute.km.toFixed(2) +
          " km" +
          " | Jarak tarif: " +
          rounded +
          " km" +
          " | Ongkir: " +
          (
            fee === null
              ? "Di luar jangkauan"
              : rupiah(fee)
          );

        if (minimum > 0) {
          details +=
            " | Minimal belanja: " +
            rupiah(minimum);

          if (subtotal < minimum) {
            details +=
              " | Kekurangan: " +
              rupiah(minimum - subtotal);
          }
        }

        $("distanceSummary").textContent =
          details;
      }
    }

    const hoursStatus = serviceStatus();

    if (preparingWhatsApp) {
      checkout.disabled = true;

      checkout.textContent =
        "Membuka WhatsApp...";

    } else if (!hoursStatus.open) {
      checkout.disabled = true;

      if (hoursStatus.reason === "before") {
        checkout.textContent =
          "Pemesanan Dibuka Pukul 10.00 WIB";

      } else if (hoursStatus.reason === "after") {
        checkout.textContent =
          "Pemesanan " +
          (takeaway ? "Takeaway" : "Delivery") +
          " Sudah Ditutup";

      } else {
        checkout.textContent =
          "Jam Layanan Belum Tersedia";
      }

    } else if (
      !takeaway &&
      calculating
    ) {
      checkout.disabled = true;

      checkout.textContent =
        "Menghitung Ongkir...";

    } else if (
      !takeaway &&
      !currentRoute
    ) {
      checkout.disabled = true;

      checkout.textContent =
        "Tentukan Lokasi Pengiriman Dahulu";

    } else if (
      !takeaway &&
      fee === null
    ) {
      checkout.disabled = true;

      checkout.textContent =
        "Di Luar Jangkauan Delivery";

    } else if (subtotal <= 0) {
      checkout.disabled = true;

      checkout.textContent =
        "Pilih Menu Terlebih Dahulu";

    } else if (
      !takeaway &&
      subtotal < minimumSubtotal(currentRoute.km)
    ) {
      checkout.disabled = true;

      checkout.textContent =
        "Minimal Order " +
        rupiah(
          minimumSubtotal(currentRoute.km)
        );

    } else if (
      !takeaway &&
      !["Cash", "QRIS"].includes(
        selectedPayment()
      )
    ) {
      checkout.disabled = true;

      checkout.textContent =
        "Pilih Metode Pembayaran";

    } else if (
      isCashDelivery() &&
      !["new", "returning"].includes(
        selectedCustomerType()
      )
    ) {
      checkout.disabled = true;

      checkout.textContent =
        "Pilih Status Pelanggan";

    } else if (
      !takeaway &&
      selectedFirstOrderPayment() !==
        expectedPaymentChoice()
    ) {
      checkout.disabled = true;

      checkout.textContent =
        "Periksa Metode Pembayaran";

    } else {
      checkout.disabled = false;

      checkout.textContent =
        takeaway
          ? "Pesan Takeaway via WhatsApp"
          : "Kirim Pesanan via WhatsApp";
    }

    updateHoursInfo();
    updatePaymentInfo();
  }

  // ==========================================
  // MEMBATALKAN PERHITUNGAN RUTE LAMA
  // ==========================================

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

  // ==========================================
  // HITUNG JARAK RUTE JALAN
  // ==========================================

  async function calculateRoute() {
    if (isTakeaway()) return;

    invalidateRoute();

    const sequence = requestSequence;

    if (!location) {
      setLocationStatus(
        "Silakan tentukan lokasi pengiriman.",
        "error"
      );

      return;
    }

    const outlet = selectedOutlet();

    if (!outlet) {
      setLocationStatus(
        "Pilih outlet terlebih dahulu.",
        "error"
      );

      return;
    }

    const requestedLocation = {
      ...location
    };

    const requestedOutlet = outletKey();

    calculating = true;

    updateSummary();

    setLocationStatus(
      "Menghitung jarak melalui rute jalan..."
    );

    const controller = new AbortController();

    routeController = controller;

    const timeout = setTimeout(
      () => controller.abort(),
      ROUTE_TIMEOUT_MS
    );

    try {
      const url =
        "https://router.project-osrm.org/route/v1/driving/" +
        outlet.longitude +
        "," +
        outlet.latitude +
        ";" +
        requestedLocation.longitude +
        "," +
        requestedLocation.latitude +
        "?overview=false&steps=false";

      const response = await fetch(
        url,
        {
          signal: controller.signal,
          cache: "no-store"
        }
      );

      if (!response.ok) {
        throw new Error(
          "Layanan rute sedang tidak tersedia."
        );
      }

      const data = await response.json();

      const meters =
        data?.routes?.[0]?.distance;

      if (
        !Number.isFinite(meters) ||
        meters < 0
      ) {
        throw new Error(
          "Rute jalan menuju lokasi tidak ditemukan."
        );
      }

      if (sequence !== requestSequence) {
        return;
      }

      const km = meters / 1000;

      const fee = deliveryFee(km);

      const rounded = roundedDistance(km);

      route = {
        outlet: requestedOutlet,
        latitude: requestedLocation.latitude,
        longitude: requestedLocation.longitude,
        km,
        roundedKm: rounded,
        fee
      };

      setLocationStatus(
        fee === null
          ? "Jarak " +
            km.toFixed(2) +
            " km di luar jangkauan maksimal 9 km."
          : "Lokasi ditemukan. Jarak rute " +
            km.toFixed(2) +
            " km, dihitung " +
            rounded +
            " km. Ongkir " +
            rupiah(fee) +
            ".",
        fee === null
          ? "error"
          : "success"
      );

    } catch (error) {
      if (sequence !== requestSequence) {
        return;
      }

      route = null;

      setLocationStatus(
        "Ongkir belum dapat dihitung. " +
        "Periksa koneksi internet dan coba " +
        "Hitung Ulang Ongkir. " +
        (
          error.name === "AbortError"
            ? "Layanan rute terlalu lama merespons."
            : error.message
        ),
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

  // ==========================================
  // GPS — PANDUAN BROWSER INSTAGRAM
  // ==========================================

  $("getLocation").addEventListener(
    "click",
    () => {
      if (
        preparingWhatsApp ||
        isTakeaway()
      ) {
        return;
      }

      if (!navigator.geolocation) {
        setLocationStatus(
          "Browser tidak mendukung akses lokasi. " +
          "Jika membuka dari Instagram, pilih menu " +
          "titik tiga untuk membuka website melalui " +
          "Safari atau Chrome.",
          "error"
        );

        return;
      }

      if (!window.isSecureContext) {
        setLocationStatus(
          "Layanan lokasi membutuhkan HTTPS. " +
          "Buka website melalui alamat resminya.",
          "error"
        );

        return;
      }

      const sequence = ++gpsSequence;

      invalidateRoute();

      setLocationStatus(
        "Meminta titik lokasi. Pilih Izinkan " +
        "saat browser meminta akses GPS."
      );

      navigator.geolocation.getCurrentPosition(
        position => {
          if (
            sequence !== gpsSequence ||
            isTakeaway()
          ) {
            return;
          }

          const latitude =
            position.coords.latitude;

          const longitude =
            position.coords.longitude;

          if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude)
          ) {
            setLocationStatus(
              "Koordinat GPS tidak valid.",
              "error"
            );

            return;
          }

          location = {
            latitude,
            longitude
          };

          $("mapsLink").value =
            "https://www.google.com/maps?q=" +
            latitude +
            "," +
            longitude;

          calculateRoute();
        },

        error => {
          if (
            sequence !== gpsSequence ||
            isTakeaway()
          ) {
            return;
          }

          location = null;

          $("mapsLink").value = "";

          invalidateRoute();

          let message =
            "Lokasi belum dapat diperoleh. " +
            "Silakan coba kembali.";

          if (error.code === 1) {
            message =
              "Lokasi tidak dapat diakses. " +
              "Jika membuka website melalui Instagram, " +
              "ketuk menu titik tiga (•••), lalu pilih " +
              "Buka di Browser Eksternal untuk melanjutkan " +
              "melalui Safari atau Chrome. " +
              "Jika pilihan tersebut tidak tersedia, " +
              "salin tautan website dan buka langsung " +
              "di Safari atau Chrome. " +
              "Jika sudah menggunakan browser tersebut, " +
              "periksa izin lokasi, lalu coba lagi.";
          }

          if (error.code === 2) {
            message =
              "GPS belum tersedia. " +
              "Coba di tempat lebih terbuka.";
          }

          if (error.code === 3) {
            message =
              "Pengambilan GPS terlalu lama. " +
              "Silakan coba kembali.";
          }

          setLocationStatus(
            message,
            "error"
          );
        },

        {
          enableHighAccuracy: true,
          timeout: 18000,
          maximumAge: 0
        }
      );
    }
  );

  // ==========================================
  // HITUNG ULANG ONGKIR
  // ==========================================

  $("recalculate").addEventListener(
    "click",
    () => {
      if (
        !preparingWhatsApp &&
        !isTakeaway()
      ) {
        calculateRoute();
      }
    }
  );

  // ==========================================
  // PERUBAHAN OUTLET
  // ==========================================

  document.addEventListener(
    "lambe-outlet-updated",
    () => {
      if (preparingWhatsApp) {
        return;
      }

      gpsSequence += 1;

      if (isTakeaway()) {
        invalidateRoute();
        updateSummary();

        return;
      }

      if (location) {
        calculateRoute();

      } else {
        invalidateRoute();

        setLocationStatus(
          "Outlet diganti. Gunakan lokasi " +
          "untuk menghitung ongkir."
        );
      }
    }
  );

  // ==========================================
  // PERUBAHAN DELIVERY / TAKEAWAY
  // ==========================================

  document.addEventListener(
    "lambe-mode-updated",
    () => {
      gpsSequence += 1;

      invalidateRoute();

      updatePaymentInfo();

      if (
        !isTakeaway() &&
        location
      ) {
        calculateRoute();

      } else if (!isTakeaway()) {
        setLocationStatus(
          "Silakan gunakan lokasi Anda " +
          "untuk menghitung ongkir."
        );
      }

      updateSummary();
    }
  );

  // ==========================================
  // PERUBAHAN KERANJANG
  // ==========================================

  document.addEventListener(
    "lambe-cart-updated",
    updateSummary
  );

  // ==========================================
  // PERUBAHAN STATUS PELANGGAN
  // ==========================================

  document.addEventListener(
    "lambe-customer-policy-updated",
    () => {
      updatePaymentInfo();
      updateSummary();
    }
  );

  // ==========================================
  // PERUBAHAN METODE PEMBAYARAN
  // ==========================================

  document
    .querySelectorAll(
      'input[name="payment"]'
    )
    .forEach(input => {
      input.addEventListener(
        "change",
        () => {
          updatePaymentInfo();
          updateSummary();
        }
      );
    });

  // ==========================================
  // PEMERIKSAAN JAM BERKALA
  // ==========================================

  setInterval(
    updateSummary,
    HOURS_REFRESH_MS
  );

  document.addEventListener(
    "visibilitychange",
    () => {
      if (!document.hidden) {
        updateSummary();
      }
    }
  );

  window.addEventListener(
    "focus",
    updateSummary
  );

  // ==========================================
  // VALIDASI TEKS DAN NOMOR HP
  // ==========================================

  function cleanText(
    value,
    maxLength = 500
  ) {
    return String(value ?? "")
      .replace(
        /[\x00-\x1F\x7F]/g,
        " "
      )
      .trim()
      .slice(0, maxLength);
  }

  function normalizePhone(value) {
    let digits =
      String(value || "")
        .replace(/\D/g, "");

    if (digits.startsWith("62")) {
      digits =
        "0" + digits.slice(2);
    }

    return /^08\d{8,11}$/.test(digits)
      ? digits
      : "";
  }

  // ==========================================
  // VALIDASI PEMBAYARAN
  // ==========================================

  function validatePaymentSelection(
    takeaway,
    payment
  ) {
    if (
      !["Cash", "QRIS"].includes(payment)
    ) {
      alert(
        "Pilih metode pembayaran terlebih dahulu."
      );

      return null;
    }

    if (takeaway) {
      return {
        customerType: null,
        paymentChoice: null
      };
    }

    if (payment === "QRIS") {
      if (
        selectedCustomerType() !== "not_required" ||
        selectedFirstOrderPayment() !== "full100"
      ) {
        alert(
          "Pilihan pembayaran QRIS tidak sesuai. " +
          "Silakan pilih QRIS kembali."
        );

        return null;
      }

      return {
        customerType: "not_required",
        paymentChoice: "full100"
      };
    }

    const customerType =
      selectedCustomerType();

    if (
      !["new", "returning"].includes(
        customerType
      )
    ) {
      alert(
        "Apakah ini pesanan Delivery pertama Anda? " +
        "Silakan pilih salah satu jawaban."
      );

      $("customerPolicySection")
        .scrollIntoView({
          behavior: "smooth",
          block: "center"
        });

      return null;
    }

    if (customerType === "new") {
      if (
        selectedFirstOrderPayment() !== "dp50"
      ) {
        alert(
          "Pelanggan baru dengan pembayaran Cash " +
          "wajib DP minimal 50%."
        );

        return null;
      }

      return {
        customerType: "new",
        paymentChoice: "dp50"
      };
    }

    if (
      selectedFirstOrderPayment() !== null
    ) {
      alert(
        "Pilihan pembayaran Cash pelanggan lama " +
        "tidak sesuai. Silakan periksa kembali."
      );

      return null;
    }

    return {
      customerType: "returning",
      paymentChoice: null
    };
  }

  // ==========================================
  // SIAPKAN DATA PESANAN
  // ==========================================

  function getOrder() {
    const takeaway = isTakeaway();

    if (!canCheckoutNow()) {
      updateSummary();

      alert(
        "Pemesanan " +
        (
          takeaway
            ? "Takeaway"
            : "Delivery"
        ) +
        " hanya tersedia pukul " +
        SERVICE_HOURS[currentMode()].label +
        ". Silakan kembali saat jam layanan."
      );

      return null;
    }

    if (
      !takeaway &&
      (
        !validRoute() ||
        calculating ||
        route.fee === null
      )
    ) {
      alert(
        "Titik pengiriman atau ongkir belum valid. " +
        "Silakan hitung ulang."
      );

      return null;
    }

    const items = app.getCart();

    if (
      !Array.isArray(items) ||
      !items.length
    ) {
      alert(
        "Pilih menu terlebih dahulu."
      );

      return null;
    }

    const lines = [];
    let subtotal = 0;

    for (const item of items) {
      const product =
        app.getProduct(item.id);

      const qty =
        Number(item.quantity);

      if (
        !product ||
        !Number.isInteger(qty) ||
        qty < 1 ||
        qty > 99
      ) {
        alert(
          "Keranjang tidak valid. " +
          "Periksa kembali jumlah pesanan."
        );

        return null;
      }

      const unitPrice =
        Number(product.price);

      if (
        !Number.isFinite(unitPrice) ||
        unitPrice < 0
      ) {
        alert(
          "Harga salah satu menu tidak valid. " +
          "Silakan muat ulang halaman."
        );

        return null;
      }

      const variant =
        cleanText(
          item.variant || "",
          100
        );

      const category =
        String(
          product.category || ""
        );

      const isFood = [
        "Paket Hemat",
        "Paket Kenyang",
        "Menu Satuan",
        "Menu Mix"
      ].includes(category);

      const temperature =
        item.id === "es-teh" ||
        item.id === "es-jeruk";

      if (
        isFood &&
        !variant
      ) {
        alert(
          "Pilih level kepedasan untuk " +
          product.name +
          "."
        );

        return null;
      }

      if (
        temperature &&
        !["Es", "Panas"].includes(variant)
      ) {
        alert(
          "Pilih penyajian untuk " +
          product.name +
          "."
        );

        return null;
      }

      const itemTotal =
        unitPrice * qty;

      subtotal += itemTotal;

      lines.push({
        name: cleanText(
          product.name,
          120
        ),
        qty,
        unitPrice,
        itemTotal,
        variant,
        temperature
      });
    }

    if (subtotal !== cartSubtotal()) {
      alert(
        "Total keranjang berubah. " +
        "Silakan periksa ulang pesanan."
      );

      return null;
    }

    if (
      subtotal <= 0 ||
      subtotal > 5000000
    ) {
      alert(
        "Total belanja tidak valid."
      );

      return null;
    }

    if (
      !takeaway &&
      subtotal < minimumSubtotal(route.km)
    ) {
      alert(
        "Untuk jarak ini minimal belanja " +
        rupiah(
          minimumSubtotal(route.km)
        ) +
        "."
      );

      return null;
    }

    const name =
      cleanText(
        $("customerName").value,
        100
      );

    const phone =
      normalizePhone(
        $("customerPhone").value
      );

    const address =
      takeaway
        ? ""
        : cleanText(
            $("customerAddress").value,
            500
          );

    const notes =
      cleanText(
        $("customerNotes").value,
        400
      ) || "-";

    const payment = selectedPayment();
    const outlet = selectedOutlet();

    if (name.length < 2) {
      alert(
        "Isi nama pemesan terlebih dahulu."
      );

      $("customerName").focus();

      return null;
    }

    if (!phone) {
      alert(
        "Nomor WhatsApp tidak valid. " +
        "Gunakan format 08xxxxxxxxxx."
      );

      $("customerPhone").focus();

      return null;
    }

    if (
      !takeaway &&
      address.length < 5
    ) {
      alert(
        "Isi alamat pengiriman lengkap " +
        "beserta patokan."
      );

      $("customerAddress").focus();

      return null;
    }

    if (!outlet) {
      alert(
        "Pilih outlet yang tersedia."
      );

      return null;
    }

    // ========================================
    // VALIDASI JENIS PEMBAYARAN
    // ========================================

    const paymentSelection =
      validatePaymentSelection(
        takeaway,
        payment
      );

    if (!paymentSelection) {
      return null;
    }

    const customerType =
      paymentSelection.customerType;

    const firstOrderChoice =
      paymentSelection.paymentChoice;

    // ========================================
    // WAKTU PENGAMBILAN TAKEAWAY
    // ========================================

    let pickup = "";

    if (takeaway) {
      const when =
        $("pickupWhen").value;

      if (when === "secepatnya") {
        pickup =
          "Secepatnya (menunggu konfirmasi admin)";

      } else if (when === "jadwal") {
        const time =
          $("pickupTime").value;

        if (
          !/^([01]\d|2[0-3]):[0-5]\d$/.test(
            time
          )
        ) {
          alert(
            "Pilih perkiraan jam pengambilan " +
            "terlebih dahulu."
          );

          $("pickupTime").focus();

          return null;
        }

        pickup =
          time +
          " WIB (menunggu konfirmasi admin)";

      } else {
        alert(
          "Pilih waktu pengambilan."
        );

        return null;
      }
    }

    // ========================================
    // TOTAL DAN PEMBAYARAN AWAL
    // ========================================

    const fee =
      takeaway
        ? 0
        : route.fee;

    const total = subtotal + fee;

    const paymentPlan =
      calculateInitialPayment(
        total,
        payment,
        customerType,
        takeaway
      );

    if (!paymentPlan) {
      alert(
        "Nominal pembayaran belum dapat dihitung."
      );

      return null;
    }

    // ========================================
    // DATA PESANAN FINAL
    // ========================================

    return {
      takeaway,
      outlet,
      name,
      phone,
      address,
      notes,
      payment,

      items: lines,

      subtotal,
      fee,
      total,

      km: takeaway
        ? null
        : route.km,

      roundedKm: takeaway
        ? null
        : roundedDistance(route.km),

      mapsLink: takeaway
        ? ""
        : $("mapsLink").value,

      pickup,

      customerType,
      firstOrderChoice,
      paymentPlan
    };
  }

  // ==========================================
  // FORMAT PESAN WHATSAPP
  // ==========================================

  function whatsappMessage(order) {
    const message = [
      "Halo Kak, saya mau pesan " +
        (
          order.takeaway
            ? "Takeaway"
            : "Delivery Order"
        ) +
        " Lambe Turah.",

      "",

      "*PESANAN " +
        (
          order.takeaway
            ? "TAKEAWAY"
            : "DELIVERY"
        ) +
        " — LAMBE TURAH*",

      "Outlet: " +
        order.outlet.name,

      "",

      "*RINCIAN PESANAN*",
      "------------------------"
    ];

    // ========================================
    // DAFTAR MENU
    // ========================================

    order.items.forEach(
      (item, index) => {
        message.push(
          (index + 1) +
          ". *" +
          item.name +
          "* x " +
          item.qty
        );

        if (item.variant) {
          message.push(
            "   " +
            (
              item.temperature
                ? "Penyajian: "
                : "Level: "
            ) +
            item.variant
          );
        }

        message.push(
          "   " +
          rupiah(item.itemTotal),
          ""
        );
      }
    );

    // ========================================
    // RINGKASAN PEMBAYARAN
    // ========================================

    message.push(
      "*RINCIAN PEMBAYARAN*",
      "------------------------",

      "Subtotal: " +
        rupiah(order.subtotal),

      "Ongkir: " +
        rupiah(order.fee),

      "*TOTAL ESTIMASI: " +
        rupiah(order.total) +
        "*",

      "Metode: " +
        (
          order.payment === "QRIS"
            ? "QRIS Dinamis"
            : "Cash"
        ),

      ""
    );

    // ========================================
    // QRIS — TANPA STATUS PELANGGAN
    // ========================================

    if (order.payment === "QRIS") {
      message.push(
        "*PEMBAYARAN QRIS*",
        "------------------------",

        "Pembayaran penuh sesuai total pesanan.",

        "Nominal QRIS estimasi: " +
          rupiah(order.paymentPlan.initial),

        "Status: MENUNGGU PEMBAYARAN",

        "Mohon admin mengirimkan QRIS dinamis " +
          "setelah pesanan dikonfirmasi.",

        "Pembayaran akan segera dilakukan " +
          "sebelum QRIS kedaluwarsa.",

        ""
      );
    }

    // ========================================
    // CASH DELIVERY PELANGGAN BARU
    // ========================================

    if (
      !order.takeaway &&
      order.payment === "Cash" &&
      order.customerType === "new"
    ) {
      message.push(
        "*PEMBAYARAN CASH — PELANGGAN BARU*",
        "------------------------",

        "Status: Delivery pertama",

        "DP minimal 50%: " +
          rupiah(order.paymentPlan.initial),

        "Sisa tunai saat diterima: " +
          rupiah(order.paymentPlan.remaining),

        "Pembayaran DP: Transfer",

        "Status DP: BELUM DIVERIFIKASI",

        "Mohon admin mengirimkan " +
          "instruksi transfer DP " +
          "setelah pesanan dikonfirmasi.",

        ""
      );
    }

    // ========================================
    // CASH DELIVERY PELANGGAN LAMA
    // ========================================

    if (
      !order.takeaway &&
      order.payment === "Cash" &&
      order.customerType === "returning"
    ) {
      message.push(
        "*PEMBAYARAN CASH*",
        "------------------------",

        "Status: Sudah pernah melakukan DO",

        "Pembayaran tunai saat pesanan diterima.",

        "Mohon admin memverifikasi " +
          "riwayat pemesanan pelanggan.",

        ""
      );
    }

    // ========================================
    // TAKEAWAY CASH
    // ========================================

    if (
      order.takeaway &&
      order.payment === "Cash"
    ) {
      message.push(
        "*PEMBAYARAN CASH*",
        "------------------------",

        "Pembayaran tunai saat " +
          "mengambil pesanan di outlet.",

        ""
      );
    }

    // ========================================
    // DATA PENGAMBILAN / PENGIRIMAN
    // ========================================

    if (order.takeaway) {
      message.push(
        "*DATA PENGAMBILAN*",
        "------------------------",

        "Nama: " +
          order.name,

        "No. WhatsApp: " +
          order.phone,

        "Pengambilan: Outlet " +
          order.outlet.name,

        "Perkiraan waktu: " +
          order.pickup,

        "Catatan: " +
          order.notes,

        "",

        "Mohon admin konfirmasi " +
          "ketersediaan menu, total akhir, " +
          "dan waktu pesanan siap diambil."
      );

    } else {
      message.push(
        "*DATA PENGIRIMAN*",
        "------------------------",

        "Nama: " +
          order.name,

        "No. WhatsApp: " +
          order.phone,

        "Alamat: " +
          order.address,

        "Lokasi Google Maps:",
        order.mapsLink,

        "Jarak rute: " +
          order.km.toFixed(2) +
          " km",

        "Jarak tarif: " +
          order.roundedKm +
          " km",

        "Tarif ongkir: " +
          rupiah(order.fee),

        "Catatan: " +
          order.notes,

        "",

        "Mohon admin konfirmasi " +
          "ketersediaan menu, ongkir, " +
          "dan total akhir."
      );
    }

    // ========================================
    // PENUTUP DAN INSTRUKSI
    // ========================================

    message.push("");

    if (order.payment === "QRIS") {
      message.push(
        "Pesanan diproses setelah " +
        "pembayaran QRIS diverifikasi admin."
      );

    } else if (
      !order.takeaway &&
      order.customerType === "new"
    ) {
      message.push(
        "Pesanan diproses setelah " +
        "DP transfer diverifikasi admin."
      );

    } else {
      message.push(
        "Pesanan diproses setelah " +
        "dikonfirmasi admin outlet."
      );
    }

    message.push(
      "",
      "Terima kasih."
    );

    return message.join("\n");
  }

  // ==========================================
  // DETAIL PEMBAYARAN KONFIRMASI
  // ==========================================

  function confirmationPaymentDetail(order) {
    if (order.payment === "QRIS") {
      return (
        "Pembayaran: QRIS Dinamis\n" +
        "Bayar sesuai total: " +
        rupiah(order.total) +
        "\n" +
        "QRIS dikirim admin setelah konfirmasi\n" +
        "Segera bayar sebelum kedaluwarsa"
      );
    }

    if (
      !order.takeaway &&
      order.customerType === "new"
    ) {
      return (
        "Pembayaran: Cash + Transfer DP\n" +
        "DP minimal 50%: " +
        rupiah(order.paymentPlan.initial) +
        "\n" +
        "Sisa tunai saat diterima: " +
        rupiah(order.paymentPlan.remaining) +
        "\n" +
        "Transfer setelah instruksi admin"
      );
    }

    if (
      !order.takeaway &&
      order.customerType === "returning"
    ) {
      return (
        "Pembayaran: Cash\n" +
        "Status: Sudah pernah pesan\n" +
        "Bayar tunai saat diterima\n" +
        "Riwayat pelanggan diverifikasi admin"
      );
    }

    return (
      "Pembayaran: Cash\n" +
      "Bayar tunai saat mengambil pesanan"
    );
  }

  // ==========================================
  // CHECKOUT LANGSUNG KE WHATSAPP
  // ==========================================

  checkout.addEventListener(
    "click",
    () => {
      if (
        preparingWhatsApp ||
        (
          !isTakeaway() &&
          calculating
        )
      ) {
        return;
      }

      // Pemeriksaan jam pertama.

      if (!canCheckoutNow()) {
        updateSummary();

        const hours =
          SERVICE_HOURS[currentMode()];

        alert(
          "Maaf Kak, pemesanan " +
          (
            isTakeaway()
              ? "Takeaway"
              : "Delivery"
          ) +
          " hanya tersedia pukul " +
          hours.label +
          "."
        );

        return;
      }

      const order = getOrder();

      if (!order) {
        return;
      }

      // ========================================
      // DETAIL DELIVERY / TAKEAWAY
      // ========================================

      const detail =
        order.takeaway
          ? "Ambil di outlet: " +
            order.outlet.name +
            "\nPerkiraan waktu: " +
            order.pickup
          : "Jarak tarif: " +
            order.roundedKm +
            " km" +
            "\nOngkir: " +
            rupiah(order.fee);

      const paymentDetail =
        confirmationPaymentDetail(order);

      // ========================================
      // KONFIRMASI PEMESANAN
      // ========================================

      const ok =
        window.confirm(
          "KONFIRMASI PESANAN LAMBE TURAH\n\n" +

          "Jenis: " +
          (
            order.takeaway
              ? "TAKEAWAY"
              : "DELIVERY"
          ) +
          "\n" +

          "Outlet: " +
          order.outlet.name +
          "\n" +

          detail +
          "\n" +

          "Subtotal: " +
          rupiah(order.subtotal) +
          "\n" +

          "Total estimasi: " +
          rupiah(order.total) +
          "\n\n" +

          paymentDetail +
          "\n\n" +

          "WhatsApp outlet akan dibuka " +
          "dengan rincian pesanan. " +
          "Pastikan menekan Kirim agar " +
          "admin menerimanya.\n\n" +

          "Lanjutkan?"
        );

      if (!ok) {
        return;
      }

      // Pemeriksaan jam setelah konfirmasi.

      if (!canCheckoutNow()) {
        updateSummary();

        alert(
          "Maaf Kak, jam pemesanan " +
          "sudah berakhir. Silakan kembali " +
          "saat layanan dibuka."
        );

        return;
      }

      // ========================================
      // URL WHATSAPP OUTLET
      // ========================================

      const url =
        "https://wa.me/" +
        order.outlet.whatsapp +
        "?text=" +
        encodeURIComponent(
          whatsappMessage(order)
        );

      preparingWhatsApp = true;

      updateSummary();

      /*
       * WhatsApp dibuka melalui navigasi
       * di tab yang sama agar sesuai dengan
       * alur sebelumnya pada iPhone/Android.
       */

      window.location.assign(url);
    }
  );

  // ==========================================
  // KEMBALI DARI WHATSAPP
  // ==========================================

  window.addEventListener(
    "pageshow",
    () => {
      preparingWhatsApp = false;
      updateSummary();
    }
  );

  // ==========================================
  // INISIALISASI
  // ==========================================

  ensureHoursElement();
  updatePaymentInfo();
  updateSummary();

})();
