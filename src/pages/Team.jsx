import { supabase } from '../lib/supabase'
import { must, useLoad } from '../lib/useLoad'
import { useAuth } from '../context/auth'
import { useToast } from '../components/toast'
import { dayLabel, whatsappLink } from '../lib/format'
import Icon from '../components/Icon'
import { Avatar, ErrorNote, Loading, PageHead, PhotoBanner } from '../components/ui'
import { PHOTOS } from '../lib/photos'

export default function Team() {
  const { user } = useAuth()
  const toast = useToast()
  const { data, error, reload } = useLoad(async () => ({
    members: await must(supabase.from('members').select('*').order('created_at')),
  }), [])

  const change = async (person, patch, message) => {
    const { error: saveError } = await supabase.from('members').update(patch).eq('id', person.id)
    if (saveError) return toast(saveError.message, 'error')
    toast(message)
    reload()
  }

  const pending = data?.members.filter((person) => person.status === 'pending') || []
  const others = data?.members.filter((person) => person.status !== 'pending') || []

  return (
    <>
      <PageHead title="Team" sub="Activate new marketers, pause access, and choose who is an admin." />
      <PhotoBanner photo={PHOTOS.friends} title={data ? `${data.members.filter((person) => person.status === 'active').length} people working the ledger` : 'Your team'}>
        Everyone here can sign in. New sign-ups wait for you to activate them.
      </PhotoBanner>
      <ErrorNote>{error}</ErrorNote>
      {!data ? <Loading /> : (
        <>
          {pending.length > 0 && (
            <section className="panel panel-attention">
              <header className="panel-head"><h2>Waiting for you ({pending.length})</h2></header>
              <ul className="requests">
                {pending.map((person) => (
                  <li key={person.id}>
                    <Avatar name={person.full_name || person.email} />
                    <span className="request-who">
                      <b>{person.full_name || 'No name given'}</b>
                      <small className="muted">{person.email}{person.whatsapp ? ` · ${person.whatsapp}` : ''} · registered {dayLabel(person.created_at)}</small>
                    </span>
                    {person.whatsapp && (
                      <a className="icon-btn whatsapp" href={whatsappLink(person.whatsapp)} target="_blank" rel="noreferrer" aria-label={`WhatsApp ${person.full_name}`}><Icon name="whatsapp" /></a>
                    )}
                    <button className="btn btn-small" onClick={() => change(person, { status: 'suspended' }, `${person.full_name || person.email} declined`)}>Decline</button>
                    <button className="btn btn-small btn-primary" onClick={() => change(person, { status: 'active' }, `${person.full_name || person.email} can now sign in`)}>Activate</button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="table-card">
            <table className="table">
              <thead><tr><th>Person</th><th>WhatsApp</th><th>Role</th><th>Joined</th><th>Access</th></tr></thead>
              <tbody>
                {others.map((person) => {
                  const me = person.id === user.id
                  return (
                    <tr key={person.id} className={person.status === 'suspended' ? 'row-muted' : ''}>
                      <td data-label="Person">
                        <span className="person"><Avatar name={person.full_name || person.email} size="sm" />
                          <span><b>{person.full_name || '—'}{me && ' (you)'}</b><small className="muted">{person.email}</small></span>
                        </span>
                      </td>
                      <td data-label="WhatsApp">{person.whatsapp || '—'}</td>
                      <td data-label="Role">
                        <select className="chip-select" value={person.role} disabled={me} aria-label="Role"
                          onChange={(event) => change(person, { role: event.target.value }, `${person.full_name || person.email} is now ${event.target.value === 'admin' ? 'an admin' : 'a marketer'}`)}>
                          <option value="marketer">Marketer</option>
                          <option value="admin">Admin</option>
                        </select>
                      </td>
                      <td data-label="Joined">{dayLabel(person.created_at)}</td>
                      <td data-label="Access">
                        {me ? <span className="muted small">—</span> : person.status === 'active'
                          ? <button className="btn btn-small" onClick={() => change(person, { status: 'suspended' }, `Access paused for ${person.full_name || person.email}`)}>Pause access</button>
                          : <button className="btn btn-small btn-primary" onClick={() => change(person, { status: 'active' }, `${person.full_name || person.email} can sign in again`)}>Restore</button>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="muted small">Paused people keep their leads and students; an admin can still see and reassign them.</p>
        </>
      )}
    </>
  )
}
