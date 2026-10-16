
(() => {
  "use strict";

  /*
   * CEKER & KERANG PEDAS LAMBE TURAH
   * DELIVERY.JS v9.3
   *
   * CHECKOUT LANGSUNG KE WHATSAPP
   * TANPA GOOGLE APPS SCRIPT
   * TANPA DATABASE
   *
   * PEMBARUAN v9.3:
   * - Jam Delivery: 10.00–20.00 WIB.
   * - Jam Takeaway: 10.00–21.30 WIB.
   * - Katalog dan keranjang tetap tersedia 24 jam.
   * - Checkout ditutup otomatis di luar jam layanan.
   * - Informasi jam operasional mengikuti jenis pesanan.
   * - Menawarkan Takeaway ketika Delivery sudah tutup.
   * - Jam dicek ulang sebelum WhatsApp dibuka.
   *
   * Memerlukan window.LAMBE_APP dari index.html:
   * getOutlet(), getMode(), getCart(),
   * getProduct(id), getSubtotal().
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
  const MINIMUM_ABOVE_7_KM = 75000;
  const ROUTE_TIMEOUT_MS = 15000;

  // ==========================================
  // JAM OPERASIONAL WIB
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

  // Periksa ulang setiap 15 detik.
  const HOURS_REFRESH_MS = 15000;

  // ==========================================
  // KONEKSI INDEX.HTML
  // ==========================================

  const app = window.LAMBE_APP;

  const $ = id => document.getElementById(id);

  const requiredFunctions = [
    "getOutlet",
    "getMode",
    "getCart",
    "getProduct",
    "getSubtotal"
  ];

  if (
    !app ||
    requiredFunctions.some(
      name => typeof app[name] !== "function"
    )
  ) {
    console.error(
      "LAMBE_APP belum tersedia atau tidak lengkap."
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
    "pickupTime"
  ];

  if (
    requiredIds.some(id => !$(id))
  ) {
    console.error(
      "Ada elemen checkout yang tidak ditemukan pada index.html."
    );
    return;
  }

  const checkout = $("checkoutButton");

  const rupiah = value =>
    "Rp" +
    Math.round(Number(value) || 0)
      .toLocaleString("id-ID");

  let location = null;
  let route = null;

  let calculating = false;
  let preparingWhatsApp = false;

  let requestSequence = 0;
  let gpsSequence = 0;

  let routeController = null;

  // ==========================================
  // OUTLET DAN MODE PEMESANAN
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
      )?.value || "Cash"
    );
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
    const hours =
      SERVICE_HOURS[mode];

    const minutes =
      currentWIBMinutes();

    if (
      !hours ||
      minutes === null
    ) {
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
  // PESAN JAM OPERASIONAL
  // ==========================================

  /*
   * Elemen informasi jam dibuat otomatis.
   *
   * Dengan demikian delivery.js v9.3
   * tetap bisa digunakan pada index.html
   * v9.2 selama masa pergantian file.
   *
   * Pada index.html v9.3 nanti,
   * elemen dengan ID serviceHoursStatus
   * bisa disediakan secara permanen.
   */

  function ensureHoursElement() {
    let element =
      $("serviceHoursStatus");

    if (element) {
      return element;
    }

    element =
      document.createElement("div");

    element.id =
      "serviceHoursStatus";

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

    const modeHelp =
      $("modeHelp");

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
    const element =
      ensureHoursElement();

    const mode =
      currentMode();

    const status =
      serviceStatus(mode);

    const hours =
      SERVICE_HOURS[mode];

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
      } else if (
        status.reason === "after"
      ) {
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
  // PERHITUNGAN ONGKIR
  // ==========================================

  function deliveryFee(km) {
    if (km <= 2) return 2000;
    if (km <= 4) return 3000;
    if (km <= 6) return 5000;
    if (km <= 7) return 7000;

    if (km <= MAX_DISTANCE_KM) {
      return Math.ceil(km) * 1000;
    }

    return null;
  }

  function minimumSubtotal(km) {
    return km > 7
      ? MINIMUM_ABOVE_7_KM
      : 0;
  }

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
    const element =
      $("locationStatus");

    element.className =
      "status" +
      (kind ? " " + kind : "");

    element.textContent = message;
  }

  // ==========================================
  // INFORMASI PEMBAYARAN
  // ==========================================

  function updatePaymentInfo() {
    const takeaway =
      isTakeaway();

    $("paymentInfo").textContent =
      selectedPayment() === "QRIS"
        ? "QRIS dinamis akan dikirim admin setelah pesanan dan total pembayaran dikonfirmasi. Jangan membayar sebelum mendapat arahan admin."
        : takeaway
          ? "Pembayaran tunai saat mengambil pesanan di outlet. Waktu pengambilan dan total akhir dikonfirmasi admin."
          : "Pembayaran tunai saat pesanan diterima. Total akhir dikonfirmasi admin.";
  }

  // ==========================================
  // RINGKASAN DAN STATUS CHECKOUT
  // ==========================================

  function updateSummary() {
    const subtotal =
      cartSubtotal();

    const takeaway =
      isTakeaway();

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
          minimumSubtotal(
            currentRoute.km
          );

        let details =
          "Jarak rute estimasi: " +
          currentRoute.km.toFixed(2) +
          " km | Ongkir: " +
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
              rupiah(
                minimum - subtotal
              );
          }
        }

        $("distanceSummary").textContent =
          details;
      }
    }

    // Jam layanan selalu menjadi syarat checkout.

    const hoursStatus =
      serviceStatus();

    if (preparingWhatsApp) {
      checkout.disabled = true;
      checkout.textContent =
        "Membuka WhatsApp...";
    } else if (!hoursStatus.open) {
      checkout.disabled = true;

      if (
        hoursStatus.reason === "before"
      ) {
        checkout.textContent =
          "Pemesanan Dibuka Pukul 10.00 WIB";
      } else if (
        hoursStatus.reason === "after"
      ) {
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
    } else if (
      subtotal <= 0
    ) {
      checkout.disabled = true;
      checkout.textContent =
        "Pilih Menu Terlebih Dahulu";
    } else if (
      !takeaway &&
      subtotal <
        minimumSubtotal(
          currentRoute.km
        )
    ) {
      checkout.disabled = true;
      checkout.textContent =
        "Minimal Order " +
        rupiah(
          minimumSubtotal(
            currentRoute.km
          )
        );
    } else {
      checkout.disabled = false;

      checkout.textContent =
        takeaway
          ? "Pesan Takeaway via WhatsApp"
          : "Kirim Pesanan via WhatsApp";
    }

    updateHoursInfo();
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

    const sequence =
      requestSequence;

    if (!location) {
      setLocationStatus(
        "Silakan tentukan lokasi pengiriman.",
        "error"
      );
      return;
    }

    const outlet =
      selectedOutlet();

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

    const requestedOutlet =
      outletKey();

    calculating = true;

    updateSummary();

    setLocationStatus(
      "Menghitung jarak melalui rute jalan..."
    );

    const controller =
      new AbortController();

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

      const data =
        await response.json();

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

      if (
        sequence !== requestSequence
      ) {
        return;
      }

      const km =
        meters / 1000;

      const fee =
        deliveryFee(km);

      route = {
        outlet: requestedOutlet,
        latitude:
          requestedLocation.latitude,
        longitude:
          requestedLocation.longitude,
        km,
        fee
      };

      setLocationStatus(
        fee === null
          ? "Jarak " +
            km.toFixed(2) +
            " km di luar jangkauan maksimal 9 km."
          : "Lokasi ditemukan. Jarak " +
            km.toFixed(2) +
            " km, ongkir estimasi " +
            rupiah(fee) +
            ".",
        fee === null
          ? "error"
          : "success"
      );

    } catch (error) {
      if (
        sequence !== requestSequence
      ) {
        return;
      }

      route = null;

      setLocationStatus(
        "Ongkir belum dapat dihitung. Periksa koneksi internet dan coba Hitung Ulang Ongkir. " +
        (
          error.name === "AbortError"
            ? "Layanan rute terlalu lama merespons."
            : error.message
        ),
        "error"
      );

    } finally {
      clearTimeout(timeout);

      if (
        sequence === requestSequence
      ) {
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
          "Browser tidak mendukung akses lokasi. Jika membuka dari Instagram, pilih menu titik tiga untuk membuka website melalui Safari atau Chrome.",
          "error"
        );
        return;
      }

      if (
        !window.isSecureContext
      ) {
        setLocationStatus(
          "Layanan lokasi membutuhkan HTTPS. Buka website melalui alamat resminya.",
          "error"
        );
        return;
      }

      const sequence =
        ++gpsSequence;

      invalidateRoute();

      setLocationStatus(
        "Meminta titik lokasi. Pilih Izinkan saat browser meminta akses GPS."
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
            "Lokasi belum dapat diperoleh. Silakan coba kembali.";

          if (
            error.code === 1
          ) {
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

          if (
            error.code === 2
          ) {
            message =
              "GPS belum tersedia. " +
              "Coba di tempat lebih terbuka.";
          }

          if (
            error.code === 3
          ) {
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
          "Outlet diganti. Gunakan lokasi untuk menghitung ongkir."
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
      } else if (
        !isTakeaway()
      ) {
        setLocationStatus(
          "Silakan gunakan lokasi Anda untuk menghitung ongkir."
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
  // PERUBAHAN PEMBAYARAN
  // ==========================================

  document
    .querySelectorAll(
      'input[name="payment"]'
    )
    .forEach(input => {
      input.addEventListener(
        "change",
        updatePaymentInfo
      );
    });

  // ==========================================
  // PEMERIKSAAN JAM SECARA BERKALA
  // ==========================================

  setInterval(
    () => {
      updateSummary();
    },
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

    if (
      digits.startsWith("62")
    ) {
      digits =
        "0" + digits.slice(2);
    }

    return /^08\d{8,11}$/.test(
      digits
    )
      ? digits
      : "";
  }

  // ==========================================
  // SIAPKAN DATA PESANAN
  // ==========================================

  function getOrder() {
    const takeaway =
      isTakeaway();

    // Pemeriksaan jam pertama.
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
        "Titik pengiriman atau ongkir belum valid. Silakan hitung ulang."
      );
      return null;
    }

    const items =
      app.getCart();

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
          "Keranjang tidak valid. Periksa kembali jumlah pesanan."
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
          "Harga salah satu menu tidak valid. Silakan muat ulang halaman."
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

    if (
      subtotal !== cartSubtotal()
    ) {
      alert(
        "Total keranjang berubah. Silakan periksa ulang pesanan."
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
      subtotal <
      minimumSubtotal(route.km)
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

    const payment =
      selectedPayment();

    const outlet =
      selectedOutlet();

    if (
      name.length < 2
    ) {
      alert(
        "Isi nama pemesan terlebih dahulu."
      );

      $("customerName").focus();

      return null;
    }

    if (!phone) {
      alert(
        "Nomor WhatsApp tidak valid. Gunakan format 08xxxxxxxxxx."
      );

      $("customerPhone").focus();

      return null;
    }

    if (
      !takeaway &&
      address.length < 5
    ) {
      alert(
        "Isi alamat pengiriman lengkap beserta patokan."
      );

      $("customerAddress").focus();

      return null;
    }

    if (
      !["Cash", "QRIS"].includes(payment) ||
      !outlet
    ) {
      alert(
        "Pilih outlet dan metode pembayaran yang tersedia."
      );
      return null;
    }

    // ========================================
    // WAKTU PENGAMBILAN TAKEAWAY
    // ========================================

    let pickup = "";

    if (takeaway) {
      const when =
        $("pickupWhen").value;

      if (
        when === "secepatnya"
      ) {
        pickup =
          "Secepatnya (menunggu konfirmasi admin)";
      } else if (
        when === "jadwal"
      ) {
        const time =
          $("pickupTime").value;

        if (
          !/^([01]\d|2[0-3]):[0-5]\d$/.test(
            time
          )
        ) {
          alert(
            "Pilih perkiraan jam pengambilan terlebih dahulu."
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

    const fee =
      takeaway
        ? 0
        : route.fee;

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
      km: takeaway
        ? null
        : route.km,
      fee,
      total: subtotal + fee,
      mapsLink: takeaway
        ? ""
        : $("mapsLink").value,
      pickup
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

        "Mohon admin konfirmasi ketersediaan menu, total akhir, dan waktu pesanan siap diambil."
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

        "Jarak estimasi: " +
          order.km.toFixed(2) +
          " km",

        "Catatan: " +
          order.notes,

        "",

        "Mohon admin konfirmasi ketersediaan menu, ongkir, dan total akhir."
      );
    }

    if (
      order.payment === "QRIS"
    ) {
      message.push(
        "Saya menunggu QRIS dinamis dari admin setelah pesanan dikonfirmasi."
      );
    } else {
      message.push(
        order.takeaway
          ? "Pembayaran tunai saat mengambil pesanan di outlet."
          : "Pembayaran tunai saat pesanan diterima."
      );
    }

    message.push(
      "Terima kasih."
    );

    return message.join("\n");
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

      // Pemeriksaan jam sebelum validasi.
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

      const order =
        getOrder();

      if (!order) return;

      const detail =
        order.takeaway
          ? "Ambil di outlet: " +
            order.outlet.name +
            "\nPerkiraan waktu: " +
            order.pickup
          : "Ongkir estimasi: " +
            rupiah(order.fee);

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
          "\n" +

          "Pembayaran: " +
          order.payment +
          "\n\n" +

          "WhatsApp outlet akan dibuka dengan rincian pesanan. " +
          "Pastikan menekan Kirim agar admin menerimanya.\n\n" +

          "Lanjutkan?"
        );

      if (!ok) return;

      // Pemeriksaan jam terakhir setelah
      // dialog konfirmasi ditutup.
      // Mencegah checkout jika waktu
      // melewati jam tutup saat dialog tampil.

      if (!canCheckoutNow()) {
        updateSummary();

        alert(
          "Maaf Kak, jam pemesanan sudah berakhir. " +
          "Silakan kembali saat layanan dibuka."
        );

        return;
      }

      const url =
        "https://wa.me/" +
        order.outlet.whatsapp +
        "?text=" +
        encodeURIComponent(
          whatsappMessage(order)
        );

      preparingWhatsApp = true;

      updateSummary();

      // Buka WhatsApp di tab yang sama
      // agar lebih kompatibel dengan
      // browser iPhone dan Android.

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
