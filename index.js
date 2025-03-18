#!/usr/bin/env node

const fs = require('fs');
const net = require('net');
const multiplex = require('multiplex');
const minimist = require('minimist');

// =============== CONFIG / JSON LOADING LOGIC ===============
function fileExists(path) {
    try {
        fs.accessSync(path, fs.constants.F_OK);
        return true;
    } catch (err) {
        return false;
    }
}

function loadServerConfig(path) {
    const raw = fs.readFileSync(path, 'utf8');
    const config = JSON.parse(raw);

    // Verify required fields
    if (typeof config.waitPort !== 'number' || typeof config.exposedPort !== 'number') {
        throw new Error('Invalid server.json: "waitPort" and "exposedPort" must be numbers.');
    }
    // Optional fields
    config.password = config.password || null;
    config.timeout = typeof config.timeout === 'number' ? config.timeout : 5000;

    return config;
}

function loadClientConfig(path) {
    const raw = fs.readFileSync(path, 'utf8');
    const config = JSON.parse(raw);

    // Verify required fields
    if (typeof config.serverAddress !== 'string') {
        throw new Error('Invalid client.json: missing "serverAddress" field (string).');
    }
    if (typeof config.serverPort !== 'number') {
        throw new Error('Invalid client.json: missing or invalid "serverPort" field (number).');
    }
    if (typeof config.teleportHost !== 'string') {
        throw new Error('Invalid client.json: missing "teleportHost" field (string).');
    }
    if (typeof config.teleportPort !== 'number') {
        throw new Error('Invalid client.json: missing or invalid "teleportPort" field (number).');
    }
    // Optional fields
    config.password = config.password || null;
    config.timeout = typeof config.timeout === 'number' ? config.timeout : 5000;

    return config;
}

function generateServerJson() {
    const example = {
        "waitPort": 4777,
        "exposedPort": 5666,
        "password": "secret",
        "timeout": 5000
    };
    fs.writeFileSync('server.json', JSON.stringify(example, null, 2), 'utf8');
    console.log('Example server.json created in the current directory.');
}

function generateClientJson() {
    const example = {
        "serverAddress": "192.168.1.100",
        "serverPort": 4777,
        "teleportHost": "localhost",
        "teleportPort": 3389,
        "password": "secret",
        "timeout": 5000
    };
    fs.writeFileSync('client.json', JSON.stringify(example, null, 2), 'utf8');
    console.log('Example client.json created in the current directory.');
}

// =============== ARG PARSING ===============
const args = minimist(process.argv.slice(2), {
    string: [
        'tele-port-to',
        'wait-port-on',
        'teleport',
        'password',
        'timeout',
        'generate'
    ],
    boolean: ['server'],
    default: {
        'wait-port-on': '4777',
        'tele-port-to': '5666',
        'timeout': '5000'
    }
});

function printUsage() {
    console.log(`Usage:

  blackhole [options]

Modes:
  --server                       (server mode)
     --tele-port-to <port>      (port to expose, e.g. 5666)
     --wait-port-on <port>      (control port, e.g. 4777)
     --password <password>      (optional)
     --timeout <ms>             (optional, default 5000)

  --teleport <host:port>        (client mode)
     [--password <password>]
     [--timeout <ms>]           (optional, default 5000)
     <serverAddress>            (control server address)

Examples:
  1) Server mode:
     blackhole --server --password secret --tele-port-to 5666 --wait-port-on 4777 --timeout 5000

  2) Client mode:
     blackhole --teleport localhost:3389 --password secret 192.168.1.100 --timeout 5000

Config files:
  If no explicit mode is chosen, blackhole checks server.json or client.json in current directory.
  - If server.json is found, blackhole runs in server mode with config from file.
  - If server.json is not found but client.json is found, blackhole runs in client mode with config from file.

Generate config:
  blackhole --generate server   (creates sample server.json)
  blackhole --generate client   (creates sample client.json)
`);
}

// =============== LOGIC FOR --generate server/client ===============
if (args.generate === 'server') {
    generateServerJson();
    process.exit(0);
}
if (args.generate === 'client') {
    generateClientJson();
    process.exit(0);
}

// =============== DETERMINE MODE BASED ON ARGS OR CONFIG FILES ===============
let mode = null;        // 'server' | 'client'
let useConfigFile = false;

if (args.server) {
    mode = 'server';
} else if (args.teleport) {
    mode = 'client';
} else {
    // No direct mode flags => check config files
    const hasServerConfig = fileExists('server.json');
    const hasClientConfig = fileExists('client.json');

    if (hasServerConfig) {
        mode = 'server';
        useConfigFile = true;
    } else if (hasClientConfig) {
        mode = 'client';
        useConfigFile = true;
    }
}

if (!mode) {
    // Still no mode => print usage
    printUsage();
    process.exit(1);
}

// ================== HELPER: niceErrorLog function ==================
function niceErrorLog(context, err) {
    // If it's ECONNRESET, print a simpler message
    if (err && err.code === 'ECONNRESET') {
        console.log(`[${context}] Remote side closed the connection forcibly (ECONNRESET). Code: ${err.code}`);
    } else {
        // Otherwise, show code (if present) and message
        console.error(`[${context}] Socket error ${err.code ? '[' + err.code + ']' : ''}: ${err.message || err}`);
    }
}

// =============== SERVER SETUP FUNCTION ===============
function setupTunnel(plex, controlSocket, exposedPort, serverTimeout) {
    const exposedServer = net.createServer((clientSocket) => {
        console.log('Incoming connection on exposed port.');

        // Create a new stream in the multiplex
        const plexStream = plex.createStream();

        // Tunnel data
        clientSocket.pipe(plexStream).pipe(clientSocket);

        // Log close event
        plexStream.on('close', () => {
            console.log('Tunnel closed for one client connection.');
        });

        // Catch errors on the clientSocket
        clientSocket.on('error', (err) => {
            niceErrorLog('Exposed server clientSocket', err);
        });

        // Catch errors on the plexStream
        plexStream.on('error', (err) => {
            niceErrorLog('Plex stream', err);
        });
    });

    exposedServer.listen(exposedPort, () => {
        console.log(`Exposed server is listening on port ${exposedPort}`);
    });

    // Handle control socket close with a timeout
    controlSocket.on('close', () => {
        console.log(`Client disconnected. Will wait up to ${serverTimeout}ms before closing the exposed port...`);
        setTimeout(() => {
            console.log('No reconnection occurred. Closing exposed server.');
            exposedServer.close();
        }, serverTimeout);
    });

    // Handle control socket errors
    controlSocket.on('error', (err) => {
        niceErrorLog('Control socket', err);
    });
}

// =============== SERVER MODE ===============
if (mode === 'server') {
    let waitPort, exposedPort, serverPassword, serverTimeout;
    
    if (useConfigFile) {
        // Load from server.json
        try {
            const config = loadServerConfig('server.json');
            waitPort = config.waitPort;
            exposedPort = config.exposedPort;
            serverPassword = config.password;
            serverTimeout = config.timeout;
        } catch (err) {
            console.error(`Failed to load server.json: ${err.message}`);
            process.exit(1);
        }
    } else {
        // Load from CLI args
        waitPort = parseInt(args['wait-port-on'], 10);
        exposedPort = parseInt(args['tele-port-to'], 10);
        serverPassword = args.password || null;
        serverTimeout = parseInt(args.timeout, 10) || 5000;
    }

    if (isNaN(waitPort) || isNaN(exposedPort)) {
        console.error('Invalid port number for server mode.');
        process.exit(1);
    }

    const controlServer = net.createServer((controlSocket) => {
        console.log('A client connected on the control channel.');

        // If password is set, verify it
        if (serverPassword) {
            let authBuffer = '';

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
                // Auth OK – init multiplex
                const remaining = authBuffer.substring(newlineIndex + 1);
                const plex = multiplex();

                // Optional: if any leftover data remains in the buffer
                if (remaining.length > 0) {
                    plex.write(remaining);
                }

                controlSocket.pipe(plex).pipe(controlSocket);
                setupTunnel(plex, controlSocket, exposedPort, serverTimeout);
            });
        } else {
            // No password – init multiplex
            const plex = multiplex();
            controlSocket.pipe(plex).pipe(controlSocket);
            setupTunnel(plex, controlSocket, exposedPort, serverTimeout);
        }
    });

    controlServer.listen(waitPort, () => {
        console.log(`Control server is listening on port ${waitPort}`);
    });

    controlServer.on('error', (err) => {
        niceErrorLog('Control server', err);
    });

// =============== CLIENT MODE ===============
} else if (mode === 'client') {
    let serverAddress, controlPort, localHost, localPort, clientPassword, clientTimeout;

    if (useConfigFile) {
        // Load from client.json
        try {
            const config = loadClientConfig('client.json');
            serverAddress = config.serverAddress;
            controlPort = config.serverPort;
            localHost = config.teleportHost;
            localPort = config.teleportPort;
            clientPassword = config.password;
            clientTimeout = config.timeout; // not directly used in retries, but available
        } catch (err) {
            console.error(`Failed to load client.json: ${err.message}`);
            process.exit(1);
        }
    } else {
        // Load from CLI
        const teleportTarget = args.teleport; // e.g. "localhost:3389"
        const parts = teleportTarget.split(':');
        if (parts.length !== 2) {
            console.error('Invalid --teleport target. Expected format: host:port (e.g. localhost:3389)');
            process.exit(1);
        }
        localHost = parts[0];
        localPort = parseInt(parts[1], 10);
        if (isNaN(localPort)) {
            console.error('Invalid local port number.');
            process.exit(1);
        }
        serverAddress = args._[0];
        if (!serverAddress) {
            console.error('In client mode you must specify a server address.');
            printUsage();
            process.exit(1);
        }
        controlPort = parseInt(args['wait-port-on'], 10) || 4777;
        clientPassword = args.password || null;
        clientTimeout = parseInt(args.timeout, 10) || 5000;
    }

    // We'll try up to 5 times
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

            // If password was given, send it
            if (clientPassword) {
                controlSocket.write(clientPassword + "\n");
            }

            const plex = multiplex();
            controlSocket.pipe(plex).pipe(controlSocket);

            // For each new stream from the server, connect to local service
            plex.on('stream', (stream, id) => {
                console.log('New tunnel channel from the server.');
                const localSocket = net.connect({ host: localHost, port: localPort }, () => {
                    console.log(`Connected to local service at ${localHost}:${localPort}`);
                });

                // Pipe data both ways
                stream.pipe(localSocket).pipe(stream);

                // Handle local socket errors
                localSocket.on('error', (err) => {
                    niceErrorLog('Local connection', err);
                    stream.end();
                });

                // Handle errors on the tunnel stream
                stream.on('error', (err) => {
                    niceErrorLog('Tunnel stream', err);
                    localSocket.end();
                });
            });

            // Handle control socket errors
            controlSocket.on('error', (err) => {
                niceErrorLog('Control socket', err);
            });

            // If the control socket closes, try reconnecting in 10s
            controlSocket.on('close', () => {
                console.log('Control socket has closed. Will retry connection in 10 seconds...');
                setTimeout(attemptConnection, 10000);
            });
        });

        controlSocket.on('error', (err) => {
            console.log('Failed to connect to control server:', err.message);
            console.log('Will retry in 10 seconds...');
            setTimeout(attemptConnection, 10000);
        });
    }

    // Start initial connection
    attemptConnection();
}
