/** Sign a bounded JSON POST to an AWS_IAM Lambda function URL.
 * HMAC is a separate application-level gate; browser code never imports this.
 */
const encoder = new TextEncoder();
const hex = (bytes: Uint8Array) => [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
async function sha256(value: string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}
async function hmac(key: Uint8Array, value: string) {
  const imported = await crypto.subtle.importKey("raw", new Uint8Array(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", imported, encoder.encode(value)));
}
export async function signedAwsPost(body: string, settings: {
  url: string; region: string; accessKeyId: string; secretAccessKey: string; dispatchSecret: string;
}): Promise<Response> {
  const parsed = new URL(settings.url);
  if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(`.lambda-url.${settings.region}.on.aws`) ||
    parsed.search || parsed.hash || parsed.pathname !== "/")
    throw new Error("Unexpected AWS inference control-plane URL");
  const stamp = new Date().toISOString().replaceAll("-", "").replaceAll(":", "").replace(/\.\d{3}Z$/, "Z");
  const day = stamp.slice(0, 8);
  const payloadHash = await sha256(body);
  const signedHeaders = "content-type;host;x-amz-date;x-riceguard-signature";
  const appHmac = hex(await hmac(encoder.encode(settings.dispatchSecret), body));
  const canonicalHeaders = `content-type:application/json\nhost:${parsed.host}\nx-amz-date:${stamp}\nx-riceguard-signature:${appHmac}\n`;
  const canonical = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const scope = `${day}/${settings.region}/lambda/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${stamp}\n${scope}\n${await sha256(canonical)}`;
  const dateKey = await hmac(encoder.encode(`AWS4${settings.secretAccessKey}`), day);
  const regionKey = await hmac(dateKey, settings.region);
  const serviceKey = await hmac(regionKey, "lambda");
  const signingKey = await hmac(serviceKey, "aws4_request");
  const signature = hex(await hmac(signingKey, toSign));
  return await fetch(settings.url, { method: "POST", body, headers: {
    "Content-Type": "application/json",
    "X-Amz-Date": stamp,
    "X-RiceGuard-Signature": appHmac,
    Authorization: `AWS4-HMAC-SHA256 Credential=${settings.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  } });
}

export function awsSettings() {
  const url = Deno.env.get("AWS_DISPATCH_URL");
  const accessKeyId = Deno.env.get("AWS_ACCESS_KEY_ID");
  const secretAccessKey = Deno.env.get("AWS_SECRET_ACCESS_KEY");
  const dispatchSecret = Deno.env.get("AWS_DISPATCH_SECRET");
  if (!url || !accessKeyId || !secretAccessKey || !dispatchSecret) throw new Error("Private AWS controller is not configured");
  return { url, region: "us-east-1", accessKeyId, secretAccessKey, dispatchSecret };
}
