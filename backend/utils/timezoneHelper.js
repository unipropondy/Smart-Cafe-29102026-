const { formatInTimeZone, fromZonedTime, toZonedTime } = require('date-fns-tz');
const { addMinutes, subMinutes, startOfDay, addDays, startOfMonth, startOfYear } = require('date-fns');

/**
 * Get the Business Date string (YYYYMMDD) for a given UTC timestamp,
 * taking into account the outlet's timezone and the DayEnd offset.
 * 
 * If a timezone is not provided, defaults to Asia/Singapore.
 * If offset is 0, rollover is at exactly midnight local time.
 */
function getBusinessDatePrefix(utcDate = new Date(), timezone = 'Asia/Singapore', offsetMinutes = 0) {
    // 1. Shift the absolute UTC time BACKWARDS by the offset minutes.
    // If the offset is 180 (3 AM), an order at 2 AM becomes 11 PM the previous day mathematically.
    const shiftedDate = subMinutes(new Date(utcDate), offsetMinutes);

    // 2. Format the shifted date in the outlet's timezone to get YYYYMMDD
    return formatInTimeZone(shiftedDate, timezone, 'yyyyMMdd');
}

/**
 * Calculate the exact absolute SQL boundary (in Singapore Time UTC+8) for a given business day filter.
 * Because our SQL Server uses GETDATE() and stores times in UTC+8 natively, we must translate
 * the requested logical Business Day bounds into UTC+8 absolute boundaries.
 */
function getBusinessDaySqlBounds(filter = 'daily', targetDateString = null, timezone = 'Asia/Singapore', offsetMinutes = 0) {
    let anchorUtcDate;
    
    if (targetDateString) {
        // We received a specific YYYY-MM-DD date. Interpret it as midnight in the target timezone.
        // e.g., "2026-06-04 00:00:00 Asia/Dubai" -> absolute UTC date.
        anchorUtcDate = fromZonedTime(`${targetDateString} 00:00:00`, timezone);
    } else {
        // Use "today's" business date as the anchor
        const shiftedNow = subMinutes(new Date(), offsetMinutes);
        // Format to YYYY-MM-DD string in local timezone
        const localTodayStr = formatInTimeZone(shiftedNow, timezone, 'yyyy-MM-dd');
        // Convert that local midnight back to an absolute UTC date
        anchorUtcDate = fromZonedTime(`${localTodayStr} 00:00:00`, timezone);
    }

    // anchorUtcDate is an absolute Date representing 00:00:00 in the target timezone.
    // The business day actually starts at 00:00:00 + offsetMinutes.
    let startBoundUtc = addMinutes(anchorUtcDate, offsetMinutes);
    let endBoundUtc;

    // Wait, fromZonedTime and math in JS Date does not handle local calendar boundaries perfectly if 
    // we use addDays on UTC Dates (since JS Date is always local machine time). 
    // To be perfectly accurate for monthly/yearly in the target timezone, we should compute 
    // local calendar boundaries first, then convert to absolute UTC.

    // Let's get the local YYYY, MM, DD
    const localZonedDate = toZonedTime(anchorUtcDate, timezone); 
    const year = localZonedDate.getFullYear();
    const month = localZonedDate.getMonth();
    const date = localZonedDate.getDate();

    switch (String(filter).toLowerCase()) {
        case "weekly":
            // 6 days ago in local time
            const weeklyStartLocal = new Date(year, month, date - 6);
            const weeklyStartUtc = fromZonedTime(weeklyStartLocal, timezone);
            startBoundUtc = addMinutes(weeklyStartUtc, offsetMinutes);
            endBoundUtc = addDays(startBoundUtc, 7);
            break;
        case "monthly":
            // Start of local calendar month
            const monthStartLocal = new Date(year, month, 1);
            const monthStartUtc = fromZonedTime(monthStartLocal, timezone);
            startBoundUtc = addMinutes(monthStartUtc, offsetMinutes);
            
            // End of local calendar month
            const nextMonthStartLocal = new Date(year, month + 1, 1);
            const nextMonthStartUtc = fromZonedTime(nextMonthStartLocal, timezone);
            endBoundUtc = addMinutes(nextMonthStartUtc, offsetMinutes);
            break;
        case "yearly":
            // Start of local calendar year
            const yearStartLocal = new Date(year, 0, 1);
            const yearStartUtc = fromZonedTime(yearStartLocal, timezone);
            startBoundUtc = addMinutes(yearStartUtc, offsetMinutes);
            
            // End of local calendar year
            const nextYearStartLocal = new Date(year + 1, 0, 1);
            const nextYearStartUtc = fromZonedTime(nextYearStartLocal, timezone);
            endBoundUtc = addMinutes(nextYearStartUtc, offsetMinutes);
            break;
        case "daily":
        default:
            // 24 hours later
            endBoundUtc = addDays(startBoundUtc, 1);
            break;
    }

    // We now have absolute Date objects representing the start and end of the business reporting period in UTC.
    // However, our SQL Server natively thinks it is UTC+8 (Asia/Singapore) and stores rows as UTC+8.
    // So we must format these absolute UTC Dates into 'yyyy-MM-dd HH:mm:ss' strings in Asia/Singapore time
    // so the SQL WHERE clause correctly matches the physical timestamps in the DB.
    
    // NOTE: This ensures that no matter where the business is located, their local reporting bounds 
    // are correctly translated to the Singapore server's physical timeline.
    const startSqlStr = formatInTimeZone(startBoundUtc, 'Asia/Singapore', 'yyyy-MM-dd HH:mm:ss');
    const endSqlStr = formatInTimeZone(endBoundUtc, 'Asia/Singapore', 'yyyy-MM-dd HH:mm:ss');

    return {
        startSqlStr,
        endSqlStr,
        // Also returning the raw UTC bounds in case needed
        startBoundUtc,
        endBoundUtc
    };
}

module.exports = {
    getBusinessDatePrefix,
    getBusinessDaySqlBounds
};
