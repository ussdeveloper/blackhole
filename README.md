# Blackhole

Blackhole is a simple Node.js tool for creating a TCP tunnel between a client machine and a server machine. It "teleports" (forwards) a port from a client computer to a server with a public IP address, allowing access to locally running services (e.g., RDP, HTTP) from the internet or other networks.

## Features

- **Server mode** – Listens on a control port (default 4777) and exposes a selected port (e.g., 5666) for incoming connections, forwarding them to the client.
- **Client mode** – Connects to the server, forwarding data to a local service (e.g., localhost:3389).
- **Simple password authentication** – Optionally add the `--password` parameter to enforce a password when connecting.
- **Automatic reconnections on the client side** – The client will attempt up to 5 reconnections (waiting 10 seconds between attempts) if the connection is lost.
- **Graceful timeout on the server** – After the client disconnects, the server keeps the exposed port open for a configurable time (default 5000ms) before shutting it down.
- **Configuration files** – Automatically loads configuration from `server.json` or `client.json` if no CLI options are provided.
- **Config file generation** – Use `--generate server` or `--generate client` to create example JSON config files.

## Requirements

- Node.js (version 14+ or newer)
- npm packages: `minimist` and `multiplex`
- _(Optional)_ `pkg` if you want to build a standalone executable

## Installation

Clone the repository:

```bash
git clone https://github.com/your-username/blackhole.git
cd blackhole
```

Install dependencies:

```bash
npm install
```

_(Optional)_ Build an executable using pkg:

```bash
npm install --global pkg
pkg . --targets node16-linux-x64,node16-win-x64
```

This will generate executable files (e.g., `blackhole-linux` and `blackhole-win.exe`).

## Usage

Run the script with:

```bash
node index.js [options]
```

or use a generated binary (e.g., `./blackhole` or `blackhole.exe`).

### Server Mode (CLI)

```bash
blackhole --server --tele-port-to <exposedPort> --wait-port-on <controlPort> [--password <password>] [--timeout <ms>]
```

- `--server` – Enables server mode.
- `--tele-port-to <exposedPort>` – Port where the service is exposed (e.g., 5666).
- `--wait-port-on <controlPort>` – Control port where the server listens for client connections (default 4777).
- `--password <password>` – _(Optional)_ Password required for connection.
- `--timeout <ms>` – _(Optional)_ Time to wait (in ms) after the client disconnects before closing the exposed port (default 5000).

**Example:**

```bash
blackhole --server --tele-port-to 5666 --wait-port-on 4777 --password secret --timeout 5000
```

The server listens on port 4777, exposes port 5666, and requires the password `secret`. It waits 5 seconds before closing the exposed port when the client disconnects.

### Client Mode (CLI)

```bash
blackhole --teleport <localHost:localPort> [--password <password>] [--timeout <ms>] <serverAddress>
```

- `--teleport <localHost:localPort>` – Local service address and port (e.g., `localhost:3389`).
- `--password <password>` – _(Optional)_ Password that must match the server configuration.
- `--timeout <ms>` – _(Optional)_ Auxiliary parameter (not directly used for the client’s retry logic).
- `<serverAddress>` – IP address or hostname of the server running in server mode.

**Example:**

```bash
blackhole --teleport localhost:3389 --password secret --timeout 5000 192.168.1.100
```

The client connects to `192.168.1.100` on the default control port 4777, forwarding `localhost:3389`.

## Configuration Files: server.json and client.json

Blackhole can automatically run in server or client mode using configuration files if no CLI arguments are provided.

### server.json (for server mode)

Example contents:

```json
{
  "waitPort": 4777,
  "exposedPort": 5666,
  "password": "secret",
  "timeout": 5000
}
```

- `waitPort` – The server's control port.
- `exposedPort` – Port exposed to incoming connections.
- `password` – _(Optional)_ Password for authentication.
- `timeout` – _(Optional)_ Idle time in milliseconds to wait before shutting down after disconnection.

### client.json (for client mode)

Example contents:

```json
{
  "serverAddress": "192.168.1.100",
  "serverPort": 4777,
  "teleportHost": "localhost",
  "teleportPort": 3389,
  "password": "secret",
  "timeout": 5000
}
```

- `serverAddress` – Address of the control server.
- `serverPort` – Control port on the server.
- `teleportHost` – Host/IP of the local service.
- `teleportPort` – Port of the local service.
- `password` – _(Optional)_ Password for authentication.
- `timeout` – _(Optional)_ Available for use if needed.

**Behavior:**

- If a `server.json` is present, running `blackhole` (without `--server` or `--teleport` flags) starts in server mode.
- If no `server.json` is found but a `client.json` is present, it starts in client mode.
- If both files exist, `server.json` takes priority.
- If neither file is found, a usage message will be displayed.

## Generating Example Config Files

Generate example configuration files by running:

```bash
blackhole --generate server
blackhole --generate client
```

Each command creates the corresponding JSON file (`server.json` or `client.json`) with sample values.

## Example Scenario (RDP)

**Server (with a public IP):**

Use CLI:

```bash
blackhole --server --tele-port-to 5666 --wait-port-on 4777 --password super-secret-password --timeout 5000
```

or create a `server.json`:

```json
{
  "waitPort": 4777,
  "exposedPort": 5666,
  "password": "super-secret-password",
  "timeout": 5000
}
```

then run:

```bash
blackhole
```

**Client (with RDP on port 3389):**

Use CLI:

```bash
blackhole --teleport localhost:3389 --password super-secret-password 192.168.1.100
```

or create a `client.json`:

```json
{
  "serverAddress": "192.168.1.100",
  "serverPort": 4777,
  "teleportHost": "localhost",
  "teleportPort": 3389,
  "password": "super-secret-password",
  "timeout": 5000
}
```

then run:

```bash
blackhole
```

## Connecting

Use an RDP client to connect to `192.168.1.100:5666`; the connection is tunneled to the client's local port 3389.

## Security Notice

This implementation does not encrypt transmissions and only offers basic password authentication. For enhanced security, consider tunneling through SSH or using TLS.

## License

This project is released under the MIT license.
