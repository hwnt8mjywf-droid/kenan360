// Shared by the website form endpoint and the Netlify form hook.
// One lead per phone number, so the same person is never listed twice.
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);

export async function saveLead(store, d) {
  const name = clean(d.name, 60);
  const phone = clean(d.phone, 30);
  const digits = phone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (!name || digits.length < 7) return "invalid";

  const key = "p_" + digits;
  if (await store.get(key)) return "duplicate";
  // Leads saved before this change are keyed differently; check their phones too.
  const { blobs } = await store.list();
  for (const b of blobs) {
    if (b.key.startsWith("_") || b.key.startsWith("p_")) continue;
    const l = await store.get(b.key, { type: "json" });
    if (l && String(l.phone).replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "") === digits) return "duplicate";
  }

  const now = new Date().toISOString();
  await store.setJSON(
    key,
    {
      id: key, created_at: now, name, phone, email: clean(d.email, 120), goal: clean(d.goal, 60), aim: clean(d.aim, 60),
      source: String(d.referrer || "").includes("fbclid") ? "Instagram / Facebook" : "Website",
      status: "New", notes: [], updated_at: now,
    },
    { onlyIfNew: true }
  );
  return "saved";
}
