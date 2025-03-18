#!/usr/bin/env node

const net = require('net');
const multiplex = require('multiplex');
const minimist = require('minimist');

// Parse arguments
const args = minimist(process.argv.slice(2), {
    string: ['tele-port-to', 'wait-port-on', 'teleport', 'password', 'timeout'],
    boolean: ['server'],
    default: {
        'wait-port-on': '4777',
        'tele-port-to': '5666',
        'timeout': '5000'
    }
});

function printUsage() {
    console.log(`Usage:

Server mode:
  blackhole --server [--password <password>] [--timeout <ms>] --tele-port-to <exposedPort> --wait-port-on <controlPort>

Example (Server):
  blackhole --server --password secret --tele-port-to 5666 --wait-port-on 4777 --timeout 5000


Client mode:
  blackhole --teleport <localHost:localPort> [--password <password>] [--timeout <ms>] <serverAddress>

Example (Client):
  blackhole --teleport localhost:3389 --password secret --timeout 5000 192.168.1.100
`);
}

// -----------------------------
// Helper: Setup the ephemeral tunnel (server "exposed" side)
// -----------------------------
function setupTunnel(plex, controlSocket, exposedPort, serverTimeout) {
    const exposedServer = net.createServer((clientSocket) => {
        console.log('Incoming connection on exposed port.');
        const plexStream = plex.createStream();
        clientSocket.pipe(plexStream).pipe(clientSocket);

        plexStream.on('close', () => {
            console.log('Tunnel closed for one client connection.');
        });
    });

    exposedServer.listen(exposedPort, () => {
        console.log(`Exposed server is listening on port ${exposedPort}`);
    });

    // When control socket closes, wait up to serverTimeout ms, then close the exposed server
    controlSocket.on('close', () => {
        console.log(`Client disconnected. Will wait up to ${serverTimeout}ms before closing the exposed port...`);
        setTimeout(() => {
            console.log('No reconnection occurred. Closing exposed server.');
            exposedServer.close();
        }, serverTimeout);
    });

    controlSocket.on('error', (err) => {
        console.error('Control socket error:', err);
    });
}

// -----------------------------
// Server mode
// -----------------------------
if (args.server) {
    const waitPort = parseInt(args['wait-port-on'], 10);
    const exposedPort = parseInt(args['tele-port-to'], 10);
    const serverPassword = args.password || null;
    const serverTimeout = parseInt(args.timeout, 10) || 5000;

    if (isNaN(waitPort) || isNaN(exposedPort)) {
        console.error('Invalid port number.');
        process.exit(1);
    }

    const controlServer = net.createServer((controlSocket) => {
        console.log('A client connected on the control channel.');

        // If password is set, verify it
        if (serverPassword) {
            let authBuffer = '';

            // We expect the first data chunk to contain the password plus newline
            controlSocket.once('data', (data) => {
                authBuffer += data.toString();
                const newlineIndex = authBuffer.indexOf('\n');
                if (newlineIndex === -1) {
                    console.error('Authentication error: expected a newline.');
                    controlSocket.end('Authentication failed\n');
                    return;
                }
                const provided = authBuffer.substring(0, newlineIndex).trim();
                if (provided !== serverPassword) {
                    console.error('Authentication error: wrong password.');
                    controlSocket.end('Authentication failed\n');
                    return;
                }
                // Auth OK – init multiplex. If leftover data remains, forward it.
                const remaining = authBuffer.substring(newlineIndex + 1);
                const plex = multiplex();
                if (remaining.length > 0) {
                    plex.write(remaining);
                }
                controlSocket.pipe(plex).pipe(controlSocket);
                setupTunnel(plex, controlSocket, exposedPort, serverTimeout);
            });
        } else {
            // No password required, start multiplex immediately
            const plex = multiplex();
            controlSocket.pipe(plex).pipe(controlSocket);
            setupTunnel(plex, controlSocket, exposedPort, serverTimeout);
        }
    });

    controlServer.listen(waitPort, () => {
        console.log(`Control server is listening on port ${waitPort}`);
    });

    controlServer.on('error', (err) => {
        console.error('Control server error:', err);
    });

// -----------------------------
// Client mode
// -----------------------------
} else if (args.teleport) {
    const teleportTarget = args.teleport; // Format: "host:port", e.g. "localhost:3389"
    const parts = teleportTarget.split(':');
    if (parts.length !== 2) {
        console.error('Invalid --teleport target. Expected format: host:port (e.g. localhost:3389)');
        process.exit(1);
    }
    const localHost = parts[0];
    const localPort = parseInt(parts[1], 10);
    if (isNaN(localPort)) {
        console.error('Invalid local port number.');
        process.exit(1);
    }

    // We'll read the server address from the remaining positional args
    const serverAddress = args._[0];
    if (!serverAddress) {
        console.error('In client mode you must specify a server address.');
        printUsage();
        process.exit(1);
    }

    // The control port to connect to (server's "wait-port-on")
    const controlPort = parseInt(args['wait-port-on'], 10) || 4777;

    // How many reconnect attempts?
    const maxRetries = 5;
    let retries = maxRetries;

    function attemptConnection() {
        if (retries <= 0) {
            console.error('All reconnection attempts have failed. Exiting.');
            process.exit(1);
        }
        retries--;

        console.log(`Attempting to connect to the server at ${serverAddress}:${controlPort}... (${maxRetries - retries}/${maxRetries})`);
        const controlSocket = net.connect({ host: serverAddress, port: controlPort }, () => {
            console.log('Connected to the control server.');

            // If password was given, send it first
            if (args.password) {
                controlSocket.write(args.password + "\n");
            }

            const plex = multiplex();
            controlSocket.pipe(plex).pipe(controlSocket);

            // For each new stream from the server, connect to local service
            plex.on('stream', (stream, id) => {
                console.log('New tunnel channel from the server.');
                const localSocket = net.connect({ host: localHost, port: localPort }, () => {
                    console.log(`Connected to local service at ${localHost}:${localPort}`);
                });
                stream.pipe(localSocket).pipe(stream);

                localSocket.on('error', (err) => {
                    console.error('Local connection error:', err);
                    stream.end();
                });
            });

            controlSocket.on('error', (err) => {
                console.error('Control socket error:', err);
            });

            controlSocket.on('close', () => {
                console.log('Control socket has closed. Will retry connection in 10 seconds...');
                setTimeout(attemptConnection, 10000);
            });
        });

        controlSocket.on('error', (err) => {
            console.error('Failed to connect to control server:', err.message);
            console.log('Will retry in 10 seconds...');
            setTimeout(attemptConnection, 10000);
        });
    }

    // Start initial connection
    attemptConnection();

// -----------------------------
// Neither server nor client mode => print usage
// -----------------------------
} else {
    printUsage();
    process.exit(1);
}
