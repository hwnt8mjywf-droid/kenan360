// Runs automatically every time a Netlify form on the site is submitted.
// Lead form submissions are copied into the "leads" store so they show up in /crm.
import { getStore, connectLambda } from "@netlify/blobs";

export const handler = async (event) => {
  try {
    connectLambda(event);
    const { payload } = JSON.parse(event.body || "{}");
    if (!payload || payload.form_name !== "lead") { console.log("crm: ignored form", payload && payload.form_name); return { statusCode: 200, body: "ignored" }; }
    const d = payload.data || {};
    const created_at = payload.created_at || new Date().toISOString();
    const store = getStore({ name: "leads", consistency: "strong" });
    await store.setJSON(
      payload.id,
      {
        id: payload.id,
        created_at,
        name: String(d.first_name || payload.first_name || "").trim(),
        phone: String(d.phone || "").trim(),
        email: String(d.email || "").trim(),
        goal: String(d.goal || "").trim(),
        aim: String(d.aim || "").trim(),
        source: String(d.referrer || "").includes("fbclid") ? "Instagram / Facebook" : "Website",
        status: "New",
        notes: "",
        updated_at: created_at,
      },
      { onlyIfNew: true }
    );
    console.log("crm: saved lead", payload.id);
    return { statusCode: 200, body: "saved" };
  } catch (err) {
    console.error("lead save failed", err);
    return { statusCode: 200, body: "error logged" };
  }
};
