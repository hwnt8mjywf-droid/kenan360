// Backup path: runs automatically after every Netlify form submission and copies
// lead-form entries into the CRM. The website also saves leads directly through
// /api/leads; duplicates are skipped because leads are matched by phone number.
import { getStore } from "@netlify/blobs";
import { saveLead } from "../lib/save-lead.mjs";

export default async (req) => {
  try {
    const { payload } = await req.json();
    if (!payload || payload.form_name !== "lead") return new Response("ignored");
    const d = payload.data || {};
    const store = getStore({ name: "leads", consistency: "strong" });
    const result = await saveLead(store, {
      name: d.first_name, phone: d.phone, email: d.email, goal: d.goal, aim: d.aim, referrer: d.referrer,
    });
    console.log("crm: form hook", result);
    return new Response(result);
  } catch (err) {
    console.error("crm: form hook failed", err);
    return new Response("error");
  }
};
