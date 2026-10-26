/**
 * firebase-sync.js - Modul Autentikasi Login & Sinkronisasi Realtime Firebase Firestore
 * Proyek: amazing-85635
 * Fitur:
 * - Login & Registrasi pengguna
 * - Akun Admin Resmi: username "sidney" | password "sayaganteng"
 * - Sinkronisasi data keranjang & riwayat belanja secara realtime per user (users/{userId})
 * - Uji ping realtime otomatis
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Firebase Configuration resmi
const firebaseConfig = {
  apiKey: "AIzaSyCcZYvzx48aqfJapTFhYuX_N-2560XH_40",
  authDomain: "amazing-85635.firebaseapp.com",
  projectId: "amazing-85635",
  storageBucket: "amazing-85635.firebasestorage.app",
  messagingSenderId: "958825303812",
  appId: "1:958825303812:web:c5bf6f7dbb598431cb8a51"
};

// Inisialisasi Firebase & Firestore
const app = initializeApp(firebaseConfig);
const firestore = getFirestore(app);

const AUTH_USER_KEY = 'trolipintar_auth_user';
const LOCAL_ACCOUNTS_KEY = 'trolipintar_accounts_registry';

// Kredensial default admin
const DEFAULT_ADMIN = {
  username: "sidney",
  password: "sayaganteng",
  role: "admin",
  displayName: "Sidney (Admin)",
  createdAt: "2026-10-26T00:00:00.000Z"
};

let currentUser = null;
let unsubscribeSnapshot = null;
let isApplyingCloudUpdate = false;
let saveDebounceTimer = null;
let lastPingSentTime = null;

/**
 * Mengambil daftar akun lokal untuk fallback offline
 */
function getLocalAccounts() {
  try {
    const raw = localStorage.getItem(LOCAL_ACCOUNTS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed.sidney) {
      parsed.sidney = { ...DEFAULT_ADMIN };
    }
    return parsed;
  } catch (e) {
    return { sidney: { ...DEFAULT_ADMIN } };
  }
}

/**
 * Menyimpan akun baru ke registry lokal
 */
function saveLocalAccount(userObj) {
  const accounts = getLocalAccounts();
  accounts[userObj.username.toLowerCase()] = userObj;
  localStorage.setItem(LOCAL_ACCOUNTS_KEY, JSON.stringify(accounts));
}

/**
 * Memastikan akun Admin (sidney/sayaganteng) tersimpan di Cloud Firestore
 */
async function ensureAdminInFirestore() {
  try {
    const adminDocRef = doc(firestore, 'accounts', 'sidney');
    await setDoc(adminDocRef, DEFAULT_ADMIN, { merge: true });
    console.log('[FirebaseSync] Akun admin sidney terverifikasi di Firestore.');
  } catch (err) {
    console.warn('[FirebaseSync] Gagal verifikasi admin ke Firestore, gunakan fallback lokal:', err);
  }
}

/**
 * Update UI Indikator Status Akun & Cloud
 */
function updateSyncStatusUI(status, message) {
  const badgeDot = document.getElementById('syncStatusDot');
  const badgeText = document.getElementById('userPillText');
  const pillBtn = document.getElementById('btnUserAccount');
  const modalStatus = document.getElementById('modalSyncStatusText');
  const modalUserId = document.getElementById('modalUserIdDisplay');
  const modalRoleBadge = document.getElementById('modalRoleBadge');
  const modalPath = document.getElementById('modalCollectionPath');
  const modalLoginStatus = document.getElementById('modalLoginStatus');

  const uid = currentUser ? currentUser.username : null;
  const isAdmin = currentUser && (currentUser.role === 'admin' || currentUser.username === 'sidney');

  if (modalUserId) {
    modalUserId.textContent = uid || 'Belum Masuk';
  }
  if (modalRoleBadge) {
    if (isAdmin) {
      modalRoleBadge.textContent = '👑 Admin';
      modalRoleBadge.className = 'user-role-badge role-admin';
      modalRoleBadge.style.display = 'inline-block';
    } else if (currentUser) {
      modalRoleBadge.textContent = '👤 Member';
      modalRoleBadge.className = 'user-role-badge role-member';
      modalRoleBadge.style.display = 'inline-block';
    } else {
      modalRoleBadge.style.display = 'none';
    }
  }

  if (modalPath) {
    modalPath.textContent = uid ? `users/${uid}` : '-';
  }

  if (modalLoginStatus) {
    modalLoginStatus.textContent = uid ? `Aktif (${isAdmin ? 'Administrator' : 'Pengguna'})` : 'Belum Login';
  }

  if (badgeText) {
    if (isAdmin) {
      badgeText.textContent = `👑 ${uid}`;
    } else if (uid) {
      badgeText.textContent = uid;
    } else {
      badgeText.textContent = 'Masuk / Login';
    }
  }

  if (pillBtn) {
    if (isAdmin) {
      pillBtn.classList.add('admin-pill');
    } else {
      pillBtn.classList.remove('admin-pill');
    }
  }

  if (badgeDot) {
    badgeDot.className = 'sync-dot';
    if (status === 'synced' || status === 'online') {
      badgeDot.classList.add('pulse-green');
    } else if (status === 'syncing') {
      badgeDot.classList.add('pulse-yellow');
    } else if (status === 'error' || status === 'offline') {
      badgeDot.classList.add('pulse-red');
    }
  }

  if (modalStatus) {
    if (status === 'synced' || status === 'online') {
      modalStatus.innerHTML = `🟢 Terhubung & Realtime (${message || 'Cloud Firestore'})`;
      modalStatus.style.color = '#10b981';
    } else if (status === 'syncing') {
      modalStatus.innerHTML = `🟡 Sedang Menyinkronkan...`;
      modalStatus.style.color = '#f59e0b';
    } else {
      modalStatus.innerHTML = `🔴 Offline / Mode Lokal (${message || 'Tersimpan lokal'})`;
      modalStatus.style.color = '#ef4444';
    }
  }
}

/**
 * Mulai sinkronisasi realtime Firestore untuk user aktif
 */
function startRealtimeSync(userId) {
  if (!userId) return;

  if (unsubscribeSnapshot) {
    unsubscribeSnapshot();
    unsubscribeSnapshot = null;
  }

  const userDocRef = doc(firestore, 'users', userId);

  updateSyncStatusUI('syncing', 'Menghubungkan realtime...');

  unsubscribeSnapshot = onSnapshot(userDocRef, (docSnap) => {
    if (isApplyingCloudUpdate) return;

    if (docSnap.exists()) {
      const cloudData = docSnap.data();
      console.log(`[FirebaseSync] Data realtime masuk dari Firestore untuk '${userId}':`, cloudData);

      // Bila ini adalah respons dari uji coba ping
      if (cloudData._testPing && lastPingSentTime) {
        const latency = Date.now() - lastPingSentTime;
        window.dispatchEvent(new CustomEvent('trolipintar:ping_ack', { detail: { latency } }));
        lastPingSentTime = null;
      }

      // Update penyimpanan lokal & refresh UI TroliPintar
      if (window.db && typeof window.db.loadFromCloudData === 'function') {
        isApplyingCloudUpdate = true;
        try {
          window.db.loadFromCloudData(cloudData);
        } finally {
          setTimeout(() => { isApplyingCloudUpdate = false; }, 80);
        }
      }
      updateSyncStatusUI('synced', 'Realtime Sync Aktif');
    } else {
      console.log(`[FirebaseSync] Dokumen awal '${userId}' belum ada di Firestore, menyimpan data default...`);
      triggerCloudSave(true);
    }
  }, (error) => {
    console.error('[FirebaseSync] Kesalahan snapshot listener:', error);
    updateSyncStatusUI('error', error.message);
  });
}

/**
 * Simpan data aktif saat ini ke Firestore (Debounced)
 */
function triggerCloudSave(immediate = false) {
  if (isApplyingCloudUpdate) return;
  if (!currentUser || !currentUser.username) return;

  updateSyncStatusUI('syncing');

  clearTimeout(saveDebounceTimer);

  const performSave = async () => {
    try {
      if (!window.db) return;
      const data = window.db.getAllData();
      const userDocRef = doc(firestore, 'users', currentUser.username);

      await setDoc(userDocRef, {
        userId: currentUser.username,
        userRole: currentUser.role || 'member',
        ...data,
        updatedAt: serverTimestamp(),
        clientTimestamp: new Date().toISOString()
      }, { merge: true });

      console.log(`[FirebaseSync] Berhasil menyimpan ke Firestore -> users/${currentUser.username}`);
      updateSyncStatusUI('synced', 'Tersimpan ke Cloud');
    } catch (err) {
      console.error('[FirebaseSync] Gagal simpan ke Firestore:', err);
      updateSyncStatusUI('error', 'Gagal simpan ke cloud');
    }
  };

  if (immediate) {
    performSave();
  } else {
    saveDebounceTimer = setTimeout(performSave, 350);
  }
}

/**
 * Uji coba Ping Realtime langsung
 * Menulis timestamp ke Firestore dan memverifikasi penerimaannya kembali via onSnapshot
 */
async function testRealtimePing() {
  if (!currentUser) throw new Error('Silakan login terlebih dahulu');
  const userDocRef = doc(firestore, 'users', currentUser.username);
  lastPingSentTime = Date.now();

  await setDoc(userDocRef, {
    _testPing: lastPingSentTime,
    lastPingFormatted: new Date().toLocaleTimeString('id-ID')
  }, { merge: true });

  return lastPingSentTime;
}

/**
 * Autentikasi Pengguna: Login
 */
async function login(username, password) {
  if (!username || !password) {
    return { success: false, message: 'Harap masukkan username dan kata sandi!' };
  }

  const cleanUser = username.trim().toLowerCase();
  const cleanPass = password.trim();

  // 1. Verifikasi langsung untuk akun admin "sidney" / "sayaganteng"
  if (cleanUser === 'sidney' && cleanPass === 'sayaganteng') {
    const adminUser = { ...DEFAULT_ADMIN };
    currentUser = adminUser;
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(adminUser));
    saveLocalAccount(adminUser);
    updateSyncStatusUI('online', 'Admin Masuk');
    startRealtimeSync('sidney');
    return { success: true, user: adminUser };
  }

  // 2. Verifikasi via Firestore accounts/{username}
  try {
    const accDocRef = doc(firestore, 'accounts', cleanUser);
    const accSnap = await getDoc(accDocRef);
    if (accSnap.exists()) {
      const accData = accSnap.data();
      if (accData.password === cleanPass) {
        const userObj = {
          username: cleanUser,
          role: accData.role || 'member',
          displayName: accData.displayName || cleanUser
        };
        currentUser = userObj;
        localStorage.setItem(AUTH_USER_KEY, JSON.stringify(userObj));
        saveLocalAccount(accData);
        updateSyncStatusUI('online', 'Berhasil Masuk');
        startRealtimeSync(cleanUser);
        return { success: true, user: userObj };
      } else {
        return { success: false, message: 'Kata sandi salah! Silakan coba lagi.' };
      }
    }
  } catch (err) {
    console.warn('[FirebaseSync] Firestore getDoc akun error, memeriksa registry lokal:', err);
  }

  // 3. Fallback pemeriksaan registry lokal
  const localAccounts = getLocalAccounts();
  if (localAccounts[cleanUser]) {
    if (localAccounts[cleanUser].password === cleanPass) {
      const userObj = {
        username: cleanUser,
        role: localAccounts[cleanUser].role || 'member',
        displayName: localAccounts[cleanUser].displayName || cleanUser
      };
      currentUser = userObj;
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(userObj));
      updateSyncStatusUI('online', 'Berhasil Masuk (Lokal)');
      startRealtimeSync(cleanUser);
      return { success: true, user: userObj };
    } else {
      return { success: false, message: 'Kata sandi salah!' };
    }
  }

  return { success: false, message: `Akun '${cleanUser}' tidak ditemukan. Silakan daftar baru terlebih dahulu.` };
}

/**
 * Pendaftaran Pengguna Baru
 */
async function register(username, password) {
  if (!username || !password) {
    return { success: false, message: 'Harap isi semua kolom pendaftaran!' };
  }

  const cleanUser = username.trim().toLowerCase();
  const cleanPass = password.trim();

  if (cleanUser.length < 3) {
    return { success: false, message: 'Username minimal 3 karakter.' };
  }

  if (cleanPass.length < 4) {
    return { success: false, message: 'Kata sandi minimal 4 karakter.' };
  }

  if (cleanUser === 'sidney') {
    return { success: false, message: 'Username sidney adalah akun admin resmi dan sudah terdaftar!' };
  }

  // Cek apakah sudah ada di Firestore
  try {
    const accDocRef = doc(firestore, 'accounts', cleanUser);
    const accSnap = await getDoc(accDocRef);
    if (accSnap.exists()) {
      return { success: false, message: `Username '${cleanUser}' sudah digunakan. Silakan pilih username lain.` };
    }

    const newUser = {
      username: cleanUser,
      password: cleanPass,
      role: 'member',
      displayName: cleanUser,
      createdAt: new Date().toISOString()
    };

    // Simpan akun ke Firestore
    await setDoc(accDocRef, newUser);
    saveLocalAccount(newUser);

    // Otomatis login
    currentUser = newUser;
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(newUser));
    updateSyncStatusUI('online', 'Akun Baru Terdaftar');
    startRealtimeSync(cleanUser);

    return { success: true, user: newUser };
  } catch (err) {
    console.error('[FirebaseSync] Gagal mendaftar ke Firestore:', err);
    // Simpan ke lokal bila offline
    const newUser = {
      username: cleanUser,
      password: cleanPass,
      role: 'member',
      displayName: cleanUser,
      createdAt: new Date().toISOString()
    };
    saveLocalAccount(newUser);
    currentUser = newUser;
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(newUser));
    updateSyncStatusUI('online', 'Terdaftar (Offline)');
    startRealtimeSync(cleanUser);
    return { success: true, user: newUser };
  }
}

/**
 * Keluar / Logout
 */
function logout() {
  if (unsubscribeSnapshot) {
    unsubscribeSnapshot();
    unsubscribeSnapshot = null;
  }
  localStorage.removeItem(AUTH_USER_KEY);
  currentUser = null;
  updateSyncStatusUI('offline', 'Belum Masuk');
}

/**
 * Inisialisasi Auth saat pertama kali dimuat
 */
async function initAuth() {
  // Pastikan akun admin sidney ada di Cloud Firestore
  ensureAdminInFirestore();

  // Periksa apakah sudah ada sesi login tersimpan
  const savedUserRaw = localStorage.getItem(AUTH_USER_KEY);
  if (savedUserRaw) {
    try {
      currentUser = JSON.parse(savedUserRaw);
    } catch (e) {
      currentUser = null;
    }
  }

  // Bila belum ada akun aktif sama sekali, gunakan akun admin sidney sebagai akun default aktif
  if (!currentUser) {
    currentUser = { ...DEFAULT_ADMIN };
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(currentUser));
  }

  updateSyncStatusUI('online', 'Terhubung');
  startRealtimeSync(currentUser.username);
}

// Ekspor ke window agar dapat dipanggil dari app.js dan db.js
window.firebaseSync = {
  app,
  firestore,
  triggerCloudSave,
  startRealtimeSync,
  login,
  register,
  logout,
  testRealtimePing,
  getCurrentUser: () => currentUser,
  getCurrentUserId: () => (currentUser ? currentUser.username : null),
  isAdmin: () => (currentUser && (currentUser.role === 'admin' || currentUser.username === 'sidney')),
  updateSyncStatusUI
};

// Jalankan saat DOM siap
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAuth);
} else {
  initAuth();
}
