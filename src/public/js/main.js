// NetPoint Store storefront helpers
(function () {
  'use strict';

  function toast(message) {
    var el = document.getElementById('toast');
    if (!el) { alert(message); return; }
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }

  function post(url, data, isForm) {
    if (isForm) {
      return fetch(url, { method: 'POST', body: data });
    }
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data || {}),
    }).then(function (r) { return r.json(); });
  }

  // ---- cart ----------------------------------------------------------------

  window.addToCart = function (event, productId) {
    event.preventDefault();
    var qtyInput = document.getElementById('qty-' + productId);
    post('/cart/add', { product_id: productId, qty: qtyInput ? qtyInput.value : 1 })
      .then(function (res) {
        if (!res.ok) throw new Error(res.error || 'Could not add item');
        toast('Added to cart');
        var badge = document.querySelector('.cart-link .badge');
        if (badge && res.count !== undefined) badge.textContent = res.count;
      })
      .catch(function (e) { toast(e.message); });
  };

  window.updateQty = function (input, productId) {
    post('/cart/update', { product_id: productId, qty: parseInt(input.value, 10) })
      .then(function () { window.location.reload(); });
  };

  window.removeItem = function (productId) {
    post('/cart/remove', { product_id: productId })
      .then(function () { window.location.reload(); });
  };

  window.checkCoupon = function () {
    var code = document.getElementById('coupon-code').value;
    var out = document.getElementById('coupon-result');
    post('/cart/coupon', { code: code }).then(function (res) {
      if (res.ok) {
        out.innerHTML = '<span class="stock-ok">✓ ' + code.toUpperCase() + '</span> — ' +
          res.percent_off + '% off. ' + (res.note || '') +
          (res.remaining === null ? '' : ' <span class="muted">(' + res.remaining + ' left)</span>');
        out.className = 'small';
      } else {
        out.innerHTML = '<span class="stock-bad">' + res.error + '</span>';
      }
    }).catch(function (e) { out.textContent = e.message; });
  };

  // ---- checkout ----------------------------------------------------------------

  window.placeOrder = function (event) {
    event.preventDefault();
    var form = event.target;

    var lines = [];
    document.querySelectorAll('.co-qty').forEach(function (input) {
      lines.push({
        product_id: input.getAttribute('data-id'),
        qty: parseInt(input.value, 10),
        // The basket the customer confirmed is what billing charges.
        price: parseFloat(input.getAttribute('data-price')),
      });
    });

    var payload = {
      items: lines,
      address: form.address.value,
      gift_message: form.gift_message.value,
      coupons: form.coupons.value,
    };

    post('/checkout', payload).then(function (res) {
      if (res.ok) {
        window.location.href = '/orders/' + res.orderId + '?msg=' + encodeURIComponent('Order placed successfully!');
      } else {
        toast(res.error || 'Checkout failed');
      }
    }).catch(function (e) { toast(e.message); });

    return false;
  };

  // ---- profile ----------------------------------------------------------------

  window.saveProfile = function (event) {
    event.preventDefault();
    var form = event.target;
    var data = {};
    new FormData(form).forEach(function (v, k) { data[k] = v; });

    post('/profile/update', data).then(function (res) {
      if (res.ok) {
        toast('Profile saved');
        setTimeout(function () { window.location.reload(); }, 600);
      } else {
        toast(res.error);
      }
    }).catch(function (e) { toast(e.message); });
    return false;
  };

  window.loadAvatarFromUrl = function () {
    var url = document.getElementById('avatar-url').value.trim();
    var out = document.getElementById('avatar-url-result');
    if (!url) { toast('Enter a URL first'); return; }

    out.textContent = 'Fetching…';
    post('/profile/avatar-url', { avatar_url: url }).then(function (res) {
      if (!res.ok) { out.textContent = 'Error: ' + res.error; return; }
      out.textContent =
        'Saved: ' + res.saved + '\nSize: ' + res.size + ' bytes\nContent-Type: ' + res.content_type +
        (res.preview ? '\n--- preview ---\n' + res.preview : '');
      document.getElementById('avatar-img').src = res.saved + '?t=' + Date.now();
    }).catch(function (e) { out.textContent = String(e); });
  };

  window.redeemPoints = function () {
    var points = parseInt(document.getElementById('redeem-points').value, 10);
    var out = document.getElementById('redeem-result');
    post('/account/redeem', { points: points }).then(function (res) {
      if (res.ok) {
        out.innerHTML = '<span class="stock-ok">✓ Redeemed!</span> Points left: ' + res.points_left +
          ', credit now EGP ' + Number(res.balance).toFixed(2);
      } else {
        out.innerHTML = '<span class="stock-bad">' + res.error + '</span>';
      }
    }).catch(function (e) { out.textContent = e.message; });
  };

  // ---- admin ----------------------------------------------------------------

  window.editProduct = function (p) {
    document.getElementById('pf-title').textContent = 'Edit product #' + p.id;
    document.getElementById('pf-id').value = p.id;
    document.getElementById('pf-name').value = p.name;
    document.getElementById('pf-desc').value = p.description || '';
    document.getElementById('pf-price').value = p.price;
    document.getElementById('pf-stock').value = p.stock;
    document.getElementById('pf-image').value = p.image_url || '';
    document.getElementById('pf-category').value = p.category_id || '';
    document.getElementById('pf-featured').checked = !!p.featured;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  window.deleteProduct = function (id) {
    if (!confirm('Delete product #' + id + '?')) return;
    var fd = new FormData(); fd.append('id', id);
    fetch('/admin/products/delete', { method: 'POST', body: fd })
      .then(function () { window.location.reload(); });
  };

  window.syncProductImage = function () {
    document.getElementById('sync-row').style.display = 'flex';
    var source = document.getElementById('image-url-source');
    source.focus();
    var handler = function () {
      var fd = new FormData(); fd.append('image_url_source', source.value);
      fetch('/admin/products/sync-image', { method: 'POST', body: fd })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          var out = document.getElementById('sync-result');
          if (!res.ok) { out.textContent = 'Error: ' + res.error; return; }
          out.textContent = 'Saved ' + res.saved + ' (' + res.size + ' bytes, ' + res.content_type + ')' +
            (res.preview ? '\n--- preview ---\n' + res.preview : '');
          document.getElementById('pf-image').value = res.saved;
        });
      source.removeEventListener('change', handler);
    };
    source.addEventListener('change', handler);
  };

  window.setOrderStatus = function (orderId, select) {
    var fd = new FormData();
    fd.append('id', orderId);
    fd.append('status', select.value);
    fetch('/admin/orders/status', { method: 'POST', body: fd })
      .then(function (r) { return r.json(); })
      .then(function (res) { toast(res.ok ? 'Status updated' : res.error); });
  };

  window.saveUserRole = function (uid, btn) {
    var row = btn.closest('tr');
    var role = row.querySelector('.role-select').value;
    var fd = new FormData();
    fd.append('id', uid);
    fd.append('role', role);
    fetch('/admin/users/role', { method: 'POST', body: fd })
      .then(function (r) { return r.json(); })
      .then(function (res) { toast(res.ok ? 'Role saved' : res.error); });
  };

  window.deleteUser = function (uid) {
    if (!confirm('Delete user #' + uid + '? This cannot be undone.')) return;
    var fd = new FormData(); fd.append('id', uid);
    fetch('/admin/users/delete', { method: 'POST', body: fd })
      .then(function (r) { return r.json(); })
      .then(function (res) { toast(res.ok ? 'User deleted' : res.error); if (res.ok) setTimeout(function () { window.location.reload(); }, 500); });
  };
})();
