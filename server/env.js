// Tidies settings before anything else reads them. Imported first by index.js.
// PUBLIC_URL must be a full address like https://kids.example.org; add https:// if it was left off
// and drop any trailing slash, so Google and Telegram get a redirect address they accept.
let u = String(process.env.PUBLIC_URL || "").trim();
if (u && !/^https?:\/\//i.test(u)) u = "https://" + u;
process.env.PUBLIC_URL = u.replace(/\/+$/, "");
