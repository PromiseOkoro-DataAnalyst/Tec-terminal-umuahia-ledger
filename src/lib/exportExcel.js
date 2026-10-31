import { logEvent } from './supabase'

// columns: [{ header: 'Name', value: (row) => row.full_name, width: 24 }]
export async function exportToExcel({ fileName, sheet, columns, rows, subject }) {
  const { default: writeExcelFile } = await import('write-excel-file/browser')
  const data = [
    columns.map((column) => ({ value: column.header, fontWeight: 'bold', backgroundColor: '#E7ECF8' })),
    ...rows.map((row) => columns.map((column) => {
      const value = column.value(row)
      return { value: value === undefined || value === '' ? null : value }
    })),
  ]
  await writeExcelFile(data, { columns: columns.map((column) => ({ width: column.width || 18 })), sheet })
    .toFile(`${fileName}.xlsx`)
  logEvent('exported', subject, `exported ${rows.length} ${subject}${rows.length === 1 ? '' : 's'} to Excel`)
}
