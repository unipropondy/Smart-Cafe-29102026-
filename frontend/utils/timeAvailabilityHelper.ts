/**
 * Utility helper for dish time availability check.
 * Supports formats:
 * - 24-hour format: "00:05", "01:00", "13:30", "23:59"
 * - 12-hour AM/PM format: "1am", "01:00 AM", "1:30 PM", "12:00 PM", "12pm"
 * - Single digits: "1", "13"
 * - NULL or empty string -> available 24/7 (returns true)
 */

export function parseTimeToMinutes(timeStr: string | null | undefined): number | null {
  if (!timeStr || typeof timeStr !== "string") return null;

  const cleaned = timeStr.trim().toLowerCase();
  if (!cleaned) return null;

  // Match 12-hour AM/PM format like "1am", "01:00 am", "1:30 pm", "12pm"
  const ampmRegex = /^(\d{1,2})(?::(\d{1,2}))?\s*(am|pm)$/i;
  const ampmMatch = cleaned.match(ampmRegex);

  if (ampmMatch) {
    let hours = parseInt(ampmMatch[1], 10);
    const minutes = ampmMatch[2] ? parseInt(ampmMatch[2], 10) : 0;
    const period = ampmMatch[3].toLowerCase();

    if (hours < 1 || hours > 12 || minutes < 0 || minutes > 59) return null;

    if (period === "pm" && hours < 12) {
      hours += 12;
    } else if (period === "am" && hours === 12) {
      hours = 0;
    }
    return hours * 60 + minutes;
  }

  // Match 24-hour format like "00:05", "01:00", "13:30", "23:59", or single/double digit "1", "13"
  const time24Regex = /^(\d{1,2})(?::(\d{1,2}))?$/;
  const time24Match = cleaned.match(time24Regex);

  if (time24Match) {
    const hours = parseInt(time24Match[1], 10);
    const minutes = time24Match[2] ? parseInt(time24Match[2], 10) : 0;

    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

    return hours * 60 + minutes;
  }

  return null;
}

export function isDishAvailableNow(
  availableFromStr: string | null | undefined,
  availableToStr: string | null | undefined,
  currentDateObj: Date = new Date()
): boolean {
  const fromMinutes = parseTimeToMinutes(availableFromStr);
  const toMinutes = parseTimeToMinutes(availableToStr);

  // If either is missing or invalid, assume available 24/7
  if (fromMinutes === null || toMinutes === null) {
    return true;
  }

  // Enforce Singapore Time (Asia/Singapore, SGT UTC+8) standard across all devices and servers
  const sgtParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Singapore",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(currentDateObj);

  const sgtHourStr = sgtParts.find((p) => p.type === "hour")?.value || "0";
  const sgtMinuteStr = sgtParts.find((p) => p.type === "minute")?.value || "0";

  let hours = parseInt(sgtHourStr, 10);
  if (hours === 24) hours = 0; // Handle 24-hour midnight wrap if returned by browser
  const minutes = parseInt(sgtMinuteStr, 10);

  const currentMinutes = hours * 60 + minutes;

  if (fromMinutes <= toMinutes) {
    // Normal same-day range (e.g. 09:00 to 17:00 or 00:05 to 11:00)
    return currentMinutes >= fromMinutes && currentMinutes <= toMinutes;
  } else {
    // Overnight range (e.g. 23:00 PM to 02:00 AM)
    return currentMinutes >= fromMinutes || currentMinutes <= toMinutes;
  }
}
