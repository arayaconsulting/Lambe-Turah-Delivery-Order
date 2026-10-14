
(() => {
  "use strict";

  /*
   * ======================================
   * LAMBE TURAH — DELIVERY ORDER v8.0
   * STABLE CHECKOUT
   * ======================================
   *
   * Frontend: GitHub Pages
   * Backend : Google Apps Script
   *
   * Fitur:
   * - Pilihan outlet
   * - GPS pelanggan
   * - Jarak jalan OSRM
   * - Ongkir otomatis
   * - Minimal belanja berdasarkan jarak
   * - Cash / QRIS Dinamis
   * - Penyimpanan pesanan langsung
   * - WhatsApp Bantuan melayang
   *
   * STRATEGI CHECKOUT:
   *
   * Website
   *   ↓ POST FORM
   * Google Apps Script
   *   ↓
   * Google Spreadsheet
   *   ↓
   * Halaman hasil Apps Script
   *
   * Tidak memakai iframe tersembunyi,
   * fetch lintas origin, atau postMessage.
   */

  // =====================================
  // 1. KONFIGURASI
  // =====================================

  const API_URL =
    "https://script.google.com/macros/s/AKfycbxeNI9gVEryLDCAZNNXTZiKzUG2mTCu5V4o7HTiSssHgAmh6o_e7W8idEBoG3_jml69eQ/exec";

  const HELP_PHONE = "6285232526003";

  const HELP_MESSAGE =
    "Halo Kak, saya mau tanya seputar " +
    "pemesanan Delivery Order Lambe Turah. " +
    "Bisa dibantu, Kak? 😊";

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

  const $ = id =>
    document.getElementById(id);

  if (!app) {
    console.error(
      "LAMBE_APP tidak tersedia. " +
      "Periksa index.html."
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

  // =====================================
  // 2. STATUS APLIKASI
  // =====================================

  let customerLocation = null;

  let calculatedRoute = null;

  let calculating = false;

  let submitting = false;

  let routeRequestId = 0;

  // =====================================
  // 3. DATA OUTLET DAN PEMBAYARAN
  // =====================================

  function getOutletKey() {
    return app.getOutlet();
  }

  function currentOutlet() {
    return OUTLETS[getOutletKey()];
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

    if (paymentMethod() === "QRIS") {
      element.textContent =
        "📱 QRIS dinamis akan dikirim oleh " +
        "admin setelah pesanan diverifikasi. " +
        "Jangan melakukan pembayaran " +
        "sebelum menerima arahan admin.";
    } else {
      element.textContent =
        "💵 Pembayaran tunai dilakukan " +
        "saat pesanan diterima. " +
        "Total akhir dikonfirmasi " +
        "oleh admin outlet.";
    }
  }

  // =====================================
  // 4. STATUS LOKASI
  // =====================================

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
      calculatedRoute.outlet === getOutletKey() &&
      calculatedRoute.lat === customerLocation.lat &&
      calculatedRoute.lng === customerLocation.lng
    );
  }

  // =====================================
  // 5. RINGKASAN PESANAN
  // =====================================

  function updateSummary() {
    const foodTotal = subtotal();

    const route = routeIsValid()
      ? calculatedRoute
      : null;

    const fee = route
      ? route.fee
      : null;

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
        "Jarak dan ongkir menunggu " +
        "lokasi pengiriman.";

    } else {
      const minimum =
        minimumOrder(route.km);

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

    // Jika sudah mengirim, tombol tetap
    // terkunci sampai browser berpindah.

    if (submitting) {
      checkout.disabled = true;

      checkout.textContent =
        "⏳ Mengirim Pesanan ke Sistem...";

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

  // =====================================
  // 6. HITUNG JARAK JALAN
  // =====================================

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
      "Sedang menghitung jarak " +
      "melalui rute jalan..."
    );

    const lat = customerLocation.lat;

    const lng = customerLocation.lng;

    const outletKey = getOutletKey();

    try {
      const url =
        "https://router.project-osrm.org/" +
        "route/v1/driving/" +
        outlet.lng + "," + outlet.lat +
        ";" +
        lng + "," + lat +
        "?overview=false&steps=false";

      const controller =
        new AbortController();

      const timeout = setTimeout(
        () => controller.abort(),
        15000
      );

      let response;

      try {
        response = await fetch(
          url,
          {
            signal: controller.signal,
            cache: "no-store"
          }
        );
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

      // Abaikan respons lama apabila
      // outlet/lokasi sudah berubah.

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
          " km berada di luar " +
          "jangkauan delivery maksimal 9 km.",
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

  // =====================================
  // 7. GPS PELANGGAN
  // =====================================

  $("getLocation").addEventListener(
    "click",
    () => {
      if (submitting) return;

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
        "saat browser meminta izin."
      );

      navigator.geolocation.getCurrentPosition(
        position => {
          if (submitting) return;

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
          if (submitting) return;

          ++routeRequestId;

          calculating = false;

          calculatedRoute = null;

          let message =
            "Lokasi belum berhasil diperoleh.";

          if (error.code === 1) {
            message =
              "Izin lokasi ditolak. " +
              "Aktifkan izin lokasi " +
              "di pengaturan browser.";

          } else if (error.code === 2) {
            message =
              "GPS tidak tersedia. " +
              "Coba kembali di tempat " +
              "yang lebih terbuka.";

          } else if (error.code === 3) {
            message =
              "Pengambilan lokasi " +
              "terlalu lama. Silakan coba lagi.";
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
    () => {
      if (!submitting) {
        calculateRoute();
      }
    }
  );

  // =====================================
  // 8. PERUBAHAN OUTLET
  // =====================================

  document.addEventListener(
    "lambe-outlet-updated",
    () => {
      if (submitting) return;

      ++routeRequestId;

      calculatedRoute = null;

      calculating = false;

      updateSummary();

      if (customerLocation) {
        calculateRoute();
      } else {
        setLocationStatus(
          "Outlet diperbarui. " +
          "Tentukan lokasi untuk " +
          "menghitung ongkir."
        );
      }
    }
  );

  // =====================================
  // 9. PERUBAHAN KERANJANG
  // =====================================

  document.addEventListener(
    "lambe-cart-updated",
    updateSummary
  );

  // =====================================
  // 10. METODE PEMBAYARAN
  // =====================================

  document.querySelectorAll(
    'input[name="payment"]'
  ).forEach(input => {
    input.addEventListener(
      "change",
      updatePaymentInfo
    );
  });

  // =====================================
  // 11. VALIDASI DATA PELANGGAN
  // =====================================

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

    if (
      calculatedRoute.fee === null
    ) {
      alert(
        "Lokasi di luar jangkauan delivery."
      );

      return null;
    }

    const items =
      app.getCart().filter(
        item => app.getProduct(item.id)
      );

    if (!items.length) {
      alert(
        "Silakan pilih menu terlebih dahulu."
      );

      return null;
    }

    if (
      subtotal() <
      minimumOrder(calculatedRoute.km)
    ) {
      alert(
        "Minimal belanja untuk jarak ini " +
        rp(
          minimumOrder(
            calculatedRoute.km
          )
        )
      );

      return null;
    }

    const name =
      cleanText(
        $("customerName").value
      );

    const phone =
      cleanText(
        $("customerPhone").value
      );

    const address =
      cleanText(
        $("customerAddress").value
      );

    const notes =
      cleanText(
        $("customerNotes").value
      ) || "-";

    const payment =
      paymentMethod();

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
        "Silakan pilih metode pembayaran."
      );

      return null;
    }

    const outletKey =
      getOutletKey();

    if (!OUTLETS[outletKey]) {
      alert(
        "Outlet tidak valid."
      );

      return null;
    }

    const cleanItems =
      items.map(item => ({
        id: item.id,
        quantity: item.quantity,
        variant: item.variant || ""
      }));

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

      items: cleanItems
    };
  }

  // =====================================
  // 12. TOKEN TRANSAKSI
  // =====================================

  function makeToken() {
    if (
      window.crypto &&
      typeof window.crypto.randomUUID ===
        "function"
    ) {
      return window.crypto.randomUUID();
    }

    if (
      window.crypto &&
      typeof window.crypto.getRandomValues ===
        "function"
    ) {
      const array =
        new Uint32Array(4);

      window.crypto.getRandomValues(
        array
      );

      return Array.from(array)
        .map(number =>
          number.toString(16)
        )
        .join("-");
    }

    throw new Error(
      "Browser tidak mendukung " +
      "pembuatan token transaksi."
    );
  }

  // =====================================
  // 13. KIRIM FORM LANGSUNG
  // =====================================

  function submitToDatabase(order) {
    if (submitting) {
      return;
    }

    let token;

    try {
      token = makeToken();

    } catch (error) {
      alert(error.message);
      return;
    }

    // OrderAPI.gs v3.1 meminta
    // token transaksi yang valid.

    order.clientToken = token;

    /*
     * PERUBAHAN UTAMA V8.0
     *
     * Form dikirim langsung ke Apps Script
     * menggunakan target _self.
     *
     * Browser berpindah ke halaman hasil
     * Google Apps Script.
     *
     * Tidak ada iframe tersembunyi.
     */

    const form =
      document.createElement("form");

    form.method = "POST";

    form.action = API_URL;

    form.target = "_self";

    form.acceptCharset = "UTF-8";

    form.style.display = "none";

    const input =
      document.createElement("input");

    input.type = "hidden";

    input.name = "payload";

    input.value =
      JSON.stringify(order);

    form.appendChild(input);

    document.body.appendChild(form);

    submitting = true;

    updateSummary();

    showSubmissionNotice(
      "Pesanan sedang dikirim ke sistem. " +
      "Tunggu hingga halaman hasil terbuka. " +
      "Jangan menekan tombol kembali, " +
      "refresh, atau checkout ulang."
    );

    try {
      form.submit();

    } catch (error) {
      submitting = false;

      updateSummary();

      showSubmissionNotice(
        "Browser tidak dapat memastikan " +
        "hasil pengiriman. Pesanan mungkin " +
        "sudah tercatat. Jangan checkout " +
        "ulang sebelum memeriksa database " +
        "atau menghubungi WhatsApp Bantuan."
      );

      console.error(
        "Checkout error:",
        error
      );

    } finally {
      form.remove();
    }
  }

  // =====================================
  // 14. INFORMASI PENGIRIMAN
  // =====================================

  function showSubmissionNotice(message) {
    let notice =
      $("lambeSubmissionNotice");

    if (!notice) {
      notice =
        document.createElement("div");

      notice.id =
        "lambeSubmissionNotice";

      notice.setAttribute(
        "role",
        "status"
      );

      notice.style.cssText = [
        "margin-top:16px",
        "padding:17px",
        "background:#fff8e8",
        "color:#705014",
        "border:1px solid #eddba4",
        "border-radius:13px",
        "font-size:13px",
        "line-height:1.75"
      ].join(";");

      checkout.insertAdjacentElement(
        "afterend",
        notice
      );
    }

    notice.textContent = message;
  }

  // =====================================
  // 15. KONFIRMASI SEBELUM CHECKOUT
  // =====================================

  checkout.addEventListener(
    "click",
    () => {
      if (
        submitting ||
        calculating
      ) {
        return;
      }

      const order =
        validateOrder();

      if (!order) return;

      const total =
        subtotal() +
        calculatedRoute.fee;

      const confirmed = confirm(
        "KONFIRMASI PESANAN LAMBE TURAH\n\n" +
        "Outlet: " +
        currentOutlet().name + "\n" +
        "Subtotal: " +
        rp(subtotal()) + "\n" +
        "Ongkir estimasi: " +
        rp(calculatedRoute.fee) + "\n" +
        "Total estimasi: " +
        rp(total) + "\n" +
        "Pembayaran: " +
        paymentMethod() + "\n\n" +
        "Pesanan akan disimpan ke sistem. " +
        "Setelah itu, Anda perlu melanjutkan " +
        "ke WhatsApp untuk mengirim " +
        "rincian pesanan kepada admin.\n\n" +
        "Lanjutkan?"
      );

      if (!confirmed) {
        return;
      }

      submitToDatabase(order);
    }
  );

  // =====================================
  // 16. WHATSAPP BANTUAN MELAYANG
  // =====================================

  function createFloatingHelp() {
    if (
      $("lambeFloatingHelp")
    ) {
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
        color:#fff;
        padding:12px 16px;
        border-radius:999px;
        text-decoration:none;
        font:800 13px Arial,sans-serif;
        box-shadow:0 7px 25px
          rgba(0,0,0,.22);
        border:2px solid white;
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

    document.head.appendChild(
      style
    );

    const link =
      document.createElement("a");

    link.id =
      "lambeFloatingHelp";

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

  // =====================================
  // 17. INISIALISASI
  // =====================================

  createFloatingHelp();

  updatePaymentInfo();

  updateSummary();

})();
