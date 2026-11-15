/** AES-GCM under a key held as a Worker secret. Nothing is stored unencrypted. */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function importKey(base64Key: string): Promise<CryptoKey> {
  let raw: Uint8Array;
  try {
    raw = fromBase64(base64Key.trim());
  } catch {
    throw new Error("TOKEN_ENCRYPTION_KEY is not valid base64.");
  }
  if (raw.byteLength !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64 encoded.");
  }
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Returns "iv.ciphertext", both base64. `context` binds the value to its storage key. */
export async function encrypt(base64Key: string, plaintext: string, context: string): Promise<string> {
  const key = await importKey(base64Key);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(context) },
    key,
    encoder.encode(plaintext),
  );
  return `${toBase64(iv)}.${toBase64(new Uint8Array(sealed))}`;
}

export async function decrypt(base64Key: string, sealed: string, context: string): Promise<string> {
  const [iv, body] = sealed.split(".");
  if (!iv || !body) throw new Error("Stored value is not in the expected form.");
  const key = await importKey(base64Key);
  const opened = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(iv), additionalData: encoder.encode(context) },
    key,
    fromBase64(body),
  );
  return decoder.decode(opened);
}
