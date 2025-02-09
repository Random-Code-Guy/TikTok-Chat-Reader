const ipRequestCounts = new Map();

const MAX_IP_CONNECTIONS = 10;
const MAX_IP_REQUESTS_PER_MINUTE = 5;

// Periodic cleanup of IP request counts to avoid memory leaks
setInterval(() => {
    ipRequestCounts.clear();
}, 60 * 1000);

/**
 * Determines if a client should be blocked based on IP rate limits.
 * @param {object} io - The Socket.IO server instance.
 * @param {object} currentSocket - The current client socket connection.
 * @returns {boolean} - Returns `true` if the client should be blocked, otherwise `false`.
 */
function clientBlocked(io, currentSocket) {
    const ipCounts = getOverallIpConnectionCounts(io);
    const currentIp = getSocketIp(currentSocket);

    if (!currentIp) {
        console.warn('LIMITER: Failed to retrieve socket IP.');
        return false;
    }

    const currentIpConnections = ipCounts.get(currentIp) || 0;
    const currentIpRequests = ipRequestCounts.get(currentIp) || 0;

    ipRequestCounts.set(currentIp, currentIpRequests + 1);

    if (currentIpConnections > MAX_IP_CONNECTIONS) {
        console.warn(`LIMITER: Max connection count of ${MAX_IP_CONNECTIONS} exceeded for client ${currentIp}`);
        return true;
    }

    if (currentIpRequests > MAX_IP_REQUESTS_PER_MINUTE) {
        console.warn(`LIMITER: Max request count of ${MAX_IP_REQUESTS_PER_MINUTE} exceeded for client ${currentIp}`);
        return true;
    }

    return false;
}

/**
 * Retrieves a map of active IP connections.
 * @param {object} io - The Socket.IO server instance.
 * @returns {Map<string, number>} - A map of IP addresses and their active connection counts.
 */
function getOverallIpConnectionCounts(io) {
    const ipCounts = new Map();

    io.of('/').sockets.forEach(socket => {
        const ip = getSocketIp(socket);
        if (!ip) return;

        ipCounts.set(ip, (ipCounts.get(ip) || 0) + 1);
    });

    return ipCounts;
}

/**
 * Extracts the client's IP address, handling forwarded headers if behind a proxy.
 * @param {object} socket - The client socket connection.
 * @returns {string|null} - The extracted IP address or `null` if unavailable.
 */
function getSocketIp(socket) {
    if (!socket.handshake || !socket.handshake.address) return null;

    const ip = socket.handshake.address;
    return ['::1', '::ffff:127.0.0.1'].includes(ip)
        ? socket.handshake.headers['x-forwarded-for'] || null
        : ip;
}

module.exports = {
    clientBlocked
};