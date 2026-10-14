(() => {
  "use strict";

  /*
   * LAMBE TURAH — DELIVERY ORDER v6.0
   * Integrasi Google Spreadsheet + WhatsApp
   */

  const API_URL =
    "https://script.google.com/macros/s/AKfycbxeNI9gVEryLDCAZNNXTZiKzUG2mTCu5V4o7HTiSssHgAmh6o_e7W8idEBoG3_jml69eQ/exec";

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

  const rp = amount =>
    "Rp" + Math.round(Number(amount) || 0)
      .toLocaleString("id-ID");

  let customerLocation = null;
  let calculatedRoute = null;
  let calculating = false;
  let submitting = false;
  let routeRequestId = 0;

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

  function calculateFee(distanceKm) {
    if (distanceKm <= 2) return 2000;
    if (distanceKm <= 4) return 3000;
    if (distanceKm <= 6) return 5000;
    if (distanceKm <= 7) return 7000;

    if (distanceKm <= 9) {
      return Math.ceil(distanceKm) * 1000;
    }

    return null;
  }

  function minimumOrder(distanceKm) {
    return distanceKm > 7 ? 75000 : 0;
  }

  function setLocationStatus(message, type = "") {
    const element = $("locationStatus");

    element.className = "status " + type;
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

  function updatePaymentInfo() {
    const payment = paymentMethod();

    $("paymentInfo").textContent =
      payment === "QRIS"
        ? "📱 Pembayaran QRIS dinamis. Setelah admin memastikan ketersediaan menu, ketepatan titik pengiriman, dan nominal akhir, admin akan mengirimkan QRIS sesuai jumlah pembayaran. Jangan membayar sebelum menerima konfirmasi."
        : "💵 Pembayaran tunai saat pesanan diterima. Total pembayaran akan dikonfirmasi oleh admin outlet.";
  }

  function updateSummary() {
    const foodTotal = subtotal();

    $("summarySubtotal").textContent = rp(foodTotal);

    const route = routeIsValid()
      ? calculatedRoute
      : null;

    const fee = route ? route.fee : null;

    $("summaryShipping").textContent =
      fee === null
        ? "Belum tersedia"
        : rp(fee);

    $("summaryTotal").textContent =
      rp(foodTotal + (fee === null ? 0 : fee));

    if (!route) {
      $("distanceSummary").textContent =
        "Jarak dan ongkir menunggu lokasi pengiriman.";
    } else {
      const requiredMinimum = minimumOrder(route.km);

      let description =
        "Jarak rute estimasi: " +
        route.km.toFixed(2) +
        " km | Ongkir: " +
        (fee === null ? "Di luar jangkauan" : rp(fee));

      if (requiredMinimum > 0) {
        description +=
          " | Minimal belanja: " +
          rp(requiredMinimum);

        if (foodTotal < requiredMinimum) {
          description +=
            " | Kekurangan: " +
            rp(requiredMinimum - foodTotal);
        }
      }

      $("distanceSummary").textContent = description;
    }

    const button = $("checkoutButton");

    if (submitting) {
      button.disabled = true;
      button.textContent = "Mengirim Pesanan...";
      return;
    }

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

    if (fee === null) {
      button.disabled = true;
      button.textContent = "Di Luar Jangkauan Delivery";
      return;
    }

    if (foodTotal <= 0) {
      button.disabled = true;
      button.textContent = "Pilih Menu Terlebih Dahulu";
      return;
    }

    const minimum = minimumOrder(route.km);

    if (foodTotal < minimum) {
      button.disabled = true;
      button.textContent =
        "Minimal Order " + rp(minimum);
      return;
    }

    button.disabled = false;
    button.textContent =
      "💬 Simpan Pesanan & Lanjut ke WhatsApp";
  }

  /*
   * MENGHITUNG JARAK RUTE
   * Menggunakan layanan routing publik OSRM.
   */

  async function calculateRoute() {
    const requestId = ++routeRequestId;

    calculatedRoute = null;

    if (!customerLocation) {
      calculating = false;

      setLocationStatus(
        "Silakan tentukan lokasi pengiriman terlebih dahulu.",
        "error"
      );

      updateSummary();
      return;
    }

    const outlet = currentOutlet();

    if (!outlet) {
      calculating = false;

      setLocationStatus(
        "Outlet tidak ditemukan.",
        "error"
      );

      updateSummary();
      return;
    }

    calculating = true;
    updateSummary();

    setLocationStatus(
      "Lokasi diterima. Sedang menghitung jarak melalui jalan..."
    );

    const lat = customerLocation.lat;
    const lng = customerLocation.lng;
    const outletKey = app.getOutlet();

    try {
      const endpoint =
        "https://router.project-osrm.org/route/v1/driving/" +
        outlet.lng + "," + outlet.lat + ";" +
        lng + "," + lat +
        "?overview=false&steps=false";

      const controller = new AbortController();

      const timeout = setTimeout(
        () => controller.abort(),
        15000
      );

      let response;

      try {
        response = await fetch(endpoint, {
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

      const result = await response.json();

      const meters = result.routes?.[0]?.distance;

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
          "Lokasi ditemukan, tetapi jarak " +
          km.toFixed(2) +
          " km berada di luar jangkauan delivery maksimal 9 km.",
          "error"
        );
      } else {
        setLocationStatus(
          "✅ Lokasi terdeteksi. Jarak estimasi " +
          km.toFixed(2) +
          " km dengan ongkir " +
          rp(fee) +
          ". Total akhir dikonfirmasi admin.",
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
        "Periksa koneksi lalu coba lagi. " +
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

  /*
   * MENGAMBIL LOKASI PELANGGAN
   */

  $("getLocation").addEventListener("click", () => {
    if (!navigator.geolocation) {
      setLocationStatus(
        "Browser ini tidak mendukung layanan lokasi.",
        "error"
      );
      return;
    }

    if (!window.isSecureContext) {
      setLocationStatus(
        "Akses GPS membutuhkan website HTTPS.",
        "error"
      );
      return;
    }

    setLocationStatus(
      "Sedang meminta lokasi. Pilih Izinkan apabila muncul pemberitahuan."
    );

    navigator.geolocation.getCurrentPosition(
      position => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;

        if (
          !Number.isFinite(lat) ||
          !Number.isFinite(lng)
        ) {
          setLocationStatus(
            "Titik lokasi tidak valid.",
            "error"
          );
          return;
        }

        customerLocation = { lat, lng };

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
            "Izin lokasi ditolak. Aktifkan izin lokasi untuk Safari atau browser, kemudian coba lagi.";
        } else if (error.code === 2) {
          message =
            "Sinyal GPS belum tersedia. Coba berada di lokasi yang lebih terbuka.";
        } else if (error.code === 3) {
          message =
            "Pengambilan lokasi terlalu lama. Silakan coba kembali.";
        }

        setLocationStatus(message, "error");
        updateSummary();
      },

      {
        enableHighAccuracy: true,
        timeout: 18000,
        maximumAge: 0
      }
    );
  });

  $("recalculate").addEventListener(
    "click",
    calculateRoute
  );

  /*
   * OUTLET DAN KERANJANG
   */

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
          "Outlet diperbarui. Gunakan lokasi untuk menghitung ongkir."
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

  /*
   * VALIDASI DATA PELANGGAN
   */

  function cleanText(value) {
    return String(value || "").trim();
  }

  function validPhone(value) {
    const digits = value.replace(/[^\d]/g, "");

    return (
      /^08\d{8,11}$/.test(digits) ||
      /^628\d{8,11}$/.test(digits)
    );
  }

  function validateOrder() {
    if (!routeIsValid()) {
      alert(
        "Lokasi dan ongkir belum valid. Silakan hitung ulang."
      );
      return null;
    }

    const route = calculatedRoute;

    if (route.fee === null) {
      alert(
        "Lokasi berada di luar jangkauan delivery."
      );
      return null;
    }

    const items = app.getCart().filter(item =>
      app.getProduct(item.id)
    );

    if (!items.length) {
      alert(
        "Silakan pilih makanan atau minuman terlebih dahulu."
      );
      return null;
    }

    if (
      subtotal() < minimumOrder(route.km)
    ) {
      alert(
        "Minimal belanja untuk jarak ini adalah " +
        rp(minimumOrder(route.km))
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
      cleanText($("customerNotes").value) || "-";

    const payment = paymentMethod();

    if (name.length < 2) {
      alert("Silakan isi nama penerima.");
      $("customerName").focus();
      return null;
    }

    if (!validPhone(phone)) {
      alert(
        "Silakan isi nomor WhatsApp yang valid."
      );
      $("customerPhone").focus();
      return null;
    }

    if (address.length < 5) {
      alert(
        "Silakan isi alamat pengiriman dengan lengkap."
      );
      $("customerAddress").focus();
      return null;
    }

    if (!["Cash", "QRIS"].includes(payment)) {
      alert(
        "Silakan pilih metode pembayaran."
      );
      return null;
    }

    const outletKey = app.getOutlet();

    if (!OUTLETS[outletKey]) {
      alert(
        "Outlet tidak valid. Silakan pilih kembali."
      );
      return null;
    }

    /*
     * Server akan memeriksa harga dan ongkir ulang.
     * Harga dari browser tidak dikirim sebagai
     * sumber kebenaran.
     */

    return {
      outlet: outletKey,
      name,
      phone,
      address,
      notes,
      payment,
      latitude: customerLocation.lat,
      longitude: customerLocation.lng,
      items: items.map(item => ({
        id: item.id,
        quantity: item.quantity,
        variant: item.variant || ""
      }))
    };
  }

  /*
   * PENGIRIMAN KE GOOGLE APPS SCRIPT
   *
   * Menggunakan form POST standar.
   * Browser akan membuka halaman hasil Apps Script.
   * Metode ini tidak membutuhkan CORS fetch.
   */

  function submitToDatabase(order) {
    const form = document.createElement("form");

    form.method = "POST";
    form.action = API_URL;
    form.target = "_self";
    form.style.display = "none";

    const input = document.createElement("input");

    input.type = "hidden";
    input.name = "payload";
    input.value = JSON.stringify(order);

    form.appendChild(input);
    document.body.appendChild(form);

    /*
     * Tombol hanya dapat dipakai sekali
     * selama navigasi berlangsung.
     */

    submitting = true;
    updateSummary();

    form.submit();
  }

  /*
   * TOMBOL CHECKOUT
   */

  $("checkoutButton").addEventListener(
    "click",
    () => {
      if (submitting || calculating) {
        return;
      }

      const order = validateOrder();

      if (!order) {
        return;
      }

      const confirmed = confirm(
        "Pesanan akan dicatat ke database Lambe Turah.\n\n" +
        "Setelah berhasil dicatat, Anda akan diarahkan ke halaman untuk melanjutkan pengiriman pesanan melalui WhatsApp.\n\n" +
        "Lanjutkan?"
      );

      if (!confirmed) {
        return;
      }

      submitToDatabase(order);
    }
  );

  updatePaymentInfo();
  updateSummary();

})();
