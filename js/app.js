/**
 * app.js - Logika Interaktif TroliPintar
 * PWA Smart Grocery & Budget Safety Tracker untuk Siswa Rantau
 * Memenuhi seluruh spesifikasi SRS (F-01 s/d F-06)
 */

document.addEventListener('DOMContentLoaded', () => {
  // -------------------------------------------------------------
  // 1. STATE & INISIALISASI
  // -------------------------------------------------------------
  let currentCart = window.db.getCart();
  let budgetCap = window.db.getBudget();
  let currentFilterCategory = 'all';
  let searchQuery = '';
  let editingItemId = null;
  let deferredPrompt = null; // PWA install prompt

  // Web Audio Context untuk feedback suara kasir/troli
  let audioCtx = null;
  function playBeep(type = 'success') {
    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);

      if (type === 'success') {
        osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
        osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.15); // A5
        gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.15);
      } else if (type === 'warning') {
        osc.frequency.setValueAtTime(440, audioCtx.currentTime);
        osc.frequency.setValueAtTime(349, audioCtx.currentTime + 0.12);
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.25);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.25);
      } else if (type === 'step') {
        osc.frequency.setValueAtTime(659.25, audioCtx.currentTime); // E5
        gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.08);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.08);
      }
    } catch (e) {
      // Audio might be blocked before first user gesture
    }
  }

  function triggerVibrate(pattern = [40]) {
    if (navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch (e) {}
    }
  }

  // -------------------------------------------------------------
  // 2. HELPER FORMATTING
  // -------------------------------------------------------------
  function formatRupiah(number) {
    const val = Math.round(Number(number) || 0);
    return 'Rp ' + val.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  function unformatRupiah(str) {
    if (typeof str === 'number') return str;
    return parseFloat(str.replace(/[^0-9]/g, '')) || 0;
  }

  // -------------------------------------------------------------
  // F-03: KALKULATOR DISKON BERTINGKAT & TUNGGAL
  // Rumus matematis diskon bertumpuk:
  // Contoh: 50% + 20% pada harga Rp 100.000
  // Tahap 1: Rp 100.000 * (1 - 0.50) = Rp 50.000
  // Tahap 2: Rp 50.000 * (1 - 0.20) = Rp 40.000
  // Total hemat: Rp 60.000 (Efektif 60%, bukan 70%)
  // -------------------------------------------------------------
  function calculateDiscount(baseSubtotal, discountRaw) {
    if (!discountRaw || !discountRaw.trim() || baseSubtotal <= 0) {
      return {
        discountAmount: 0,
        finalPrice: baseSubtotal,
        effectivePercent: 0,
        explanation: ''
      };
    }

    const raw = discountRaw.trim();
    let current = baseSubtotal;
    let parts = [];

    if (raw.includes('+')) {
      // Diskon bertingkat / stacked: "50% + 20%"
      parts = raw.split('+').map(p => p.trim());
      let tierSteps = [];

      parts.forEach((part, idx) => {
        const pctMatch = part.match(/(\d+(\.\d+)?)\s*%/);
        if (pctMatch) {
          const pct = parseFloat(pctMatch[1]);
          const cut = current * (pct / 100);
          current -= cut;
          tierSteps.push(`${pct}%`);
        } else {
          // Nominal part
          const num = unformatRupiah(part);
          if (num > 0) {
            current = Math.max(0, current - num);
            tierSteps.push(formatRupiah(num));
          }
        }
      });

      const totalDiscount = baseSubtotal - current;
      const effectivePct = (totalDiscount / baseSubtotal) * 100;

      return {
        discountAmount: Math.round(totalDiscount),
        finalPrice: Math.round(current),
        effectivePercent: effectivePct.toFixed(1),
        explanation: `Diskon Bertingkat (${tierSteps.join(' + ')}) = Efektif ${effectivePct.toFixed(1)}%`
      };
    } else {
      // Diskon tunggal persen atau nominal
      const pctMatch = raw.match(/(\d+(\.\d+)?)\s*%/);
      if (pctMatch) {
        const pct = parseFloat(pctMatch[1]);
        const cut = baseSubtotal * (pct / 100);
        const finalP = Math.max(0, baseSubtotal - cut);
        return {
          discountAmount: Math.round(cut),
          finalPrice: Math.round(finalP),
          effectivePercent: pct.toFixed(1),
          explanation: `Diskon ${pct}% (Hemat ${formatRupiah(cut)})`
        };
      } else {
        // Nominal (contoh: 5000 / Rp 5.000)
        const nom = unformatRupiah(raw);
        const finalP = Math.max(0, baseSubtotal - nom);
        const cut = baseSubtotal - finalP;
        const pct = baseSubtotal > 0 ? (cut / baseSubtotal) * 100 : 0;
        return {
          discountAmount: Math.round(cut),
          finalPrice: Math.round(finalP),
          effectivePercent: pct.toFixed(1),
          explanation: `Potongan ${formatRupiah(cut)} (${pct.toFixed(1)}%)`
        };
      }
    }
  }

  // -------------------------------------------------------------
  // F-04: KOMPARATOR HARGA REALTIME VS BULAN LALU
  // Menghasilkan data panah & badge pembanding
  // -------------------------------------------------------------
  function comparePriceWithLastMonth(productName, currentUnitPrice) {
    if (!productName || currentUnitPrice <= 0) return null;
    const bench = window.db.getBenchmarkForProduct(productName);
    if (!bench) {
      return {
        status: 'new',
        symbol: '✨',
        text: 'Item Baru',
        detail: 'Belum ada data bulan lalu',
        lastPrice: null,
        diff: 0,
        pct: 0
      };
    }

    const lastPrice = bench.price;
    const diff = currentUnitPrice - lastPrice;
    const pct = lastPrice > 0 ? ((diff / lastPrice) * 100) : 0;

    if (diff > 0) {
      return {
        status: 'higher',
        symbol: '↑',
        text: `Naik (+${formatRupiah(diff)})`,
        detail: `Bulan lalu: ${formatRupiah(lastPrice)} (+${pct.toFixed(1)}%)`,
        lastPrice: lastPrice,
        diff: diff,
        pct: pct.toFixed(1)
      };
    } else if (diff < 0) {
      return {
        status: 'lower',
        symbol: '↓',
        text: `Turun (-${formatRupiah(Math.abs(diff))})`,
        detail: `Bulan lalu: ${formatRupiah(lastPrice)} (${pct.toFixed(1)}%)`,
        lastPrice: lastPrice,
        diff: diff,
        pct: Math.abs(pct).toFixed(1)
      };
    } else {
      return {
        status: 'stable',
        symbol: '=',
        text: 'Stabil',
        detail: `Sama persis bulan lalu (${formatRupiah(lastPrice)})`,
        lastPrice: lastPrice,
        diff: 0,
        pct: 0
      };
    }
  }

  // -------------------------------------------------------------
  // F-02 & F-05: KALKULASI TOTAL KERANJANG & SAFETY CAP GAUGE
  // -------------------------------------------------------------
  function calculateCartTotals() {
    let subtotalRaw = 0;
    let totalDiscount = 0;
    let finalTotal = 0;
    let checkedItemsCount = 0;

    currentCart.forEach(item => {
      const lineSubtotal = (parseFloat(item.qty) || 0) * (parseFloat(item.unitPrice) || 0);
      const disc = calculateDiscount(lineSubtotal, item.discountRaw);
      subtotalRaw += lineSubtotal;
      totalDiscount += disc.discountAmount;
      finalTotal += disc.finalPrice;

      if (item.checked) {
        checkedItemsCount++;
      }
    });

    return {
      subtotalRaw,
      totalDiscount,
      finalTotal,
      itemCount: currentCart.length,
      checkedItemsCount
    };
  }

  function updateSafetyCapDisplay() {
    const { finalTotal, itemCount, checkedItemsCount } = calculateCartTotals();
    const remaining = budgetCap - finalTotal;
    const percentage = budgetCap > 0 ? Math.min(100, Math.max(0, (finalTotal / budgetCap) * 100)) : 100;
    const actualPercent = budgetCap > 0 ? ((finalTotal / budgetCap) * 100).toFixed(1) : 100;

    // Elements
    const gaugeCard = document.getElementById('budgetGaugeCard');
    const gaugeSpent = document.getElementById('gaugeSpent');
    const gaugeCap = document.getElementById('gaugeCap');
    const gaugeFill = document.getElementById('gaugeFill');
    const gaugeStatus = document.getElementById('gaugeStatus');
    const gaugeRemaining = document.getElementById('gaugeRemaining');
    const dockTotalPrice = document.getElementById('dockTotalPrice');
    const dockItemCountBadge = document.getElementById('dockItemCountBadge');

    if (gaugeSpent) gaugeSpent.textContent = formatRupiah(finalTotal);
    if (gaugeCap) gaugeCap.textContent = `Limit: ${formatRupiah(budgetCap)}`;
    if (dockTotalPrice) dockTotalPrice.textContent = formatRupiah(finalTotal);
    if (dockItemCountBadge) dockItemCountBadge.textContent = itemCount.toString();

    // Progress bar fill width
    if (gaugeFill) {
      gaugeFill.style.width = `${Math.min(100, actualPercent)}%`;
      gaugeFill.className = 'gauge-bar-fill';
    }

    if (gaugeCard) {
      gaugeCard.className = 'budget-gauge-card';
    }

    // Safety Cap thresholds logic
    if (actualPercent > 100) {
      // Over Budget!
      if (gaugeCard) gaugeCard.classList.add('danger');
      if (gaugeFill) gaugeFill.classList.add('fill-danger');
      if (gaugeStatus) {
        gaugeStatus.className = 'gauge-status-badge badge-danger';
        gaugeStatus.innerHTML = `⚠️ OVER BUDGET (+${formatRupiah(Math.abs(remaining))})`;
      }
      if (gaugeRemaining) {
        gaugeRemaining.className = 'remaining-val negative';
        gaugeRemaining.textContent = `Defisit ${formatRupiah(Math.abs(remaining))}`;
      }
      triggerVibrate([80, 50, 80]);
    } else if (actualPercent >= 90) {
      // Kritis / Bahaya
      if (gaugeCard) gaugeCard.classList.add('danger');
      if (gaugeFill) gaugeFill.classList.add('fill-danger');
      if (gaugeStatus) {
        gaugeStatus.className = 'gauge-status-badge badge-danger';
        gaugeStatus.innerHTML = `🚨 Limit Kritis (${actualPercent}%)`;
      }
      if (gaugeRemaining) {
        gaugeRemaining.className = 'remaining-val negative';
        gaugeRemaining.textContent = `Sisa ${formatRupiah(remaining)}`;
      }
    } else if (actualPercent >= 75) {
      // Waspada
      if (gaugeCard) gaugeCard.classList.add('warning');
      if (gaugeFill) gaugeFill.classList.add('fill-warning');
      if (gaugeStatus) {
        gaugeStatus.className = 'gauge-status-badge badge-warning';
        gaugeStatus.innerHTML = `⚠️ Waspada (${actualPercent}%)`;
      }
      if (gaugeRemaining) {
        gaugeRemaining.className = 'remaining-val';
        gaugeRemaining.textContent = `Sisa ${formatRupiah(remaining)}`;
      }
    } else {
      // Aman
      if (gaugeCard) gaugeCard.classList.add('safe');
      if (gaugeFill) gaugeFill.classList.add('fill-safe');
      if (gaugeStatus) {
        gaugeStatus.className = 'gauge-status-badge badge-safe';
        gaugeStatus.innerHTML = `🛡️ Dompet Aman (${actualPercent}%)`;
      }
      if (gaugeRemaining) {
        gaugeRemaining.className = 'remaining-val';
        gaugeRemaining.textContent = `Sisa ${formatRupiah(remaining)}`;
      }
    }
  }

  // -------------------------------------------------------------
  // F-01 & F-02: RENDER DAFTAR ITEM BELANJA
  // -------------------------------------------------------------
  function renderGroceryList() {
    const listContainer = document.getElementById('groceryListContainer');
    if (!listContainer) return;

    // Filter & Search
    let items = currentCart.filter(item => {
      const matchCat = (currentFilterCategory === 'all' || item.category === currentFilterCategory);
      const matchSearch = (!searchQuery || item.name.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchCat && matchSearch;
    });

    if (items.length === 0) {
      listContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/>
              <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>
            </svg>
          </div>
          <div class="empty-title">Keranjang Belanja Kosong</div>
          <p class="empty-desc">Tekan tombol <strong>+ Tambah Barang</strong> di bawah untuk mulai mencatat barang belanjaan bulananmu.</p>
        </div>
      `;
      updateSafetyCapDisplay();
      return;
    }

    listContainer.innerHTML = items.map(item => {
      const subtotal = item.qty * item.unitPrice;
      const disc = calculateDiscount(subtotal, item.discountRaw);
      const comp = comparePriceWithLastMonth(item.name, item.unitPrice);

      let compBadgeHtml = '';
      if (comp) {
        let badgeClass = 'badge-stable';
        if (comp.status === 'higher') badgeClass = 'badge-higher';
        else if (comp.status === 'lower') badgeClass = 'badge-lower';
        else if (comp.status === 'new') badgeClass = 'badge-new';

        compBadgeHtml = `
          <div class="price-comparator-badge ${badgeClass}" title="${comp.detail}">
            <span>${comp.symbol}</span>
            <span>${comp.text}</span>
          </div>
        `;
      }

      let discountHtml = '';
      if (disc.discountAmount > 0) {
        discountHtml = `
          <div class="discount-strike-wrap">
            <span class="strike-price">${formatRupiah(subtotal)}</span>
            <span class="discount-pill">-${disc.effectivePercent}%</span>
          </div>
        `;
      }

      return `
        <div class="grocery-card ${item.checked ? 'checked' : ''}" data-id="${item.id}">
          <div class="card-header-row">
            <div class="card-title-group">
              <button class="trolley-check-btn ${item.checked ? 'checked' : ''}" data-action="toggle-check" data-id="${item.id}" title="Tandai sudah masuk troli">
                ${item.checked ? `
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                ` : ''}
              </button>
              <div class="item-name-block">
                <span class="item-name">${escapeHtml(item.name)}</span>
                <div class="item-meta">
                  <span class="item-category-tag">${escapeHtml(item.category || 'Umum')}</span>
                  <span>•</span>
                  <span>@ ${formatRupiah(item.unitPrice)}/${item.unit || 'pcs'}</span>
                </div>
                ${compBadgeHtml}
                ${item.note ? `<div style="font-size:0.68rem; color:var(--text-faint); margin-top:2px;">📌 ${escapeHtml(item.note)}</div>` : ''}
              </div>
            </div>
            
            <div class="item-pricing-summary">
              <span class="item-unit-calc">${item.qty} ${item.unit || 'pcs'} × ${formatRupiah(item.unitPrice)}</span>
              ${discountHtml}
              <span class="item-final-price">${formatRupiah(disc.finalPrice)}</span>
            </div>
          </div>

          <div class="card-bottom-row">
            <!-- F-02: Qty Stepper Touch Friendly -->
            <div class="qty-stepper">
              <button class="stepper-btn" data-action="qty-minus" data-id="${item.id}" aria-label="Kurangi kuantitas">−</button>
              <span class="stepper-val">${item.qty} <small style="font-weight:400; color:var(--text-muted); font-size:0.65rem;">${item.unit || 'pcs'}</small></span>
              <button class="stepper-btn" data-action="qty-plus" data-id="${item.id}" aria-label="Tambah kuantitas">+</button>
            </div>

            <div class="card-actions-row">
              <button class="btn-ghost-sm" data-action="edit" data-id="${item.id}">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
                Ubah
              </button>
              <button class="btn-ghost-sm danger" data-action="delete" data-id="${item.id}">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
                Hapus
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    updateSafetyCapDisplay();
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // -------------------------------------------------------------
  // EVENT DELEGASI LIST (Qty Stepper, Check, Edit, Delete)
  // -------------------------------------------------------------
  const listContainer = document.getElementById('groceryListContainer');
  if (listContainer) {
    listContainer.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const itemId = btn.dataset.id;
      const item = currentCart.find(i => i.id === itemId);
      if (!item) return;

      if (action === 'toggle-check') {
        item.checked = !item.checked;
        window.db.saveCart(currentCart);
        triggerVibrate([30]);
        playBeep('step');
        renderGroceryList();
      } else if (action === 'qty-plus') {
        // F-02: Tambah kuantitas realtime
        const step = (item.unit === 'kg' || item.unit === 'liter') ? 0.5 : 1;
        item.qty = parseFloat((item.qty + step).toFixed(2));
        window.db.saveCart(currentCart);
        triggerVibrate([25]);
        playBeep('step');
        renderGroceryList();
      } else if (action === 'qty-minus') {
        // F-02: Kurang kuantitas realtime
        const step = (item.unit === 'kg' || item.unit === 'liter') ? 0.5 : 1;
        if (item.qty > step) {
          item.qty = parseFloat((item.qty - step).toFixed(2));
        } else {
          // Konfirmasi hapus jika mencapai 0
          if (confirm(`Hapus "${item.name}" dari troli?`)) {
            currentCart = currentCart.filter(i => i.id !== itemId);
          }
        }
        window.db.saveCart(currentCart);
        triggerVibrate([25]);
        playBeep('step');
        renderGroceryList();
      } else if (action === 'edit') {
        openEditModal(item);
      } else if (action === 'delete') {
        if (confirm(`Hapus "${item.name}" dari troli belanja?`)) {
          currentCart = currentCart.filter(i => i.id !== itemId);
          window.db.saveCart(currentCart);
          showToast(`"${item.name}" dihapus`, 'toast-warning');
          renderGroceryList();
        }
      }
    });
  }

  // -------------------------------------------------------------
  // MODAL TAMBAH / UBAH ITEM
  // -------------------------------------------------------------
  const modalItem = document.getElementById('modalItem');
  const formItem = document.getElementById('formItem');
  const itemNameInput = document.getElementById('itemNameInput');
  const itemCategoryInput = document.getElementById('itemCategoryInput');
  const itemUnitInput = document.getElementById('itemUnitInput');
  const itemQtyInput = document.getElementById('itemQtyInput');
  const itemPriceInput = document.getElementById('itemPriceInput');
  const itemDiscountInput = document.getElementById('itemDiscountInput');
  const itemNoteInput = document.getElementById('itemNoteInput');
  const modalTitle = document.getElementById('modalTitle');
  const discountLivePreview = document.getElementById('discountLivePreview');
  const modalPriceComparatorBox = document.getElementById('modalPriceComparatorBox');
  const autocompleteList = document.getElementById('autocompleteList');

  function openAddModal() {
    editingItemId = null;
    modalTitle.textContent = 'Tambah Item Belanja';
    formItem.reset();
    itemQtyInput.value = '1';
    itemUnitInput.value = 'pcs';
    itemCategoryInput.value = 'Bahan Pokok';
    updateModalDiscountPreview();
    updateModalPriceComparison();
    modalItem.classList.add('open');
    setTimeout(() => itemNameInput.focus(), 150);
  }

  function openEditModal(item) {
    editingItemId = item.id;
    modalTitle.textContent = 'Ubah Item Belanja';
    itemNameInput.value = item.name;
    itemCategoryInput.value = item.category || 'Bahan Pokok';
    itemUnitInput.value = item.unit || 'pcs';
    itemQtyInput.value = item.qty;
    itemPriceInput.value = item.unitPrice;
    itemDiscountInput.value = item.discountRaw || '';
    itemNoteInput.value = item.note || '';
    updateModalDiscountPreview();
    updateModalPriceComparison();
    modalItem.classList.add('open');
  }

  function closeModal() {
    modalItem.classList.remove('open');
    autocompleteList.style.display = 'none';
  }

  document.querySelectorAll('[data-action="close-modal"]').forEach(btn => {
    btn.addEventListener('click', closeModal);
  });

  // FAB / Button Tambah Barang
  document.getElementById('btnOpenAddModal')?.addEventListener('click', openAddModal);

  // Live updates saat ketik di modal (F-02, F-03, F-04)
  function updateModalDiscountPreview() {
    const qty = parseFloat(itemQtyInput.value) || 0;
    const price = parseFloat(itemPriceInput.value) || 0;
    const rawDisc = itemDiscountInput.value;
    const subtotal = qty * price;
    const res = calculateDiscount(subtotal, rawDisc);

    if (discountLivePreview) {
      if (res.discountAmount > 0) {
        discountLivePreview.innerHTML = `
          <span>🏷️ ${res.explanation}</span>
          <span style="margin-left:auto; font-weight:800;">Bayar: ${formatRupiah(res.finalPrice)}</span>
        `;
        discountLivePreview.style.display = 'flex';
      } else {
        discountLivePreview.innerHTML = `Subtotal: ${formatRupiah(subtotal)}`;
        discountLivePreview.style.display = 'block';
      }
    }
  }

  function updateModalPriceComparison() {
    const name = itemNameInput.value.trim();
    const price = parseFloat(itemPriceInput.value) || 0;
    if (!modalPriceComparatorBox) return;

    if (!name || price <= 0) {
      modalPriceComparatorBox.style.display = 'none';
      return;
    }

    const comp = comparePriceWithLastMonth(name, price);
    if (!comp) {
      modalPriceComparatorBox.style.display = 'none';
      return;
    }

    modalPriceComparatorBox.style.display = 'flex';
    let badgeClass = 'badge-stable';
    if (comp.status === 'higher') badgeClass = 'badge-higher';
    else if (comp.status === 'lower') badgeClass = 'badge-lower';
    else if (comp.status === 'new') badgeClass = 'badge-new';

    modalPriceComparatorBox.innerHTML = `
      <div>
        <div style="font-weight:700; color:#fff;">Status Harga vs Bulan Lalu</div>
        <div style="font-size:0.72rem; color:var(--text-muted);">${comp.detail}</div>
      </div>
      <div class="price-comparator-badge ${badgeClass}" style="font-size:0.78rem; padding:4px 10px;">
        <span>${comp.symbol}</span>
        <span>${comp.text}</span>
      </div>
    `;
  }

  itemQtyInput?.addEventListener('input', updateModalDiscountPreview);
  itemPriceInput?.addEventListener('input', () => {
    updateModalDiscountPreview();
    updateModalPriceComparison();
  });
  itemDiscountInput?.addEventListener('input', updateModalDiscountPreview);

  // Autocomplete produk
  itemNameInput?.addEventListener('input', (e) => {
    const val = e.target.value.trim().toLowerCase();
    updateModalPriceComparison();

    if (!val || val.length < 1) {
      autocompleteList.style.display = 'none';
      return;
    }

    const benchmarks = window.db.getBenchmarks();
    const matches = Object.values(benchmarks).filter(b => b.name.toLowerCase().includes(val)).slice(0, 5);

    if (matches.length > 0) {
      autocompleteList.innerHTML = matches.map(m => `
        <div class="autocomplete-item" data-name="${escapeHtml(m.name)}" data-price="${m.price}" data-unit="${m.unit || 'pcs'}" data-category="${m.category || 'Bahan Pokok'}">
          <div>
            <div style="font-weight:700;">${escapeHtml(m.name)}</div>
            <div style="font-size:0.7rem; color:var(--text-muted);">${escapeHtml(m.category || '')} (${m.unit || 'pcs'})</div>
          </div>
          <div style="font-weight:700; color:var(--primary-400);">${formatRupiah(m.price)}</div>
        </div>
      `).join('');
      autocompleteList.style.display = 'block';
    } else {
      autocompleteList.style.display = 'none';
    }
  });

  autocompleteList?.addEventListener('click', (e) => {
    const itemEl = e.target.closest('.autocomplete-item');
    if (!itemEl) return;
    itemNameInput.value = itemEl.dataset.name;
    itemPriceInput.value = itemEl.dataset.price;
    itemUnitInput.value = itemEl.dataset.unit;
    itemCategoryInput.value = itemEl.dataset.category;
    autocompleteList.style.display = 'none';
    updateModalDiscountPreview();
    updateModalPriceComparison();
  });

  // Preset chips diskon di modal
  document.querySelectorAll('.discount-quick-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const discVal = chip.dataset.val;
      itemDiscountInput.value = discVal;
      updateModalDiscountPreview();
      triggerVibrate([20]);
    });
  });

  // Submit Form Tambah / Ubah Item (F-01)
  formItem?.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = itemNameInput.value.trim();
    const category = itemCategoryInput.value;
    const unit = itemUnitInput.value;
    const qty = parseFloat(itemQtyInput.value) || 1;
    const unitPrice = parseFloat(itemPriceInput.value) || 0;
    const discountRaw = itemDiscountInput.value.trim();
    const note = itemNoteInput.value.trim();

    if (!name) {
      alert('Nama produk wajib diisi!');
      return;
    }
    if (unitPrice < 0) {
      alert('Harga satuan tidak boleh negatif!');
      return;
    }

    if (editingItemId) {
      // Ubah item
      const item = currentCart.find(i => i.id === editingItemId);
      if (item) {
        item.name = name;
        item.category = category;
        item.unit = unit;
        item.qty = qty;
        item.unitPrice = unitPrice;
        item.discountRaw = discountRaw;
        item.note = note;
      }
      showToast('Item berhasil diperbarui!', 'toast-success');
    } else {
      // Tambah item baru
      const newItem = {
        id: 'item-' + Date.now(),
        name,
        category,
        unit,
        qty,
        unitPrice,
        discountRaw,
        checked: false,
        note
      };
      currentCart.unshift(newItem);
      showToast(`"${name}" masuk ke daftar!`, 'toast-success');
      playBeep('success');
      triggerVibrate([40]);
    }

    window.db.saveCart(currentCart);
    closeModal();
    renderGroceryList();
  });

  // -------------------------------------------------------------
  // F-06: SELESAIKAN BELANJA (CHECKOUT SESSION)
  // -------------------------------------------------------------
  const modalCheckout = document.getElementById('modalCheckout');
  const btnOpenCheckout = document.getElementById('btnOpenCheckout');
  const checkoutSummaryContent = document.getElementById('checkoutSummaryContent');
  const btnConfirmCheckout = document.getElementById('btnConfirmCheckout');
  const checkoutStoreInput = document.getElementById('checkoutStoreInput');

  btnOpenCheckout?.addEventListener('click', () => {
    if (currentCart.length === 0) {
      alert('Keranjang belanja masih kosong!');
      return;
    }

    const { subtotalRaw, totalDiscount, finalTotal, itemCount, checkedItemsCount } = calculateCartTotals();
    const sisa = budgetCap - finalTotal;

    checkoutSummaryContent.innerHTML = `
      <div style="background:var(--bg-card); border-radius:var(--radius-md); padding:14px; margin-bottom:12px;">
        <div style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:0.85rem;">
          <span style="color:var(--text-muted);">Total Item Barang:</span>
          <strong>${itemCount} barang (${checkedItemsCount} di troli)</strong>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:0.85rem;">
          <span style="color:var(--text-muted);">Subtotal Normal:</span>
          <span>${formatRupiah(subtotalRaw)}</span>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:0.85rem; color:#fb7185;">
          <span>Hemat Diskon:</span>
          <strong>-${formatRupiah(totalDiscount)}</strong>
        </div>
        <div style="display:flex; justify-content:space-between; padding-top:8px; border-top:1px solid var(--border-subtle); font-size:1.1rem; font-weight:800;">
          <span>Total Tagihan:</span>
          <span style="color:var(--primary-400);">${formatRupiah(finalTotal)}</span>
        </div>
        <div style="display:flex; justify-content:space-between; margin-top:6px; font-size:0.8rem;">
          <span style="color:var(--text-muted);">Status Anggaran:</span>
          <span style="color:${sisa >= 0 ? 'var(--primary-400)' : 'var(--danger-500)'}; font-weight:700;">
            ${sisa >= 0 ? `Sisa Hemat ${formatRupiah(sisa)}` : `Over Budget ${formatRupiah(Math.abs(sisa))}`}
          </span>
        </div>
      </div>
      <p style="font-size:0.75rem; color:var(--text-muted); line-height:1.4;">
        💡 <strong>Info Pintar:</strong> Menyelesaikan belanja akan menyimpan rekaman ini ke Tab Riwayat dan secara otomatis memperbarui <strong>harga patokan bulan lalu</strong> untuk komparator belanja bulan depan!
      </p>
    `;

    modalCheckout.classList.add('open');
  });

  btnConfirmCheckout?.addEventListener('click', () => {
    const { subtotalRaw, totalDiscount, finalTotal, itemCount } = calculateCartTotals();
    const store = (checkoutStoreInput?.value || '').trim() || 'Supermarket Bulanan';

    const sessionPayload = {
      id: 'hist-' + Date.now(),
      title: `Belanja ${store}`,
      date: new Date().toISOString(),
      store: store,
      budgetCap: budgetCap,
      totalSpent: finalTotal,
      totalSaved: totalDiscount,
      itemCount: itemCount,
      items: currentCart.map(item => {
        const disc = calculateDiscount(item.qty * item.unitPrice, item.discountRaw);
        return {
          name: item.name,
          category: item.category,
          qty: item.qty,
          unit: item.unit,
          unitPrice: item.unitPrice,
          finalPrice: disc.finalPrice
        };
      })
    };

    window.db.finalizeSession(sessionPayload);
    currentCart = [];
    modalCheckout.classList.remove('open');
    showToast('🎉 Belanja Selesai! Data disimpan ke Riwayat.', 'toast-success');
    playBeep('success');
    renderGroceryList();
    renderHistoryTab();
    renderBudgetTab();
  });

  // -------------------------------------------------------------
  // TAB NAVIGATION (Belanja, Riwayat, Anggaran)
  // -------------------------------------------------------------
  const navTabs = document.querySelectorAll('.nav-tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');

  function switchTab(targetTabId) {
    navTabs.forEach(t => {
      t.classList.toggle('active', t.dataset.target === targetTabId);
    });
    tabPanes.forEach(p => {
      p.classList.toggle('active', p.id === targetTabId);
    });

    // Reset scroll posisi jendela ke paling atas saat pindah tab
    window.scrollTo({ top: 0, behavior: 'instant' });

    const dock = document.querySelector('.floating-action-dock');
    if (dock) {
      dock.style.display = (targetTabId === 'tabBelanja') ? 'flex' : 'none';
    }

    if (targetTabId === 'tabRiwayat') {
      renderHistoryTab();
    } else if (targetTabId === 'tabAnggaran') {
      renderBudgetTab();
    }
  }

  navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      switchTab(tab.dataset.target);
      triggerVibrate([20]);
    });
  });

  // -------------------------------------------------------------
  // TAB 2: RENDER RIWAYAT BELANJA (F-06)
  // -------------------------------------------------------------
  function renderHistoryTab() {
    const historyList = window.db.getHistory();
    const historyListContainer = document.getElementById('historyListContainer');
    const totalSpentAllHistory = document.getElementById('totalSpentAllHistory');
    const totalSessionsCount = document.getElementById('totalSessionsCount');

    if (!historyListContainer) return;

    let grandTotalSpent = 0;
    historyList.forEach(h => grandTotalSpent += (h.totalSpent || 0));

    if (totalSpentAllHistory) totalSpentAllHistory.textContent = formatRupiah(grandTotalSpent);
    if (totalSessionsCount) totalSessionsCount.textContent = `${historyList.length} Sesi`;

    if (historyList.length === 0) {
      historyListContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-title">Belum Ada Riwayat Belanja</div>
          <p class="empty-desc">Selesaikan sesi belanja di tab Belanja untuk mencatat riwayat resmi.</p>
        </div>
      `;
      return;
    }

    historyListContainer.innerHTML = historyList.map(hist => {
      const d = new Date(hist.date);
      const formattedDate = d.toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

      const itemsSummary = (hist.items || []).slice(0, 4).map(i => `${i.name} (${i.qty} ${i.unit})`).join(', ');
      const moreCount = (hist.items || []).length > 4 ? `+${(hist.items.length - 4)} lainnya` : '';

      return `
        <div class="history-card-item">
          <div class="history-card-top">
            <div>
              <div class="history-title">${escapeHtml(hist.title || hist.store || 'Belanja Bulanan')}</div>
              <div class="history-date">📅 ${formattedDate}</div>
            </div>
            <div class="history-spent-badge">
              <div class="history-spent-amount">${formatRupiah(hist.totalSpent)}</div>
              ${hist.totalSaved > 0 ? `<div class="history-savings">Hemat ${formatRupiah(hist.totalSaved)}</div>` : ''}
            </div>
          </div>

          <div class="history-items-preview">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
              <span>🛒 <strong>${hist.itemCount || (hist.items ? hist.items.length : 0)} Barang</strong></span>
              <button class="btn-ghost-sm" data-action="toggle-details" data-id="${hist.id}" style="color:var(--primary-400); font-weight:700; padding:2px 8px; border:1px solid rgba(16,185,129,0.3); border-radius:4px;">
                Lihat Struk ▾
              </button>
            </div>
            <div style="font-size:0.73rem; color:var(--text-muted);">${escapeHtml(itemsSummary)} ${moreCount}</div>
          </div>

          <!-- Accordion Rincian Lengkap Barang Struk -->
          <div class="history-details-accordion" id="details-${hist.id}">
            <div style="font-weight:700; font-size:0.75rem; color:#fff; margin-bottom:6px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:4px;">
              🧾 Rincian Barang yang Dibeli:
            </div>
            ${(hist.items || []).map(item => `
              <div class="receipt-item-row">
                <div>
                  <span style="color:#fff; font-weight:600;">${escapeHtml(item.name)}</span>
                  <span style="color:var(--text-faint); font-size:0.7rem;">(${item.qty} ${item.unit || 'pcs'})</span>
                </div>
                <div style="font-weight:700; color:var(--primary-400);">
                  ${formatRupiah(item.finalPrice || item.unitPrice || 0)}
                </div>
              </div>
            `).join('')}
          </div>

          <div class="history-card-footer">
            <span style="font-size:0.7rem; color:var(--text-faint);">Limit: ${formatRupiah(hist.budgetCap)}</span>
            <button class="btn-ghost-sm" data-action="reload-session" data-id="${hist.id}" style="color:var(--primary-400); font-weight:700;">
              🔁 Muat Ulang ke Troli
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Listener Toggle Rincian Struk
    historyListContainer.querySelectorAll('[data-action="toggle-details"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const hId = btn.dataset.id;
        const accordion = document.getElementById(`details-${hId}`);
        if (accordion) {
          const isOpen = accordion.classList.toggle('open');
          btn.innerHTML = isOpen ? 'Tutup Struk ▴' : 'Lihat Struk ▾';
          triggerVibrate([15]);
        }
      });
    });

    // Listener Muat Ulang ke Troli (Restock Template)
    historyListContainer.querySelectorAll('[data-action="reload-session"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const hId = btn.dataset.id;
        const target = historyList.find(h => h.id === hId);
        if (target && target.items) {
          if (confirm(`Muat ${target.items.length} item dari sesi "${target.title}" ke keranjang belanja saat ini?`)) {
            const reloaded = target.items.map((item, idx) => ({
              id: 'item-' + Date.now() + '-' + idx,
              name: item.name,
              category: item.category || 'Bahan Pokok',
              unit: item.unit || 'pcs',
              qty: item.qty || 1,
              unitPrice: item.unitPrice || item.finalPrice || 0,
              discountRaw: '',
              checked: false,
              note: 'Dimuat dari ' + target.title
            }));
            currentCart = [...reloaded, ...currentCart];
            window.db.saveCart(currentCart);
            showToast('Item berhasil dimuat ke Troli!', 'toast-success');
            switchTab('tabBelanja');
            renderGroceryList();
          }
        }
      });
    });
  }

  // -------------------------------------------------------------
  // TAB 3: RENDER ANGGARAN & PENGATURAN (F-05)
  // -------------------------------------------------------------
  function renderBudgetTab() {
    const budgetInput = document.getElementById('settingBudgetInput');
    if (budgetInput) {
      budgetInput.value = budgetCap;
    }

    // Hitung rincian belanja per kategori dari keranjang aktif
    const categoryTotals = {};
    const { finalTotal } = calculateCartTotals();

    currentCart.forEach(item => {
      const cat = item.category || 'Lainnya';
      const sub = item.qty * item.unitPrice;
      const disc = calculateDiscount(sub, item.discountRaw);
      categoryTotals[cat] = (categoryTotals[cat] || 0) + disc.finalPrice;
    });

    const categoryBreakdownContainer = document.getElementById('categoryBreakdownContainer');
    if (categoryBreakdownContainer) {
      const categories = Object.keys(categoryTotals);
      if (categories.length === 0) {
        categoryBreakdownContainer.innerHTML = `<p style="font-size:0.75rem; color:var(--text-faint);">Belum ada barang di keranjang belanja aktif.</p>`;
      } else {
        const catColors = ['#10B981', '#3B82F6', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4', '#64748B'];
        categoryBreakdownContainer.innerHTML = categories.map((cat, idx) => {
          const spent = categoryTotals[cat];
          const pct = finalTotal > 0 ? ((spent / finalTotal) * 100).toFixed(1) : 0;
          const color = catColors[idx % catColors.length];

          return `
            <div class="cat-breakdown-row">
              <div class="cat-breakdown-labels">
                <span style="font-weight:600; color:#fff;">${cat}</span>
                <span style="color:var(--text-muted); font-size:0.72rem;">${formatRupiah(spent)} (${pct}%)</span>
              </div>
              <div class="cat-track">
                <div class="cat-fill" style="width:${pct}%; background-color:${color};"></div>
              </div>
            </div>
          `;
        }).join('');
      }
    }
  }

  // Simpan batas anggaran baru
  document.getElementById('btnSaveBudget')?.addEventListener('click', () => {
    const budgetInput = document.getElementById('settingBudgetInput');
    const val = parseFloat(budgetInput.value) || 0;
    if (val <= 0) {
      alert('Batas anggaran harus lebih dari 0!');
      return;
    }
    budgetCap = window.db.setBudget(val);
    updateSafetyCapDisplay();
    showToast(`Batas Anggaran diperbarui: ${formatRupiah(budgetCap)}`, 'toast-success');
    triggerVibrate([40]);
  });

  // Preset chips di Tab Anggaran
  document.querySelectorAll('.budget-chip-preset').forEach(chip => {
    chip.addEventListener('click', () => {
      const val = parseFloat(chip.dataset.val);
      const budgetInput = document.getElementById('settingBudgetInput');
      if (budgetInput) budgetInput.value = val;
      budgetCap = window.db.setBudget(val);
      updateSafetyCapDisplay();
      showToast(`Batas Anggaran: ${formatRupiah(budgetCap)}`, 'toast-success');
    });
  });

  // Reset demo data
  document.getElementById('btnResetDemo')?.addEventListener('click', () => {
    if (confirm('Kembalikan ke data demo belanja awal? (Keranjang dan riwayat akan di-reset)')) {
      window.db.resetDemo();
      currentCart = window.db.getCart();
      budgetCap = window.db.getBudget();
      showToast('Data demo berhasil dipulihkan!', 'toast-success');
      renderGroceryList();
      renderHistoryTab();
      renderBudgetTab();
      switchTab('tabBelanja');
    }
  });

  // Ekspor & Impor JSON
  document.getElementById('btnExportJson')?.addEventListener('click', () => {
    const backup = {
      budget: window.db.getBudget(),
      cart: window.db.getCart(),
      history: window.db.getHistory(),
      benchmarks: window.db.getBenchmarks()
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trolipintar-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Data berhasil diekspor!', 'toast-success');
  });

  // -------------------------------------------------------------
  // FILTER & SEARCH LOGIC
  // -------------------------------------------------------------
  const searchInput = document.getElementById('searchInput');
  searchInput?.addEventListener('input', (e) => {
    searchQuery = e.target.value.trim();
    renderGroceryList();
  });

  const categoryChips = document.querySelectorAll('.category-chip');
  categoryChips.forEach(chip => {
    chip.addEventListener('click', () => {
      categoryChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentFilterCategory = chip.dataset.category;
      renderGroceryList();
      triggerVibrate([15]);
    });
  });

  // -------------------------------------------------------------
  // TOAST NOTIFIKASI
  // -------------------------------------------------------------
  function showToast(msg, typeClass = 'toast-success') {
    const toast = document.getElementById('toastNotice');
    if (!toast) return;
    toast.textContent = msg;
    toast.className = `toast-notice show ${typeClass}`;
    setTimeout(() => {
      toast.classList.remove('show');
    }, 2400);
  }

  // -------------------------------------------------------------
  // PWA REGISTRATION & INSTALL PROMPT
  // -------------------------------------------------------------
  // Bersihkan cache lama secara proaktif di browser pengguna
  if ('caches' in window) {
    caches.keys().then((names) => {
      names.forEach((name) => {
        if (name !== 'trolipintar-v4') {
          caches.delete(name);
        }
      });
    });
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then((reg) => {
          reg.update(); // Pastikan mengambil sw.js terbaru
          console.log('Service Worker terdaftar:', reg.scope);
        })
        .catch(err => console.log('SW registration gagal:', err));
    });
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const banner = document.getElementById('pwaInstallBanner');
    if (banner) banner.style.display = 'flex';
  });

  document.getElementById('btnPwaInstall')?.addEventListener('click', () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then((choiceResult) => {
        if (choiceResult.outcome === 'accepted') {
          showToast('TroliPintar ditambahkan ke layar utama!', 'toast-success');
        }
        deferredPrompt = null;
        const banner = document.getElementById('pwaInstallBanner');
        if (banner) banner.style.display = 'none';
      });
    }
  });

  document.getElementById('btnClosePwaBanner')?.addEventListener('click', () => {
    const banner = document.getElementById('pwaInstallBanner');
    if (banner) banner.style.display = 'none';
  });

  // -------------------------------------------------------------
  // FIREBASE CLOUD SYNC & USER MODAL HANDLERS
  // -------------------------------------------------------------
  const userAccountModal = document.getElementById('userAccountModal');
  const btnUserAccount = document.getElementById('btnUserAccount');
  const btnCloseUserModal = document.getElementById('btnCloseUserModal');
  const btnApplyUserSwitch = document.getElementById('btnApplyUserSwitch');
  const btnCreateNewUser = document.getElementById('btnCreateNewUser');
  const manualUserSwitchInput = document.getElementById('manualUserSwitchInput');

  btnUserAccount?.addEventListener('click', () => {
    if (window.firebaseSync && typeof window.firebaseSync.getCurrentUserId === 'function') {
      const uid = window.firebaseSync.getCurrentUserId();
      const modalUid = document.getElementById('modalUserIdDisplay');
      const modalPath = document.getElementById('modalCollectionPath');
      if (modalUid) modalUid.textContent = uid || 'user1';
      if (modalPath) modalPath.textContent = `users/${uid || 'user1'}`;
      if (manualUserSwitchInput) manualUserSwitchInput.value = '';
    }
    userAccountModal?.classList.add('open');
  });

  btnCloseUserModal?.addEventListener('click', () => {
    userAccountModal?.classList.remove('open');
  });

  userAccountModal?.addEventListener('click', (e) => {
    if (e.target === userAccountModal) {
      userAccountModal.classList.remove('open');
    }
  });

  btnApplyUserSwitch?.addEventListener('click', async () => {
    const targetUser = manualUserSwitchInput?.value?.trim();
    if (!targetUser) {
      alert('Masukkan ID user yang dituju (contoh: user2)');
      return;
    }
    if (window.firebaseSync && typeof window.firebaseSync.switchUser === 'function') {
      await window.firebaseSync.switchUser(targetUser);
      showToast(`Beralih ke akun ${targetUser}!`, 'toast-success');
      userAccountModal?.classList.remove('open');
      currentCart = window.db.getCart();
      budgetCap = window.db.getBudget();
      renderGroceryList();
      renderHistoryTab();
      renderBudgetTab();
    }
  });

  btnCreateNewUser?.addEventListener('click', async () => {
    if (confirm('Buat ID akun perangkat baru berikutnya di cloud (user berikutnya)?')) {
      if (window.firebaseSync && typeof window.firebaseSync.createNewUser === 'function') {
        const newUid = await window.firebaseSync.createNewUser();
        showToast(`Akun baru dibuat: ${newUid}!`, 'toast-success');
        userAccountModal?.classList.remove('open');
        currentCart = window.db.getCart();
        budgetCap = window.db.getBudget();
        renderGroceryList();
        renderHistoryTab();
        renderBudgetTab();
      }
    }
  });

  // Listener ketika ada sinkronisasi dari Firebase Cloud Firestore
  window.addEventListener('trolipintar:synced', () => {
    currentCart = window.db.getCart();
    budgetCap = window.db.getBudget();
    renderGroceryList();
    renderHistoryTab();
    renderBudgetTab();
  });

  // Render awal
  renderGroceryList();
  renderHistoryTab();
  renderBudgetTab();
});
