import "dotenv/config";
import express from "express";
import path from "path";
import helmet from "helmet";
import session from "express-session";
import cookieParser from "cookie-parser";
import ejs from "ejs";
import { nanoid } from "nanoid";

import { getDb } from "./db";
import { THEMES, getTheme } from "./themes";
import {
  sendEmail,
  renderInviteEmail,
  renderPlannerEmail,
  renderPartnerConfirmationEmail,
} from "./email";

type Flash = { type: "info" | "error"; message: string };

const app = express();
const VIEWS_DIR = path.join(process.cwd(), "src", "views");

function parseLines(input: string): string[] {
  return input
    .split("\n")
    .map(s => s.trim())
    .filter(Boolean);
}

function safeParseMenuJson(menuJson: string): { dinner: string[]; activity: string[]; mood: string[] } {
  try {
    const m = JSON.parse(menuJson);
    return {
      dinner: Array.isArray(m?.dinner) ? m.dinner : [],
      activity: Array.isArray(m?.activity) ? m.activity : [],
      mood: Array.isArray(m?.mood) ? m.mood : [],
    };
  } catch {
    return { dinner: [], activity: [], mood: [] };
  }
}


app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(process.cwd(), "public")));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  })
);

function isAdmin(req: express.Request) {
  return Boolean((req.session as any).isAdmin);
}
function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!isAdmin(req)) return res.redirect("/admin/login");
  next();
}
function setFlash(req: express.Request, flash: Flash) {
  (req.session as any).flash = flash;
}
function consumeFlash(req: express.Request): Flash | null {
  const f = (req.session as any).flash as Flash | undefined;
  if (f) delete (req.session as any).flash;
  return f || null;
}
function baseUrl() {
  return (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
}
function plannerEmail() {
  return (process.env.PLANNER_EMAIL || "").trim();
}
function formatDateIso(iso: string | null): string | null {
  if (!iso) return null;
  try {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return iso;
  }
}

async function renderPage(req: express.Request, res: express.Response, opts: {
  title: string;
  view: string;
  locals?: Record<string, any>;
  status?: number;
  admin?: boolean;
  flash?: Flash | null;
}) {
  const inner = await ejs.renderFile(path.join(VIEWS_DIR, `${opts.view}.ejs`), opts.locals || {}, { async: true });
  const html = await ejs.renderFile(
    path.join(VIEWS_DIR, `layout.ejs`),
    {
      title: opts.title,
      admin: opts.admin ?? isAdmin(req),
      flash: opts.flash ?? consumeFlash(req),
      body: inner,
    },
    { async: true }
  );
  if (opts.status) res.status(opts.status);
  res.send(html);
}

app.get("/", (req, res) => res.redirect("/admin"));

/** Admin */
app.get("/admin", (req, res) => {
  if (!isAdmin(req)) return res.redirect("/admin/login");
  res.redirect("/admin/dashboard");
});

app.get("/admin/login", async (req, res) => {
  await renderPage(req, res, { title: "Admin login • Date Night Cottage", view: "admin_login" });
});

app.post("/admin/login", (req, res) => {
  const password = String(req.body.password || "");
  const expected = process.env.ADMIN_PASSWORD || "";
  if (!expected) {
    setFlash(req, { type: "error", message: "ADMIN_PASSWORD is not set in .env" });
    return res.redirect("/admin/login");
  }
  if (password !== expected) {
    setFlash(req, { type: "error", message: "Nope — that password doesn’t match 🌧️" });
    return res.redirect("/admin/login");
  }
  (req.session as any).isAdmin = true;
  setFlash(req, { type: "info", message: "Welcome in 🌿" });
  res.redirect("/admin/dashboard");
});

app.get("/admin/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/admin/login"));
});

app.get("/admin/dashboard", requireAdmin, async (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT dn.*,
      (SELECT COUNT(*) FROM invites i WHERE i.date_night_id = dn.id) AS invite_count
    FROM date_nights dn
    ORDER BY dn.created_at DESC
  `).all() as any[];

  const dateNights = rows.map((dn) => {
    const t = getTheme(dn.theme_id);
    return {
      id: dn.id,
      title: dn.title,
      themeName: t?.name ?? dn.theme_id,
      inviteCount: dn.invite_count,
      dateText: formatDateIso(dn.date_iso),
    };
  });

  await renderPage(req, res, {
    title: "Admin • Date Night Cottage",
    view: "admin_dashboard",
    locals: { dateNights },
    admin: true,
  });
});

app.get("/admin/new", requireAdmin, async (req, res) => {
  await renderPage(req, res, {
    title: "New date night • Date Night Cottage",
    view: "admin_new",
    locals: { themes: THEMES },
    admin: true,
  });
});

app.post("/admin/new", requireAdmin, (req, res) => {
  const theme = getTheme(String(req.body.themeId || "").trim());
  const title = String(req.body.title || "").trim();
  const themeId = String(req.body.themeId || "").trim();
  const dateIso = String(req.body.date || "").trim() || null;
  const menuJson = JSON.stringify(req.body.menu || theme?.options || {});

  if (!title) {
    setFlash(req, { type: "error", message: "Please add a title." });
    return res.redirect("/admin/new");
  }
  if (!getTheme(themeId)) {
    setFlash(req, { type: "error", message: "That theme doesn’t exist." });
    return res.redirect("/admin/new");
  }

  const db = getDb();
  const id = nanoid(12);
  db.prepare(`
    INSERT INTO date_nights (id, title, theme_id, date_iso, menu_json, blurb, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, title, themeId, dateIso, menuJson, theme?.blurb || "", new Date().toISOString());
  

  res.redirect(`/admin/date-night/${id}`);
});

app.get("/admin/date-night/:id", requireAdmin, async (req, res) => {
  const db = getDb();
  const id = String(req.params.id);
  const dn = db.prepare(`SELECT * FROM date_nights WHERE id = ?`).get(id) as any;
  if (!dn) {
    setFlash(req, { type: "error", message: "Date night not found." });
    return res.redirect("/admin/dashboard");
  }

  const theme = getTheme(dn.theme_id);
  const menu = safeParseMenuJson(dn.menu_json);
  if (!theme) {
    setFlash(req, { type: "error", message: "Theme missing." });
    return res.redirect("/admin/dashboard");
  }

  const invites = db.prepare(`SELECT * FROM invites WHERE date_night_id = ? ORDER BY created_at DESC`).all(id) as any[];
  const selectionStmt = db.prepare(`SELECT * FROM selections WHERE invite_id = ?`);

  const inviteVM = invites.map((inv) => {
    const url = `${baseUrl()}/invite/${inv.token}`;
    const used = Boolean(inv.used_at);
    let selectionSummary: string | null = null;
    if (used) {
      const sel = selectionStmt.get(inv.id) as any;
      if (sel) selectionSummary = `🍲 ${sel.dinner_choice} • 🎲 ${sel.activity_choice} • 💛 ${sel.mood_choice}`;
    }
    return {
      id: inv.id,
      url,
      used,
      menu,
      recipientEmail: inv.recipient_email,
      selectionSummary,
    };
  });

  await renderPage(req, res, {
    title: `${dn.title} • Admin • Date Night Cottage`,
    view: "admin_date_night",
    locals: {
      dateNight: { ...dn, dateText: formatDateIso(dn.date_iso) },
      theme,
      menu,
      invites: inviteVM,
      plannerEmail: plannerEmail(),
    },
    admin: true,
  });
});

app.post("/admin/date-night/:id/delete", requireAdmin, (req, res) => {
  const db = getDb();
  const id = String(req.params.id);

  const inviteIds = db.prepare(`SELECT id FROM invites WHERE date_night_id = ?`).all(id) as Array<{ id: string }>;
  const delSel = db.prepare(`DELETE FROM selections WHERE invite_id = ?`);
  for (const inv of inviteIds) delSel.run(inv.id);

  db.prepare(`DELETE FROM invites WHERE date_night_id = ?`).run(id);
  db.prepare(`DELETE FROM date_nights WHERE id = ?`).run(id);

  setFlash(req, { type: "info", message: "Deleted 🌿" });
  res.redirect("/admin/dashboard");
});

app.post("/admin/date-night/:id/invite", requireAdmin, async (req, res) => {
  const db = getDb();
  const dateNightId = String(req.params.id);
  const recipientEmail = String(req.body.recipientEmail || "").trim() || null;

  const dn = db.prepare(`SELECT * FROM date_nights WHERE id = ?`).get(dateNightId) as any;
  if (!dn) return res.redirect("/admin/dashboard");

  const theme = getTheme(dn.theme_id);
  if (!theme) return res.redirect(`/admin/date-night/${dateNightId}`);

  const inviteId = nanoid(12);
  const token = nanoid(22);

  db.prepare(`
    INSERT INTO invites (id, date_night_id, token, recipient_email, used_at, created_at)
    VALUES (?, ?, ?, ?, NULL, ?)
  `).run(inviteId, dateNightId, token, recipientEmail, new Date().toISOString());

  const inviteUrl = `${baseUrl()}/invite/${token}`;

  if (recipientEmail) {
    try {
      const email = renderInviteEmail({
        title: dn.title,
        themeName: theme.name,
        themeBlurb: theme.blurb,
        inviteUrl,
      });
      await sendEmail({ to: recipientEmail, subject: email.subject, html: email.html, text: email.text });
      setFlash(req, { type: "info", message: "Invite created and emailed ✉️" });
    } catch (e: any) {
      setFlash(req, { type: "error", message: `Invite created, but email failed: ${e?.message || String(e)}` });
    }
  } else {
    setFlash(req, { type: "info", message: "Invite created. Copy the link and send it 💌" });
  }

  res.redirect(`/admin/date-night/${dateNightId}`);
});

/** Re-send same invite email (same token) */
app.post("/admin/invite/:inviteId/resend", requireAdmin, async (req, res) => {
  const db = getDb();
  const inviteId = String(req.params.inviteId);

  const inv = db.prepare(`SELECT * FROM invites WHERE id = ?`).get(inviteId) as any;
  if (!inv || !inv.recipient_email) {
    setFlash(req, { type: "error", message: "Invite not found or missing recipient email." });
    return res.redirect("/admin/dashboard");
  }

  const dn = db.prepare(`SELECT * FROM date_nights WHERE id = ?`).get(inv.date_night_id) as any;
  if (!dn) return res.redirect("/admin/dashboard");

  const theme = getTheme(dn.theme_id);
  if (!theme) return res.redirect(`/admin/date-night/${dn.id}`);

  const inviteUrl = `${baseUrl()}/invite/${inv.token}`;

  try {
    const email = renderInviteEmail({
      title: dn.title,
      themeName: theme.name,
      themeBlurb: theme.blurb,
      inviteUrl,
    });
    await sendEmail({ to: inv.recipient_email, subject: email.subject, html: email.html, text: email.text });
    setFlash(req, { type: "info", message: "Invite re-sent ✉️" });
  } catch (e: any) {
    setFlash(req, { type: "error", message: `Re-send failed: ${e?.message || String(e)}` });
  }

  res.redirect(`/admin/date-night/${dn.id}`);
});

/** Invite page */
app.get("/invite/:token", async (req, res) => {
  const db = getDb();
  const token = String(req.params.token);

  const inv = db.prepare(`SELECT * FROM invites WHERE token = ?`).get(token) as any;
  if (!inv) {
    return renderPage(req, res, {
      title: "Invite not found",
      view: "thanks",
      flash: { type: "error", message: "That invite link doesn’t seem to exist." },
      status: 404,
    });
  }

  const dn = db.prepare(`SELECT * FROM date_nights WHERE id = ?`).get(inv.date_night_id) as any;
  if (!dn) {
    return renderPage(req, res, {
      title: "Invite error",
      view: "thanks",
      flash: { type: "error", message: "This invite is missing its date night." },
      status: 404,
    });
  }

  
  const theme = getTheme(dn.theme_id); // still used for name (optional)
  const menu = safeParseMenuJson(dn.menu_json);
  if (!theme) {
    return renderPage(req, res, {
      title: "Invite error",
      view: "thanks",
      flash: { type: "error", message: "This date night has an unknown theme." },
      status: 500,
    });
  }

  await renderPage(req, res, {
    title: `Invite • ${dn.title}`,
    view: "invite",
    locals: { token, dateNight: dn, themeName: theme.name, menu, used: Boolean(inv.used_at) },
  });
});

app.post("/invite/:token", async (req, res) => {
  const db = getDb();
  const token = String(req.params.token);

  const inv = db.prepare(`SELECT * FROM invites WHERE token = ?`).get(token) as any;
  if (!inv) {
    setFlash(req, { type: "error", message: "That invite doesn’t exist." });
    return res.redirect(`/invite/${token}`);
  }
  if (inv.used_at) {
    setFlash(req, { type: "error", message: "This invite was already used." });
    return res.redirect(`/invite/${token}`);
  }

  const dn = db.prepare(`SELECT * FROM date_nights WHERE id = ?`).get(inv.date_night_id) as any;
  if (!dn) return res.redirect(`/invite/${token}`);

  const theme = getTheme(dn.theme_id); // still used for name (optional)
  const menu = safeParseMenuJson(dn.menu_json);
  if (!theme) return res.redirect(`/invite/${token}`);

  const dinner = String(req.body.dinnerChoice || "").trim();
  const activity = String(req.body.activityChoice || "").trim();
  const mood = String(req.body.moodChoice || "").trim();
  const notes = String(req.body.notes || "").trim() || null;

  const valid =
    menu.dinner.includes(dinner) &&
    menu.activity.includes(activity) &&
    menu.mood.includes(mood);

  if (!valid) {
    setFlash(req, { type: "error", message: "One or more choices were invalid. Please try again." });
    return res.redirect(`/invite/${token}`);
  }

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO selections (id, invite_id, dinner_choice, activity_choice, mood_choice, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(nanoid(12), inv.id, dinner, activity, mood, notes, now);

  db.prepare(`UPDATE invites SET used_at = ? WHERE id = ?`).run(now, inv.id);

  // Email planner
  const pe = plannerEmail();
  const inviteUrl = `${baseUrl()}/invite/${token}`;

  if (pe) {
    try {
      const email = renderPlannerEmail({
        title: dn.title,
        themeName: theme.name,
        inviteUrl,
        dinner,
        activity,
        mood,
        notes,
      });
      await sendEmail({ to: pe, subject: email.subject, html: email.html, text: email.text });
    } catch (e) {
      console.error("Planner email failed", e);
    }
  } else {
    console.log("[planner-email:missing] Set PLANNER_EMAIL to receive selections.");
  }

  // Email partner confirmation (only if we know their email on the invite)
  if (inv.recipient_email) {
    try {
      const email = renderPartnerConfirmationEmail({ title: dn.title, themeName: theme.name });
      await sendEmail({ to: inv.recipient_email, subject: email.subject, html: email.html, text: email.text });
    } catch (e) {
      console.error("Partner confirmation email failed", e);
    }
  }

  await renderPage(req, res, { title: "Thanks • Date Night Cottage", view: "thanks" });
});


app.get("/admin/date-night/:id/menu", requireAdmin, async (req, res) => {
  const db = getDb();
  const id = String(req.params.id);
  const dn = db.prepare(`SELECT * FROM date_nights WHERE id = ?`).get(id) as any;
  if (!dn) return res.redirect("/admin/dashboard");

  const menu = safeParseMenuJson(dn.menu_json);

  await renderPage(req, res, {
    title: `Edit itinerary • ${dn.title}`,
    view: "admin_edit_menu",
    admin: true,
    locals: {
      dateNight: dn,
      blurb: dn.blurb,
      dinnerText: menu.dinner.join("\n"),
      activityText: menu.activity.join("\n"),
      moodText: menu.mood.join("\n"),
    },
  });
});


app.post("/admin/date-night/:id/menu", requireAdmin, (req, res) => {
  const db = getDb();
  const id = String(req.params.id);

  const dn = db.prepare(`SELECT * FROM date_nights WHERE id = ?`).get(id) as any;
  if (!dn) return res.redirect("/admin/dashboard");

  const dinner = parseLines(String(req.body.dinner || ""));
  const activity = parseLines(String(req.body.activity || ""));
  const mood = parseLines(String(req.body.mood || ""));
  const blurb = String(req.body.blurb || "").trim() || null;

  if (dinner.length === 0 || activity.length === 0 || mood.length === 0) {
    setFlash(req, { type: "error", message: "Please provide at least 1 option in each section." });
    return res.redirect(`/admin/date-night/${id}/menu`);
  }

  const menuJson = JSON.stringify({ dinner, activity, mood });

  db.prepare(`UPDATE date_nights SET menu_json = ?, blurb = ? WHERE id = ?`)
    .run(menuJson, blurb, id);

  setFlash(req, { type: "info", message: "Itinerary saved 🌼" });
  res.redirect(`/admin/date-night/${id}`);
});


const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => console.log(`🌿 Running on http://localhost:${PORT}`));
