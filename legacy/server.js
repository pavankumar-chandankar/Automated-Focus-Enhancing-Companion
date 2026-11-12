const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });

wss.on('connection', ws => {
    ws.on('message', message => {
        console.log('received: %s', message);
        ws.send(`Echo from server: ${message}`);
    });

    ws.send('Welcome to the WebSocket server!');
});

// client.js
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:8080');

ws.on('open', function open() {
    console.log('connected');
    ws.send('Hello Server!');
});

ws.on('message', function message(data) {
    console.log('received: %s', data);
});
