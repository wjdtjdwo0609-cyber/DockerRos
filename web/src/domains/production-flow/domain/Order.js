let nextOrderId = 0;

export const OrderStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  DONE: 'done',
};

export function hasOrderItems({ socket8 = 0, socket12 = 0 } = {}) {
  return socket8 > 0 || socket12 > 0;
}

export function createProductionOrder({ socket8 = 0, socket12 = 0, createdAt = new Date() } = {}) {
  return {
    id: ++nextOrderId,
    socket8,
    socket12,
    total: socket8 + socket12,
    status: OrderStatus.PENDING,
    createdAt,
  };
}
