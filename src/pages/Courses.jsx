import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { must, useLoad } from '../lib/useLoad'
import { useToast } from '../components/toast'
import { naira } from '../lib/format'
import Icon from '../components/Icon'
import { Empty, ErrorNote, Field, Loading, Modal, PageHead, PhotoBanner } from '../components/ui'
import { PHOTOS } from '../lib/photos'

export default function Courses() {
  const toast = useToast()
  const [editing, setEditing] = useState(null)

  const { data, error, reload } = useLoad(async () => {
    const [courses, students, leads] = await Promise.all([
      must(supabase.from('courses').select('*').order('name')),
      must(supabase.from('students').select('course_id')),
      must(supabase.from('leads').select('course_id').not('stage', 'in', '(enrolled,lost)')),
    ])
    const count = (rows, id) => rows.filter((row) => row.course_id === id).length
    return { courses: courses.map((course) => ({ ...course, students: count(students, course.id), open_leads: count(leads, course.id) })) }
  }, [])

  const toggle = async (course) => {
    const { error: saveError } = await supabase.from('courses').update({ is_active: !course.is_active }).eq('id', course.id)
    if (saveError) return toast(saveError.message, 'error')
    toast(course.is_active ? `${course.name} hidden from new enrolments` : `${course.name} is open again`)
    reload()
  }

  return (
    <>
      <PageHead title="Courses" sub="The catalogue marketers pick from, with each course’s standard fee.">
        <button className="btn btn-primary" onClick={() => setEditing({})}><Icon name="plus" size={18} /> Add course</button>
      </PageHead>
      <PhotoBanner photo={PHOTOS.graduates} title="From enquiry to graduation">
        {data ? `${data.courses.filter((course) => course.is_active).length} courses open for enrolment` : 'Your course catalogue'}
      </PhotoBanner>
      <ErrorNote>{error}</ErrorNote>
      {!data ? <Loading /> : data.courses.length === 0 ? (
        <Empty icon="courses" title="No courses yet" action={<button className="btn btn-primary" onClick={() => setEditing({})}>Add your first course</button>}>
          Add the courses you teach so leads and students can be linked to them.
        </Empty>
      ) : (
        <div className="table-card">
          <table className="table">
            <thead><tr><th>Course</th><th>Duration</th><th className="num">Standard fee</th><th className="num">Students</th><th className="num">Open leads</th><th>Status</th><th><span className="sr-only">Edit</span></th></tr></thead>
            <tbody>
              {data.courses.map((course) => (
                <tr key={course.id} className={course.is_active ? '' : 'row-muted'}>
                  <td data-label="Course"><b>{course.name}</b></td>
                  <td data-label="Duration">{course.duration_label || '—'}</td>
                  <td data-label="Standard fee" className="num">{naira(course.standard_fee)}</td>
                  <td data-label="Students" className="num">{course.students}</td>
                  <td data-label="Open leads" className="num">{course.open_leads}</td>
                  <td data-label="Status">
                    <button className={`switch ${course.is_active ? 'on' : ''}`} role="switch" aria-checked={course.is_active} onClick={() => toggle(course)}>
                      <span />{course.is_active ? 'Open' : 'Hidden'}
                    </button>
                  </td>
                  <td className="cell-actions"><button className="btn btn-small" onClick={() => setEditing(course)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <CourseForm course={editing} onClose={() => setEditing(null)} onSaved={(isNew) => { setEditing(null); toast(isNew ? 'Course added' : 'Course saved'); reload() }} />}
    </>
  )
}

function CourseForm({ course, onClose, onSaved }) {
  const toast = useToast()
  const [form, setForm] = useState({ name: course.name || '', standard_fee: course.standard_fee ?? '', duration_label: course.duration_label || '' })
  const [busy, setBusy] = useState(false)
  const update = (key) => (event) => setForm({ ...form, [key]: event.target.value })

  const save = async (event) => {
    event.preventDefault()
    setBusy(true)
    const payload = { name: form.name.trim(), standard_fee: Number(form.standard_fee || 0), duration_label: form.duration_label.trim() || null }
    const { error } = course.id
      ? await supabase.from('courses').update(payload).eq('id', course.id)
      : await supabase.from('courses').insert(payload)
    setBusy(false)
    if (error) return toast(/duplicate/i.test(error.message) ? 'A course with that name already exists.' : error.message, 'error')
    onSaved(!course.id)
  }

  return (
    <Modal title={course.id ? `Edit ${course.name}` : 'Add a course'} onClose={onClose}>
      <form className="form" onSubmit={save}>
        <Field label="Course name"><input required autoFocus value={form.name} onChange={update('name')} placeholder="e.g. Software Engineering" /></Field>
        <div className="form-row">
          <Field label="Standard fee (₦)" hint="Marketers can adjust it per student">
            <input type="number" min="0" step="any" required value={form.standard_fee} onChange={update('standard_fee')} />
          </Field>
          <Field label="Duration"><input value={form.duration_label} onChange={update('duration_label')} placeholder="e.g. 6 months" /></Field>
        </div>
        {course.id && <p className="muted small">Changing the fee only affects new enrolments. Existing students keep their agreed fee.</p>}
        <div className="row end">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : course.id ? 'Save course' : 'Add course'}</button>
        </div>
      </form>
    </Modal>
  )
}
