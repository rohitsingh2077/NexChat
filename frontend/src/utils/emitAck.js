// Wraps a socket emit-with-ack in a Promise, with a client-side timeout so a
// dropped connection doesn't leave a caller waiting forever for an ack that
// will never arrive. Shared by every socket-based mutation (channel
// messages, documents) that needs to know whether its emit actually
// succeeded, not just that it was sent - originally lived only inside
// ChannelMessages.jsx, pulled out here once the document editor needed the
// identical helper.
export const emitAck = (socket, event, payload, timeoutMs = 8000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Request timed out")), timeoutMs);
    socket.emit(event, payload, (ack) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
