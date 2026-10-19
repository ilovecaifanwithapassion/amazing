/**
 * db.js - Penyimpanan Data & Database Harga Komparasi TroliPintar
 * Menyimpan data keranjang aktif, riwayat belanja bulanan,
 * dan basis data harga bulan lalu untuk komparator realtime.
 */

const DB_KEYS = {
  BUDGET: 'trolipintar_budget_cap',
  CURRENT_CART: 'trolipintar_current_cart',
  HISTORY: 'trolipintar_history',
  BENCHMARKS: 'trolipintar_benchmarks',
  SETTINGS: 'trolipintar_settings'
};

// Data patokan harga bulan lalu (benchmark) standar belanja anak kost/siswa rantau
const DEFAULT_BENCHMARKS = {
  "beras ramos 5kg": { name: "Beras Ramos 5kg", price: 72500, unit: "pack", category: "Bahan Pokok" },
  "beras 5kg": { name: "Beras 5kg", price: 72500, unit: "pack", category: "Bahan Pokok" },
  "telur ayam negeri 1kg": { name: "Telur Ayam Negeri 1kg", price: 28500, unit: "kg", category: "Lauk & Telur" },
  "telur ayam 1kg": { name: "Telur Ayam 1kg", price: 28500, unit: "kg", category: "Lauk & Telur" },
  "minyak goreng 2l": { name: "Minyak Goreng 2L", price: 34000, unit: "pack", category: "Bumbu & Minyak" },
  "minyak goreng 1l": { name: "Minyak Goreng 1L", price: 17500, unit: "btl", category: "Bumbu & Minyak" },
  "indomie goreng": { name: "Indomie Goreng", price: 3100, unit: "pcs", category: "Bahan Pokok" },
  "indomie kuah": { name: "Indomie Kuah", price: 3000, unit: "pcs", category: "Bahan Pokok" },
  "mie sedaap goreng": { name: "Mie Sedaap Goreng", price: 3000, unit: "pcs", category: "Bahan Pokok" },
  "susu uht 1 liter": { name: "Susu UHT 1 Liter", price: 19500, unit: "liter", category: "Minuman & Susu" },
  "susu ultra milk 1l": { name: "Susu Ultra Milk 1L", price: 19500, unit: "liter", category: "Minuman & Susu" },
  "sabun mandi cair 450ml": { name: "Sabun Mandi Cair 450ml", price: 22000, unit: "pack", category: "Perawatan & Sabun" },
  "deterjen bubuk 800g": { name: "Deterjen Bubuk 800g", price: 18500, unit: "pack", category: "Perawatan & Sabun" },
  "sunlight 750ml": { name: "Sunlight 750ml", price: 14500, unit: "pack", category: "Perawatan & Sabun" },
  "pasta gigi pepsodent": { name: "Pasta Gigi Pepsodent", price: 13000, unit: "pcs", category: "Perawatan & Sabun" },
  "shampo 160ml": { name: "Shampo 160ml", price: 24500, unit: "btl", category: "Perawatan & Sabun" },
  "nugget fiesta 500g": { name: "Nugget Fiesta 500g", price: 45000, unit: "pack", category: "Lauk & Telur" },
  "sosis kanzler": { name: "Sosis Kanzler Singles", price: 8500, unit: "pcs", category: "Lauk & Telur" },
  "roti tawar": { name: "Roti Tawar", price: 16000, unit: "pack", category: "Bahan Pokok" },
  "kopi sachet 1 renteng": { name: "Kopi Sachet 1 Renteng", price: 18000, unit: "pack", category: "Minuman & Susu" },
  "air galon isi ulang": { name: "Air Galon Isi Ulang", price: 6000, unit: "galon", category: "Minuman & Susu" },
  "bawang merah 250g": { name: "Bawang Merah 250g", price: 12000, unit: "pack", category: "Sayur & Bumbu" },
  "bawang putih 250g": { name: "Bawang Putih 250g", price: 11500, unit: "pack", category: "Sayur & Bumbu" },
  "cabai rawit 250g": { name: "Cabai Rawit 250g", price: 18000, unit: "pack", category: "Sayur & Bumbu" },
  "kecap manis 520ml": { name: "Kecap Manis 520ml", price: 23000, unit: "pack", category: "Bumbu & Minyak" },
  "saus sambal 275ml": { name: "Saus Sambal 275ml", price: 8500, unit: "btl", category: "Bumbu & Minyak" }
};

// Sampel daftar belanja awal untuk demo langsung
const DEFAULT_CART_ITEMS = [
  {
    id: 'item-1',
    name: 'Beras Ramos 5kg',
    category: 'Bahan Pokok',
    unit: 'pack',
    qty: 1,
    unitPrice: 74000, // Naik dari 72.500 (+1.500)
    discountRaw: '',
    checked: true,
    note: 'Merk Maknyuss / Ramos'
  },
  {
    id: 'item-2',
    name: 'Minyak Goreng 2L',
    category: 'Bumbu & Minyak',
    unit: 'pack',
    qty: 1,
    unitPrice: 32500, // Turun dari 34.000 (-1.500)
    discountRaw: '50% + 20%', // Demo diskon bertingkat!
    checked: true,
    note: 'Promo JSM Superindo'
  },
  {
    id: 'item-3',
    name: 'Telur Ayam Negeri 1kg',
    category: 'Lauk & Telur',
    unit: 'kg',
    qty: 2,
    unitPrice: 28500, // Stabil sama dengan 28.500 (=)
    discountRaw: '',
    checked: true,
    note: 'Pilih butir yang bersih'
  },
  {
    id: 'item-4',
    name: 'Indomie Goreng',
    category: 'Bahan Pokok',
    unit: 'pcs',
    qty: 10,
    unitPrice: 3100, // Stabil
    discountRaw: '10%',
    checked: false,
    note: 'Stok darurat akhir bulan'
  },
  {
    id: 'item-5',
    name: 'Sunlight 750ml',
    category: 'Perawatan & Sabun',
    unit: 'pack',
    qty: 1,
    unitPrice: 15500, // Naik dari 14.500 (+1.000)
    discountRaw: '',
    checked: false,
    note: 'Refill pouch'
  }
];

// Sampel riwayat belanja bulan sebelumnya
const DEFAULT_HISTORY = [
  {
    id: 'hist-2026-09',
    title: 'Belanja Bulanan Kost - September 2026',
    date: '2026-09-10T14:30:00.000Z',
    store: 'Superindo & Pasar Tradisional',
    budgetCap: 550000,
    totalSpent: 486500,
    totalSaved: 42000,
    itemCount: 14,
    items: [
      { name: 'Beras Ramos 5kg', category: 'Bahan Pokok', qty: 1, unit: 'pack', finalPrice: 72500 },
      { name: 'Telur Ayam Negeri 1kg', category: 'Lauk & Telur', qty: 2, unit: 'kg', finalPrice: 57000 },
      { name: 'Minyak Goreng 2L', category: 'Bumbu & Minyak', qty: 1, unit: 'pack', finalPrice: 34000 },
      { name: 'Indomie Goreng', category: 'Bahan Pokok', qty: 15, unit: 'pcs', finalPrice: 46500 },
      { name: 'Susu UHT 1 Liter', category: 'Minuman & Susu', qty: 2, unit: 'liter', finalPrice: 39000 },
      { name: 'Sunlight 750ml', category: 'Perawatan & Sabun', qty: 1, unit: 'pack', finalPrice: 14500 },
      { name: 'Deterjen Bubuk 800g', category: 'Perawatan & Sabun', qty: 1, unit: 'pack', finalPrice: 18500 },
      { name: 'Sabun Mandi Cair 450ml', category: 'Perawatan & Sabun', qty: 1, unit: 'pack', finalPrice: 22000 },
      { name: 'Pasta Gigi Pepsodent', category: 'Perawatan & Sabun', qty: 1, unit: 'pcs', finalPrice: 13000 },
      { name: 'Bawang Merah 250g', category: 'Sayur & Bumbu', qty: 1, unit: 'pack', finalPrice: 12000 },
      { name: 'Bawang Putih 250g', category: 'Sayur & Bumbu', qty: 1, unit: 'pack', finalPrice: 11500 },
      { name: 'Cabai Rawit 250g', category: 'Sayur & Bumbu', qty: 1, unit: 'pack', finalPrice: 18000 },
      { name: 'Kecap Manis 520ml', category: 'Bumbu & Minyak', qty: 1, unit: 'pack', finalPrice: 23000 },
      { name: 'Nugget Fiesta 500g', category: 'Lauk & Telur', qty: 1, unit: 'pack', finalPrice: 45000 }
    ]
  },
  {
    id: 'hist-2026-08',
    title: 'Belanja Bulanan Kost - Agustus 2026',
    date: '2026-08-08T16:15:00.000Z',
    store: 'Hypermart Mall',
    budgetCap: 500000,
    totalSpent: 472000,
    totalSaved: 38500,
    itemCount: 11,
    items: [
      { name: 'Beras Ramos 5kg', category: 'Bahan Pokok', qty: 1, unit: 'pack', finalPrice: 71000 },
      { name: 'Telur Ayam Negeri 1kg', category: 'Lauk & Telur', qty: 2, unit: 'kg', finalPrice: 56000 },
      { name: 'Minyak Goreng 2L', category: 'Bumbu & Minyak', qty: 1, unit: 'pack', finalPrice: 33500 },
      { name: 'Indomie Goreng', category: 'Bahan Pokok', qty: 20, unit: 'pcs', finalPrice: 60000 }
    ]
  },
  {
    id: 'hist-2026-07',
    title: 'Belanja Bulanan Kost - Juli 2026',
    date: '2026-07-12T11:20:00.000Z',
    store: 'Superindo & Pasar Baru',
    budgetCap: 500000,
    totalSpent: 495000,
    totalSaved: 25000,
    itemCount: 9,
    items: [
      { name: 'Beras Ramos 5kg', category: 'Bahan Pokok', qty: 1, unit: 'pack', finalPrice: 70000 },
      { name: 'Telur Ayam Negeri 1kg', category: 'Lauk & Telur', qty: 2, unit: 'kg', finalPrice: 55000 },
      { name: 'Minyak Goreng 2L', category: 'Bumbu & Minyak', qty: 1, unit: 'pack', finalPrice: 33000 },
      { name: 'Deterjen Bubuk 800g', category: 'Perawatan & Sabun', qty: 1, unit: 'pack', finalPrice: 18000 }
    ]
  },
  {
    id: 'hist-2026-06',
    title: 'Belanja Awal Semester Kost - Juni 2026',
    date: '2026-06-15T15:45:00.000Z',
    store: 'Griya Toserba',
    budgetCap: 500000,
    totalSpent: 460000,
    totalSaved: 32000,
    itemCount: 8,
    items: [
      { name: 'Beras Ramos 5kg', category: 'Bahan Pokok', qty: 1, unit: 'pack', finalPrice: 69500 },
      { name: 'Minyak Goreng 2L', category: 'Bumbu & Minyak', qty: 1, unit: 'pack', finalPrice: 32500 }
    ]
  }
];

class DBManager {
  constructor() {
    this.init();
  }

  init() {
    if (!localStorage.getItem(DB_KEYS.BUDGET)) {
      localStorage.setItem(DB_KEYS.BUDGET, '600000'); // Default Rp 600.000
    }
    if (!localStorage.getItem(DB_KEYS.BENCHMARKS)) {
      localStorage.setItem(DB_KEYS.BENCHMARKS, JSON.stringify(DEFAULT_BENCHMARKS));
    }
    if (!localStorage.getItem(DB_KEYS.CURRENT_CART)) {
      localStorage.setItem(DB_KEYS.CURRENT_CART, JSON.stringify(DEFAULT_CART_ITEMS));
    }
    const currentHist = this.getHistory();
    if (!currentHist || currentHist.length < 3) {
      localStorage.setItem(DB_KEYS.HISTORY, JSON.stringify(DEFAULT_HISTORY));
    }
    if (!localStorage.getItem(DB_KEYS.SETTINGS)) {
      localStorage.setItem(DB_KEYS.SETTINGS, JSON.stringify({
        warningThreshold: 85,
        hapticFeedback: true,
        soundFeedback: true,
        currency: 'IDR'
      }));
    }
  }

  triggerSync() {
    if (window.firebaseSync && typeof window.firebaseSync.triggerCloudSave === 'function') {
      window.firebaseSync.triggerCloudSave();
    }
  }

  getAllData() {
    return {
      budget: this.getBudget(),
      cart: this.getCart(),
      benchmarks: this.getBenchmarks(),
      history: this.getHistory(),
      settings: this.getSettings()
    };
  }

  loadFromCloudData(cloudData) {
    if (!cloudData) return;
    if (cloudData.budget !== undefined && cloudData.budget !== null) {
      localStorage.setItem(DB_KEYS.BUDGET, cloudData.budget.toString());
    }
    if (Array.isArray(cloudData.cart)) {
      localStorage.setItem(DB_KEYS.CURRENT_CART, JSON.stringify(cloudData.cart));
    }
    if (Array.isArray(cloudData.history)) {
      localStorage.setItem(DB_KEYS.HISTORY, JSON.stringify(cloudData.history));
    }
    if (cloudData.benchmarks && typeof cloudData.benchmarks === 'object') {
      localStorage.setItem(DB_KEYS.BENCHMARKS, JSON.stringify(cloudData.benchmarks));
    }
    if (cloudData.settings && typeof cloudData.settings === 'object') {
      localStorage.setItem(DB_KEYS.SETTINGS, JSON.stringify(cloudData.settings));
    }
    window.dispatchEvent(new CustomEvent('trolipintar:synced', { detail: cloudData }));
  }

  getBudget() {
    const val = localStorage.getItem(DB_KEYS.BUDGET);
    return val ? parseFloat(val) : 600000;
  }

  setBudget(amount) {
    const num = Math.max(0, parseFloat(amount) || 0);
    localStorage.setItem(DB_KEYS.BUDGET, num.toString());
    this.triggerSync();
    return num;
  }

  getCart() {
    try {
      const data = localStorage.getItem(DB_KEYS.CURRENT_CART);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error('Failed to parse cart:', e);
      return [];
    }
  }

  saveCart(cart) {
    localStorage.setItem(DB_KEYS.CURRENT_CART, JSON.stringify(cart));
    this.triggerSync();
  }

  getBenchmarks() {
    try {
      const data = localStorage.getItem(DB_KEYS.BENCHMARKS);
      return data ? JSON.parse(data) : { ...DEFAULT_BENCHMARKS };
    } catch (e) {
      return { ...DEFAULT_BENCHMARKS };
    }
  }

  saveBenchmarks(benchmarks) {
    localStorage.setItem(DB_KEYS.BENCHMARKS, JSON.stringify(benchmarks));
    this.triggerSync();
  }

  // F-04: Pencocokan Harga Bulan Lalu Realtime
  getBenchmarkForProduct(productName) {
    if (!productName || !productName.trim()) return null;
    const benchmarks = this.getBenchmarks();
    const cleanQuery = productName.trim().toLowerCase();

    // 1. Exact match di database normalized key
    if (benchmarks[cleanQuery]) {
      return benchmarks[cleanQuery];
    }

    // 2. Fuzzy / substring match
    const keys = Object.keys(benchmarks);
    for (const key of keys) {
      if (cleanQuery.includes(key) || key.includes(cleanQuery)) {
        return benchmarks[key];
      }
    }

    // 3. Word token overlap match (e.g. "beras 5kg ramos" matches "beras ramos 5kg")
    const queryTokens = cleanQuery.split(/\s+/).filter(t => t.length > 2);
    if (queryTokens.length > 0) {
      for (const key of keys) {
        const matches = queryTokens.filter(t => key.includes(t));
        if (matches.length >= Math.min(2, queryTokens.length)) {
          return benchmarks[key];
        }
      }
    }

    return null;
  }

  getHistory() {
    try {
      const data = localStorage.getItem(DB_KEYS.HISTORY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  saveHistory(history) {
    localStorage.setItem(DB_KEYS.HISTORY, JSON.stringify(history));
    this.triggerSync();
  }

  // F-06: Selesaikan Belanja & Sinkronisasi Database Pembanding Resmi
  finalizeSession(sessionPayload) {
    const history = this.getHistory();
    const benchmarks = this.getBenchmarks();

    // Update benchmark harga dengan harga aktual yang dibeli hari ini
    if (sessionPayload.items && Array.isArray(sessionPayload.items)) {
      sessionPayload.items.forEach(item => {
        if (item.name && item.unitPrice > 0) {
          const normKey = item.name.trim().toLowerCase();
          benchmarks[normKey] = {
            name: item.name.trim(),
            price: item.unitPrice,
            unit: item.unit || 'pcs',
            category: item.category || 'Lainnya',
            updatedAt: new Date().toISOString()
          };
        }
      });
      this.saveBenchmarks(benchmarks);
    }

    // Masukkan ke riwayat di urutan paling atas
    history.unshift(sessionPayload);
    this.saveHistory(history);

    // Kosongkan keranjang aktif
    this.saveCart([]);
    this.triggerSync();
    return true;
  }

  getSettings() {
    try {
      const data = localStorage.getItem(DB_KEYS.SETTINGS);
      return data ? JSON.parse(data) : { warningThreshold: 85, hapticFeedback: true, soundFeedback: true };
    } catch (e) {
      return { warningThreshold: 85, hapticFeedback: true, soundFeedback: true };
    }
  }

  saveSettings(settings) {
    localStorage.setItem(DB_KEYS.SETTINGS, JSON.stringify(settings));
    this.triggerSync();
  }

  resetDemo() {
    localStorage.setItem(DB_KEYS.BUDGET, '600000');
    localStorage.setItem(DB_KEYS.BENCHMARKS, JSON.stringify(DEFAULT_BENCHMARKS));
    localStorage.setItem(DB_KEYS.CURRENT_CART, JSON.stringify(DEFAULT_CART_ITEMS));
    localStorage.setItem(DB_KEYS.HISTORY, JSON.stringify(DEFAULT_HISTORY));
    this.triggerSync();
  }
}

window.db = new DBManager();
