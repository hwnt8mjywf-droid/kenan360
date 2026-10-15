// One-time: loads the three reviews already on the site into the store.
// Visit https://kenan360.net/api/seed-reviews once after the first deploy, then it refuses to run again.
import { getStore } from "@netlify/blobs";
const REVIEWS = [
  { created_at: "2026-10-15T01:48:52Z", name: "Jimmy Miller", rating: 5, service: "Full 360",
    text: "Working with Ken has honestly gotten me into the best shape of my life. This dude does it all. Workouts, nutrition, accountability, even helping me put outfits together and level up my style. It’s way more than just personal training.\n\nAnd the funniest part? His IG videos actually helped me meet my girlfriend 😂😂 Never thought getting in shape would turn into a whole lifestyle upgrade hahaha.\n\nIf you’re looking for the full package, Ken’s your guy. He knows his stuff and genuinely wants to see you win." },
  { created_at: "2026-10-15T01:16:35Z", name: "Marcus Rivera", rating: 5, service: "Full 360",
    text: "It was great helped me meet all my goals! Great trainer for any begginer looking to get in shape. Highly recommend!!" },
  { created_at: "2026-10-15T01:05:43Z", name: "Jennie Wolf", rating: 5, service: "Full 360",
    text: "Amazing experience working with Ken! He is extremely professional, knowledgeable, and genuinely cares about delivering the best results. His attention to detail, communication, and dedication really set him apart. He goes above and beyond to make sure everything runs smoothly. Highly recommend Ken to anyone looking for someone reliable, hardworking, and exceptional at what he does. Definitely a 5-star experience!" },
];
export default async () => {
  const store = getStore({ name: "reviews", consistency: "strong" });
  const { blobs } = await store.list();
  if (blobs.length) return new Response("Already seeded (" + blobs.length + " reviews in store). Nothing changed.");
  for (const r of REVIEWS) {
    const key = r.created_at.replace(/[:.]/g, "-") + "_" + r.name.replace(/[^a-z0-9]+/gi, "-");
    await store.setJSON(key, { ...r, hidden: false });
  }
  return new Response("Done: " + REVIEWS.length + " reviews added.");
};
export const config = { path: "/api/seed-reviews" };
