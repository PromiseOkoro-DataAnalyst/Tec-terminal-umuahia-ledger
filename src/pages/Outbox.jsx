import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { must, useLoad } from '../lib/useLoad'
import { useAuth } from '../context/auth'
import { useToast } from '../components/toast'
import { timeAgo, todayISO, whatsappLink } from '../lib/format'
import { exportToExcel } from '../lib/exportExcel'
import { SOURCES, callSender, mediaName, mediaUrl } from '../lib/messaging'
import Icon from '../components/Icon'
import { CountUp, Empty, ErrorNote, Loading, PageHead, Search, Segmented } from '../components/ui'

const STATUS = [
  { value: 'queued', label: 'Waiting' },
  { value: 'sent', label: 'Sent' },
  { value: 'failed', label: 'Failed' },
]

export default function Outbox() {
  const { isAdmin } = useAuth()
  const toast = useToast()
  const [status, setStatus] = useState('queued')
  const [channel, setChannel] = useState('all')
  const [source, setSource] = useState('all')
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState(null)
  const [sending, setSending] = useState(false)

  const { data, error, reload } = useLoad(async () => {
    const since = new Date(Date.now() - 60 * 86400000).toISOString()
    const [messages, settings] = await Promise.all([
      must(supabase.from('message_log')
        .select('id, source, channel, status, error, recipient_name, to_address, subject, body, media_paths, queued_at, sent_at, lead_id, student_id, campaigns(name), broadcasts(title)')
        .or(`status.eq.queued,queued_at.gte.${since}`)
        .order('queued_at', { ascending: false }).limit(1000)),
      must(supabase.from('messaging_settings').select('whatsapp_mode, email_enabled').maybeSingle()),
    ])
    return { messages, manualWhatsApp: (settings?.whatsapp_mode || 'manual') === 'manual' }
  }, [])

  const messages = useMemo(() => data?.messages || [], [data])
  const counts = useMemo(() => Object.fromEntries(STATUS.map((item) => [item.value, messages.filter((row) => row.status === item.value).length])), [messages])
  const waitingForYou = data?.manualWhatsApp ? messages.filter((row) => row.status === 'queued' && row.channel === 'whatsapp').length : 0

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return messages.filter((row) =>
      row.status === status &&
      (channel === 'all' || row.channel === channel) &&
      (source === 'all' || row.source === source) &&
      (!needle || [row.recipient_name, row.to_address, row.body].join(' ').toLowerCase().includes(needle)))
  }, [messages, status, channel, source, query])

  const sendOnWhatsApp = async (row) => {
    const text = [row.body, ...(row.media_paths || []).map(mediaUrl)].join('\n\n')
    window.open(whatsappLink(row.to_address, text), '_blank', 'noopener')
    const { error: markError } = await supabase.rpc('mark_message_sent', { target_message_id: row.id })
    if (markError) return toast(markError.message, 'error')
    toast(`Marked as sent to ${row.recipient_name}`)
    reload()
  }

  const adminAction = async (row, action) => {
    const { error: actionError } = await supabase.rpc('set_message_status', { target_message_id: row.id, new_status: action })
    if (actionError) return toast(actionError.message, 'error')
    toast(action === 'retry' ? 'Back in the queue' : 'Cancelled')
    reload()
  }

  const sendNow = async () => {
    setSending(true)
    try {
      const result = await callSender({ action: 'send' })
      toast(result.waiting ? result.waiting : `${result.sent} sent${result.failed ? `, ${result.failed} failed` : ''}`, result.failed ? 'error' : 'ok')
      reload()
    } catch (sendError) {
      toast(sendError.message, 'error')
    }
    setSending(false)
  }

  const exportMessages = () => exportToExcel({
    fileName: `TecTerminal messages ${todayISO()}`,
    sheet: 'Messages',
    subject: 'message',
    rows: visible,
    columns: [
      { header: 'To', value: (row) => row.recipient_name, width: 24 },
      { header: 'Address', value: (row) => row.to_address, width: 26 },
      { header: 'Channel', value: (row) => (row.channel === 'email' ? 'Email' : 'WhatsApp'), width: 11 },
      { header: 'Type', value: (row) => SOURCES[row.source], width: 16 },
      { header: 'Campaign / broadcast', value: (row) => row.campaigns?.name || row.broadcasts?.title, width: 22 },
      { header: 'Status', value: (row) => row.status, width: 10 },
      { header: 'Queued', value: (row) => new Date(row.queued_at), width: 18, },
      { header: 'Sent', value: (row) => (row.sent_at ? new Date(row.sent_at) : null), width: 18 },
      { header: 'Subject', value: (row) => row.subject, width: 30 },
      { header: 'Message', value: (row) => row.body, width: 60 },
      { header: 'Error', value: (row) => row.error, width: 30 },
    ],
  }).catch((exportError) => toast(exportError.message, 'error'))

  return (
    <>
      <PageHead title="Outbox" sub="Every campaign message, fee reminder and broadcast, and whether it went out.">
        <button className="btn" onClick={exportMessages} disabled={!visible.length}><Icon name="download" size={18} /> Excel</button>
        {isAdmin && <button className="btn btn-primary" onClick={sendNow} disabled={sending}><Icon name="send" size={18} /> {sending ? 'Sending…' : 'Send queued now'}</button>}
      </PageHead>

      {waitingForYou > 0 && (
        <section className="panel panel-attention outbox-callout">
          <span className="outbox-callout-figure"><CountUp value={waitingForYou} /></span>
          <div>
            <b>WhatsApp message{waitingForYou === 1 ? '' : 's'} waiting for you to send</b>
            <p className="muted small">Tap <i>Send</i> on each one: WhatsApp opens with the message ready, and it’s ticked off here.</p>
          </div>
          {status !== 'queued' || channel !== 'whatsapp' ? (
            <button className="btn btn-whatsapp" onClick={() => { setStatus('queued'); setChannel('whatsapp') }}><Icon name="whatsapp" size={18} /> Show them</button>
          ) : null}
        </section>
      )}

      <div className="toolbar">
        <Segmented label="Status" value={status} onChange={setStatus}
          options={STATUS.map((item) => ({ value: item.value, label: `${item.label} ${counts[item.value] ?? ''}` }))} />
        <Search value={query} onChange={setQuery} placeholder="Search name, number or text" />
      </div>
      <div className="filters">
        {[['all', 'All channels'], ['whatsapp', 'WhatsApp'], ['email', 'Email']].map(([value, label]) => (
          <button key={value} className={`chip ${channel === value ? 'on' : ''}`} onClick={() => setChannel(value)}>{label}</button>
        ))}
        <select className="chip-select" value={source} onChange={(event) => setSource(event.target.value)} aria-label="Type">
          <option value="all">All types</option>
          {Object.entries(SOURCES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>

      <ErrorNote>{error}</ErrorNote>
      {!data ? <Loading /> : visible.length === 0 ? (
        <Empty icon="outbox" title={status === 'queued' ? 'Nothing waiting' : status === 'failed' ? 'Nothing failed' : 'Nothing sent yet'}>
          {status === 'queued' ? 'Campaigns and fee reminders are checked every morning at 9:00. New messages appear here.' : 'Messages from the last 60 days show here.'}
        </Empty>
      ) : (
        <ul className="outbox">
          {visible.map((row) => {
            const open = openId === row.id
            return (
              <li key={row.id} className={`outbox-row ${open ? 'open' : ''}`}>
                <button className="outbox-main" onClick={() => setOpenId(open ? null : row.id)} aria-expanded={open}>
                  <span className={`channel-dot channel-${row.channel}`}><Icon name={row.channel === 'email' ? 'mail' : 'whatsapp'} size={16} /></span>
                  <span className="outbox-text">
                    <b>{row.recipient_name || row.to_address}</b>
                    <small>
                      {SOURCES[row.source]}{row.campaigns?.name ? ` · ${row.campaigns.name}` : ''}{row.broadcasts?.title ? ` · ${row.broadcasts.title}` : ''}
                      {' · '}{row.status === 'sent' && row.sent_at ? `sent ${timeAgo(row.sent_at)}` : `queued ${timeAgo(row.queued_at)}`}
                    </small>
                    {!open && <span className="outbox-snippet">{row.channel === 'email' && row.subject ? `${row.subject} — ` : ''}{row.body}</span>}
                    {row.error && <span className="outbox-error"><Icon name="alert" size={14} /> {row.error}</span>}
                  </span>
                </button>
                <span className="outbox-actions">
                  {row.status === 'queued' && row.channel === 'whatsapp' && data.manualWhatsApp && (
                    <button className="btn btn-small btn-whatsapp" onClick={() => sendOnWhatsApp(row)}><Icon name="whatsapp" size={16} /> Send</button>
                  )}
                  {isAdmin && row.status === 'queued' && <button className="btn btn-small" onClick={() => adminAction(row, 'cancel')}>Cancel</button>}
                  {isAdmin && row.status === 'failed' && <button className="btn btn-small" onClick={() => adminAction(row, 'retry')}><Icon name="refresh" size={15} /> Retry</button>}
                </span>
                {open && (
                  <div className="outbox-detail">
                    <p className="muted small">To {row.to_address}</p>
                    {row.channel === 'email' && row.subject && <b>{row.subject}</b>}
                    <p className="outbox-body">{row.body}</p>
                    {row.media_paths?.length > 0 && (
                      <div className="chips">
                        {row.media_paths.map((path) => (
                          <a key={path} className="chip" href={mediaUrl(path)} target="_blank" rel="noreferrer"><Icon name="paperclip" size={14} /> {mediaName(path)}</a>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
