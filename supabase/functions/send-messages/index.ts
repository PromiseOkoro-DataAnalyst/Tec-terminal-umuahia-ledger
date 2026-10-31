// =====================================================================
//  send-messages — TecTerminal Umuahia Ledger
//
//  Sends queued messages from the outbox (public.message_log):
//    • Email through Brevo or Resend
//    • WhatsApp through Meta's WhatsApp Cloud API (only when "Cloud API"
//      mode is chosen in the app; in "manual" mode WhatsApp messages wait
//      in the Outbox for a marketer to send with one tap)
//
//  Called every 10 minutes by pg_cron (see supabase/sending-schedule.sql), or by
//  an admin from the app ("Send queued now" / "Check connection").
//
//  Secrets to add in Supabase → Edge Functions → Secrets:
//    EMAIL_PROVIDER         brevo  or  resend
//    BREVO_API_KEY          if using Brevo
//    RESEND_API_KEY         if using Resend
//    EMAIL_FROM_ADDRESS     the address emails come from, e.g. hello@yourdomain.com
//    WHATSAPP_TOKEN         optional, Meta permanent access token (Cloud API mode)
//    WHATSAPP_PHONE_ID      optional, Meta phone number ID (Cloud API mode)
//    GREENAPI_URL           optional, GREEN-API "apiUrl", e.g. https://7103.api.greenapi.com (gateway mode)
//    GREENAPI_INSTANCE      optional, GREEN-API idInstance (gateway mode)
//    GREENAPI_TOKEN         optional, GREEN-API apiTokenInstance (gateway mode)
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2'

const env = (name: string) => (Deno.env.get(name) || '').trim()

const SUPABASE_URL = env('SUPABASE_URL')
const SERVICE_KEY = (() => {
  try {
    const keys = JSON.parse(env('SUPABASE_SECRET_KEYS') || '{}')
    if (keys.default) return keys.default as string
  } catch { /* fall back to the legacy key */ }
  return env('SUPABASE_SERVICE_ROLE_KEY')
})()

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const BATCH = 40          // messages per run (Brevo free: 300/day, Resend free: 100/day)
const MAX_ATTEMPTS = 3

type Settings = {
  sender_name: string
  reply_to_email: string | null
  site_url: string | null
  whatsapp_mode: 'manual' | 'cloud_api' | 'gateway'
  whatsapp_daily_limit: number | null
  whatsapp_gap_seconds: number | null
  whatsapp_template_name: string | null
  whatsapp_template_language: string
  email_enabled: boolean
}

const emailProvider = () => env('EMAIL_PROVIDER').toLowerCase() || (env('BREVO_API_KEY') ? 'brevo' : env('RESEND_API_KEY') ? 'resend' : '')
const emailReady = () => {
  const provider = emailProvider()
  return Boolean(env('EMAIL_FROM_ADDRESS') && ((provider === 'brevo' && env('BREVO_API_KEY')) || (provider === 'resend' && env('RESEND_API_KEY'))))
}
const cloudReady = (settings: Settings) =>
  Boolean(env('WHATSAPP_TOKEN') && env('WHATSAPP_PHONE_ID') && settings.whatsapp_template_name)
const gatewayReady = () => Boolean(env('GREENAPI_URL') && env('GREENAPI_INSTANCE') && env('GREENAPI_TOKEN'))
const whatsappReady = (settings: Settings) =>
  settings.whatsapp_mode === 'gateway' ? gatewayReady() : settings.whatsapp_mode === 'cloud_api' ? cloudReady(settings) : false

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Gateway messages only go out in the daytime, Lagos time (people reply, and it looks human)
const lagosHour = () => Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Africa/Lagos' }).format(new Date()))
const GATEWAY_HOURS = { from: 8, to: 20 }

// Unofficial gateway (GREEN-API): sends from a linked WhatsApp number like WhatsApp Web does.
async function sendWhatsAppGateway(to: string, body: string, media: string[]) {
  const base = `${env('GREENAPI_URL').replace(/\/+$/, '')}/waInstance${env('GREENAPI_INSTANCE')}`
  const token = env('GREENAPI_TOKEN')
  const chatId = `${to.replace(/\D/g, '').replace(/^0/, '234')}@c.us`
  const post = async (method: string, payload: unknown) => {
    const response = await fetch(`${base}/${method}/${token}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(`WhatsApp gateway: ${result.message || result.error || response.statusText}`)
    return String(result.idMessage || '')
  }
  const id = await post('sendMessage', { chatId, message: body })
  for (const path of media) {
    await sleep(1500)
    await post('sendFileByUrl', { chatId, urlFile: mediaUrl(path), fileName: fileName(path) })
  }
  return id
}

const mediaUrl = (path: string) =>
  /^https?:\/\//.test(path) ? path : `${SUPABASE_URL}/storage/v1/object/public/broadcast-media/${path.split('/').map(encodeURIComponent).join('/')}`
const fileName = (path: string) => decodeURIComponent(path.split('/').pop() || 'attachment').replace(/^\d+-/, '')

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const linkify = (html: string) => html.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#0c2363;font-weight:600">$1</a>')

const LOGO_URL = `${SUPABASE_URL}/storage/v1/object/public/brand/email-logo.png`

// Branded layout: logo on white, deep blue title band, message, red button for the
// first link in the message (if any), deep blue footer with the unsubscribe link.
function emailHtml(subject: string, body: string, settings: Settings, unsubscribeUrl: string | null, media: string[]) {
  const firstLink = body.match(/https?:\/\/[^\s<]+/)?.[0] || null
  const paragraphs = escapeHtml(body).split(/\n{2,}/)
    .map((block) => `<p style="margin:0 0 14px">${linkify(block.replace(/\n/g, '<br>'))}</p>`).join('')
  const images = media.filter((path) => /\.(png|jpe?g|gif|webp)$/i.test(path))
    .map((path) => `<img src="${mediaUrl(path)}" alt="" style="max-width:100%;border-radius:12px;margin:6px 0 14px;display:block">`).join('')
  const files = media.filter((path) => !/\.(png|jpe?g|gif|webp)$/i.test(path))
    .map((path) => `<p style="margin:0 0 8px"><a href="${mediaUrl(path)}" style="color:#0c2363;font-weight:600">${escapeHtml(fileName(path))}</a></p>`).join('')
  const button = firstLink ? `
      <tr><td align="center" style="padding:8px 32px 24px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td align="center" bgcolor="#e11d2e" style="border-radius:12px;border-bottom:4px solid #9b0f22;">
            <a href="${firstLink}" target="_blank" style="display:inline-block;padding:15px 34px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;">Open link</a>
          </td></tr></table>
      </td></tr>` : ''
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:#0a1633;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f6fb;"><tr><td align="center" style="padding:32px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid #e0e6f1;border-radius:18px;overflow:hidden;">
    <tr><td align="center" style="padding:28px 28px 22px;background:#ffffff;">
      <img src="${LOGO_URL}" width="200" alt="TecTerminal — Learn. Connect. Succeed." style="display:block;width:200px;max-width:70%;height:auto;border:0;">
    </td></tr>
    <tr><td style="background:#0c2363;padding:24px 32px;">
      <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:24px;line-height:1.25;color:#ffffff;">${escapeHtml(subject)}</h1>
    </td></tr>
    <tr><td style="padding:28px 32px 10px;font-size:16px;line-height:1.65;color:#2b3550;">${paragraphs}${images}${files}</td></tr>${button}
    <tr><td style="background:#0c2363;padding:18px 32px;font-size:12px;line-height:1.6;color:#c9d3ea;">
      <strong style="color:#ffffff;">${escapeHtml(settings.sender_name)}</strong> &middot; Learn. Connect. Succeed.
      ${unsubscribeUrl ? `<br><a href="${unsubscribeUrl}" style="color:#c9d3ea;text-decoration:underline;">Stop receiving these messages</a>` : ''}
    </td></tr>
  </table>
</td></tr></table></body></html>`
}

async function sendEmail(to: string, subject: string, body: string, settings: Settings, unsubscribeUrl: string | null, media: string[]) {
  const html = emailHtml(subject, body, settings, unsubscribeUrl, media)
  const text = body + (unsubscribeUrl ? `\n\nStop receiving these messages: ${unsubscribeUrl}` : '')
  const from = env('EMAIL_FROM_ADDRESS')
  const attachable = media.filter((path) => !/\.(mp4|mov|webm)$/i.test(path))   // videos go as links, not attachments
  if (emailProvider() === 'brevo') {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': env('BREVO_API_KEY'), 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { name: settings.sender_name, email: from },
        to: [{ email: to }],
        ...(settings.reply_to_email ? { replyTo: { email: settings.reply_to_email } } : {}),
        subject, htmlContent: html, textContent: text,
        ...(attachable.length ? { attachment: attachable.map((path) => ({ url: mediaUrl(path), name: fileName(path) })) } : {}),
        ...(unsubscribeUrl ? { headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>` } } : {}),
      }),
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(`Brevo: ${result.message || response.statusText}`)
    return String(result.messageId || '')
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `${settings.sender_name} <${from}>`,
      to: [to],
      ...(settings.reply_to_email ? { reply_to: settings.reply_to_email } : {}),
      subject, html, text,
      ...(attachable.length ? { attachments: attachable.map((path) => ({ path: mediaUrl(path), filename: fileName(path) })) } : {}),
      ...(unsubscribeUrl ? { headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>` } } : {}),
    }),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`Resend: ${result.message || response.statusText}`)
  return String(result.id || '')
}

// Meta only lets a business start a WhatsApp conversation with an approved
// template. We use one template whose body is just {{1}} and put the whole
// message in it. Line breaks aren't allowed inside a template value.
async function sendWhatsApp(to: string, body: string, settings: Settings, media: string[]) {
  const links = media.map(mediaUrl).join(' ')
  const value = `${body}${links ? ` ${links}` : ''}`.replace(/\s*\n+\s*/g, ' · ').replace(/ {4,}/g, '   ').slice(0, 1000)
  const response = await fetch(`https://graph.facebook.com/v21.0/${env('WHATSAPP_PHONE_ID')}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('WHATSAPP_TOKEN')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: settings.whatsapp_template_name,
        language: { code: settings.whatsapp_template_language || 'en' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: value }] }],
      },
    }),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`WhatsApp: ${result.error?.message || response.statusText}`)
  return String(result.messages?.[0]?.id || '')
}

async function loadSettings(): Promise<Settings> {
  const { data, error } = await admin.from('messaging_settings').select('*').single()
  if (error) throw error
  return data as Settings
}

const GATEWAY_BATCH = 10   // WhatsApp messages per 10-minute run in gateway mode (keeps within the function's time limit)

async function sendQueued() {
  const settings = await loadSettings()
  const canEmail = settings.email_enabled && emailReady()
  let whatsappRoom = 0
  let whatsappNote = ''
  if (settings.whatsapp_mode === 'cloud_api' && cloudReady(settings)) whatsappRoom = BATCH
  if (settings.whatsapp_mode === 'gateway' && gatewayReady()) {
    const hour = lagosHour()
    if (hour < GATEWAY_HOURS.from || hour >= GATEWAY_HOURS.to) {
      whatsappNote = 'WhatsApp waits until 8:00 (sends 8:00 to 20:00 Lagos time)'
    } else {
      // Lagos is UTC+1 all year: midnight in Lagos is 23:00 UTC the day before
      const lagosNow = new Date(Date.now() + 3600000)
      const lagosMidnightUtc = Date.UTC(lagosNow.getUTCFullYear(), lagosNow.getUTCMonth(), lagosNow.getUTCDate()) - 3600000
      const { count } = await admin.from('message_log').select('id', { count: 'exact', head: true })
        .eq('channel', 'whatsapp').eq('status', 'sent').gte('sent_at', new Date(lagosMidnightUtc).toISOString())
      const limit = settings.whatsapp_daily_limit ?? 120
      whatsappRoom = Math.max(0, Math.min(GATEWAY_BATCH, limit - (count || 0)))
      if (!whatsappRoom) whatsappNote = `Today's WhatsApp limit of ${limit} is reached`
    }
  }

  const select = 'id, channel, to_address, subject, body, media_paths, attempts, leads(opt_out_token, opted_out), students(opt_out_token, opted_out)'
  const [emails, whatsapps] = await Promise.all([
    canEmail ? admin.from('message_log').select(select).eq('status', 'queued').eq('channel', 'email').lt('attempts', MAX_ATTEMPTS).order('queued_at').limit(BATCH) : { data: [], error: null },
    whatsappRoom ? admin.from('message_log').select(select).eq('status', 'queued').eq('channel', 'whatsapp').lt('attempts', MAX_ATTEMPTS).order('queued_at').limit(whatsappRoom) : { data: [], error: null },
  ])
  if (emails.error) throw emails.error
  if (whatsapps.error) throw whatsapps.error
  if (!canEmail && !whatsappRoom) return { sent: 0, failed: 0, waiting: whatsappNote || 'No automatic channel is set up yet' }
  const rows = [...(emails.data || []), ...(whatsapps.data || [])]
  const gap = Math.max(5, settings.whatsapp_gap_seconds ?? 8) * 1000
  let lastWhatsApp = 0

  const site = (settings.site_url || '').replace(/\/+$/, '')
  let sent = 0
  let failed = 0
  for (const row of rows || []) {
    // deno-lint-ignore no-explicit-any
    const person: any = row.leads || row.students
    if (person?.opted_out) {
      await admin.from('message_log').update({ status: 'failed', error: 'Skipped: opted out' }).eq('id', row.id)
      continue
    }
    const unsubscribeUrl = site && person?.opt_out_token ? `${site}/unsubscribe?t=${person.opt_out_token}` : null
    try {
      if (!row.to_address) throw new Error('No address on record')
      if (row.channel === 'whatsapp' && settings.whatsapp_mode === 'gateway') {
        // A human-like pause between WhatsApp messages, with a little randomness
        const wait = lastWhatsApp ? gap + Math.random() * 3000 - (Date.now() - lastWhatsApp) : 0
        if (wait > 0) await sleep(wait)
        lastWhatsApp = Date.now()
      }
      const providerId = row.channel === 'email'
        ? await sendEmail(row.to_address, row.subject || settings.sender_name, row.body || '', settings, unsubscribeUrl, row.media_paths || [])
        : settings.whatsapp_mode === 'gateway'
          ? await sendWhatsAppGateway(row.to_address, row.body || '', row.media_paths || [])
          : await sendWhatsApp(row.to_address, row.body || '', settings, row.media_paths || [])
      await admin.from('message_log').update({
        status: 'sent', sent_at: new Date().toISOString(), error: null, attempts: row.attempts + 1, provider_message_id: providerId,
      }).eq('id', row.id)
      sent++
    } catch (sendError) {
      const attempts = row.attempts + 1
      await admin.from('message_log').update({
        status: attempts >= MAX_ATTEMPTS ? 'failed' : 'queued',
        error: String((sendError as Error).message || sendError).slice(0, 500),
        attempts,
      }).eq('id', row.id)
      failed++
    }
  }
  return { sent, failed, ...(whatsappNote ? { note: whatsappNote } : {}) }
}

// Is the linked WhatsApp number online? ("authorized" means the QR code was scanned)
async function gatewayState() {
  try {
    const response = await fetch(`${env('GREENAPI_URL').replace(/\/+$/, '')}/waInstance${env('GREENAPI_INSTANCE')}/getStateInstance/${env('GREENAPI_TOKEN')}`)
    const result = await response.json().catch(() => ({}))
    return String(result.stateInstance || response.statusText)
  } catch (error) {
    return String((error as Error).message || error)
  }
}

// Is the caller a signed-in, active admin?
async function isAdminRequest(request: Request) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return false
  const { data } = await admin.auth.getUser(token)
  if (!data?.user) return false
  const { data: member } = await admin.from('members').select('role, status').eq('id', data.user.id).maybeSingle()
  return member?.role === 'admin' && member?.status === 'active'
}

// The 10-minute job sends a secret that the database generated and keeps in
// public.app_secrets (only this function can read it). CRON_SECRET as an
// Edge Function secret also works, if you prefer setting one by hand.
let storedCronSecret: string | null = null
async function cronSecret() {
  if (env('CRON_SECRET')) return env('CRON_SECRET')
  if (storedCronSecret) return storedCronSecret
  const { data } = await admin.from('app_secrets').select('value').eq('name', 'cron').maybeSingle()
  storedCronSecret = data?.value || null
  return storedCronSecret
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (!SERVICE_KEY) return reply({ error: 'The function has no service key. Check the Supabase secrets.' }, 500)

  const secret = await cronSecret()
  const fromCron = Boolean(secret) && request.headers.get('x-cron-secret') === secret
  if (!fromCron && !(await isAdminRequest(request))) return reply({ error: 'Not allowed' }, 401)

  const input = await request.json().catch(() => ({}))
  try {
    if (input.action === 'status') {
      const settings = await loadSettings()
      return reply({
        email: { ready: emailReady(), provider: emailProvider() || null, from: env('EMAIL_FROM_ADDRESS') || null, enabled: settings.email_enabled },
        whatsapp: { mode: settings.whatsapp_mode, ready: whatsappReady(settings), hasToken: Boolean(env('WHATSAPP_TOKEN') && env('WHATSAPP_PHONE_ID')), gateway: gatewayReady(), gatewayState: settings.whatsapp_mode === 'gateway' && gatewayReady() ? await gatewayState() : null },
        cronSecret: Boolean(await cronSecret()),
      })
    }
    if (input.action === 'test') {
      const settings = await loadSettings()
      const text = 'This is a test message from TecTerminal Umuahia Ledger. If you can read this, sending works.'
      const id = input.channel === 'whatsapp' && settings.whatsapp_mode === 'gateway'
        ? await sendWhatsAppGateway(String(input.to), text, [])
        : input.channel === 'whatsapp'
        ? await sendWhatsApp(String(input.to).replace(/\D/g, '').replace(/^0/, '234'), text, settings, [])
        : await sendEmail(String(input.to), 'Test message from TecTerminal Umuahia Ledger', text, settings, null, [])
      return reply({ ok: true, id })
    }
    return reply(await sendQueued())
  } catch (error) {
    return reply({ error: String((error as Error).message || error) }, 500)
  }
})
