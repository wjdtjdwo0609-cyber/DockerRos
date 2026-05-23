export class EventBus extends EventTarget {
  publish(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  subscribe(type, handler) {
    this.addEventListener(type, handler);
    return () => this.removeEventListener(type, handler);
  }
}
