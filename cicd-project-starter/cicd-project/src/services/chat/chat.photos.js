const createError = require("http-errors");

async function downloadPhoto(path) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw createError(404, "Profile photo unavailable.");
  // Paths come exclusively from the authorized database lookup, never from a URL parameter.
  const segments = path.split("/");
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.includes("\\"),
    )
  ) {
    throw createError(404, "Profile photo unavailable.");
  }
  const url = new URL(
    `/storage/v1/object/authenticated/profile-photos/${segments.map(encodeURIComponent).join("/")}`,
    base,
  );
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${key}`, apikey: key },
    redirect: "error",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw createError(404, "Profile photo unavailable.");
  const type = response.headers.get("content-type")?.split(";")[0].trim();
  if (!["image/jpeg", "image/png", "image/webp"].includes(type)) {
    await response.body?.cancel();
    throw createError(404, "Profile photo unavailable.");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 8388608) throw createError(413, "Profile photo is too large.");
    chunks.push(Buffer.from(chunk));
  }
  return { type, body: Buffer.concat(chunks) };
}
module.exports = { downloadPhoto };
