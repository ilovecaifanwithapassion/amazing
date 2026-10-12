# TroliPintar - Smart Grocery & Budget Safety Tracker (PWA)

Aplikasi web mobile (Progressive Web App - PWA) bergaya *native app* yang dirancang khusus untuk seorang siswa rantau saat berbelanja bulanan sambil mendorong troli supermarket.

## 📱 Arsitektur & Tampilan Mobile
- **Format Layar Smartphone:** Lebar maksimal 430px (terpusat secara elegan di browser desktop).
- **Bottom Navigation Bar:** Navigasi melayang di bagian bawah layar (Belanja, Riwayat, Anggaran).
- **Ergonomi Satu Jempol:** Tombol sentuh ramah jempol (touch-friendly), input angka besar, stepper kuantitas (+/-), dan layout kartu responsif tanpa tabel desktop yang melebar.
- **Dukungan PWA & Offline:** Dilengkapi `manifest.json`, Service Worker (`sw.js`) dengan strategi Network-First, dan dukungan *Add to Home Screen*.

## ✨ Kebutuhan Fungsional (Sesuai SRS)
- **F-01: Pencatatan Item Belanja Lengkap:** Menyimpan nama produk, kategori barang, satuan (kg, liter, pcs, pack, gram, btl, dus, ikat), kuantitas, harga satuan, dan catatan.
- **F-02: Perhitungan Kuantitas Otomatis:** Perubahan angka kuantitas (Qty) langsung mengalikan harga satuan secara realtime ke total baris item dan ringkasan keranjang.
- **F-03: Kalkulator Diskon Bertingkat:** Menangani diskon tunggal (contoh: 25%) maupun diskon bertumpuk (contoh: 50% + 20%) dengan rumus matematis yang tepat: $P \times (1 - d_1) \times (1 - d_2)$.
- **F-04: Komparator Harga Realtime vs Bulan Lalu:**
  - 🔴 Panah Merah Naik (↑): Jika harga naik dibanding bulan lalu.
  - 🟢 Panah Hijau Turun (↓): Jika harga turun dibanding bulan lalu.
  - ⚪ Tanda Setara (=): Jika harga stabil.
  - ✨ Item Baru: Jika belum ada data bulan lalu.
- **F-05: Pengendali Anggaran (Safety Cap):** Input batas maksimal dompet dengan indikator warna visual:
  - 🟢 Hijau: Aman (< 75%)
  - 🟡 Kuning: Waspada (75% - 90%)
  - 🔴 Merah Berkedip: Batas Kritis / OVER BUDGET (> 90% - 100%+) disertai getaran haptik dan nada peringatan.
- **F-06: Riwayat & Database Belanja:** Data belanja tersimpan rapi ke dalam penyimpanan lokal (`localStorage`) agar menjadi data pembanding resmi untuk bulan berikutnya, dilengkapi fitur *Restock Template* dan ekspor data JSON.

## 🚀 Cara Menjalankan
Jalankan server lokal dengan Node.js:
```bash
node smart-grocery-pwa/server.js
```
Buka browser di:
`http://127.0.0.1:3000`
