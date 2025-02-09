require('dotenv').config();

const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { TikTokConnectionWrapper, getGlobalConnectionCount } = require('./connectionWrapper');
const { clientBlocked } = require('./limiter');

const app = express();
const httpServer = createServer(app);

// Enable cross-origin resource sharing
const io = new Server(httpServer, {
    cors: {
        origin: '*',
    },
});

io.on('connection', (socket) => {
    let tiktokConnectionWrapper = null;

    console.info('New connection from origin:', socket.handshake.headers['origin'] || socket.handshake.headers['referer']);

    socket.on('setUniqueId', (uniqueId, options = {}) => {
        // Prevent modification of sensitive options
        ['requestOptions', 'websocketOptions'].forEach((key) => delete options[key]);

        // Attach session ID from .env if available
        if (process.env.SESSIONID) {
            options.sessionId = process.env.SESSIONID;
            console.info('Using SessionId');
        }

        // Check rate limit before creating a connection
        if (process.env.ENABLE_RATE_LIMIT && clientBlocked(io, socket)) {
            socket.emit(
                'tiktokDisconnected',
                'Too many connections or requests. Please reduce usage or host your own server instance. Rate limits prevent TikTok from blocking the server IP.'
            );
            socket.disconnect(true);
            return;
        }

        try {
            // Establish connection
            tiktokConnectionWrapper = new TikTokConnectionWrapper(uniqueId, options, true);
            tiktokConnectionWrapper.connect();
        } catch (err) {
            socket.emit('tiktokDisconnected', err.toString());
            return;
        }

        // Forward connection events
        tiktokConnectionWrapper.once('connected', (state) => socket.emit('tiktokConnected', state));
        tiktokConnectionWrapper.once('disconnected', (reason) => socket.emit('tiktokDisconnected', reason));

        // Ensure clean disconnect when stream ends
        tiktokConnectionWrapper.connection.once('streamEnd', () => socket.emit('streamEnd'));

        // Dynamically forward all message events
        const events = [
            'roomUser',
            'member',
            'chat',
            'gift',
            'social',
            'like',
            'questionNew',
            'linkMicBattle',
            'linkMicArmies',
            'liveIntro',
            'emote',
            'envelope',
            'subscribe',
        ];

        events.forEach((event) => {
            tiktokConnectionWrapper.connection.on(event, (msg) => socket.emit(event, msg));
        });
    });

    socket.on('disconnect', () => {
        if (tiktokConnectionWrapper) {
            tiktokConnectionWrapper.disconnect();
        }
    });
});

// Emit global connection statistics every 5 seconds
setInterval(() => {
    io.emit('statistic', { globalConnectionCount: getGlobalConnectionCount() });
}, 5000);

// Serve frontend files
app.use(express.static('public'));

// Start HTTP server
const port = process.env.PORT || 8081;
httpServer.listen(port, () => console.info(`Server running! Visit http://localhost:${port}`));