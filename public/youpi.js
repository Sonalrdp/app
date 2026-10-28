/**
 * Cortex UPI Gateway — Universal Embeddable Client SDK
 * Zero dependencies. Embed in any external merchant website via:
 * <script src="http://localhost:5000/youpi.js"></script>
 */
(function(window, document) {
  'use strict';

  if (window.Youpi) return;

  const scriptTag = document.currentScript || (function() {
    const scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();

  const scriptSrc = scriptTag ? scriptTag.src : 'http://localhost:5000/youpi.js';
  const defaultHost = (function() {
    try {
      const u = new URL(scriptSrc);
      return u.origin;
    } catch {
      return 'http://localhost:5000';
    }
  })();

  let activeModal = null;

  function createModal(checkoutUrl, onCloseCallback, onSuccessCallback) {
    if (activeModal) closeModal();

    const overlay = document.createElement('div');
    overlay.id = 'youpi-checkout-overlay';
    overlay.style.cssText = [
      'position: fixed',
      'inset: 0',
      'z-index: 9999999',
      'background: rgba(15, 23, 42, 0.75)',
      'backdrop-filter: blur(8px)',
      '-webkit-backdrop-filter: blur(8px)',
      'display: flex',
      'align-items: center',
      'justify-content: center',
      'padding: 16px',
      'opacity: 0',
      'transition: opacity 0.25s cubic-bezier(0.16, 1, 0.3, 1)'
    ].join(';');

    const container = document.createElement('div');
    container.style.cssText = [
      'position: relative',
      'width: 100%',
      'max-width: 440px',
      'height: 650px',
      'max-height: 92vh',
      'background: #ffffff',
      'border-radius: 20px',
      'overflow: hidden',
      'box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.35)',
      'transform: scale(0.96)',
      'transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)'
    ].join(';');

    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '&times;';
    closeBtn.style.cssText = [
      'position: absolute',
      'top: 14px',
      'right: 14px',
      'z-index: 10',
      'width: 32px',
      'height: 32px',
      'border: none',
      'border-radius: 50%',
      'background: rgba(0, 0, 0, 0.08)',
      'color: #334155',
      'font-size: 22px',
      'line-height: 1',
      'cursor: pointer',
      'display: flex',
      'align-items: center',
      'justify-content: center',
      'transition: background 0.15s'
    ].join(';');
    closeBtn.onmouseenter = () => closeBtn.style.background = 'rgba(0, 0, 0, 0.15)';
    closeBtn.onmouseleave = () => closeBtn.style.background = 'rgba(0, 0, 0, 0.08)';

    const iframe = document.createElement('iframe');
    iframe.src = checkoutUrl;
    iframe.style.cssText = 'width:100%; height:100%; border:none; display:block;';

    container.appendChild(closeBtn);
    container.appendChild(iframe);
    overlay.appendChild(container);
    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
      overlay.style.opacity = '1';
      container.style.transform = 'scale(1)';
    });

    function closeModal() {
      if (!overlay.parentNode) return;
      overlay.style.opacity = '0';
      container.style.transform = 'scale(0.96)';
      setTimeout(() => {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        window.removeEventListener('message', handleMessage);
        activeModal = null;
        if (typeof onCloseCallback === 'function') onCloseCallback();
      }, 200);
    }

    function handleMessage(e) {
      if (!e.data || typeof e.data !== 'object') return;
      if (e.data.type === 'YOUPI_PAYMENT_SUCCESS') {
        const detail = e.data.order;
        window.dispatchEvent(new CustomEvent('youpi:payment:success', { detail }));
        window.dispatchEvent(new CustomEvent('youpi:payment:result', { detail: { ...detail, status: 'SUCCESS' } }));
        if (typeof onSuccessCallback === 'function') onSuccessCallback(detail);
        setTimeout(closeModal, 1500);
      } else if (e.data.type === 'YOUPI_MODAL_CLOSE') {
        closeModal();
      }
    }

    closeBtn.onclick = closeModal;
    overlay.onclick = (e) => {
      if (e.target === overlay) closeModal();
    };
    window.addEventListener('message', handleMessage);

    activeModal = { overlay, closeModal };
  }

  const Youpi = {
    pay: async function(options = {}) {
      const host = options.gateway_url || defaultHost;
      let orderId = options.order_id;
      let checkoutUrl = '';

      if (options.checkout_url) {
        checkoutUrl = options.checkout_url;
      } else {
        try {
          const res = await fetch(`${host}/api/orders/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              amount: options.amount,
              order_id: orderId,
              product_name: options.product_name || 'Checkout Order',
              customer_name: options.customer?.name || options.customer_name,
              customer_email: options.customer?.email || options.customer_email,
              customer_phone: options.customer?.phone || options.customer_phone,
              metadata: options.metadata
            })
          });
          const json = await res.json();
          if (!json.success || !json.order) {
            throw new Error(json.error || 'Failed to create order session');
          }
          checkoutUrl = json.order.checkout_url;
        } catch (err) {
          alert('Gateway Error: ' + err.message);
          return;
        }
      }

      createModal(checkoutUrl, options.onClose, options.handler);
    }
  };

  // Auto-bind click handlers for [data-youpi-pay] elements
  document.addEventListener('click', function(e) {
    const trigger = e.target.closest('[data-youpi-pay]');
    if (!trigger) return;
    e.preventDefault();

    const amount = trigger.getAttribute('data-amount') || '100';
    const orderId = trigger.getAttribute('data-order-id');
    const productName = trigger.getAttribute('data-product-name') || 'Item';
    const metaStr = trigger.getAttribute('data-metadata');
    let metadata = null;
    if (metaStr) {
      try { metadata = JSON.parse(metaStr); } catch {}
    }

    Youpi.pay({
      amount,
      order_id: orderId,
      product_name: productName,
      metadata,
      handler: function(order) {
        console.log('[YouPI Gateway] Payment confirmed:', order);
      }
    });
  });

  window.Youpi = Youpi;
})(window, document);

