const { WebcastPushConnection } = require('tiktok-live-connector');
const { EventEmitter } = require('events');

let globalConnectionCount = 0;

/**
 * TikTok LIVE connection wrapper with advanced reconnect functionality and error handling
 */
class TikTokConnectionWrapper extends EventEmitter {
    #connection;
    #uniqueId;
    #enableLog;
    #clientDisconnected = false;
    #reconnectEnabled = true;
    #reconnectCount = 0;
    #reconnectWaitMs = 1000;
    #maxReconnectAttempts = 5;
    #maxReconnectWaitMs = 32000; // Max wait time for reconnect

    constructor(uniqueId, options, enableLog = false) {
        super();
        this.#uniqueId = uniqueId;
        this.#enableLog = enableLog;
        this.#connection = new WebcastPushConnection(uniqueId, options);
        this.#setupEventListeners();
    }

    #setupEventListeners() {
        this.#connection.on('streamEnd', () => {
            this.#log(`Stream has ended, stopping reconnect attempts.`);
            this.#reconnectEnabled = false;
            this.emit('streamEnd');
        });

        this.#connection.on('disconnected', () => {
            globalConnectionCount = Math.max(0, globalConnectionCount - 1);
            this.#log(`TikTok connection disconnected`);
            this.#scheduleReconnect();
        });

        this.#connection.on('error', (err) => {
            this.#log(`Error: ${err.info}, ${err.exception}`);
            console.error(err);
        });
    }

    async connect(isReconnect = false) {
        try {
            const state = await this.#connection.connect();
            this.#log(`${isReconnect ? 'Reconnected' : 'Connected'} to roomId ${state.roomId}, WebSocket: ${state.upgradedToWebsocket}`);
            globalConnectionCount += 1;

            // Reset reconnect variables
            this.#reconnectCount = 0;
            this.#reconnectWaitMs = 1000;

            // If client requested disconnection while connecting, disconnect immediately
            if (this.#clientDisconnected) {
                this.disconnect();
                return;
            }

            if (!isReconnect) {
                this.emit('connected', state);
            }
        } catch (err) {
            this.#log(`${isReconnect ? 'Reconnect' : 'Connection'} failed: ${err.message}`);
            if (isReconnect) {
                this.#scheduleReconnect(err);
            } else {
                this.emit('disconnected', err.toString());
            }
        }
    }

    #scheduleReconnect(reason = 'Unknown error') {
        if (!this.#reconnectEnabled || this.#reconnectCount >= this.#maxReconnectAttempts) {
            this.#log(`Max reconnect attempts exceeded. Giving up.`);
            this.emit('disconnected', `Connection lost. ${reason}`);
            return;
        }

        this.#log(`Reconnecting in ${this.#reconnectWaitMs}ms (attempt ${this.#reconnectCount + 1}/${this.#maxReconnectAttempts})`);

        setTimeout(() => {
            if (!this.#reconnectEnabled || this.#reconnectCount >= this.#maxReconnectAttempts) return;

            this.#reconnectCount += 1;
            this.#reconnectWaitMs = Math.min(this.#reconnectWaitMs * 2, this.#maxReconnectWaitMs); // Exponential backoff with max limit

            this.connect(true);
        }, this.#reconnectWaitMs);
    }

    disconnect() {
        if (this.#clientDisconnected) return;

        this.#log(`Client disconnected.`);
        this.#clientDisconnected = true;
        this.#reconnectEnabled = false;

        if (this.#connection.getState()?.isConnected) {
            this.#connection.disconnect();
        }
    }

    #log(message) {
        if (this.#enableLog) {
            console.log(`WRAPPER @${this.#uniqueId}: ${message}`);
        }
    }
}

module.exports = {
    TikTokConnectionWrapper,
    getGlobalConnectionCount: () => globalConnectionCount,
};