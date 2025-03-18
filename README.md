# Blackhole

**Blackhole** is a simple Node.js tool for creating a TCP tunnel between a client machine and a server machine. It allows “teleporting” (port forwarding) a port from a client computer to a server with a public IP address, enabling access to locally running services (e.g., RDP, HTTP) from the internet or other networks.

## Features

- **Server mode** – Listens on a control port (default `4777`) and exposes a selected port (e.g., `5666`) for incoming connections. It now supports an optional timeout parameter (`--timeout`) that specifies how long (in milliseconds) the server will wait for a reconnection before closing the exposed port.
- **Client mode** – Connects to the server, forwarding data to a local service (e.g., `localhost:3389`). In client mode, reconnection is attempted up to 5 times with a 10-second interval between attempts.
- **Simple password authentication** – Optionally, you can add the `--password` parameter to enforce a password when connecting.

## Requirements

- Node.js (version 14+ or newer)
- npm packages: `minimist` and `multiplex`
- (Optional) [pkg](https://github.com/vercel/pkg) if you want to build a standalone executable
- You must install `pkg` globally:
  ```bash
  npm install -g @yao-pkg/pkg
  ```

## Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/blackhole.git
   cd blackhole
   ```
2. **Install dependencies:**
   ```bash
   npm install
   ```
3. **(Optional) Build an executable using pkg:**
   ```bash
   npm install --global pkg
   pkg . --targets node16-linux-x64,node16-win-x64
   ```
   This will generate executable files, e.g., `blackhole-linux` and `blackhole-win.exe`.

## Usage

Run the script with:

```bash
node index.js [options]
```

or use a generated binary (e.g., `./blackhole` or `blackhole.exe`).

### Server Mode

```bash
blackhole --server [--password <password>] [--timeout <ms>] --tele-port-to <exposedPort> --wait-port-on <controlPort>
```

- `--server` – Enables server mode.
- `--tele-port-to <exposedPort>` – Port where the server will expose the service (e.g., `5666`).
- `--wait-port-on <controlPort>` – Control port where the server listens for client connections (default `4777`).
- `--password <password>` – (Optional) Password required for connection.
- `--timeout <ms>` – (Optional) Maximum time in milliseconds to wait after a client disconnects before closing the exposed port (default is `5000`).

**Example:**

```bash
blackhole --server --password secret --tele-port-to 5666 --wait-port-on 4777 --timeout 5000
```

The server listens on port `4777`, and the service is exposed on port `5666`. The client must provide the password `secret`. If the client disconnects, the server waits for up to 5000ms for a reconnection before shutting down the tunnel.

### Client Mode

```bash
blackhole --teleport <localHost:localPort> [--password <password>] [--timeout <ms>] <serverAddress>
```

- `--teleport <localHost:localPort>` – Address and port of the local service (e.g., `localhost:3389`).
- `--password <password>` – (Optional) Password that must match the server configuration.
- `--timeout <ms>` – (Optional) Timeout parameter affecting connection behavior (e.g. in logging messages).
- `<serverAddress>` – IP address or hostname of the server where the server mode is running.

**Example:**

```bash
blackhole --teleport localhost:3389 --password secret --timeout 5000 192.168.1.100
```

The client connects to the server at `192.168.1.100` on the default control port `4777`, forwarding the local service running on `localhost:3389`. If the connection is lost, the client will automatically retry the connection up to 5 times, waiting 10 seconds between attempts.

## Example Scenario (RDP)

1. **On the server (with a public IP):**
   ```bash
   blackhole --server --tele-port-to 5666 --wait-port-on 4777 --password super-secret-password --timeout 5000
   ```
2. **On the client (with RDP service on port 3389):**
   ```bash
   blackhole --teleport localhost:3389 --password super-secret-password --timeout 5000 public.ip.server
   ```
3. **Connecting:**  
   The user uses a standard RDP client, specifying the address `public.ip.server:5666` – the connection is tunneled to the client.

## Security Notice

- The current implementation does not encrypt transmissions – it only provides basic password authentication.
- To secure the connection, consider additional protection layers such as tunneling through SSH or using TLS.

## License

This project is released under the [MIT](LICENSE) license.
