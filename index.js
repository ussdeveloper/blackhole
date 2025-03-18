#!/usr/bin/env node

const net = require('net');
const multiplex = require('multiplex');
const minimist = require('minimist');

// Parsowanie argumentów
const args = minimist(process.argv.slice(2), {
    string: ['tele-port-to', 'wait-port-on', 'teleport', 'password'],
    boolean: ['server'],
    default: {
        'wait-port-on': '4777',
        'tele-port-to': '5666'
    }
});

function printUsage() {
    console.log(`Użycie:

Tryb serwera:
  blackhole --server [--password <hasło>] --tele-port-to <exposedPort> --wait-port-on <controlPort>
Przykład:
  blackhole --server --password secret --tele-port-to 5666 --wait-port-on 4777

Tryb klienta:
  blackhole --teleport <localTarget> [--password <hasło>] <serverAddress>
Przykład:
  blackhole --teleport localhost:3389 --password secret 192.168.1.100
`);
}

// Funkcja pomocnicza tworząca tunel (serwer "eksponowany")
function setupTunnel(plex, controlSocket, exposedPort) {
    const exposedServer = net.createServer((clientSocket) => {
        console.log('Nadeszło połączenie na wystawionym porcie.');
        const plexStream = plex.createStream();
        clientSocket.pipe(plexStream).pipe(clientSocket);
        plexStream.on('close', () => {
            console.log('Tunel zakończony dla jednego połączenia.');
        });
    }).listen(exposedPort, () => {
        console.log(`Serwer wystawiony nasłuchuje na porcie ${exposedPort}`);
    });

    controlSocket.on('close', () => {
        console.log('Połączenie kontrolne zakończone. Zamykam serwer wystawiony.');
        exposedServer.close();
    });

    controlSocket.on('error', (err) => {
        console.error('Błąd połączenia kontrolnego:', err);
    });
}

// Tryb serwera
if (args.server) {
    const waitPort = parseInt(args['wait-port-on'], 10);
    const exposedPort = parseInt(args['tele-port-to'], 10);
    const serverPassword = args.password || null;

    if (isNaN(waitPort) || isNaN(exposedPort)) {
        console.error('Niepoprawny numer portu.');
        process.exit(1);
    }

    const controlServer = net.createServer((controlSocket) => {
        console.log('Klient połączył się na kanale kontrolnym.');
        
        // Jeśli ustawione jest hasło, weryfikuj autoryzację
        if (serverPassword) {
            let authBuffer = '';
            // Odbieramy pierwsze dane, które powinny zawierać hasło zakończone znakiem nowej linii
            controlSocket.once('data', (data) => {
                authBuffer += data.toString();
                const newlineIndex = authBuffer.indexOf('\n');
                if (newlineIndex === -1) {
                    console.error('Błąd autoryzacji: oczekiwano znaku nowej linii.');
                    controlSocket.end('Authentication failed\n');
                    return;
                }
                const provided = authBuffer.substring(0, newlineIndex).trim();
                if (provided !== serverPassword) {
                    console.error('Błąd autoryzacji: złe hasło.');
                    controlSocket.end('Authentication failed\n');
                    return;
                }
                // Autoryzacja OK – inicjujemy multiplex. Jeśli zostały dodatkowe dane, przekazujemy je dalej.
                const remaining = authBuffer.substring(newlineIndex + 1);
                const plex = multiplex();
                if (remaining.length > 0) {
                    plex.write(remaining);
                }
                controlSocket.pipe(plex).pipe(controlSocket);
                setupTunnel(plex, controlSocket, exposedPort);
            });
        } else {
            // Bez hasła – od razu uruchamiamy multiplex
            const plex = multiplex();
            controlSocket.pipe(plex).pipe(controlSocket);
            setupTunnel(plex, controlSocket, exposedPort);
        }
    });

    controlServer.listen(waitPort, () => {
        console.log(`Serwer kontrolny nasłuchuje na porcie ${waitPort}`);
    });

    controlServer.on('error', (err) => {
        console.error('Błąd serwera kontrolnego:', err);
    });

// Tryb klienta
} else if (args.teleport) {
    const teleportTarget = args.teleport; // Format: "host:port", np. "localhost:3389"
    const parts = teleportTarget.split(':');
    if (parts.length !== 2) {
        console.error('Niepoprawny cel teleportacji. Oczekiwany format: host:port, np. localhost:3389');
        process.exit(1);
    }
    const localHost = parts[0];
    const localPort = parseInt(parts[1], 10);
    if (isNaN(localPort)) {
        console.error('Niepoprawny numer portu lokalnego.');
        process.exit(1);
    }

    // Adres serwera kontrolnego – wymagany jako argument pozycyjny
    const serverAddress = args._[0];
    if (!serverAddress) {
        console.error('W trybie klienta wymagany jest adres serwera.');
        printUsage();
        process.exit(1);
    }

    // Opcjonalnie można przekazać --wait-port-on, domyślnie 4777
    const controlPort = parseInt(args['wait-port-on'], 10) || 4777;

    const controlSocket = net.connect({ host: serverAddress, port: controlPort }, () => {
        console.log(`Połączono z serwerem kontrolnym ${serverAddress}:${controlPort}`);
        // Jeśli podano hasło, wysyłamy je jako pierwszą wiadomość zakończoną nową linią
        if (args.password) {
            controlSocket.write(args.password + "\n");
        }
    });

    const plex = multiplex();
    controlSocket.pipe(plex).pipe(controlSocket);

    // Obsługa nowych kanałów – dla każdego połączenia przychodzącego na serwerze "eksponowanym"
    plex.on('stream', (stream, id) => {
        console.log('Otrzymano nowy kanał tunelowy z serwera.');
        // Łączymy się z lokalną usługą
        const localSocket = net.connect({ host: localHost, port: localPort }, () => {
            console.log(`Połączono z lokalną usługą ${localHost}:${localPort}`);
        });
        stream.pipe(localSocket).pipe(stream);

        localSocket.on('error', (err) => {
            console.error('Błąd połączenia lokalnego:', err);
            stream.end();
        });
    });

    controlSocket.on('error', (err) => {
        console.error('Błąd połączenia kontrolnego:', err);
    });
} else {
    printUsage();
    process.exit(1);
}
