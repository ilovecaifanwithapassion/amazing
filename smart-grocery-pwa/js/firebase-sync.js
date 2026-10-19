/**
 * firebase-sync.js - Modul Sinkronisasi Realtime Firebase Firestore & Multi-Device Akun
 * Proyek: amazing-85635
 * Setiap perangkat yang membuka website otomatis mendapatkan akun urut: user1, user2, user3, dst.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Firebase Configuration dari pengguna
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

const USER_STORAGE_KEY = 'trolipintar_firebase_user_id';
let currentUserId = localStorage.getItem(USER_STORAGE_KEY) || null;
let unsubscribeSnapshot = null;
let isApplyingCloudUpdate = false;
let saveDebounceTimer = null;

/**
 * Update UI Indikator Status Akun & Cloud
 */
function updateSyncStatusUI(status, message) {
  const badgeDot = document.getElementById('syncStatusDot');
  const badgeText = document.getElementById('userPillText');
  const modalStatus = document.getElementById('modalSyncStatusText');
  const modalUserId = document.getElementById('modalUserIdDisplay');
  const modalPath = document.getElementById('modalCollectionPath');

  if (modalUserId && currentUserId) {
    modalUserId.textContent = currentUserId;
  }
  if (modalPath && currentUserId) {
    modalPath.textContent = `users/${currentUserId}`;
  }

  if (badgeText && currentUserId) {
    badgeText.textContent = currentUserId;
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
      modalStatus.innerHTML = `🟢 Terhubung & Tersinkronisasi (${message || 'Cloud Firestore'})`;
      modalStatus.style.color = '#10b981';
    } else if (status === 'syncing') {
      modalStatus.innerHTML = `🟡 Sedang Menyimpan ke Cloud...`;
      modalStatus.style.color = '#f59e0b';
    } else {
      modalStatus.innerHTML = `🔴 Offline / Mode Lokal (${message || 'Tersimpan di browser'})`;
      modalStatus.style.color = '#ef4444';
    }
  }
}

/**
 * Alokasi ID Akun Per Perangkat Secara Otomatis: user1, user2, user3, dst.
 * Menggunakan transaksi Firestore atomic agar tidak ada ID yang kembar antar perangkat.
 */
async function resolveDeviceUserId() {
  if (currentUserId && currentUserId.trim()) {
    console.log(`[FirebaseSync] Menggunakan akun tersimpan di perangkat ini: ${currentUserId}`);
    return currentUserId;
  }

  updateSyncStatusUI('syncing', 'Menyiapkan akun perangkat...');

  try {
    const counterDocRef = doc(firestore, 'system', 'user_counter');
    const assignedId = await runTransaction(firestore, async (transaction) => {
      const snap = await transaction.get(counterDocRef);
      let count = 0;
      if (snap.exists()) {
        count = snap.data().totalUsers || 0;
      }
      const nextCount = count + 1;
      transaction.set(counterDocRef, {
        totalUsers: nextCount,
        lastAssignedAt: serverTimestamp()
      }, { merge: true });
      return `user${nextCount}`;
    });

    currentUserId = assignedId;
    localStorage.setItem(USER_STORAGE_KEY, currentUserId);
    console.log(`[FirebaseSync] Akun baru berhasil dialokasikan: ${currentUserId}`);
    return currentUserId;
  } catch (err) {
    console.warn('[FirebaseSync] Gagal alokasi counter online, gunakan fallback lokal:', err);
    // Fallback bila internet lambat / offline saat pertama buka
    const fallbackId = 'user' + (Math.floor(Date.now() / 1000) % 1000);
    currentUserId = fallbackId;
    localStorage.setItem(USER_STORAGE_KEY, currentUserId);
    return currentUserId;
  }
}

/**
 * Mulai sinkronisasi realtime untuk user saat ini
 */
function startRealtimeSync(userId) {
  if (unsubscribeSnapshot) {
    unsubscribeSnapshot();
    unsubscribeSnapshot = null;
  }

  const userDocRef = doc(firestore, 'users', userId);

  updateSyncStatusUI('syncing', 'Menghubungkan ke database...');

  unsubscribeSnapshot = onSnapshot(userDocRef, (docSnap) => {
    if (isApplyingCloudUpdate) return;

    if (docSnap.exists()) {
      const cloudData = docSnap.data();
      console.log(`[FirebaseSync] Data realtime diterima dari cloud untuk ${userId}:`, cloudData);
      
      // Update data di penyimpanan lokal & refresh UI
      if (window.db && typeof window.db.loadFromCloudData === 'function') {
        isApplyingCloudUpdate = true;
        try {
          window.db.loadFromCloudData(cloudData);
        } finally {
          setTimeout(() => { isApplyingCloudUpdate = false; }, 100);
        }
      }
      updateSyncStatusUI('synced', 'Realtime Sync Aktif');
    } else {
      console.log(`[FirebaseSync] Dokumen untuk ${userId} belum ada di cloud, inisialisasi data awal...`);
      // Simpan data lokal saat ini ke Firestore sebagai data awal user
      triggerCloudSave(true);
    }
  }, (error) => {
    console.error('[FirebaseSync] Snapshot listener error:', error);
    updateSyncStatusUI('error', error.message);
  });
}

/**
 * Simpan data aktif saat ini ke Firestore (Debounced)
 */
function triggerCloudSave(immediate = false) {
  if (isApplyingCloudUpdate) return;
  if (!currentUserId) return;

  updateSyncStatusUI('syncing');

  clearTimeout(saveDebounceTimer);

  const performSave = async () => {
    try {
      if (!window.db) return;
      const data = window.db.getAllData();
      const userDocRef = doc(firestore, 'users', currentUserId);

      await setDoc(userDocRef, {
        userId: currentUserId,
        ...data,
        updatedAt: serverTimestamp(),
        clientTimestamp: new Date().toISOString(),
        deviceInfo: {
          platform: navigator.platform || 'Unknown',
          userAgent: navigator.userAgent.substring(0, 120)
        }
      }, { merge: true });

      console.log(`[FirebaseSync] Sukses simpan ke Firestore -> users/${currentUserId}`);
      updateSyncStatusUI('synced', 'Tersimpan');
    } catch (err) {
      console.error('[FirebaseSync] Gagal menyimpan ke Firestore:', err);
      updateSyncStatusUI('error', 'Gagal simpan ke cloud');
    }
  };

  if (immediate) {
    performSave();
  } else {
    saveDebounceTimer = setTimeout(performSave, 400);
  }
}

/**
 * Ganti akun secara manual (misal ingin simulasi 'user2' di perangkat yang sama)
 */
async function switchUser(newUserId) {
  if (!newUserId || !newUserId.trim()) return;
  const cleanId = newUserId.trim().toLowerCase();
  currentUserId = cleanId;
  localStorage.setItem(USER_STORAGE_KEY, currentUserId);
  console.log(`[FirebaseSync] Beralih ke akun: ${currentUserId}`);
  updateSyncStatusUI('syncing', 'Beralih akun...');
  startRealtimeSync(currentUserId);
}

/**
 * Generate akun urut baru secara manual (misal user ingin membuat akun baru di HP yang sama)
 */
async function createNewUser() {
  localStorage.removeItem(USER_STORAGE_KEY);
  currentUserId = null;
  const newId = await resolveDeviceUserId();
  startRealtimeSync(newId);
  return newId;
}

// Inisialisasi Otomatis saat modul dimuat
async function initFirebaseSync() {
  const userId = await resolveDeviceUserId();
  updateSyncStatusUI('online', 'Terhubung');
  startRealtimeSync(userId);
}

// Ekspor ke window agar dapat diakses oleh db.js dan app.js
window.firebaseSync = {
  app,
  firestore,
  triggerCloudSave,
  switchUser,
  createNewUser,
  getCurrentUserId: () => currentUserId,
  updateSyncStatusUI
};

// Jalankan inisialisasi
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFirebaseSync);
} else {
  initFirebaseSync();
}
