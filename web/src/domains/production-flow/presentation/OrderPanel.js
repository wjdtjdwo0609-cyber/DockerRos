// Order entry panel (test stand-in for the eventual web order intake).
//
// Lets a developer/operator create orders like { socket8: 3, socket12: 2 }
// and see them in a queue. Eventually the real version will be replaced by
// HTTP/WS subscription to the website backend; this local panel keeps the
// exact same data model so swap-in is trivial.
//
// State exposed through `orders.active` / `orders.completed` arrays.
// Each order:
//   { id, socket8, socket12, total, status: 'pending'|'running'|'done', createdAt }
//
// Other modules can subscribe to changes via the EventTarget API:
//   panel.addEventListener('orders-changed', ...)

import { createProductionOrder, hasOrderItems, OrderStatus } from '../domain/Order.js';

export class OrderPanel extends EventTarget {
  constructor(rootEl) {
    super();
    this.rootEl = rootEl;
    this.active = [];      // pending + running
    this.completed = [];

    rootEl.querySelector('[data-order-submit]').addEventListener('click', () => {
      const s8 = parseInt(rootEl.querySelector('[data-order-8]').value, 10) || 0;
      const s12 = parseInt(rootEl.querySelector('[data-order-12]').value, 10) || 0;
      this.submit({ socket8: s8, socket12: s12 });
    });
    rootEl.querySelector('[data-order-close]').addEventListener('click', () => {
      this.hide();
    });
    rootEl.addEventListener('click', (e) => {
      const id = e.target?.dataset?.orderComplete;
      if (id) this.markDone(parseInt(id, 10));
      const cancelId = e.target?.dataset?.orderCancel;
      if (cancelId) this.cancel(parseInt(cancelId, 10));
    });

    this._render();
  }

  show() { this.rootEl.classList.remove('hidden'); }
  hide() { this.rootEl.classList.add('hidden'); }
  toggle() {
    if (this.rootEl.classList.contains('hidden')) this.show();
    else this.hide();
  }

  reset() {
    this.active = [];
    this.completed = [];
    this._render();
    this._fire();
  }

  submit({ socket8 = 0, socket12 = 0 }) {
    if (!hasOrderItems({ socket8, socket12 })) return;
    const order = createProductionOrder({ socket8, socket12 });
    this.active.push(order);
    this._render();
    this._fire();
    return order;
  }

  markDone(id) {
    const idx = this.active.findIndex((o) => o.id === id);
    if (idx === -1) return;
    const [order] = this.active.splice(idx, 1);
    order.status = OrderStatus.DONE;
    order.completedAt = new Date();
    this.completed.unshift(order);
    if (this.completed.length > 10) this.completed.length = 10;
    this._render();
    this._fire();
  }

  cancel(id) {
    const idx = this.active.findIndex((o) => o.id === id);
    if (idx === -1) return;
    this.active.splice(idx, 1);
    this._render();
    this._fire();
  }

  _fire() {
    this.dispatchEvent(new CustomEvent('orders-changed', {
      detail: { active: [...this.active], completed: [...this.completed] },
    }));
  }

  _render() {
    const list = this.rootEl.querySelector('[data-order-active-list]');
    list.innerHTML = '';
    if (this.active.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'order-empty';
      empty.textContent = '대기 중인 주문 없음';
      list.appendChild(empty);
    } else {
      for (const o of this.active) {
        const row = document.createElement('div');
        row.className = 'order-row';
        const desc = document.createElement('span');
        desc.className = 'order-desc';
        const parts = [];
        if (o.socket8) parts.push(`8핀×${o.socket8}`);
        if (o.socket12) parts.push(`12핀×${o.socket12}`);
        desc.textContent = `#${o.id}  ${parts.join(' + ')}`;
        const btnDone = document.createElement('button');
        btnDone.textContent = '완료';
        btnDone.dataset.orderComplete = o.id;
        btnDone.className = 'order-done-btn';
        const btnCancel = document.createElement('button');
        btnCancel.textContent = '취소';
        btnCancel.dataset.orderCancel = o.id;
        btnCancel.className = 'order-cancel-btn';
        row.appendChild(desc);
        row.appendChild(btnDone);
        row.appendChild(btnCancel);
        list.appendChild(row);
      }
    }

    const histList = this.rootEl.querySelector('[data-order-completed-list]');
    histList.innerHTML = '';
    for (const o of this.completed) {
      const row = document.createElement('div');
      row.className = 'order-row order-row-done';
      const parts = [];
      if (o.socket8) parts.push(`8핀×${o.socket8}`);
      if (o.socket12) parts.push(`12핀×${o.socket12}`);
      row.textContent = `✓ #${o.id}  ${parts.join(' + ')}`;
      histList.appendChild(row);
    }

    // Header counts
    this.rootEl.querySelector('[data-order-active-count]').textContent = this.active.length;
  }
}
