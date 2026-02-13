function esc(s: string) {
  return s.replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c] as string));
}

export function renderInviteEmail(args: { title: string; themeName: string; themeBlurb: string; inviteUrl: string }) {
  return {
    subject: `A cozy invite: ${args.title} 🌿`,
    html: `
      <div style="font-family:system-ui;background:#fbf6ee;padding:24px;">
        <div style="max-width:640px;margin:0 auto;background:#fffaf2;border:1px solid #e7dccb;border-radius:18px;padding:18px;">
          <h2 style="margin:0 0 10px;">🌼 You’ve got a cozy invite</h2>
          <p style="margin:0 0 12px;color:#6b645b;line-height:1.6">
            <strong>${esc(args.title)}</strong><br/>
            Theme: <strong>${esc(args.themeName)}</strong><br/>
            <em>${esc(args.themeBlurb)}</em>
          </p>
          <p style="margin:0 0 14px;line-height:1.6">Tap below to choose a few sweet options.</p>
          <a href="${args.inviteUrl}" style="display:inline-block;background:#7a8f62;color:#fff;text-decoration:none;padding:12px 16px;border-radius:14px;font-weight:700;">
            Choose my cozy picks 🌿
          </a>
          <p style="margin:12px 0 0;color:#6b645b;font-size:12px;">Link: ${esc(args.inviteUrl)}</p>
        </div>
      </div>
    `,
    text: `Cozy invite: ${args.title}\nTheme: ${args.themeName}\nPick here: ${args.inviteUrl}`,
  };
}

export function renderPlannerEmail(args: {
  title: string; themeName: string; inviteUrl: string;
  dinner: string; activity: string; mood: string; notes?: string | null;
}) {
  const notes = args.notes?.trim() ? `\nNote: ${args.notes.trim()}` : "";
  return {
    subject: `Selections for "${args.title}" 👀`,
    html: `
      <div style="font-family:system-ui;background:#fbf6ee;padding:24px;">
        <div style="max-width:640px;margin:0 auto;background:#fffaf2;border:1px solid #e7dccb;border-radius:18px;padding:18px;">
          <h2 style="margin:0 0 10px;">👀 Picks are in</h2>
          <p style="margin:0 0 12px;color:#6b645b;line-height:1.6">
            <strong>${esc(args.title)}</strong> • Theme: <strong>${esc(args.themeName)}</strong>
          </p>
          <ul style="margin:0;padding-left:18px;line-height:1.7">
            <li><strong>Dinner:</strong> ${esc(args.dinner)}</li>
            <li><strong>Activity:</strong> ${esc(args.activity)}</li>
            <li><strong>Mood:</strong> ${esc(args.mood)}</li>
          </ul>
          ${args.notes?.trim() ? `<p style="margin:12px 0 0;"><strong>Note:</strong> ${esc(args.notes.trim())}</p>` : ""}
          <p style="margin:12px 0 0;color:#6b645b;font-size:12px;">Invite link: ${esc(args.inviteUrl)}</p>
        </div>
      </div>
    `,
    text:
      `Selections for "${args.title}" (Theme: ${args.themeName})\n` +
      `- Dinner: ${args.dinner}\n- Activity: ${args.activity}\n- Mood: ${args.mood}\n` +
      `${notes}\nInvite: ${args.inviteUrl}`,
  };
}

export function renderPartnerConfirmationEmail(args: { title: string; themeName: string }) {
  return {
    subject: `You’re all set for "${args.title}" 🕯️`,
    html: `
      <div style="font-family:system-ui;background:#fbf6ee;padding:24px;">
        <div style="max-width:640px;margin:0 auto;background:#fffaf2;border:1px solid #e7dccb;border-radius:18px;padding:18px;">
          <h2 style="margin:0 0 10px;">🕯️ All set, love</h2>
          <p style="margin:0;color:#6b645b;line-height:1.7">
            Your choices are in for <strong>${esc(args.title)}</strong>.<br/>
            Theme: <strong>${esc(args.themeName)}</strong>.
          </p>
          <p style="margin:12px 0 0;line-height:1.7">
            You don’t need to plan a thing — just show up and be cozy.<br/>
            <strong>You’ll be taken care of.</strong> 💛
          </p>
        </div>
      </div>
    `,
    text: `You're all set for "${args.title}" (Theme: ${args.themeName}). You’ll be taken care of 💛`,
  };
}


export async function sendEmail(opts: { to: string; subject: string; html: string; text?: string }) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim() || "Date Night Cottage <onboarding@resend.dev>";

  if (!apiKey) {
    console.log("[email:stub]", { from, ...opts });
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, ...opts }),
  });

  if (!res.ok) throw new Error(`Resend failed: ${res.status} ${await res.text()}`);
}
