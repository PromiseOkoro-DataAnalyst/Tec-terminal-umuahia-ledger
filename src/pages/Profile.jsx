import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/auth'
import { useToast } from '../components/toast'
import Icon from '../components/Icon'
import { Avatar, Field, PageHead, PhotoBanner } from '../components/ui'
import { PHOTOS } from '../lib/photos'

export default function Profile() {
  const { member, user, refreshMember, isAdmin } = useAuth()
  const toast = useToast()
  const [form, setForm] = useState({ full_name: member?.full_name || '', whatsapp: member?.whatsapp || '' })
  const [busy, setBusy] = useState(false)
  const [signatureUrl, setSignatureUrl] = useState(null)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    let alive = true
    if (!member?.signature_path) return undefined
    supabase.storage.from('signatures').createSignedUrl(member.signature_path, 3600).then(({ data }) => {
      if (alive) setSignatureUrl(data?.signedUrl || null)
    })
    return () => { alive = false }
  }, [member?.signature_path])

  const save = async (event) => {
    event.preventDefault()
    setBusy(true)
    const { error } = await supabase.from('members').update({ full_name: form.full_name.trim(), whatsapp: form.whatsapp.trim() || null }).eq('id', user.id)
    setBusy(false)
    if (error) return toast(error.message, 'error')
    toast('Profile saved')
    refreshMember()
  }

  const upload = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!/^image\/(png|jpeg)$/.test(file.type)) return toast('Use a PNG or JPG image.', 'error')
    if (file.size > 1024 * 1024) return toast('Keep the image under 1 MB.', 'error')
    setUploading(true)
    const path = `${user.id}/signature-${Date.now()}.${file.type === 'image/png' ? 'png' : 'jpg'}`
    const { error } = await supabase.storage.from('signatures').upload(path, file, { contentType: file.type })
    if (!error) {
      const previous = member?.signature_path
      await supabase.from('members').update({ signature_path: path }).eq('id', user.id)
      if (previous) supabase.storage.from('signatures').remove([previous])
      await refreshMember()
      toast('Signature saved')
    } else {
      toast(error.message, 'error')
    }
    setUploading(false)
  }

  return (
    <>
      <PageHead title="My profile" />
      <PhotoBanner photo={PHOTOS.yaba} title={member?.full_name || 'Your profile'}>{isAdmin ? 'Admin' : 'Marketer'} at TecTerminal Umuahia</PhotoBanner>
      <div className="split">
        <section className="panel">
          <header className="profile-head">
            <Avatar name={member?.full_name || member?.email} size="lg" />
            <span><b>{member?.full_name || 'No name yet'}</b><small className="muted">{member?.email} · {isAdmin ? 'Admin' : 'Marketer'}</small></span>
          </header>
          <form className="form" onSubmit={save}>
            <Field label="Full name" hint="Shown on reports you download"><input required value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} /></Field>
            <Field label="WhatsApp number"><input value={form.whatsapp} inputMode="tel" onChange={(event) => setForm({ ...form, whatsapp: event.target.value })} /></Field>
            <div className="row end"><button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button></div>
          </form>
        </section>

        <section className="panel">
          <header className="panel-head"><h2>Signature</h2></header>
          <p className="muted small">Added automatically to the signature spot on reports you download. Sign on white paper, take a clear photo, and upload a PNG or JPG under 1 MB.</p>
          <div className="signature-box">
            {signatureUrl ? <img src={signatureUrl} alt="Your signature" /> : <span className="muted">No signature uploaded</span>}
          </div>
          <label className="btn btn-block">
            <Icon name="upload" size={18} /> {uploading ? 'Uploading…' : member?.signature_path ? 'Replace signature' : 'Upload signature'}
            <input type="file" accept="image/png,image/jpeg" hidden onChange={upload} disabled={uploading} />
          </label>
        </section>
      </div>
    </>
  )
}
