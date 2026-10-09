import net from "node:net";
import fs from "node:fs/promises";
import { canonicalJson } from "./canonical.mjs";

export const HOST_OPERATION_SOCKET_PATH = "/run/bodycast/production-operations.sock";
const MAX_REQUEST_BYTES = 1024 * 1024;

async function verifyActivatedSocket({ socketPath, releaseGroupGid }) {
  if (process.env.LISTEN_PID !== String(process.pid) || process.env.LISTEN_FDS !== "1") {
    throw new Error("Host operation service must start from its systemd socket unit.");
  }
  const stat = await fs.lstat(socketPath);
  if (!stat.isSocket() || stat.isSymbolicLink() || process.platform !== "win32"
    && (stat.uid !== 0 || stat.gid !== releaseGroupGid || (stat.mode & 0o777) !== 0o660)) {
    throw new Error("Production operation socket owner, group, type, or mode is unsafe.");
  }
}

export function createHostOperationServer(broker, {
  socketPath = HOST_OPERATION_SOCKET_PATH,
  releaseGroupGid,
  maxRequestBytes = MAX_REQUEST_BYTES,
} = {}) {
  if (!broker || typeof broker.dispatch !== "function") throw new Error("Typed production operation broker is required.");
  if (!Number.isSafeInteger(releaseGroupGid) || releaseGroupGid < 1) throw new Error("Fixed release group GID is required.");
  let dispatchTail = Promise.resolve();
  const server = net.createServer((socket) => {
    let input = "";
    let handled = false;
    socket.on("data", (chunk) => {
      if (handled) return socket.destroy();
      input += chunk.toString("utf8");
      if (Buffer.byteLength(input, "utf8") > maxRequestBytes) {
        handled = true;
        socket.end(canonicalJson({ ok: false, error: "Request exceeds protocol size limit." }) + "\n");
        return;
      }
      const newline = input.indexOf("\n");
      if (newline < 0) return;
      handled = true;
      if (newline !== input.length - 1 || input.indexOf("\n", newline + 1) >= 0) {
        socket.end(canonicalJson({ ok: false, error: "Exactly one canonical JSON request is required." }) + "\n");
        return;
      }
      const text = input.slice(0, newline);
      let request;
      try {
        request = JSON.parse(text);
        if (canonicalJson(request) !== text) throw new Error("Request JSON is not canonical or contains duplicate keys.");
      } catch (error) {
        socket.end(canonicalJson({ ok: false, error: "Malformed production operation request: " + error.message }) + "\n");
        return;
      }
      socket.setTimeout(request.operation === "forward-migration" ? 60 * 60_000 : 15_000, () => socket.destroy());
      const result = dispatchTail.then(() => broker.dispatch(request));
      dispatchTail = result.catch(() => {});
      result.then((response) => socket.end(canonicalJson({ ok: true, result: response }) + "\n"))
        .catch((error) => socket.end(canonicalJson({ ok: false, error: error.message }) + "\n"));
    });
    socket.on("end", () => {
      if (!handled && input.length > 0) socket.end(canonicalJson({ ok: false, error: "Incomplete request frame." }) + "\n");
    });
  });
  return Object.freeze({
    async listenFromSystemd() {
      await verifyActivatedSocket({ socketPath, releaseGroupGid });
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen({ fd: 3 }, resolve);
      });
      return server;
    },
    async close() {
      if (!server.listening) return;
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  });
}

export { verifyActivatedSocket, MAX_REQUEST_BYTES };
