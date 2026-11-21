import { useEffect, useState } from 'react'

export function todayDate(): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

let selectedDate = todayDate()
const listeners = new Set<(date: string) => void>()

export function getSelectedDate(): string {
  return selectedDate
}

export function setSelectedDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return
  selectedDate = date
  for (const listener of listeners) listener(selectedDate)
}

export function useSelectedDate(): [string, (date: string) => void] {
  const [date, updateDate] = useState(selectedDate)
  useEffect(() => {
    const listener = (nextDate: string) => updateDate(nextDate)
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, [])
  return [date, setSelectedDate]
}
