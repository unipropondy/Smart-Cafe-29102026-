import React, { useMemo, useState, useEffect } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Platform, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Theme } from "../constants/theme";
import { Fonts } from "../constants/Fonts";
import { format, isSameDay, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, isSameMonth, isBefore, isAfter, addMonths, setMonth, setYear } from "date-fns";

interface CalendarPickerProps {
  selectedDate: string;
  onDateChange: (date: string) => void;
  rangeStart?: string | null;
  rangeEnd?: string | null;
  onRangeChange?: (start: string, end: string) => void;
  isRangeMode?: boolean;
  onModeChange?: (isRange: boolean) => void;
  onlyAllowToday?: boolean;
  maxDate?: string | Date;
  disableFutureDates?: boolean;
}

type ViewMode = "calendar" | "month" | "year";

const parseLocalDate = (dateStr: string | null | undefined): Date => {
  if (!dateStr) return new Date();
  const parts = dateStr.split("-");
  if (parts.length === 3) {
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    return new Date(year, month, day);
  }
  return new Date(dateStr);
};

export default function CalendarPicker({ 
  selectedDate, 
  onDateChange, 
  rangeStart, 
  rangeEnd, 
  onRangeChange,
  isRangeMode = false,
  onModeChange,
  onlyAllowToday = false,
  maxDate,
  disableFutureDates = false,
}: CalendarPickerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("calendar");
  const [viewDate, setViewDate] = useState(() => parseLocalDate(selectedDate));

  const isFutureDate = (d: Date) => {
    if (disableFutureDates) {
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      return isAfter(d, today);
    }
    if (maxDate) {
      const max = maxDate instanceof Date ? new Date(maxDate) : parseLocalDate(maxDate);
      max.setHours(23, 59, 59, 999);
      return isAfter(d, max);
    }
    return false;
  };

  useEffect(() => {
    setViewDate(parseLocalDate(selectedDate));
  }, [selectedDate]);

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(viewDate));
    const end = endOfWeek(endOfMonth(viewDate));
    const result = [];
    let current = start;
    while (current <= end) {
      result.push(current);
      current = addDays(current, 1);
    }
    return result;
  }, [viewDate]);

  const isDateToday = (d: Date) => {
    return isSameDay(d, new Date()) || (Boolean(selectedDate) && isSameDay(d, parseLocalDate(selectedDate)));
  };

  const handleDatePress = (date: Date) => {
    if (onlyAllowToday && !isDateToday(date)) {
      return;
    }
    if (isFutureDate(date)) {
      return;
    }
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    const formattedDate = format(date, "yyyy-MM-dd");

    if (isRangeMode) {
      if (!rangeStart || (rangeStart && rangeEnd)) {
        onRangeChange?.(formattedDate, "");
      } else {
        const start = parseLocalDate(rangeStart);
        if (isBefore(date, start)) {
          onRangeChange?.(formattedDate, rangeStart);
        } else {
          onRangeChange?.(rangeStart, formattedDate);
        }
      }
    } else {
      onDateChange(formattedDate);
    }
  };

  const changeMonth = (offset: number) => {
    setViewDate(prev => addMonths(prev, offset));
  };

  const selectMonth = (monthIndex: number) => {
    setViewDate(prev => setMonth(prev, monthIndex));
    setViewMode("calendar");
  };

  const selectYear = (year: number) => {
    setViewDate(prev => setYear(prev, year));
    setViewMode("month");
  };

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const years = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const maxYear = (disableFutureDates || maxDate) ? currentYear : currentYear + 1;
    const res = [];
    for (let i = currentYear - 10; i <= maxYear; i++) res.push(i);
    return res;
  }, [disableFutureDates, maxDate]);

  if (viewMode === "year") {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.monthText}>Select Year</Text>
          <TouchableOpacity onPress={() => setViewMode("calendar")}>
            <Ionicons name="close" size={20} color={Theme.textPrimary} />
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.grid}>
          {years.map(y => (
            <TouchableOpacity 
              key={y} 
              onPress={() => selectYear(y)}
              style={[styles.pickerItem, viewDate.getFullYear() === y && styles.selectedPickerItem]}
            >
              <Text style={[styles.pickerItemText, viewDate.getFullYear() === y && styles.selectedPickerItemText]}>{y}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    );
  }

  if (viewMode === "month") {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setViewMode("year")}>
            <Text style={styles.monthText}>{viewDate.getFullYear()}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setViewMode("calendar")}>
            <Ionicons name="close" size={20} color={Theme.textPrimary} />
          </TouchableOpacity>
        </View>
        <View style={styles.grid}>
          {months.map((m, i) => {
            const now = new Date();
            const isFutureMonth = Boolean((disableFutureDates || maxDate) && viewDate.getFullYear() === now.getFullYear() && i > now.getMonth());
            return (
              <TouchableOpacity 
                key={m} 
                disabled={isFutureMonth}
                onPress={() => selectMonth(i)}
                style={[
                  styles.pickerItem, 
                  viewDate.getMonth() === i && styles.selectedPickerItem,
                  isFutureMonth && { opacity: 0.25 }
                ]}
              >
                <Text style={[styles.pickerItemText, viewDate.getMonth() === i && styles.selectedPickerItemText]}>{m}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Mode Toggle inside Calendar */}
      {!!onModeChange && (
        <View style={styles.modeToggleContainer}>
          <TouchableOpacity 
            onPress={() => onModeChange?.(false)}
            style={[styles.modeBtn, !isRangeMode && styles.activeModeBtn]}
          >
            <Text style={[styles.modeBtnText, !isRangeMode && styles.activeModeBtnText]}>SINGLE</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            onPress={() => onModeChange?.(true)}
            style={[styles.modeBtn, isRangeMode && styles.activeModeBtn]}
          >
            <Text style={[styles.modeBtnText, isRangeMode && styles.activeModeBtnText]}>RANGE</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => changeMonth(-1)}
          style={[styles.navBtn, onlyAllowToday && { opacity: 0.25 }]}
          disabled={onlyAllowToday}
        >
          <Ionicons name="chevron-back" size={22} color={Theme.textPrimary} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => !onlyAllowToday && setViewMode("month")}
          style={styles.monthTitleBtn}
          disabled={onlyAllowToday}
        >
          <Text style={styles.monthText}>{format(viewDate, "MMMM yyyy")}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => changeMonth(1)}
          style={[styles.navBtn, onlyAllowToday && { opacity: 0.25 }]}
          disabled={onlyAllowToday}
        >
          <Ionicons name="chevron-forward" size={22} color={Theme.textPrimary} />
        </TouchableOpacity>
      </View>

      <View style={styles.weekRow}>
        {["S", "M", "T", "W", "T", "F", "S"].map((day, i) => (
          <Text key={i} style={styles.weekText}>{day}</Text>
        ))}
      </View>

      <View style={styles.grid}>
        {days.map((day, i) => {
          const isSelected = !isRangeMode && isSameDay(day, parseLocalDate(selectedDate));
          const isCurrentMonth = isSameMonth(day, viewDate);
          let isInRange = false, isRangeStart = false, isRangeEnd = false;
          if (rangeStart) {
            isRangeStart = isSameDay(day, parseLocalDate(rangeStart));
            if (rangeEnd) {
              isRangeEnd = isSameDay(day, parseLocalDate(rangeEnd));
              isInRange = isAfter(day, parseLocalDate(rangeStart)) && isBefore(day, parseLocalDate(rangeEnd));
            }
          }
          const isRangePoint = isRangeStart || isRangeEnd;
          const isToday = isDateToday(day);
          const isFuture = isFutureDate(day);
          const isDisabled = (onlyAllowToday && !isToday) || isFuture;

          return (
            <TouchableOpacity
              key={i}
              disabled={isDisabled}
              style={[
                styles.day,
                isSelected && styles.selectedDay,
                isRangeMode && isRangePoint && styles.selectedDay,
                isRangeMode && isInRange && styles.inRangeDay,
                isRangeMode && isRangeStart && rangeEnd && { borderTopRightRadius: 0, borderBottomRightRadius: 0 },
                isRangeMode && isRangeEnd && { borderTopLeftRadius: 0, borderBottomLeftRadius: 0 },
                !isCurrentMonth && styles.otherMonthDay,
                isDisabled && {
                  opacity: 0.18,
                  ...(Platform.OS === "web" ? ({ cursor: "not-allowed" } as any) : {}),
                },
              ]}
              onPress={() => handleDatePress(day)}
            >
              <Text style={[styles.dayText, (isSelected || isRangePoint) && styles.selectedDayText, isInRange && styles.inRangeText]}>
                {format(day, "d")}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { 
    padding: 12, 
    backgroundColor: Theme.bgCard, 
    borderRadius: 20, 
    borderWidth: 1,
    borderColor: Theme.border,
    ...Theme.shadowLg 
  },
  header: { 
    flexDirection: "row", 
    justifyContent: "space-between", 
    alignItems: "center", 
    marginBottom: 12, 
    minHeight: 40 
  },
  navBtn: { 
    width: 32, 
    height: 32, 
    borderRadius: 10, 
    backgroundColor: Theme.bgNav, 
    justifyContent: "center", 
    alignItems: "center", 
    borderWidth: 1, 
    borderColor: Theme.border 
  },
  monthTitleBtn: { 
    flex: 1, 
    alignItems: "center",
    marginHorizontal: 8,
  },
  monthText: { 
    fontSize: 15, 
    fontFamily: Fonts.black, 
    color: Theme.textPrimary,
    letterSpacing: 0.5
  },
  weekRow: { 
    flexDirection: "row", 
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: Theme.border + "40",
    paddingBottom: 8,
  },
  weekText: { 
    flex: 1, 
    textAlign: "center", 
    color: Theme.textMuted, 
    fontFamily: Fonts.bold, 
    fontSize: 10,
    textTransform: "uppercase"
  },
  grid: { 
    flexDirection: "row", 
    flexWrap: "wrap",
    marginTop: 4
  },
  day: { 
    width: "14.28%", 
    aspectRatio: 1, 
    justifyContent: "center", 
    alignItems: "center", 
    borderRadius: 10,
    marginVertical: 1
  },
  dayText: { 
    fontSize: 12, 
    fontFamily: Fonts.bold, 
    color: Theme.textPrimary 
  },
  selectedDay: { 
    backgroundColor: Theme.primary,
    ...Theme.shadowSm
  },
  selectedDayText: { 
    color: "#fff", 
    fontFamily: Fonts.black 
  },
  otherMonthDay: { 
    opacity: 0.25 
  },
  inRangeDay: { 
    backgroundColor: Theme.primary + "15", 
    borderRadius: 0 
  },
  inRangeText: { 
    color: Theme.primary,
    fontFamily: Fonts.black
  },
  modeToggleContainer: { 
    flexDirection: "row", 
    backgroundColor: Theme.bgNav, 
    borderRadius: 12, 
    padding: 2, 
    marginBottom: 16, 
    borderWidth: 1, 
    borderColor: Theme.border 
  },
  modeBtn: { 
    flex: 1, 
    paddingVertical: 7, 
    alignItems: "center", 
    borderRadius: 10 
  },
  activeModeBtn: { 
    backgroundColor: Theme.bgCard, 
    ...Theme.shadowSm,
    borderWidth: 1,
    borderColor: Theme.primary + "20"
  },
  modeBtnText: { 
    fontSize: 10, 
    fontFamily: Fonts.black, 
    color: Theme.textMuted 
  },
  activeModeBtnText: { 
    color: Theme.primary 
  },
  pickerItem: { 
    width: "30%", 
    margin: "1.5%", 
    paddingVertical: 14, 
    alignItems: "center", 
    borderRadius: 12, 
    backgroundColor: Theme.bgNav, 
    borderWidth: 1, 
    borderColor: Theme.border 
  },
  selectedPickerItem: { 
    backgroundColor: Theme.primary, 
    borderColor: Theme.primary 
  },
  pickerItemText: { 
    fontSize: 13, 
    fontFamily: Fonts.bold, 
    color: Theme.textSecondary 
  },
  selectedPickerItemText: { 
    color: "#fff", 
    fontFamily: Fonts.black 
  },
});
