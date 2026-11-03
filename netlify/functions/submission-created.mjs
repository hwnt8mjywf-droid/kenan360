// Backup path: runs automatically after every Netlify form submission and copies
// lead-form entries into the CRM. The website also saves leads directly through
// /api/leads; duplicates are skipped because leads are matched by phone number.
import { getStore } from "@netlify/blobs";
import { saveLead, saveBootcamp } from "../lib/save-lead.mjs";

export default async (req) => {
  try {
    const { payload } = await req.json();
    if (!payload || !["lead", "bootcamp"].includes(payload.form_name)) return new Response("ignored");
    const d = payload.data || {};
    const store = getStore({ name: "leads", consistency: "strong" });
    if (payload.form_name === "bootcamp") {
      const r = await saveBootcamp(store, {
        name: [d.first_name, d.last_name].filter(Boolean).join(" "), phone: d.phone, email: d.email,
        session: d.session, level: d.level, referrer: d.referrer,
      });
      console.log("crm: form hook bootcamp", r);
      return new Response(r);
    }
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
