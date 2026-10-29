/**
 * Timezone utilities to enforce SGT (Singapore Time, UTC+8) in the frontend.
 */

export function getSingaporeDateString(date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = formatter.formatToParts(date);
  const month = parts.find(p => p.type === 'month')?.value;
  const day = parts.find(p => p.type === 'day')?.value;
  const year = parts.find(p => p.type === 'year')?.value;
  return `${year}-${month}-${day}`;
}

export function formatToSingaporeDate(
  dateInput: Date | string | number,
  options: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' }
): string {
  if (!dateInput) return "";
  const date = parseDatabaseDate(dateInput);
  if (isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Singapore',
    ...options
  }).format(date).replace(/[\u202F\u00A0\uFEFF]/g, ' ');
}

export function formatToSingaporeTime(
  dateInput: Date | string | number,
  options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: true }
): string {
  if (!dateInput) return "";
  const date = parseDatabaseDate(dateInput);
  if (isNaN(date.getTime())) return "";
  const formatted = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Singapore',
    ...options
  }).format(date).replace(/[\u202F\u00A0\uFEFF]/g, ' ');
  return formatted.replace(/(am|pm)/gi, (m) => m.toUpperCase());
}

export function formatToSingaporeDateTime(dateInput: Date | string | number): string {
  if (!dateInput) return "";
  const date = parseDatabaseDate(dateInput);
  if (isNaN(date.getTime())) return "";
  const dateStr = formatToSingaporeDate(date, { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeStr = formatToSingaporeTime(date, { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${dateStr} • ${timeStr}`.replace(/[\u202F\u00A0\uFEFF]/g, ' ');
}

export function getSingaporeDate(): Date {
  return new Date();
}

export function getSingaporeTimeTodayRange(): { from: Date; to: Date } {
  const now = new Date();
  
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = formatter.formatToParts(now);
  const month = parts.find(p => p.type === 'month')?.value;
  const day = parts.find(p => p.type === 'day')?.value;
  const year = parts.find(p => p.type === 'year')?.value;

  const from = new Date(`${year}-${month}-${day}T00:00:00+08:00`);
  const to = new Date(now);
  return { from, to };
}

export function parseDatabaseDate(dateInput: Date | string | number): Date {
  if (!dateInput) return new Date();
  if (dateInput instanceof Date) return dateInput;
  if (typeof dateInput === 'number') return new Date(dateInput);

  let str = String(dateInput).trim();
  
  // Try custom regex parsing for: "Jul  9 2026  2:12PM"
  const cleaned = str.replace(/\s+/g, ' ');
  const match = cleaned.match(/^([a-zA-Z]{3})\s+(\d{1,2})\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)$/);
  if (match) {
    const monthMap: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
    };
    const [_, monStr, dayStr, yearStr, hourStr, minStr, ampm] = match;
    const month = monthMap[monStr.toLowerCase()];
    const day = parseInt(dayStr, 10);
    const year = parseInt(yearStr, 10);
    let hour = parseInt(hourStr, 10);
    const minute = parseInt(minStr, 10);
    if (ampm.toUpperCase() === 'PM' && hour < 12) hour += 12;
    if (ampm.toUpperCase() === 'AM' && hour === 12) hour = 0;

    const isoStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+08:00`;
    return new Date(isoStr);
  }

  // If string has explicit numeric timezone offset (+08:00, -05:00, etc.), parse directly as JS Date
  if (/[+-]\d{2}:?\d{2}$/.test(str)) {
    const directParsed = new Date(str);
    if (!isNaN(directParsed.getTime())) {
      return directParsed;
    }
  }

  // MSSQL datetime columns (e.g. GETDATE() or LastSettlementDate) are stored in Singapore local time (+08:00).
  // When serialized by Tedious/JSON, they often receive a false trailing 'Z'. Strip any trailing 'Z' or offset.
  let cleanStr = str.replace(/Z$/i, '').replace(/[+-]\d{2}:\d{2}$/, '');

  if (!cleanStr.includes('T') && cleanStr.includes(' ') && !/^[a-zA-Z]{3}/.test(cleanStr)) {
    cleanStr = cleanStr.replace(' ', 'T');
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(cleanStr)) {
    if (!cleanStr.includes('T')) {
      cleanStr += 'T00:00:00';
    }
    cleanStr += '+08:00';
  }

  const parsed = new Date(cleanStr);
  return isNaN(parsed.getTime()) ? new Date(dateInput) : parsed;
}



