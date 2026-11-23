import crypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";

if (process.env.NODE_ENV === "production") {
  // Integration tests intentionally spawn production-mode children; keep those runtimes native.
} else {
const fixedTimeText = process.env.BODYCAST_REFACTOR_FIXED_TIME;
const seedText = process.env.BODYCAST_REFACTOR_RANDOM_SEED;
const clockMode = process.env.BODYCAST_REFACTOR_CLOCK_MODE;
if (process.env.NODE_ENV !== "test" || !seedText || !["frozen", "native"].includes(clockMode)) {
  throw new Error("Comparator deterministic runtime requires a test environment, random seed, and explicit clock mode.");
}

if (clockMode === "frozen") {
const fixedTime = Date.parse(fixedTimeText);
if (!Number.isFinite(fixedTime) || new Date(fixedTime).toISOString() !== fixedTimeText) {
  throw new Error("Comparator fixed clock must be a canonical UTC ISO timestamp.");
}
const NativeDate = globalThis.Date;
let virtualTime = fixedTime;
function ComparatorDate(...args) {
  if (!new.target) return new NativeDate(virtualTime).toString();
  return Reflect.construct(NativeDate, args.length === 0 ? [virtualTime] : args, new.target);
}
Object.setPrototypeOf(ComparatorDate, NativeDate);
ComparatorDate.prototype = NativeDate.prototype;
Object.defineProperty(ComparatorDate, "name", { value: "Date" });
Object.defineProperty(ComparatorDate, "now", { configurable: true, writable: true, value: () => virtualTime });
globalThis.Date = ComparatorDate;

const nativeSetTimeout = globalThis.setTimeout.bind(globalThis);
const nativeSetInterval = globalThis.setInterval.bind(globalThis);
function normalizedDelay(value) {
  const delay = Number(value);
  return !Number.isFinite(delay) || delay < 1 || delay > 2_147_483_647 ? 1 : Math.trunc(delay);
}
globalThis.setTimeout = function deterministicTimeout(callback, delay, ...args) {
  if (typeof callback !== "function") throw new TypeError("Comparator timers require a callback function.");
  const advanceBy = normalizedDelay(delay);
  let timer;
  timer = nativeSetTimeout(function onTimeout(...callbackArgs) {
    virtualTime += advanceBy;
    callback.apply(timer, args.length ? args : callbackArgs);
  }, advanceBy);
  return timer;
};
globalThis.setInterval = function deterministicInterval(callback, delay, ...args) {
  if (typeof callback !== "function") throw new TypeError("Comparator intervals require a callback function.");
  const advanceBy = normalizedDelay(delay);
  let timer;
  timer = nativeSetInterval(function onInterval(...callbackArgs) {
    virtualTime += advanceBy;
    callback.apply(timer, args.length ? args : callbackArgs);
  }, advanceBy);
  return timer;
};
}

let state = 0x811c9dc5;
for (const character of seedText) {
  state ^= character.charCodeAt(0);
  state = Math.imul(state, 0x01000193) >>> 0;
}
if (state === 0) state = 0x6d2b79f5;

function nextUint32() {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return state >>> 0;
}

function fillBytes(buffer, offset = 0, size = buffer.length - offset) {
  if (!ArrayBuffer.isView(buffer) || buffer instanceof DataView) {
    throw new TypeError("Comparator deterministic random fill requires a typed array or Buffer.");
  }
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0
    || offset + size > buffer.byteLength) {
    throw new RangeError("Comparator deterministic random fill range is invalid.");
  }
  const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  for (let index = offset; index < offset + size; index += 1) bytes[index] = nextUint32() & 0xff;
  return buffer;
}

function deterministicRandomBytes(size, callback) {
  if (!Number.isSafeInteger(size) || size < 0 || size > 0x7fffffff) {
    throw new RangeError("Comparator deterministic random byte size is invalid.");
  }
  const value = fillBytes(Buffer.alloc(size));
  if (typeof callback === "function") {
    queueMicrotask(() => callback(null, value));
    return undefined;
  }
  return value;
}

function deterministicRandomFillSync(buffer, offset, size) {
  if (typeof offset === "function") throw new TypeError("Comparator randomFillSync callback overload is unsupported.");
  return fillBytes(buffer, offset ?? 0, size ?? buffer.byteLength - (offset ?? 0));
}

function deterministicRandomFill(buffer, offset, size, callback) {
  if (typeof offset === "function") {
    callback = offset;
    offset = 0;
    size = buffer.byteLength;
  } else if (typeof size === "function") {
    callback = size;
    size = buffer.byteLength - (offset ?? 0);
  }
  if (typeof callback !== "function") throw new TypeError("Comparator randomFill requires a callback.");
  let error;
  try { fillBytes(buffer, offset ?? 0, size ?? buffer.byteLength - (offset ?? 0)); } catch (caught) { error = caught; }
  queueMicrotask(() => callback(error, error ? undefined : buffer));
  return undefined;
}

function deterministicUuid() {
  const bytes = deterministicRandomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function deterministicRandomInt(min, max, callback) {
  if (max === undefined || typeof max === "function") {
    callback = typeof max === "function" ? max : callback;
    max = min;
    min = 0;
  }
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max <= min || max - min > 0x100000000) {
    throw new RangeError("Comparator deterministic randomInt bounds are invalid.");
  }
  const range = max - min;
  const ceiling = Math.floor(0x100000000 / range) * range;
  let sample;
  do { sample = nextUint32(); } while (sample >= ceiling);
  const value = min + (sample % range);
  if (typeof callback === "function") {
    queueMicrotask(() => callback(null, value));
    return undefined;
  }
  return value;
}

crypto.randomBytes = deterministicRandomBytes;
crypto.randomFillSync = deterministicRandomFillSync;
crypto.randomFill = deterministicRandomFill;
crypto.randomUUID = deterministicUuid;
crypto.randomInt = deterministicRandomInt;
syncBuiltinESMExports();

const webCrypto = globalThis.crypto;
if (!webCrypto || !Object.isExtensible(webCrypto)) {
  throw new Error("Comparator cannot install deterministic Web Crypto methods.");
}
Object.defineProperty(webCrypto, "randomUUID", { configurable: true, value: deterministicUuid });
Object.defineProperty(webCrypto, "getRandomValues", {
  configurable: true,
  value(buffer) {
    if (!(buffer instanceof Int8Array || buffer instanceof Uint8Array || buffer instanceof Uint8ClampedArray
      || buffer instanceof Int16Array || buffer instanceof Uint16Array || buffer instanceof Int32Array
      || buffer instanceof Uint32Array || buffer instanceof BigInt64Array || buffer instanceof BigUint64Array)) {
      throw new TypeError("Comparator getRandomValues requires an integer typed array.");
    }
    if (buffer.byteLength > 65_536) throw new DOMException("The requested length exceeds 65,536 bytes", "QuotaExceededError");
    return fillBytes(buffer);
  },
});

let mathState = state;
Math.random = () => {
  mathState = (Math.imul(mathState, 1664525) + 1013904223) >>> 0;
  return mathState / 0x100000000;
};
}
